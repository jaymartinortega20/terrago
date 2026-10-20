import { BALANCE, getCrop, getItem, getMap, getNode, getRecipe, mineFloorId, mineFloorNumber, ladderRowsFor } from '@terrago/game-data';
import {
  cropStatus,
  formatDuration,
  gatherChance,
  FISHABLE_TILES,
  PROP_TYPES,
  TILE_SIZE,
  type NodeObject,
  maxHp,
  maxMp,
  xpToNext,
  SKILL_NAMES,
  type ActRequest,
  type ActResult,
  type MapDef,
  type PlotObject,
  type PlotState,
  type SelfState,
  type WorldObject,
} from '@terrago/shared';
import { getClass } from '@terrago/game-data';
import { GameError, type Pool } from '../db';
import type { Logger } from '../logger';
import { clearPlot, farmUpgradeView, fertilize, harvest, loadFarm, plant, plotsForTier, till, upgradeFarm, water, type FarmResult } from '../services/farming';
import type { toState } from '../services/inventory';
import { getNpc, npcOffers } from '../services/npcs';
import type { ProgressDelta } from '../services/progress';
import { buyFromShop, repairAll, repairCost, sellToShop, shopView } from '../services/shops';
import { craft as craftRecipe, rollDrops, swingAtNode } from '../services/gathering';
import { cast } from './fishing';
import type { Player } from '../world/player';
import { World } from '../world/world';

type Inventory = ReturnType<typeof toState>;

export interface GameplayDeps {
  pool: Pool;
  world: World;
  log: Logger;
}

// ---------------------------------------------------------------------------
// Farm plots as world objects
// ---------------------------------------------------------------------------

/** Build the plot objects for a homestead: unlocked plots plus the next tier's (shown as locked). */
export function farmObjects(def: MapDef, tier: number, plots: PlotState[]): PlotObject[] {
  const coords = def.farmPlots ?? [];
  const unlocked = plotsForTier(tier);
  const nextTier = BALANCE.farming.tiers.find((t) => t.tier === tier + 1);
  const visible = Math.min(coords.length, nextTier ? nextTier.plots : unlocked);
  const byIndex = new Map(plots.map((p) => [p.index, p]));
  const out: PlotObject[] = [];
  for (let i = 0; i < visible; i++) {
    const [x, y] = coords[i]!;
    const st = byIndex.get(i);
    out.push({
      kind: 'plot',
      id: `plot:${i}`,
      x,
      y,
      index: i,
      locked: i >= unlocked,
      tilled: st?.tilled ?? false,
      wetUntil: st?.wetUntil ?? 0,
      crop: st?.crop ?? null,
    });
  }
  return out;
}

export async function loadMapObjects(pool: Pool, def: MapDef, owner: { id: string } | null): Promise<WorldObject[]> {
  if (def.farmPlots && owner) {
    const farm = await loadFarm(pool, owner.id);
    return farmObjects(def, farm.tier, farm.plots);
  }
  return [];
}

// ---------------------------------------------------------------------------
// Applying results to the live player
// ---------------------------------------------------------------------------

export function pushInventory(world: World, p: Player, inv: Inventory | null): void {
  if (!inv) return;
  world.inventoryCache.set(p.id, inv);
  p.rec.gold = inv.gold;
  p.conn?.send('inventory:update', inv);
}

export function applyDelta(world: World, p: Player, delta: ProgressDelta): void {
  const patch: Partial<SelfState> = {};
  if (delta.energy) {
    p.rec.energy = delta.energy.energy;
    p.rec.energyUpdatedAt = delta.energy.energyUpdatedAt;
    p.lastEnergySent = delta.energy.energy;
    patch.energy = delta.energy.energy;
  }
  if (delta.skill) {
    p.rec.skills = { ...p.rec.skills, [delta.skill.id]: { level: delta.skill.progress.level, xp: delta.skill.progress.xp, next: delta.skill.progress.next } };
    patch.skills = p.rec.skills;
    if (delta.skill.levelsGained > 0) {
      p.conn?.send('notice', { kind: 'success', text: `${SKILL_NAMES[delta.skill.id]} level ${delta.skill.progress.level}!` });
    }
  }
  if (delta.character) {
    const leveled = delta.character.level > p.rec.level;
    p.rec.level = delta.character.level;
    p.rec.xp = delta.character.xp;
    const cls = getClass(p.rec.classId);
    Object.assign(patch, {
      level: p.rec.level,
      xp: p.rec.xp,
      xpToNext: xpToNext(p.rec.level, BALANCE.xpCurve),
      maxHp: maxHp(p.rec.level, p.rec.stats, cls),
      maxMp: maxMp(p.rec.level, p.rec.stats, cls),
    });
    if (leveled) p.conn?.send('notice', { kind: 'success', text: `Level up! You are now level ${p.rec.level}.` });
  }
  if (Object.keys(patch).length) p.conn?.send('self:update', patch);
}

