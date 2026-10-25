import { getItem } from '@terrago/game-data';
import {
  MOUNT_CHANNEL_MS,
  MOUNT_STYLES,
  PET_GROWTH,
  PET_GROWTH_MAX,
  PET_MAX_LEVEL,
  PET_EVOLVE_LOYALTY,
  PET_STAGES,
  removeItemById,
  getMountStyle,
  petFoodValue,
  petGrowthPoints,
  petStats,
  petXpToNext,
  spentGrowth,
  type MountLook,
  type PetGrowthId,
  type PetMenuState,
  type PetView,
  type StableState,
} from '@terrago/shared';
import { GameError, withTransaction, type Pool } from '../db';
import { consumeFromSlotTx, loadSlots, lockCharacter, toState, writeSlots } from '../services/inventory';
import { changeGold, logItemMovement } from '../services/ledger';
import type { Player, PetState } from '../world/player';
import { npcService, pushInventory, questEvent, type GameplayDeps } from './gameplay';

// ---------------------------------------------------------------------------
// Mounts
// ---------------------------------------------------------------------------

function ownedMounts(deps: GameplayDeps, p: Player): string[] {
  const out: string[] = [];
  for (const s of deps.world.inventoryCache.get(p.id)?.slots ?? []) {
    if (getItem(s.itemId)?.mount && !out.includes(s.itemId)) out.push(s.itemId);
  }
  return out;
}

/** The mount the player rides: the one picked in the stable, else their fastest. */
function rideable(deps: GameplayDeps, p: Player): string | null {
  const owned = ownedMounts(deps, p).filter((id) => p.rec.level >= getItem(id)!.levelRequirement);
  if (p.mountChoice && owned.includes(p.mountChoice)) return p.mountChoice;
  let best: string | null = null;
  for (const id of owned) if (!best || getItem(id)!.mount!.speed > getItem(best)!.mount!.speed) best = id;
  return best;
}

/** Load the stable choice and mount look when a character enters the world. */
export async function loadCompanions(deps: GameplayDeps, p: Player): Promise<void> {
  const r = await deps.pool.query<{ mount_choice: string | null; mount_look: MountLook }>(`SELECT mount_choice, mount_look FROM characters WHERE id = $1`, [p.id]);
  p.mountChoice = r.rows[0]?.mount_choice ?? null;
  p.mountLook = r.rows[0]?.mount_look ?? {};
  p.conn?.send('self:update', { mountLook: p.mountLook });
  if (p.mount) deps.world.broadcastLook(p, { mountLook: p.mountLook });
  await syncCompanion(deps, p);
}

/**
 * Mount button / Z: start getting on (0.5 s; moving or a hit cancels), or get
 * off right away. Fighting gets you off automatically, with no penalty.
 */
export function toggleMount(deps: GameplayDeps, p: Player): { mount: string | null; channelMs?: number } {
  const { world } = deps;
  if (p.mount) {
    world.setMount(p, null);
    return { mount: null };
  }
  if (p.mountChannel) {
    world.cancelMountChannel(p, null);
    return { mount: null };
  }
  if (p.dead) throw new GameError("You can't ride right now.");
  if (world.runtimeOf(p).def.theme === 'cave') throw new GameError('Mounts refuse to go into the mine tunnels.');
  if (Date.now() - p.lastCombatAt < 4000) throw new GameError("You can't mount up in the middle of a fight.");
  if (p.pose) throw new GameError('Stand up first.');
  const id = rideable(deps, p);
  if (!id) throw new GameError("You don't own a mount yet. Stablemaster Hana in Oakhaven can help.");
  world.startMountChannel(p, id, MOUNT_CHANNEL_MS);
  return { mount: null, channelMs: MOUNT_CHANNEL_MS };
}

export function onMounted(deps: GameplayDeps, p: Player): void {
  questEvent(deps, p, 'mount', null);
}

async function stableState(deps: GameplayDeps, p: Player): Promise<StableState> {
  const r = await deps.pool.query<{ style_id: string }>(`SELECT style_id FROM character_mount_styles WHERE character_id = $1`, [p.id]);
  const styles = [...MOUNT_STYLES.filter((s) => s.price === 0).map((s) => s.id), ...r.rows.map((x) => x.style_id)];
  return { owned: ownedMounts(deps, p), chosen: p.mountChoice, styles, look: p.mountLook };
}

