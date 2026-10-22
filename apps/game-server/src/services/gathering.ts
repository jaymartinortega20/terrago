import { BALANCE, getItem, getRecipe } from '@terrago/game-data';
import { addItem, removeItemById, type NodeDef, type Slots, type ToolKind } from '@terrago/shared';
import { getSpec } from '@terrago/shared';
import { specEffect, specFor } from './specs';
import { GameError, withTransaction, type Pool, type Tx } from '../db';
import { pickTool } from './farming';
import { loadSlots, lockCharacter, toState, writeSlots } from './inventory';
import { changeGold, logItemMovement, type ItemReason } from './ledger';
import { getSkill, grantCharacterXpTx, grantSkillXpTx, spendEnergyTx, type ProgressDelta } from './progress';

/**
 * Mining, woodcutting, gathering, fishing catches and crafting. Like farming,
 * every call is one transaction: lock → validate → change → ledger → commit.
 */

export interface GatherResult {
  message: string;
  inventory: ReturnType<typeof toState> | null;
  delta: ProgressDelta;
  items: { itemId: string; quantity: number; quality: number }[];
}

const CHARACTER_XP_SHARE = 0.3;
const SKILL_NAMES: Record<string, string> = { mining: 'Mining', woodcutting: 'Woodcutting', gathering: 'Gathering', fishing: 'Fishing' };

function wear(slots: Slots, slot: number): { slots: Slots; broke: string | null } {
  const s = slots[slot];
  if (!s || s.durability === null) return { slots, broke: null };
  const next = slots.map((x) => (x ? { ...x } : null));
  next[slot]!.durability = Math.max(0, s.durability - 1);
  return { slots: next, broke: next[slot]!.durability === 0 ? (getItem(s.itemId)?.name ?? 'tool') : null };
}

export async function giveItems(
  tx: Tx,
  characterId: string,
  slots: Slots,
  items: { itemId: string; quantity: number; quality: number }[],
  reason: ItemReason,
  changed: Set<number>,
): Promise<Slots> {
  let cur = slots;
  for (const it of items) {
    const def = getItem(it.itemId);
    if (!def) throw new Error(`Unknown item ${it.itemId}`);
    const res = addItem(cur, { itemId: def.id, quality: it.quality, durability: def.maxDurability, bound: def.bind === 'pickup' }, it.quantity, def.stackSize);
    if (!res.ok) throw new GameError('Your bag is full. Make some room first.');
    cur = res.slots;
    res.changed.forEach((i) => changed.add(i));
    await logItemMovement(tx, { itemId: def.id, quantity: it.quantity, quality: it.quality, to: characterId, reason });
  }
  return cur;
}

/** Roll a node's drop table (one success). The first drop is the node's main resource. */
export function rollDrops(node: NodeDef, rand: () => number): { itemId: string; quantity: number; quality: number }[] {
  const out: { itemId: string; quantity: number; quality: number }[] = [];
  for (const d of node.drops) {
    if (rand() >= d.chance) continue;
    out.push({ itemId: d.itemId, quantity: d.min + Math.floor(rand() * (d.max - d.min + 1)), quality: 0 });
  }
  return out;
}

/**
 * One swing at a node. `success` was rolled by the caller (who also reserved
 * one of the node's yields); here we charge Energy and tool wear, and on
 * success hand over the items and XP.
 */
export async function swingAtNode(
  pool: Pool,
  characterId: string,
  node: NodeDef,
  opts: { prefer?: number; success: boolean; drops: { itemId: string; quantity: number; quality: number }[] },
): Promise<GatherResult> {
  return withTransaction(pool, async (tx) => {
    const { gold } = await lockCharacter(tx, characterId);
    const skill = await getSkill(tx, characterId, node.skill);
    if (skill.level < node.level) throw new GameError(`You need ${SKILL_NAMES[node.skill] ?? node.skill} level ${node.level} for this.`);
    let { capacity, slots } = await loadSlots(tx, characterId);
    const changed = new Set<number>();
    const delta: ProgressDelta = {};
    let broke: string | null = null;
    let energyCost = node.energy;
    if (node.tool) {
      const tool = pickTool(slots, node.tool as ToolKind, opts.prefer);
      if (tool.tier < node.toolTier) throw new GameError(`Your ${tool.name} isn't strong enough. You need a better ${node.tool === 'axe' ? 'axe' : 'pickaxe'}.`);
      if (tool.tier >= node.toolTier + 2) energyCost = Math.max(1, energyCost - 1);
      const w = wear(slots, tool.slot);
      slots = w.slots;
      broke = w.broke;
      changed.add(tool.slot);
    }
    delta.energy = await spendEnergyTx(tx, characterId, energyCost);
    let message: string;
    if (opts.success) {
      slots = await giveItems(tx, characterId, slots, opts.drops, 'gather', changed);
      const s = await grantSkillXpTx(tx, characterId, node.skill, node.xp);
      delta.skill = { id: node.skill, progress: s, levelsGained: s.levelsGained };
      delta.character = await grantCharacterXpTx(tx, characterId, Math.round(node.xp * CHARACTER_XP_SHARE));
      message = opts.drops.map((d) => `+${d.quantity} ${getItem(d.itemId)?.name}`).join(', ');
    } else {
      message = node.tool === 'pickaxe' ? 'Clang! Not quite.' : node.tool === 'axe' ? 'Thunk. Keep chopping.' : 'Almost...';
    }
    if (broke) message += ` Your ${broke} broke!`;
    if (changed.size) await writeSlots(tx, characterId, slots, [...changed]);
    return { message, inventory: changed.size ? toState(capacity, gold, slots) : null, delta, items: opts.success ? opts.drops : [] };
  });
}