function applyFarm(deps: GameplayDeps, p: Player, res: FarmResult): ActResult {
  const rt = deps.world.runtimeOf(p);
  const tier = res.tier;
  void tier;
  const updated: PlotObject[] = [];
  for (const st of res.plots) {
    const cur = rt.objects.get(`plot:${st.index}`);
    if (cur?.kind === 'plot') updated.push({ ...cur, tilled: st.tilled, wetUntil: st.wetUntil, crop: st.crop });
  }
  deps.world.setObjects(rt.key, updated);
  pushInventory(deps.world, p, res.inventory);
  applyDelta(deps.world, p, res.delta);
  return { message: res.message };
}

// ---------------------------------------------------------------------------
// The one "use" button: decides what to do with whatever is at a tile
// ---------------------------------------------------------------------------

function selectedItem(world: World, p: Player, slot: unknown): { slot: number; itemId: string } | null {
  if (!Number.isInteger(slot)) return null;
  const inv = world.inventoryCache.get(p.id);
  const s = inv?.slots.find((x) => x.slot === slot);
  return s ? { slot: s.slot, itemId: s.itemId } : null;
}

function hasTool(world: World, p: Player, kind: string): number {
  const inv = world.inventoryCache.get(p.id);
  let tier = -1;
  for (const s of inv?.slots ?? []) {
    const t = getItem(s.itemId)?.tool;
    if (t?.kind === kind && (s.durability === null || s.durability > 0)) tier = Math.max(tier, t.tier);
  }
  return tier;
}

/** Plot indices covered by a watering can of `tier`, aimed at (tx, ty) while facing `dir`. */
function wateringArea(def: MapDef, tx: number, ty: number, tier: number, dir: Player['dir']): number[] {
  const index = new Map((def.farmPlots ?? []).map(([x, y], i) => [`${x},${y}`, i]));
  const tiles: [number, number][] = [];
  if (tier >= 2) {
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) tiles.push([tx + dx, ty + dy]);
  } else if (tier === 1) {
    const [sx, sy] = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] }[dir];
    for (let k = 0; k < 3; k++) tiles.push([tx + sx! * k, ty + sy! * k]);
  } else tiles.push([tx, ty]);
  return tiles.map(([x, y]) => index.get(`${x},${y}`)).filter((i): i is number => i !== undefined);
}

export async function act(deps: GameplayDeps, p: Player, raw: unknown): Promise<ActResult> {
  const { world, pool } = deps;
  const req = (raw ?? {}) as Partial<ActRequest>;
  if (!Number.isInteger(req.tx) || !Number.isInteger(req.ty)) throw new GameError('Invalid target.');
  const tx = req.tx as number;
  const ty = req.ty as number;
  const now = Date.now();
  if (now < p.nextActAt) throw new GameError('Slow down a little.');
  p.nextActAt = now + BALANCE.farming.actionCooldownMs;
  if (!world.tileInReach(p, tx, ty)) throw new GameError("That's too far away.");

  const rt = world.runtimeOf(p);
  const here = world.objectsAt(p, tx, ty);
  const node = here.find((o): o is NodeObject => o.kind === 'node');
  if (node) return gatherNode(deps, p, node, req.slot);
  const plot = here.find((o): o is PlotObject => o.kind === 'plot');
  if (!plot) {
    const tile = rt.def.tiles[ty]?.[tx];
    if (tile && FISHABLE_TILES.has(tile) && rt.def.fishing) {
      const s = await cast(deps, p, rt.def.fishing, selectedItem(world, p, req.slot)?.slot);
      return { message: null, fishing: { id: s.id, x: tx, y: ty } };
    }
    throw new GameError('Nothing to do there.');
  }
  if (rt.owner?.id !== p.id) throw new GameError("This isn't your farm.");
  if (plot.locked) throw new GameError('That land is still wild. Farmer Rowan in Greenhaven can expand your farm.');

  const sel = selectedItem(world, p, req.slot);
  const selDef = sel ? getItem(sel.itemId) : undefined;
  const prefer = sel?.slot;
  const run = (f: Promise<FarmResult>) => f.then((r) => applyFarm(deps, p, r));

  if (req.mode === 'clear') return run(clearPlot(pool, p.id, plot.index));
  if (req.mode === 'fertilize') return run(fertilize(pool, p.id, plot.index, prefer));

  const crop = plot.crop;
  const cropDef = crop ? getCrop(crop.cropId) : undefined;
  const status = crop && cropDef ? cropStatus(crop, cropDef, now) : null;
  const dry = plot.wetUntil - now < BALANCE.farming.waterMs * 0.5;
  const canTier = hasTool(world, p, 'can');
  const doWater = () => run(water(pool, p.id, wateringArea(rt.def, tx, ty, canTier, p.dir), selDef?.tool?.kind === 'can' ? prefer : undefined));

  if (status?.ready) return run(harvest(pool, p.id, plot.index));
  if (!plot.tilled) return run(till(pool, p.id, plot.index, selDef?.tool?.kind === 'hoe' ? prefer : undefined));
  if (!crop) {
    if (selDef?.tool?.kind === 'can') return doWater();
    if (selDef?.category === 'seed') return run(plant(pool, p.id, plot.index, prefer));
    const inv = world.inventoryCache.get(p.id);
    const anySeed = inv?.slots.some((s) => getItem(s.itemId)?.category === 'seed');
    if (anySeed) return run(plant(pool, p.id, plot.index, prefer));
    if (dry && canTier >= 0) return doWater();
    throw new GameError('You have no seeds. Farmer Rowan sells them in Greenhaven.');
  }
  if (selDef?.fertilizer) return run(fertilize(pool, p.id, plot.index, prefer));
  if ((dry || selDef?.tool?.kind === 'can') && canTier >= 0) {
    try {
      return await doWater();
    } catch (err) {
      if (!(err instanceof GameError) || !dry) throw err;
    }
  }
  const name = cropDef?.name ?? 'Crop';
  const pct = Math.floor((status?.progress ?? 0) * 100);
  const when = status?.watered ? `ready in ${formatDuration(status.remainingMs ?? 0)}` : 'needs water to grow';
  return { message: `${name}: ${pct}% grown — ${when}.` };
}