export const stable = {
  get: (deps: GameplayDeps, p: Player) => stableState(deps, p),

  /** Pick which mount you ride. Swaps right away if you're already riding. */
  async choose(deps: GameplayDeps, p: Player, raw: unknown): Promise<StableState> {
    const id = String(raw ?? '');
    const def = getItem(id);
    if (!def?.mount) throw new GameError('That is not a mount.');
    if (!ownedMounts(deps, p).includes(id)) throw new GameError("You don't have that mount in your bag.");
    if (p.rec.level < def.levelRequirement) throw new GameError(`You need level ${def.levelRequirement} to ride the ${def.name}.`);
    await deps.pool.query(`UPDATE characters SET mount_choice = $2 WHERE id = $1`, [p.id, id]);
    p.mountChoice = id;
    if (p.mount && p.mount !== id) {
      deps.world.setMount(p, null, 1, false);
      deps.world.setMount(p, id);
    }
    return stableState(deps, p);
  },

  /** Put a saddle, barding or trail on your mounts (or take it off). */
  async style(deps: GameplayDeps, p: Player, req: unknown): Promise<StableState> {
    const r = (req ?? {}) as { slot?: unknown; id?: unknown };
    const slot = String(r.slot ?? '') as keyof MountLook;
    if (!['saddle', 'barding', 'trail'].includes(slot)) throw new GameError('Unknown slot.');
    const id = r.id == null ? null : String(r.id);
    if (id) {
      const def = getMountStyle(id);
      if (!def || def.slot !== slot) throw new GameError('That does not go there.');
      const st = await stableState(deps, p);
      if (!st.styles.includes(id)) throw new GameError(`Buy the ${def.name} from Stablemaster Hana first.`);
    }
    const look: MountLook = { ...p.mountLook, [slot]: id };
    await deps.pool.query(`UPDATE characters SET mount_look = $2 WHERE id = $1`, [p.id, JSON.stringify(look)]);
    p.mountLook = look;
    if (p.mount) deps.world.broadcastLook(p, { mountLook: look });
    p.conn?.send('self:update', { mountLook: look });
    return stableState(deps, p);
  },

  /** Buy a saddle, barding or trail from Stablemaster Hana. */
  async buyStyle(deps: GameplayDeps, p: Player, req: unknown): Promise<StableState> {
    const r = (req ?? {}) as { id?: unknown; npcId?: unknown };
    npcService(deps.world, p, r.npcId, 'shop');
    if (r.npcId !== 'stablemaster_hana') throw new GameError('Only Stablemaster Hana sells mount gear.');
    const def = getMountStyle(String(r.id ?? ''));
    if (!def || def.price <= 0) throw new GameError('That is not for sale.');
    const inv = await withTransaction(deps.pool, async (tx) => {
      const have = await tx.query(`SELECT 1 FROM character_mount_styles WHERE character_id = $1 AND style_id = $2`, [p.id, def.id]);
      if (have.rowCount) throw new GameError(`You already own the ${def.name}.`);
      const g = await changeGold(tx, p.id, -def.price, 'npc_purchase', { type: 'mount_style', id: def.id });
      await tx.query(`INSERT INTO character_mount_styles (character_id, style_id) VALUES ($1, $2)`, [p.id, def.id]);
      return g.after;
    });
    const cached = deps.world.inventoryCache.get(p.id);
    if (cached) pushInventory(deps.world, p, { ...cached, gold: inv });
    return stableState(deps, p);
  },
};

// ---------------------------------------------------------------------------
// Pets
// ---------------------------------------------------------------------------

interface PetRow {
  pet_id: string;
  level: number;
  xp: number;
  loyalty: number;
  growth: PetState['growth'];
  kills: number;
  stage: number;
}

const kindOf = (id: string) => (id === 'hawk' ? 'hawk' : (getItem(id)?.pet?.kind ?? 'dog'));
const nameOf = (id: string) => (id === 'hawk' ? 'Gale Hawk' : (getItem(id)?.name ?? id));

