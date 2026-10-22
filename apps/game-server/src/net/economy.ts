import { DUNGEONS, getItem, getMap, waystones } from '@terrago/game-data';
import { DIFFICULTIES, TILE_SIZE, sanitizeChatText, maskProfanity, type StallView, type TravelOption } from '@terrago/shared';
import { GameError, withTransaction } from '../db';
import { bankMove, bankUpgrade, bankView } from '../services/bank';
import { addAnimal, collectAnimals, feedAnimals, listAnimals } from '../services/animals';
import { changeGold } from '../services/ledger';
import { lockCharacter } from '../services/inventory';
import { buyFromStall } from '../services/market';
import type { Player } from '../world/player';
import { antibot } from '../security/antibot';
import { applyDelta, npcService, pushInventory, type GameplayDeps } from './gameplay';

/**
 * Bank vaults, waystone travel and player market stalls.
 */

// --- Bank --------------------------------------------------------------------

export const bank = {
  get(deps: GameplayDeps, p: Player, npcId: unknown) {
    npcService(deps.world, p, npcId, 'bank');
    return bankView(deps.pool, p.id);
  },
  async move(deps: GameplayDeps, p: Player, req: unknown) {
    const r = (req ?? {}) as { npcId?: unknown; dir?: unknown; slot?: unknown };
    npcService(deps.world, p, r.npcId, 'bank');
    if (r.dir !== 'deposit' && r.dir !== 'withdraw') throw new GameError('Deposit or withdraw?');
    if (r.dir === 'deposit' && p.stall?.prices.has(r.slot as number)) throw new GameError('That item is on sale in your stall.');
    const res = await bankMove(deps.pool, p.id, r.dir, r.slot);
    pushInventory(deps.world, p, res.inventory);
    return res.bank;
  },
  async upgrade(deps: GameplayDeps, p: Player, npcId: unknown) {
    npcService(deps.world, p, npcId, 'bank');
    const res = await bankUpgrade(deps.pool, p.id);
    const inv = deps.world.inventoryCache.get(p.id);
    if (inv) pushInventory(deps.world, p, { ...inv, gold: res.gold });
    return { message: res.message, bank: res.bank };
  },
};

// --- Waystones ---------------------------------------------------------------

function atWaystone(p: Player): boolean {
  const def = getMap(p.mapId);
  if (!def || p.instanceOwner) return false;
  return def.objects.some(
    (o) => o.kind === 'prop' && o.type === 'teleport_pad' && p.x >= (o.x - 1) * TILE_SIZE && p.x <= (o.x + 4) * TILE_SIZE && p.y >= (o.y - 1) * TILE_SIZE && p.y <= (o.y + 4) * TILE_SIZE,
  );
}

async function known(deps: GameplayDeps, p: Player): Promise<Set<string>> {
  const { rows } = await deps.pool.query(`SELECT flag FROM character_flags WHERE character_id = $1 AND flag LIKE 'visited:%'`, [p.id]);
  const out = new Set(rows.map((r) => (r.flag as string).slice(8)));
  out.add('greenhaven');
  out.add('sunfield_plains');
  // Older characters: count anywhere at or below your level as discovered.
  for (const w of waystones()) if ((getMap(w.mapId)?.levels?.[0] ?? 1) <= p.rec.level) out.add(w.mapId);
  return out;
}

export async function travelList(deps: GameplayDeps, p: Player): Promise<{ atWaystone: boolean; options: TravelOption[] }> {
  const k = await known(deps, p);
  return {
    atWaystone: atWaystone(p),
    options: waystones().map((w) => ({ mapId: w.mapId, name: w.name, fee: w.fee, known: k.has(w.mapId), here: w.mapId === p.mapId })),
  };
}

export async function travelGo(deps: GameplayDeps, p: Player, mapId: unknown): Promise<{ message: string }> {
  const w = waystones().find((x) => x.mapId === mapId);
  if (!w) throw new GameError('Unknown destination.');
  if (!atWaystone(p)) throw new GameError('Stand on a waystone to travel.');
  if (w.mapId === p.mapId) throw new GameError("You're already here.");
  if (p.dead || Date.now() - p.lastCombatAt < 5000) throw new GameError("You can't travel in the middle of a fight.");
  if (!(await known(deps, p)).has(w.mapId)) throw new GameError(`Visit ${w.name} on foot once to attune its waystone.`);
  const gold = await withTransaction(deps.pool, async (tx) => {
    await lockCharacter(tx, p.id);
    return (await changeGold(tx, p.id, -w.fee, 'teleport', { type: 'waystone', id: w.mapId })).after;
  });
  const inv = deps.world.inventoryCache.get(p.id);
  if (inv) pushInventory(deps.world, p, { ...inv, gold });
  deps.world.setMount(p, null, 1);
  await deps.world.moveTo(p, w.mapId, null, w.x, w.y + 2, 'down');
  return { message: `The waystone hums… welcome to ${w.name}! (-${w.fee} Gold)` };
}

