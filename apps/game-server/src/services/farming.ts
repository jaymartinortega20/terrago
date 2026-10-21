import { BALANCE, cropForSeed, farmTier, getCrop, getItem } from '@terrago/game-data';
import {
  addItem,
  afterHarvest,
  cropStatus,
  removeFromSlot,
  removeItemById,
  rollQuality,
  seasonAt,
  seasonSpeed,
  waterCrop,
  type CropState,
  type FarmUpgradeView,
  type PlotState,
  type Slots,
  type ToolKind,
} from '@terrago/shared';
import { GameError, withTransaction, type Pool, type Tx } from '../db';
import { loadSlots, lockCharacter, toState, writeSlots } from './inventory';
import { changeGold, logItemMovement } from './ledger';
import { getSkill, grantCharacterXpTx, grantSkillXpTx, spendEnergyTx, type ProgressDelta } from './progress';

/**
 * Homestead farming. Every operation runs in one transaction:
 * lock character → lock plot rows → validate → change items/energy/plots →
 * commit. Crop growth is computed from stored timestamps (see @terrago/shared
 * farming.ts), so nothing here depends on timers.
 */

export interface FarmData {
  tier: number;
  plots: PlotState[];
}

export interface FarmResult {
  message: string | null;
  plots: PlotState[];
  inventory: ReturnType<typeof toState> | null;
  delta: ProgressDelta;
  tier?: number;
}

const F = () => BALANCE.farming;

export function plotsForTier(tier: number): number {
  return farmTier(tier).plots;
}

function rowToPlot(r: Record<string, any>): PlotState {
  const crop: CropState | null = r.crop_id
    ? {
        cropId: r.crop_id,
        growthDone: Number(r.growth_done_ms),
        progressAt: new Date(r.progress_at).getTime(),
        waterUntil: new Date(r.water_until).getTime(),
        speed: Number(r.speed),
        fertilizer: r.fertilizer,
        harvests: r.harvests,
      }
    : null;
  return { index: r.plot_index, tilled: r.tilled, wetUntil: new Date(r.water_until).getTime(), crop };
}

type StoredPlot = PlotState;

export async function loadFarm(pool: Pool, characterId: string): Promise<FarmData> {
  await pool.query('INSERT INTO farms (character_id) VALUES ($1) ON CONFLICT DO NOTHING', [characterId]);
  const [farm, plots] = await Promise.all([
    pool.query<{ tier: number }>('SELECT tier FROM farms WHERE character_id = $1', [characterId]),
    pool.query('SELECT * FROM farm_plots WHERE character_id = $1 ORDER BY plot_index', [characterId]),
  ]);
  return { tier: farm.rows[0]?.tier ?? 1, plots: plots.rows.map(rowToPlot) };
}

async function lockFarm(tx: Tx, characterId: string): Promise<number> {
  await tx.query('INSERT INTO farms (character_id) VALUES ($1) ON CONFLICT DO NOTHING', [characterId]);
  const { rows } = await tx.query<{ tier: number }>('SELECT tier FROM farms WHERE character_id = $1 FOR UPDATE', [characterId]);
  return rows[0]!.tier;
}

async function lockPlot(tx: Tx, characterId: string, index: number): Promise<StoredPlot> {
  await tx.query('INSERT INTO farm_plots (character_id, plot_index) VALUES ($1, $2) ON CONFLICT DO NOTHING', [characterId, index]);
  const { rows } = await tx.query('SELECT * FROM farm_plots WHERE character_id = $1 AND plot_index = $2 FOR UPDATE', [characterId, index]);
  return rowToPlot(rows[0]!) as StoredPlot;
}

async function writePlot(tx: Tx, characterId: string, p: StoredPlot): Promise<void> {
  const c = p.crop;
  await tx.query(
    `UPDATE farm_plots SET tilled = $3, crop_id = $4, planted_at = CASE WHEN $4::text IS NULL THEN NULL ELSE COALESCE(planted_at, now()) END,
            growth_done_ms = $5, progress_at = $6, water_until = $7, speed = $8, fertilizer = $9, harvests = $10, updated_at = now()
      WHERE character_id = $1 AND plot_index = $2`,
    [
      characterId,
      p.index,
      p.tilled,
      c?.cropId ?? null,
      Math.round(c?.growthDone ?? 0),
      new Date(c?.progressAt ?? Date.now()),
      new Date(c ? c.waterUntil : p.wetUntil),
      c?.speed ?? 1,
      c?.fertilizer ?? null,
      c?.harvests ?? 0,
    ],
  );
}