async function loadRows(pool: Pool, characterId: string, ids: string[]): Promise<Map<string, PetRow>> {
  if (!ids.length) return new Map();
  const r = await pool.query<PetRow>(`SELECT pet_id, level, xp, loyalty, growth, kills, stage FROM character_pets WHERE character_id = $1 AND pet_id = ANY($2)`, [characterId, ids]);
  return new Map(r.rows.map((x) => [x.pet_id, x]));
}

async function savePet(pool: Pool, characterId: string, st: PetState): Promise<void> {
  await pool.query(
    `INSERT INTO character_pets (character_id, pet_id, level, xp, loyalty, growth, kills, stage, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, now())
     ON CONFLICT (character_id, pet_id) DO UPDATE SET level = $3, xp = $4, loyalty = $5, growth = $6, kills = $7, stage = $8, updated_at = now()`,
    [characterId, st.id, st.level, st.xp, st.loyalty, JSON.stringify(st.growth), st.kills, st.stage],
  );
}

/** Make sure the live pet state matches the active companion (hawk or pet), loading its saved growth. */
export async function syncCompanion(deps: GameplayDeps, p: Player): Promise<void> {
  const id = p.companionId();
  if (!id) {
    if (p.petState) {
      p.petState = null;
      setPetStage(deps, p);
      deps.world.recomputeSpeed(p);
      p.conn?.send('pet:update', null);
    }
    return;
  }
  if (p.petState?.id === id && !p.petState.stub) return;
  const row = (await loadRows(deps.pool, p.id, [id])).get(id);
  const kind = kindOf(id);
  const keep = p.petState?.id === id ? p.petState : null;
  const level = Math.min(row?.level ?? 1, Math.max(1, p.rec.level));
  p.petState = {
    id,
    kind,
    level,
    xp: row?.xp ?? 0,
    loyalty: row?.loyalty ?? 50,
    growth: row?.growth ?? {},
    kills: row?.kills ?? 0,
    hp: keep && !keep.stub ? keep.hp : petStats(kind, level, row?.stage ?? 1).maxHp,
    koUntil: keep?.koUntil ?? 0,
    attacks: keep?.attacks ?? 0,
    tauntUntil: 0,
    stage: row?.stage ?? 1,
  };
  setPetStage(deps, p);
  deps.world.recomputeSpeed(p);
  p.conn?.send('pet:update', petView(p, p.petState, true));
}

function petView(p: Player, st: PetState, active: boolean): PetView {
  const stats = petStats(st.kind, st.level, st.stage);
  return {
    id: st.id,
    name: nameOf(st.id),
    kind: st.kind,
    active,
    level: st.level,
    xp: st.xp,
    xpToNext: petXpToNext(st.level),
    loyalty: st.loyalty,
    growth: st.growth,
    points: petGrowthPoints(st.level) - spentGrowth(st.growth),
    hp: Math.min(st.hp, stats.maxHp),
    maxHp: stats.maxHp,
    atk: stats.atk,
    aggro: stats.aggro,
    koUntil: st.koUntil,
    stage: st.stage,
    next: (() => {
      const n = PET_STAGES[st.stage];
      return n ? { stage: n.stage, title: n.title, minLevel: n.minLevel, stones: n.stones, gold: n.gold, loyalty: PET_EVOLVE_LOYALTY } : null;
    })(),
  };
}

/** Others see a bigger (and at stage 3, glowing) pet. */
function setPetStage(deps: GameplayDeps, p: Player): void {
  const stage = p.petState && p.petState.id === p.pet ? p.petState.stage : 1;
  if (stage === p.petStage) return;
  p.petStage = stage;
  deps.world.broadcastLook(p, { petStage: stage });
}

/** Add Pet EXP, levelling up to the owner's level (max 100). Returns levels gained. */
export function addPetXp(st: PetState, gained: number, ownerLevel: number): number {
  const cap = Math.min(PET_MAX_LEVEL, Math.max(1, ownerLevel));
  let n = 0;
  st.xp += Math.max(0, Math.floor(gained));
  while (st.level < cap && st.xp >= petXpToNext(st.level)) {
    st.xp -= petXpToNext(st.level);
    st.level++;
    n++;
  }
  // At the owner's level the pet banks EXP up to just short of the next level.
  if (st.level >= cap) st.xp = Math.min(st.xp, Math.max(0, petXpToNext(st.level) - 1));
  if (n) st.hp = petStats(st.kind, st.level, st.stage).maxHp;
  return n;
}