/** Pay for a cast: Energy and rod wear. Returns the rod tier used. */
export async function castLine(pool: Pool, characterId: string, prefer?: number): Promise<{ rodTier: number; delta: ProgressDelta; inventory: ReturnType<typeof toState>; broke: string | null; fishing: number }> {
  return withTransaction(pool, async (tx) => {
    const { gold } = await lockCharacter(tx, characterId);
    const { capacity, slots } = await loadSlots(tx, characterId);
    const rod = pickTool(slots, 'rod', prefer);
    const w = wear(slots, rod.slot);
    const energy = await spendEnergyTx(tx, characterId, 1);
    await writeSlots(tx, characterId, w.slots, [rod.slot]);
    const fishing = await getSkill(tx, characterId, 'fishing');
    return { rodTier: rod.tier, delta: { energy }, inventory: toState(capacity, gold, w.slots), broke: w.broke, fishing: fishing.level };
  });
}

/** Land a fish the server has verified was caught. */
export async function landFish(pool: Pool, characterId: string, fishItem: string, quality: number, xp: number): Promise<GatherResult> {
  return withTransaction(pool, async (tx) => {
    const { gold } = await lockCharacter(tx, characterId);
    const { capacity, slots } = await loadSlots(tx, characterId);
    const changed = new Set<number>();
    const next = await giveItems(tx, characterId, slots, [{ itemId: fishItem, quantity: 1, quality }], 'gather', changed);
    const s = await grantSkillXpTx(tx, characterId, 'fishing', xp);
    const delta: ProgressDelta = { skill: { id: 'fishing', progress: s, levelsGained: s.levelsGained } };
    delta.character = await grantCharacterXpTx(tx, characterId, Math.round(xp * CHARACTER_XP_SHARE));
    await writeSlots(tx, characterId, next, [...changed]);
    const q = ['', 'Silver ', 'Gold ', 'Diamond ', 'Legendary '][quality];
    return {
      message: `You caught a ${q}${getItem(fishItem)?.name}! (+${xp} Fishing XP)`,
      inventory: toState(capacity, gold, next),
      delta,
      items: [{ itemId: fishItem, quantity: 1, quality }],
    };
  });
}

/**
 * Craft a recipe `times` times: inputs and Gold fee are consumed and the
 * output granted in one transaction, or nothing happens at all.
 */
export async function craft(pool: Pool, characterId: string, recipeId: unknown, times: unknown): Promise<GatherResult> {
  const recipe = typeof recipeId === 'string' ? getRecipe(recipeId) : undefined;
  if (!recipe) throw new GameError('Unknown recipe.');
  if (!Number.isInteger(times) || (times as number) < 1 || (times as number) > 50) throw new GameError('Invalid amount.');
  const n = times as number;
  const out = getItem(recipe.output.itemId)!;
  return withTransaction(pool, async (tx) => {
    await lockCharacter(tx, characterId);
    const skill = await getSkill(tx, characterId, recipe.skill);
    if (skill.level < recipe.level) throw new GameError(`You need ${recipe.skill} level ${recipe.level}.`);
    const spec = await specFor(tx, characterId, recipe.skill);
    if (recipe.spec && recipe.spec !== spec) throw new GameError(`Only a ${getSpec(recipe.spec)?.name ?? 'specialist'} can make this. Find one on the Marketplace!`);
    const fx = specEffect(recipe, spec);
    let { capacity, slots } = await loadSlots(tx, characterId);
    const changed = new Set<number>();
    for (const i of recipe.inputs) {
      const res = removeItemById(slots, i.itemId, i.quantity * n);
      if (!res.ok) throw new GameError(`You need ${i.quantity * n}× ${getItem(i.itemId)?.name ?? i.itemId}.`);
      slots = res.slots;
      res.changed.forEach((x) => changed.add(x));
      for (const r of res.removed) await logItemMovement(tx, { itemId: i.itemId, quantity: r.quantity, quality: r.quality, from: characterId, reason: 'craft', ref: { type: 'recipe', id: recipe.id } });
    }
    let gold = (await lockCharacter(tx, characterId)).gold;
    if (recipe.fee > 0 && !fx.noFee) gold = (await changeGold(tx, characterId, -recipe.fee * n, 'craft', { type: 'recipe', id: recipe.id })).after;
    const made = recipe.output.quantity * n * fx.outMult;
    const xp = Math.round(recipe.xp * n * fx.xpMult);
    slots = await giveItems(tx, characterId, slots, [{ itemId: out.id, quantity: made, quality: 0 }], 'craft', changed);
    await writeSlots(tx, characterId, slots, [...changed]);
    const s = await grantSkillXpTx(tx, characterId, recipe.skill, xp);
    const delta: ProgressDelta = { skill: { id: recipe.skill, progress: s, levelsGained: s.levelsGained } };
    delta.character = await grantCharacterXpTx(tx, characterId, Math.round(xp * CHARACTER_XP_SHARE));
    void BALANCE;
    return {
      message: `Crafted ${made}× ${out.name}.${fx.outMult > 1 ? ' (Specialist bonus: doubled!)' : ''} (+${xp} XP)`,
      inventory: toState(capacity, gold, slots),
      delta,
      items: [{ itemId: out.id, quantity: made, quality: 0 }],
    };
  });
}