/** Pick a usable tool of a kind: the preferred slot if it fits, else the highest tier. */
export function pickTool(slots: Slots, kind: ToolKind, prefer?: number): { slot: number; tier: number; name: string } {
  let best: { slot: number; tier: number; name: string } | null = null;
  let broken: string | null = null;
  slots.forEach((s, i) => {
    if (!s) return;
    const def = getItem(s.itemId);
    if (def?.tool?.kind !== kind) return;
    if (s.durability !== null && s.durability <= 0) {
      broken ??= def.name;
      return;
    }
    const cand = { slot: i, tier: def.tool.tier, name: def.name };
    if (i === prefer) best = { ...cand, tier: cand.tier + 100 };
    else if (!best || cand.tier > best.tier) best = cand;
  });
  if (!best) {
    const what: Record<ToolKind, string> = { hoe: 'a hoe', can: 'a watering can', pickaxe: 'a pickaxe', axe: 'an axe', rod: 'a fishing rod', sickle: 'a sickle' };
    if (broken) throw new GameError(`Your ${broken} is broken. Blacksmith Toren can repair it.`);
    throw new GameError(`You need ${what[kind]}.`);
  }
  const b = best as { slot: number; tier: number; name: string };
  return { ...b, tier: b.tier >= 100 ? b.tier - 100 : b.tier };
}

/** Wear a tool by one use. Returns a message if it just broke. */
function wearTool(slots: Slots, slot: number): { slots: Slots; brokeName: string | null } {
  const s = slots[slot];
  if (!s || s.durability === null) return { slots, brokeName: null };
  const next = slots.map((x) => (x ? { ...x } : null));
  next[slot]!.durability = Math.max(0, s.durability - 1);
  return { slots: next, brokeName: next[slot]!.durability === 0 ? (getItem(s.itemId)?.name ?? 'tool') : null };
}

function energyFor(list: number[], tier: number): number {
  return list[Math.min(tier, list.length - 1)] ?? list[list.length - 1] ?? 0;
}

interface Ctx {
  tx: Tx;
  characterId: string;
  gold: number;
  tier: number;
  now: number;
  capacity: number;
  slots: Slots;
  changedSlots: Set<number>;
  delta: ProgressDelta;
}

async function farmTx(pool: Pool, characterId: string, fn: (c: Ctx) => Promise<{ message: string | null; plots: StoredPlot[] }>): Promise<FarmResult> {
  return withTransaction(pool, async (tx) => {
    const { gold } = await lockCharacter(tx, characterId);
    const tier = await lockFarm(tx, characterId);
    const { capacity, slots } = await loadSlots(tx, characterId);
    const ctx: Ctx = { tx, characterId, gold, tier, now: Date.now(), capacity, slots, changedSlots: new Set(), delta: {} };
    const res = await fn(ctx);
    for (const p of res.plots) await writePlot(tx, characterId, p);
    if (ctx.changedSlots.size) await writeSlots(tx, characterId, ctx.slots, [...ctx.changedSlots]);
    return {
      message: res.message,
      plots: res.plots,
      inventory: ctx.changedSlots.size ? toState(capacity, ctx.gold, ctx.slots) : null,
      delta: ctx.delta,
    };
  });
}

function checkUnlocked(ctx: Ctx, index: number): void {
  if (!Number.isInteger(index) || index < 0 || index >= plotsForTier(ctx.tier)) {
    throw new GameError('That plot is still wild. Farmer Rowan can help you expand your farm.');
  }
}

async function useTool(ctx: Ctx, kind: ToolKind, prefer: number | undefined, energyTable: number[]): Promise<{ tier: number; broke: string | null }> {
  const tool = pickTool(ctx.slots, kind, prefer);
  const cost = energyFor(energyTable, tool.tier);
  ctx.delta.energy = await spendEnergyTx(ctx.tx, ctx.characterId, cost, ctx.now);
  const worn = wearTool(ctx.slots, tool.slot);
  ctx.slots = worn.slots;
  ctx.changedSlots.add(tool.slot);
  return { tier: tool.tier, broke: worn.brokeName };
}