/** Remember regions you've walked into (unlocks their waystones). */
export async function rememberVisit(deps: GameplayDeps, p: Player): Promise<void> {
  if (!waystones().some((w) => w.mapId === p.mapId)) return;
  await deps.pool.query(`INSERT INTO character_flags (character_id, flag) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [p.id, `visited:${p.mapId}`]);
}

// --- Player stalls -----------------------------------------------------------

const MAX_STALL_ITEMS = 12;

export function openStall(deps: GameplayDeps, p: Player, req: unknown): { message: string } {
  const r = (req ?? {}) as { name?: unknown; items?: unknown };
  const def = getMap(p.mapId);
  if (!def?.safeZone || p.instanceOwner) throw new GameError('Open your stall in a town (like Greenhaven).');
  if (p.mount) throw new GameError('Get off your mount first.');
  const name = maskProfanity(sanitizeChatText(r.name, 24) ?? '').trim();
  if (name.length < 3) throw new GameError('Give your stall a name (3–24 letters).');
  if (!Array.isArray(r.items) || r.items.length === 0 || r.items.length > MAX_STALL_ITEMS) throw new GameError(`Put 1–${MAX_STALL_ITEMS} items on sale.`);
  const inv = deps.world.inventoryCache.get(p.id);
  const prices = new Map<number, { itemId: string; price: number }>();
  for (const it of r.items as { slot?: unknown; price?: unknown }[]) {
    const s = inv?.slots.find((x) => x.slot === it?.slot);
    const price = Number(it?.price);
    if (!s) throw new GameError('That item is not in your bag.');
    const d = getItem(s.itemId);
    if (!d?.tradable || s.bound) throw new GameError(`${d?.name ?? 'That item'} can't be sold.`);
    if (!Number.isSafeInteger(price) || price < 1 || price > 10_000_000) throw new GameError('Prices must be 1–10,000,000 Gold each.');
    prices.set(s.slot, { itemId: s.itemId, price });
  }
  p.stall = { name, prices };
  deps.world.broadcastLook(p, { shop: name });
  return { message: `Your stall "${name}" is open. Moving closes it.` };
}

export function closeStall(deps: GameplayDeps, p: Player, quiet = false): null {
  if (!p.stall) return null;
  p.stall = null;
  deps.world.broadcastLook(p, { shop: null });
  if (!quiet) p.conn?.send('notice', { kind: 'info', text: 'Your stall is closed.' });
  return null;
}

export function viewStall(deps: GameplayDeps, p: Player, sellerId: unknown): StallView {
  const q = typeof sellerId === 'string' ? deps.world.players.get(sellerId) : undefined;
  if (!q?.stall) throw new GameError('That stall is closed.');
  if (q.mapId !== p.mapId || Math.hypot(q.x - p.x, q.y - p.y) > 8 * TILE_SIZE) throw new GameError('Walk closer to the stall.');
  const inv = deps.world.inventoryCache.get(q.id);
  const items = [...q.stall.prices]
    .map(([slot, l]) => {
      const s = inv?.slots.find((x) => x.slot === slot && x.itemId === l.itemId);
      return s ? { slot, itemId: s.itemId, quantity: s.quantity, quality: s.quality, enhance: s.enhance ?? 0, price: l.price } : null;
    })
    .filter((x): x is NonNullable<typeof x> => !!x);
  return { sellerId: q.id, sellerName: q.name, name: q.stall.name, items };
}