const clampLoyalty = (n: number) => Math.max(0, Math.min(100, Math.round(n)));

/** A kill: the pet siphons 10% of the EXP (the owner keeps all of theirs) and grows more loyal. */
export async function petOnKill(deps: GameplayDeps, p: Player, ownerXp: number): Promise<void> {
  if (!p.companionId()) return;
  await syncCompanion(deps, p);
  const st = p.petState;
  if (!st) return;
  const before = st.level;
  const levels = addPetXp(st, Math.max(1, Math.round(ownerXp * 0.1)), p.rec.level);
  st.kills++;
  if (st.kills % 10 === 0) st.loyalty = clampLoyalty(st.loyalty + 1);
  await savePet(deps.pool, p.id, st);
  if (levels) {
    const pts = petGrowthPoints(st.level) - petGrowthPoints(before);
    p.conn?.send('notice', { kind: 'success', text: `🐾 ${nameOf(st.id)} reached level ${st.level}!${pts ? ' A new Growth Point is ready in the Pet menu (U).' : ''}` });
  }
  p.conn?.send('pet:update', petView(p, st, true));
}

/** The owner died: their pet loses 5 loyalty. */
export async function petOnDeath(deps: GameplayDeps, p: Player): Promise<void> {
  if (!p.companionId()) return;
  await syncCompanion(deps, p);
  const st = p.petState;
  if (!st) return;
  st.loyalty = clampLoyalty(st.loyalty - 5);
  await savePet(deps.pool, p.id, st);
  p.conn?.send('pet:update', petView(p, st, true));
}

async function menu(deps: GameplayDeps, p: Player): Promise<PetMenuState> {
  await syncCompanion(deps, p);
  const ids: string[] = [];
  if (p.rec.job === 'beastmaster') ids.push('hawk');
  for (const s of deps.world.inventoryCache.get(p.id)?.slots ?? []) if (getItem(s.itemId)?.pet && !ids.includes(s.itemId)) ids.push(s.itemId);
  if (p.pet && !ids.includes(p.pet)) ids.push(p.pet);
  const rows = await loadRows(deps.pool, p.id, ids);
  const active = p.petState;
  const pets = ids.map((id) => {
    if (active?.id === id) return petView(p, active, true);
    const r = rows.get(id);
    const kind = kindOf(id);
    const level = r?.level ?? 1;
    const stage = r?.stage ?? 1;
    const st: PetState = { id, kind, level, xp: r?.xp ?? 0, loyalty: r?.loyalty ?? 50, growth: r?.growth ?? {}, kills: r?.kills ?? 0, hp: petStats(kind, level, stage).maxHp, koUntil: 0, attacks: 0, tauntUntil: 0, stage };
    return petView(p, st, false);
  });
  return { active: active ? petView(p, active, true) : null, pets };
}