const brokeSuffix = (n: string | null) => (n ? ` Your ${n} broke!` : '');

export function till(pool: Pool, characterId: string, index: number, prefer?: number): Promise<FarmResult> {
  return farmTx(pool, characterId, async (ctx) => {
    checkUnlocked(ctx, index);
    const p = await lockPlot(ctx.tx, characterId, index);
    if (p.tilled) throw new GameError('This soil is already tilled.');
    const t = await useTool(ctx, 'hoe', prefer, F().energy.till);
    p.tilled = true;
    return { message: brokeSuffix(t.broke).trim() || null, plots: [p] };
  });
}

/** Find the seed to plant: the preferred slot if it holds a seed, else the first seed in the bag. */
function pickSeed(slots: Slots, prefer?: number): number | null {
  const isSeed = (i: number) => !!slots[i] && !!cropForSeed(slots[i]!.itemId);
  if (prefer !== undefined && isSeed(prefer)) return prefer;
  const i = slots.findIndex((s, idx) => !!s && isSeed(idx));
  return i >= 0 ? i : null;
}

export function plant(pool: Pool, characterId: string, index: number, prefer?: number): Promise<FarmResult> {
  return farmTx(pool, characterId, async (ctx) => {
    checkUnlocked(ctx, index);
    const p = await lockPlot(ctx.tx, characterId, index);
    if (!p.tilled) throw new GameError('Till the soil first.');
    if (p.crop) throw new GameError('Something is already growing here.');
    const slot = pickSeed(ctx.slots, prefer);
    if (slot === null) throw new GameError('You have no seeds. Farmer Rowan sells them in Greenhaven.');
    const crop = cropForSeed(ctx.slots[slot]!.itemId)!;
    const farming = await getSkill(ctx.tx, characterId, 'farming');
    if (farming.level < crop.levelRequired) throw new GameError(`${crop.name} needs Farming level ${crop.levelRequired}.`);
    const res = removeFromSlot(ctx.slots, slot, 1);
    if (!res.ok) throw new GameError(res.error);
    ctx.slots = res.slots;
    ctx.changedSlots.add(slot);
    await logItemMovement(ctx.tx, { itemId: crop.seedItem, quantity: 1, from: characterId, reason: 'plant' });
    ctx.delta.energy = await spendEnergyTx(ctx.tx, characterId, F().energy.plant, ctx.now);
    // In-season crops grow faster.
    const season = seasonSpeed(crop.seasons, ctx.now);
    p.crop = { cropId: crop.id, growthDone: 0, progressAt: ctx.now, waterUntil: p.wetUntil, speed: season, fertilizer: null, harvests: 0 };
    const wet = p.wetUntil > ctx.now;
    const tip = season > 1 ? ` It's ${seasonAt(ctx.now)} — ${crop.name} grows faster in season!` : '';
    return { message: (wet ? `Planted ${crop.name}.` : `Planted ${crop.name}. Water it so it can grow!`) + tip, plots: [p] };
  });
}

/**
 * Water one or more plots (better cans cover an area). Energy and durability
 * are spent once per use, whatever the area.
 */
export function water(pool: Pool, characterId: string, indices: number[], prefer?: number): Promise<FarmResult> {
  return farmTx(pool, characterId, async (ctx) => {
    const tierPlots = plotsForTier(ctx.tier);
    const unique = [...new Set(indices)].filter((i) => Number.isInteger(i) && i >= 0 && i < tierPlots).sort((a, b) => a - b);
    if (unique.length === 0) checkUnlocked(ctx, indices[0] ?? -1);
    const plots: StoredPlot[] = [];
    for (const i of unique) {
      const p = await lockPlot(ctx.tx, characterId, i);
      if (!p.tilled) continue;
      const wetEnough = p.wetUntil - ctx.now > F().waterMs * 0.5;
      if (wetEnough) continue;
      plots.push(p);
    }
    if (plots.length === 0) throw new GameError('The soil here is already wet (or not tilled yet).');
    const t = await useTool(ctx, 'can', prefer, F().energy.water);
    for (const p of plots) {
      if (p.crop) {
        const def = getCrop(p.crop.cropId);
        if (def) p.crop = waterCrop(p.crop, def, ctx.now, F().waterMs);
        p.wetUntil = p.crop.waterUntil;
      } else {
        p.wetUntil = ctx.now + F().waterMs;
      }
    }
    void t.tier;
    return { message: `Watered ${plots.length} plot${plots.length === 1 ? '' : 's'}.${brokeSuffix(t.broke)}`, plots };
  });
}