export async function buyStall(deps: GameplayDeps, p: Player, req: unknown): Promise<{ message: string }> {
  const r = (req ?? {}) as { sellerId?: unknown; slot?: unknown; itemId?: unknown; price?: unknown };
  const q = typeof r.sellerId === 'string' ? deps.world.players.get(r.sellerId) : undefined;
  if (!q?.stall) throw new GameError('That stall is closed.');
  if (q.mapId !== p.mapId || Math.hypot(q.x - p.x, q.y - p.y) > 8 * TILE_SIZE) throw new GameError('Walk closer to the stall.');
  const listed = q.stall.prices.get(r.slot as number);
  // The buyer must agree to the price the seller set right now (no bait-and-switch).
  if (!listed || listed.itemId !== r.itemId || listed.price !== r.price) throw new GameError('The price or item changed. Have another look.');
  // Row locks inside the transaction keep this safe against the seller's own actions.
  const res = await buyFromStall(deps.pool, p.id, q.id, r.slot as number, { itemId: listed.itemId, unitPrice: listed.price });
  pushInventory(deps.world, p, res.buyer);
  pushInventory(deps.world, q, res.seller);
  q.stall?.prices.delete(r.slot as number);
  void antibot?.trade(q.id, p.id).catch(() => {});
  q.conn?.send('notice', { kind: 'success', text: `${p.name} bought ${res.qty}× ${res.itemName} from your stall: +${Math.floor(res.total * 0.97).toLocaleString()} Gold.` });
  if (q.stall && q.stall.prices.size === 0) closeStall(deps, q);
  return { message: `Bought ${res.qty}× ${res.itemName} for ${res.total.toLocaleString()} Gold.` };
}

// --- Farm animals ------------------------------------------------------------

function atPen(p: Player): void {
  const def = getMap(p.mapId);
  const pen = def?.pen;
  if (!pen || p.instanceOwner?.id !== p.id) throw new GameError('Tend your animals at the pen on your homestead.');
  const tx = p.x / TILE_SIZE;
  const ty = p.y / TILE_SIZE;
  if (tx < pen.x - 3 || tx > pen.x + pen.w + 3 || ty < pen.y - 3 || ty > pen.y + pen.h + 3) throw new GameError('Walk over to the animal pen.');
}

export const animals = {
  get(deps: GameplayDeps, p: Player) {
    return listAnimals(deps.pool, p.id);
  },
  async add(deps: GameplayDeps, p: Player, slot: unknown) {
    atPen(p);
    const r = await addAnimal(deps.pool, p.id, slot);
    pushInventory(deps.world, p, r.inventory);
    p.conn?.send('notice', { kind: 'success', text: r.message });
    return r.animals;
  },
  async feed(deps: GameplayDeps, p: Player) {
    atPen(p);
    const r = await feedAnimals(deps.pool, p.id);
    pushInventory(deps.world, p, r.inventory);
    p.conn?.send('notice', { kind: 'success', text: r.message });
    return r.animals;
  },
  async collect(deps: GameplayDeps, p: Player) {
    atPen(p);
    const r = await collectAnimals(deps.pool, p.id);
    pushInventory(deps.world, p, r.inventory);
    applyDelta(deps.world, p, r.delta);
    p.conn?.send('notice', { kind: 'success', text: r.message });
    return r.animals;
  },
};

// --- Dungeon gates -----------------------------------------------------------

/** Enter a dungeon from its gate with a chosen difficulty (the party follows the leader's choice). */
export async function enterDungeon(deps: GameplayDeps, p: Player, req: unknown): Promise<{ message: string }> {
  const r = (req ?? {}) as { dungeonId?: unknown; difficulty?: unknown };
  const d = DUNGEONS.find((x) => x.id === r.dungeonId);
  const diff = DIFFICULTIES.find((x) => x.id === r.difficulty);
  if (!d || !diff) throw new GameError('Unknown dungeon.');
  if (d.entrance.map !== p.mapId || Math.hypot(p.x - (d.entrance.x + 1.5) * TILE_SIZE, p.y - (d.entrance.y + 2) * TILE_SIZE) > 5 * TILE_SIZE)
    throw new GameError('Stand at the dungeon gate.');
  if (p.rec.level < diff.minLevel) throw new GameError(`${diff.name} needs level ${diff.minLevel}.`);
  if (p.party && p.party.leaderId !== p.id) {
    const leader = deps.world.players.get(p.party.leaderId);
    await deps.world.enterDungeon(p, `dg_${d.id}`);
    return { message: `You joined your party leader's run${leader ? ` (${leader.dungeonDifficulty})` : ''}.` };
  }
  p.dungeonDifficulty = diff.id;
  await deps.world.enterDungeon(p, `dg_${d.id}`);
  return { message: `${d.name} — ${diff.name}. Good luck!` };
}
