import { animalForItem, getAnimal, getItem } from '@terrago/game-data';
import { ANIMAL_FEED_MS, PEN_CAPACITY, animalReady, removeFromSlot, removeItemById, type AnimalState } from '@terrago/shared';
import { GameError, withTransaction, type Pool, type Tx } from '../db';
import { giveItems } from './gathering';
import { loadSlots, lockCharacter, toState, writeSlots } from './inventory';
import { logItemMovement } from './ledger';
import { getSkill, grantSkillXpTx, type ProgressDelta } from './progress';
import { specFor } from './specs';

/** Farm animals in the homestead pen: feed them, collect eggs, wool and milk. */

async function rows(db: Pool | Tx, id: string, lock = false): Promise<AnimalState[]> {
  const { rows } = await db.query(
    `SELECT id, kind, fed_until, collected_at FROM farm_animals WHERE character_id = $1 ORDER BY id ${lock ? 'FOR UPDATE' : ''}`,
    [id],
  );
  const now = Date.now();
  return rows.map((r) => {
    const a = { id: Number(r.id), kind: r.kind, fedUntil: new Date(r.fed_until).getTime(), collectedAt: new Date(r.collected_at).getTime(), ready: 0 };
    const def = getAnimal(a.kind);
    return { ...a, ready: def ? animalReady(a, def, now) : 0 };
  });
}

export function listAnimals(pool: Pool, id: string): Promise<AnimalState[]> {
  return rows(pool, id);
}

async function tierOf(tx: Tx, id: string): Promise<number> {
  await tx.query('INSERT INTO farms (character_id) VALUES ($1) ON CONFLICT DO NOTHING', [id]);
  return (await tx.query('SELECT tier FROM farms WHERE character_id = $1', [id])).rows[0].tier;
}

/** Release an animal from your bag into the pen. */
export async function addAnimal(pool: Pool, id: string, slot: unknown) {
  if (!Number.isInteger(slot)) throw new GameError('Pick an animal from your bag.');
  return withTransaction(pool, async (tx) => {
    const { gold } = await lockCharacter(tx, id);
    const bag = await loadSlots(tx, id);
    const item = bag.slots[slot as number];
    const def = item ? animalForItem(item.itemId) : undefined;
    if (!item || !def) throw new GameError("That's not an animal.");
    const lvl = (await getSkill(tx, id, 'farming')).level;
    if (lvl < def.level) throw new GameError(`${def.name}s need Farming level ${def.level}.`);
    const cap = PEN_CAPACITY[await tierOf(tx, id)] ?? 2;
    const have = (await rows(tx, id, true)).length;
    if (have >= cap) throw new GameError(`Your pen holds ${cap} animals. Upgrade your farm with Farmer Rowan for more room.`);
    const res = removeFromSlot(bag.slots, slot as number, 1);
    if (!res.ok) throw new GameError(res.error);
    await writeSlots(tx, id, res.slots, [slot as number]);
    await logItemMovement(tx, { itemId: item.itemId, quantity: 1, from: id, reason: 'consume', ref: { type: 'pen', id: def.id } });
    await tx.query(`INSERT INTO farm_animals (character_id, kind) VALUES ($1, $2)`, [id, def.id]);
    return { inventory: toState(bag.capacity, gold, res.slots), animals: await rows(tx, id), message: `Welcome to the pen, little ${def.name.toLowerCase()}! Feed it to get ${getItem(def.product)?.name.toLowerCase()}.` };
  });
}

/** Feed every animal that will be hungry within half a day (one Animal Feed each). */
export async function feedAnimals(pool: Pool, id: string) {
  return withTransaction(pool, async (tx) => {
    const { gold } = await lockCharacter(tx, id);
    const now = Date.now();
    const list = await rows(tx, id, true);
    const hungry = list.filter((a) => a.fedUntil - now < ANIMAL_FEED_MS / 2);
    if (!hungry.length) throw new GameError(list.length ? 'Everyone is well fed.' : 'Your pen is empty.');
    const bag = await loadSlots(tx, id);
    let slots = bag.slots;
    const changed = new Set<number>();
    let fed = 0;
    for (const a of hungry) {
      const r = removeItemById(slots, 'animal_feed', 1);
      if (!r.ok) break;
      slots = r.slots;
      r.changed.forEach((c) => changed.add(c));
      // Hungry time makes nothing: shift the production clock past the gap, keep earlier progress.
      const collected = a.fedUntil >= now ? a.collectedAt : a.collectedAt < a.fedUntil ? a.collectedAt + (now - a.fedUntil) : now;
      await tx.query(`UPDATE farm_animals SET fed_until = $2, collected_at = $3 WHERE id = $1`, [a.id, new Date(now + ANIMAL_FEED_MS), new Date(collected)]);
      fed++;
    }
    if (!fed) throw new GameError('You need Animal Feed (Farmer Rowan sells it, or mill wheat at a mill).');
    await writeSlots(tx, id, slots, [...changed]);
    await logItemMovement(tx, { itemId: 'animal_feed', quantity: fed, from: id, reason: 'consume', ref: { type: 'pen', id: 'feed' } });
    return { inventory: toState(bag.capacity, gold, slots), animals: await rows(tx, id), message: `Fed ${fed} animal${fed === 1 ? '' : 's'}.${fed < hungry.length ? ' You ran out of feed!' : ''}` };
  });
}

/** Collect everything the animals produced. Animal Keepers get double. */
export async function collectAnimals(pool: Pool, id: string) {
  return withTransaction(pool, async (tx) => {
    const { gold } = await lockCharacter(tx, id);
    const list = await rows(tx, id, true);
    const keeper = (await specFor(tx, id, 'farming')) === 'animal_keeper';
    const now = Date.now();
    const gifts = new Map<string, number>();
    for (const a of list) {
      const def = getAnimal(a.kind);
      if (!def || a.ready <= 0) continue;
      gifts.set(def.product, (gifts.get(def.product) ?? 0) + a.ready * (keeper ? 2 : 1));
      // Keep the leftover fed time toward the next product.
      const used = a.ready * def.everyMs;
      await tx.query(`UPDATE farm_animals SET collected_at = $2 WHERE id = $1`, [a.id, new Date(Math.min(now, a.collectedAt + used))]);
    }
    if (!gifts.size) throw new GameError('Nothing to collect yet. Fed animals make something every half hour or so.');
    const bag = await loadSlots(tx, id);
    const changed = new Set<number>();
    const items = [...gifts].map(([itemId, quantity]) => ({ itemId, quantity, quality: 0 }));
    const slots = await giveItems(tx, id, bag.slots, items, 'harvest', changed);
    await writeSlots(tx, id, slots, [...changed]);
    const total = items.reduce((n, i) => n + i.quantity, 0);
    const s = await grantSkillXpTx(tx, id, 'farming', total * 3);
    const delta: ProgressDelta = { skill: { id: 'farming', progress: s, levelsGained: s.levelsGained } };
    return {
      inventory: toState(bag.capacity, gold, slots),
      animals: await rows(tx, id),
      delta,
      message: `Collected ${items.map((i) => `${i.quantity}× ${getItem(i.itemId)?.name}`).join(', ')}${keeper ? ' (Animal Keeper bonus!)' : ''}.`,
    };
  });
}