export function harvest(pool: Pool, characterId: string, index: number, rand: () => number = Math.random): Promise<FarmResult> {
  return farmTx(pool, characterId, async (ctx) => {
    checkUnlocked(ctx, index);
    const p = await lockPlot(ctx.tx, characterId, index);
    if (!p.crop) throw new GameError('Nothing is growing here.');
    const def = getCrop(p.crop.cropId);
    if (!def) throw new GameError('This crop has withered away.');
    if (!cropStatus(p.crop, def, ctx.now).ready) throw new GameError(`The ${def.name.toLowerCase()} isn't ready yet.`);

    const farming = await getSkill(ctx.tx, characterId, 'farming');
    const fert = p.crop.fertilizer ? getItem(p.crop.fertilizer)?.fertilizer : undefined;
    const quality = rollQuality(def.quality, farming.level, def.levelRequired, fert?.quality ?? 0, rand);
    const [min, max] = def.yield;
    let qty = min + Math.floor(rand() * (max - min + 1));
    if (rand() < Math.min(0.3, Math.max(0, farming.level - def.levelRequired) * 0.01)) qty += 1; // skilled bonus

    const produce = getItem(def.produceItem)!;
    const added = addItem(ctx.slots, { itemId: produce.id, quality, durability: null, bound: false }, qty, produce.stackSize);
    if (!added.ok) throw new GameError('Your bag is full. Make some room first.');
    ctx.slots = added.slots;
    added.changed.forEach((i) => ctx.changedSlots.add(i));
    await logItemMovement(ctx.tx, { itemId: produce.id, quantity: qty, quality, to: characterId, reason: 'harvest' });

    const skill = await grantSkillXpTx(ctx.tx, characterId, 'farming', def.xp);
    ctx.delta.skill = { id: 'farming', progress: skill, levelsGained: skill.levelsGained };
    ctx.delta.character = await grantCharacterXpTx(ctx.tx, characterId, Math.round(def.xp * F().characterXpShare));
    ctx.delta.energy = await spendEnergyTx(ctx.tx, characterId, F().energy.harvest, ctx.now);

    p.crop = afterHarvest(p.crop, def, ctx.now);
    const qualityName = ['', 'Silver ', 'Gold ', 'Diamond ', 'Legendary '][quality];
    return { message: `Harvested ${qty}× ${qualityName}${def.name}! (+${def.xp} Farming XP)`, plots: [p] };
  });
}

/** Rain waters every tilled plot that is drying out (no energy, no tools). */
export function rainWater(pool: Pool, characterId: string): Promise<FarmResult> {
  return farmTx(pool, characterId, async (ctx) => {
    const plots: StoredPlot[] = [];
    for (let i = 0; i < plotsForTier(ctx.tier); i++) {
      const p = await lockPlot(ctx.tx, characterId, i);
      if (!p.tilled || p.wetUntil - ctx.now > F().waterMs * 0.5) continue;
      if (p.crop) {
        const def = getCrop(p.crop.cropId);
        if (def) p.crop = waterCrop(p.crop, def, ctx.now, F().waterMs);
        p.wetUntil = p.crop.waterUntil;
      } else p.wetUntil = ctx.now + F().waterMs;
      plots.push(p);
    }
    return { message: plots.length ? 'The rain watered your fields.' : null, plots };
  });
}