export const pets = {
  get: (deps: GameplayDeps, p: Player) => menu(deps, p),

  /** Feed the active pet low-tier fish or a pet treat from the bag. */
  async feed(deps: GameplayDeps, p: Player, req: unknown): Promise<PetMenuState & { message: string }> {
    const slot = (req as { slot?: unknown })?.slot;
    if (!Number.isInteger(slot)) throw new GameError('Invalid slot.');
    if (!p.companionId()) throw new GameError('Call a pet to your side first (use it from your bag).');
    await syncCompanion(deps, p);
    const st = p.petState!;
    const item = deps.world.inventoryCache.get(p.id)?.slots.find((s) => s.slot === slot);
    const def = item ? getItem(item.itemId) : undefined;
    const food = def ? petFoodValue(def) : null;
    if (!def || !food) throw new GameError('Pets eat common fish and pet treats.');
    const inv = await withTransaction(deps.pool, async (tx) => {
      const { gold } = await lockCharacter(tx, p.id);
      const res = await consumeFromSlotTx(tx, p.id, slot as number, 1, 'consume');
      return toState(res.capacity, gold, res.slots);
    });
    pushInventory(deps.world, p, inv);
    const levels = addPetXp(st, food.xp, p.rec.level);
    // A hungry, sulking pet (loyalty under 20) cheers up when fed.
    st.loyalty = clampLoyalty(Math.max(st.loyalty + food.loyalty, st.loyalty < 20 ? 20 : 0));
    await savePet(deps.pool, p.id, st);
    p.conn?.send('pet:update', petView(p, st, true));
    const name = nameOf(st.id);
    const message = `${name} ate the ${def.name}: +${food.xp} Pet EXP, +${food.loyalty} loyalty.${levels ? ` Level ${st.level}!` : ''}`;
    return { ...(await menu(deps, p)), message };
  },

  /** Evolve the active pet: level 30 / 60, loyalty 60+, Evolution Stones and Gold. */
  async evolve(deps: GameplayDeps, p: Player): Promise<PetMenuState & { message: string }> {
    if (!p.companionId()) throw new GameError('Call a pet to your side first.');
    await syncCompanion(deps, p);
    const st = p.petState!;
    const next = PET_STAGES[st.stage];
    if (!next) throw new GameError(`${nameOf(st.id)} is already fully evolved.`);
    if (st.level < next.minLevel) throw new GameError(`${nameOf(st.id)} needs to reach level ${next.minLevel} first.`);
    if (st.loyalty < PET_EVOLVE_LOYALTY) throw new GameError(`${nameOf(st.id)} needs ${PET_EVOLVE_LOYALTY} loyalty to evolve (feed it and fight together).`);
    const inv = await withTransaction(deps.pool, async (tx) => {
      await lockCharacter(tx, p.id);
      const { capacity, slots } = await loadSlots(tx, p.id);
      const res = removeItemById(slots, 'evolution_stone', next.stones);
      if (!res.ok) throw new GameError(`You need ${next.stones} Evolution Stone${next.stones > 1 ? 's' : ''} (Stablemaster Hana sells them; world bosses drop them).`);
      const { after } = await changeGold(tx, p.id, -next.gold, 'enhance', { type: 'pet', id: st.id });
      await writeSlots(tx, p.id, res.slots, res.changed);
      await logItemMovement(tx, { itemId: 'evolution_stone', quantity: next.stones, from: p.id, reason: 'consume', ref: { type: 'pet', id: st.id } });
      st.stage = next.stage;
      await tx.query(
        `INSERT INTO character_pets (character_id, pet_id, level, xp, loyalty, growth, kills, stage) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (character_id, pet_id) DO UPDATE SET stage = $8, updated_at = now()`,
        [p.id, st.id, st.level, st.xp, st.loyalty, JSON.stringify(st.growth), st.kills, st.stage],
      );
      return toState(capacity, after, res.slots);
    });
    pushInventory(deps.world, p, inv);
    st.hp = petStats(st.kind, st.level, st.stage).maxHp;
    setPetStage(deps, p);
    p.conn?.send('pet:update', petView(p, st, true));
    deps.log.info('pet_evolved', { characterId: p.id, pet: st.id, stage: st.stage });
    return { ...(await menu(deps, p)), message: `✨ ${nameOf(st.id)} evolved into a ${next.title} ${nameOf(st.id)}! Stronger, tougher — and bigger.` };
  },

  /** Spend a Growth Point (one per 10 pet levels) on a passive trait. */
  async grow(deps: GameplayDeps, p: Player, req: unknown): Promise<PetMenuState> {
    const trait = String((req as { trait?: unknown })?.trait ?? '') as PetGrowthId;
    if (!(trait in PET_GROWTH)) throw new GameError('Unknown trait.');
    if (!p.companionId()) throw new GameError('Call a pet to your side first.');
    await syncCompanion(deps, p);
    const st = p.petState!;
    const left = petGrowthPoints(st.level) - spentGrowth(st.growth);
    if (left <= 0) throw new GameError('No Growth Points left. Your pet gets one every 10 levels.');
    if ((st.growth[trait] ?? 0) >= PET_GROWTH_MAX) throw new GameError(`${PET_GROWTH[trait].name} is already maxed.`);
    st.growth = { ...st.growth, [trait]: (st.growth[trait] ?? 0) + 1 };
    await savePet(deps.pool, p.id, st);
    deps.world.recomputeSpeed(p);
    p.conn?.send('pet:update', petView(p, st, true));
    return menu(deps, p);
  },
};