// ---------------------------------------------------------------------------
// Gathering, crafting
// ---------------------------------------------------------------------------

async function gatherNode(deps: GameplayDeps, p: Player, node: NodeObject, slot: unknown): Promise<ActResult> {
  const { world, pool } = deps;
  const def = getNode(node.type);
  if (!def) throw new GameError('Nothing to do there.');
  const rt = world.runtimeOf(p);
  if (node.depletedUntil > Date.now()) throw new GameError(`This ${def.name.toLowerCase()} is used up. It will come back soon.`);
  const skill = p.rec.skills[def.skill];
  if (skill.level < def.level) throw new GameError(`You need ${def.skill} level ${def.level} for this ${def.name.toLowerCase()}.`);
  const toolTier = def.tool ? hasTool(world, p, def.tool) : 0;
  if (def.tool && toolTier < 0) throw new GameError(`You need ${def.tool === 'axe' ? 'an axe' : 'a pickaxe'}.`);
  if (!world.nodeReserve(rt, node.id)) throw new GameError('Someone just took the last of it.');
  const success = Math.random() < gatherChance(skill.level, def.level, toolTier, def.toolTier);
  let res;
  try {
    res = await swingAtNode(pool, p.id, def, { prefer: selectedItem(world, p, slot)?.slot, success, drops: success ? rollDrops(def, Math.random) : [] });
  } catch (err) {
    world.nodeRelease(rt, node.id);
    throw err;
  }
  if (success) world.nodeGathered(rt, node.id);
  else world.nodeRelease(rt, node.id);
  pushInventory(world, p, res.inventory);
  applyDelta(world, p, res.delta);
  return { message: res.message, effect: success ? 'gathered' : 'miss' };
}

/** Is a station of this type within reach of the player? */
function nearStation(world: World, p: Player, station: string): boolean {
  const def = world.runtimeOf(p).def;
  for (const o of def.objects) {
    if (o.kind !== 'prop' || o.type !== station) continue;
    const d = PROP_TYPES[o.type];
    const cx = (o.x + d.w / 2) * TILE_SIZE;
    const cy = (o.y + d.h / 2) * TILE_SIZE;
    if (Math.abs(cx - p.x) <= (d.w / 2 + 1.6) * TILE_SIZE && Math.abs(cy - (p.y - 8)) <= (d.h / 2 + 1.6) * TILE_SIZE) return true;
  }
  return false;
}

export async function craftAt(deps: GameplayDeps, p: Player, req: unknown): Promise<{ message: string }> {
  const r = (req ?? {}) as { recipeId?: unknown; times?: unknown };
  const recipe = typeof r.recipeId === 'string' ? getRecipe(r.recipeId) : undefined;
  if (!recipe) throw new GameError('Unknown recipe.');
  if (!nearStation(deps.world, p, recipe.station)) throw new GameError('You need to stand at the right crafting station.');
  const res = await craftRecipe(deps.pool, p.id, recipe.id, r.times);
  pushInventory(deps.world, p, res.inventory);
  applyDelta(deps.world, p, res.delta);
  return { message: res.message };
}