export function fertilize(pool: Pool, characterId: string, index: number, prefer?: number): Promise<FarmResult> {
  return farmTx(pool, characterId, async (ctx) => {
    checkUnlocked(ctx, index);
    const p = await lockPlot(ctx.tx, characterId, index);
    if (!p.crop) throw new GameError('Plant something first.');
    const def = getCrop(p.crop.cropId);
    if (!def || cropStatus(p.crop, def, ctx.now).ready) throw new GameError("It's ready to harvest — no need.");
    if (p.crop.fertilizer) throw new GameError('This plot is already fertilized.');
    const isFert = (i: number) => !!ctx.slots[i] && !!getItem(ctx.slots[i]!.itemId)?.fertilizer;
    const slot = prefer !== undefined && isFert(prefer) ? prefer : ctx.slots.findIndex((_, i) => isFert(i));
    if (slot < 0) throw new GameError('You have no fertilizer. Farmer Rowan sells some.');
    const item = getItem(ctx.slots[slot]!.itemId)!;
    const res = removeFromSlot(ctx.slots, slot, 1);
    if (!res.ok) throw new GameError(res.error);
    ctx.slots = res.slots;
    ctx.changedSlots.add(slot);
    await logItemMovement(ctx.tx, { itemId: item.id, quantity: 1, from: characterId, reason: 'fertilize' });
    // Settle growth up to now so the new speed only applies from here on.
    const settled = waterCrop(p.crop, def, ctx.now, 0);
    p.crop = { ...settled, waterUntil: p.crop.waterUntil, speed: item.fertilizer!.speed * seasonSpeed(def.seasons, ctx.now), fertilizer: item.id };
    return { message: `Mixed ${item.name} into the soil.`, plots: [p] };
  });
}

export function clearPlot(pool: Pool, characterId: string, index: number): Promise<FarmResult> {
  return farmTx(pool, characterId, async (ctx) => {
    checkUnlocked(ctx, index);
    const p = await lockPlot(ctx.tx, characterId, index);
    if (!p.crop) throw new GameError('Nothing to clear.');
    const name = getCrop(p.crop.cropId)?.name ?? 'crop';
    p.crop = null;
    return { message: `Cleared the ${name.toLowerCase()}.`, plots: [p] };
  });
}

export async function farmUpgradeView(pool: Pool, characterId: string): Promise<FarmUpgradeView> {
  const farm = await loadFarm(pool, characterId);
  const cur = farmTier(farm.tier);
  const next = BALANCE.farming.tiers.find((t) => t.tier === farm.tier + 1);
  return {
    tier: cur.tier,
    plots: cur.plots,
    next: next
      ? { tier: next.tier, plots: next.plots, gold: next.gold ?? 0, farmingLevel: next.farmingLevel ?? 1, materials: next.materials ?? [] }
      : null,
  };
}

/** Expand the homestead: Gold + materials + Farming level. A gold sink. */
export async function upgradeFarm(pool: Pool, characterId: string): Promise<{ tier: number; plots: number; inventory: ReturnType<typeof toState> }> {
  return withTransaction(pool, async (tx) => {
    await lockCharacter(tx, characterId);
    const tier = await lockFarm(tx, characterId);
    const next = BALANCE.farming.tiers.find((t) => t.tier === tier + 1);
    if (!next) throw new GameError('Your farm is already as large as it gets.');
    const farming = await getSkill(tx, characterId, 'farming');
    if (farming.level < (next.farmingLevel ?? 1)) throw new GameError(`You need Farming level ${next.farmingLevel} for this expansion.`);
    let { capacity, slots } = await loadSlots(tx, characterId);
    const changed = new Set<number>();
    for (const m of next.materials ?? []) {
      const res = removeItemById(slots, m.itemId, m.quantity);
      if (!res.ok) throw new GameError(`You need ${m.quantity}× ${getItem(m.itemId)?.name ?? m.itemId}.`);
      slots = res.slots;
      res.changed.forEach((i) => changed.add(i));
      await logItemMovement(tx, { itemId: m.itemId, quantity: m.quantity, from: characterId, reason: 'farm_upgrade' });
    }
    let gold = (await lockCharacter(tx, characterId)).gold;
    if (next.gold) gold = (await changeGold(tx, characterId, -next.gold, 'farm_upgrade')).after;
    await writeSlots(tx, characterId, slots, [...changed]);
    await tx.query('UPDATE farms SET tier = $2, upgraded_at = now() WHERE character_id = $1', [characterId, next.tier]);
    void capacity;
    return { tier: next.tier, plots: next.plots, inventory: toState(capacity, gold, slots) };
  });
}