/** Remember the deepest mine checkpoints (every 5th floor) for the lift. */
export async function onMapEntered(deps: GameplayDeps, p: Player): Promise<void> {
  const floor = mineFloorNumber(p.mapId);
  if (floor && floor % 5 === 0) {
    await deps.pool.query('INSERT INTO character_flags (character_id, flag) VALUES ($1, $2) ON CONFLICT DO NOTHING', [p.id, `mine:${floor}`]);
  }
}

// ---------------------------------------------------------------------------
// NPC services
// ---------------------------------------------------------------------------

function npcService(world: World, p: Player, npcId: unknown, service: 'shop' | 'farm_upgrade' | 'repair' | 'lift') {
  const npc = getNpc(npcId);
  if (!npc || !npcOffers(npc, service)) throw new GameError("They can't help with that.");
  if (!world.npcInRange(p, npc)) throw new GameError("You're too far away.");
  return npc;
}

export const npcServices = {
  shopGet(deps: GameplayDeps, p: Player, npcId: unknown) {
    const npc = npcService(deps.world, p, npcId, 'shop');
    return shopView(npc.id);
  },
  async shopBuy(deps: GameplayDeps, p: Player, req: unknown) {
    const r = (req ?? {}) as { npcId?: unknown; itemId?: unknown; quantity?: unknown };
    const npc = npcService(deps.world, p, r.npcId, 'shop');
    const res = await buyFromShop(deps.pool, p.id, npc.id, r.itemId, r.quantity);
    pushInventory(deps.world, p, res.inventory);
    return { message: res.message };
  },
  async shopSell(deps: GameplayDeps, p: Player, req: unknown) {
    const r = (req ?? {}) as { npcId?: unknown; slot?: unknown; quantity?: unknown };
    const npc = npcService(deps.world, p, r.npcId, 'shop');
    const res = await sellToShop(deps.pool, p.id, npc.id, r.slot, r.quantity);
    pushInventory(deps.world, p, res.inventory);
    return { message: res.message };
  },
  async farmInfo(deps: GameplayDeps, p: Player, npcId: unknown) {
    npcService(deps.world, p, npcId, 'farm_upgrade');
    return farmUpgradeView(deps.pool, p.id);
  },
  async farmUpgrade(deps: GameplayDeps, p: Player, npcId: unknown) {
    npcService(deps.world, p, npcId, 'farm_upgrade');
    const res = await upgradeFarm(deps.pool, p.id);
    pushInventory(deps.world, p, res.inventory);
    // If the homestead is loaded (someone is there, or it was just left), refresh its plots.
    const def = getMap(BALANCE.farming.homesteadMap)!;
    const key = World.runtimeKey(def.id, p.id);
    if (deps.world.getRuntime(key)) deps.world.replaceObjects(key, await loadMapObjects(deps.pool, def, { id: p.id }));
    return { message: `Your homestead now has ${res.plots} plots!` };
  },
  repairQuote(deps: GameplayDeps, p: Player, npcId: unknown) {
    npcService(deps.world, p, npcId, 'repair');
    const inv = deps.world.inventoryCache.get(p.id);
    let cost = 0;
    let items = 0;
    for (const s of inv?.slots ?? []) {
      const c = repairCost(s.itemId, s.durability);
      if (c > 0) {
        cost += c;
        items++;
      }
    }
    return { cost, items };
  },
  async liftFloors(deps: GameplayDeps, p: Player, npcId: unknown) {
    npcService(deps.world, p, npcId, 'lift');
    const { rows } = await deps.pool.query<{ flag: string }>(`SELECT flag FROM character_flags WHERE character_id = $1 AND flag LIKE 'mine:%'`, [p.id]);
    return { floors: rows.map((r) => Number(r.flag.slice(5))).filter((n) => Number.isInteger(n)).sort((a, b) => a - b) };
  },
  async liftGo(deps: GameplayDeps, p: Player, req: unknown) {
    const r = (req ?? {}) as { npcId?: unknown; floor?: unknown };
    npcService(deps.world, p, r.npcId, 'lift');
    const floor = Number(r.floor);
    const { rows } = await deps.pool.query('SELECT 1 FROM character_flags WHERE character_id = $1 AND flag = $2', [p.id, `mine:${floor}`]);
    if (!rows[0]) throw new GameError("You haven't reached that floor yet.");
    await deps.world.moveTo(p, mineFloorId(floor), null, 4, ladderRowsFor(floor).up, 'right');
    return { message: `The lift rattles down to floor ${floor}.` };
  },
  async repair(deps: GameplayDeps, p: Player, npcId: unknown) {
    npcService(deps.world, p, npcId, 'repair');
    const res = await repairAll(deps.pool, p.id);
    pushInventory(deps.world, p, res.inventory);
    return { message: res.message };
  },
};
