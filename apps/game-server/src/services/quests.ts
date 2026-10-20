import { NPCS, QUESTS, getItem, getQuest } from '@terrago/game-data';
import { addItem, questReady, questsAvailable, type QuestState, type QuestStepType } from '@terrago/shared';
import { GameError, withTransaction, type Pool, type Tx } from '../db';
import { loadSlots, lockCharacter, toState, writeSlots } from './inventory';
import { changeGold, logItemMovement } from './ledger';
import { grantCharacterXpTx, type ProgressDelta } from './progress';

/**
 * Quests: offered by an NPC (accept), progressed by game events the server
 * produced itself (never by client claims), and handed in to an NPC for the
 * rewards. All changes run in transactions so rewards can't be claimed twice.
 */

export async function loadQuests(pool: Pool, characterId: string): Promise<QuestState[]> {
  const { rows } = await pool.query('SELECT quest_id, step, count, done FROM quest_progress WHERE character_id = $1 ORDER BY started_at', [characterId]);
  return rows.filter((r) => getQuest(r.quest_id)).map((r) => ({ id: r.quest_id, step: r.step, count: r.count, done: r.done }));
}

export interface QuestOutcome {
  quests: QuestState[];
  messages: string[];
  /** Progress toasts like "Copper Ore 3/5". */
  progress: string[];
  inventory: ReturnType<typeof toState> | null;
  delta: ProgressDelta;
  overflow: { itemId: string; quantity: number }[];
}

type Items = { itemId: string; quantity: number }[];

async function giveItems(tx: Tx, characterId: string, items: Items, slotsIn: Awaited<ReturnType<typeof loadSlots>>['slots'], changed: Set<number>, overflow: Items) {
  let slots = slotsIn;
  for (const it of items) {
    const def = getItem(it.itemId)!;
    const res = addItem(slots, { itemId: def.id, quality: 0, durability: def.maxDurability, bound: def.bind === 'pickup', enhance: 0 }, it.quantity, def.stackSize, false);
    if (!res.ok) {
      overflow.push(it);
      continue;
    }
    slots = res.slots;
    res.changed.forEach((i) => changed.add(i));
    if (res.added > 0) await logItemMovement(tx, { itemId: def.id, quantity: res.added, to: characterId, reason: 'quest' });
    if (res.added < it.quantity) overflow.push({ itemId: def.id, quantity: it.quantity - res.added });
  }
  return slots;
}

/** Apply one game event to active quests. Returns null if nothing matched. */
export async function questEvent(pool: Pool, characterId: string, current: QuestState[], type: QuestStepType, target: string | null, n: number): Promise<QuestOutcome | null> {
  const matches = current.filter((q) => {
    const def = getQuest(q.id);
    if (!def || q.done) return false;
    const st = def.steps[q.step];
    return st && st.type === type && (!st.target || st.target === target);
  });
  if (!matches.length) return null;
  return withTransaction(pool, async (tx) => {
    const { gold } = await lockCharacter(tx, characterId);
    let { capacity, slots } = await loadSlots(tx, characterId);
    const changed = new Set<number>();
    const overflow: Items = [];
    const messages: string[] = [];
    const progress: string[] = [];
    const quests = current.map((q) => ({ ...q }));
    for (const m of matches) {
      const q = quests.find((x) => x.id === m.id)!;
      const def = getQuest(q.id)!;
      const st = def.steps[q.step]!;
      q.count = Math.min(st.count, q.count + n);
      if (st.count > 1) progress.push(`${def.name}: ${q.count}/${st.count}`);
      if (q.count >= st.count) {
        const stepItems = def.stepRewards?.[String(q.step)];
        if (stepItems) {
          slots = await giveItems(tx, characterId, stepItems, slots, changed, overflow);
          messages.push(`Received: ${stepItems.map((i) => `${i.quantity}× ${getItem(i.itemId)?.name}`).join(', ')}`);
        }
        q.step++;
        q.count = 0;
        const turnIn = def.turnIn;
        messages.push(q.step >= def.steps.length ? `${def.name}: return to ${npcName(turnIn)}!` : `${def.name}: ${def.steps[q.step]!.text}`);
      }
      await tx.query('UPDATE quest_progress SET step = $3, count = $4 WHERE character_id = $1 AND quest_id = $2', [characterId, q.id, q.step, q.count]);
    }
    if (changed.size) await writeSlots(tx, characterId, slots, [...changed]);
    return { quests, messages, progress, inventory: changed.size ? toState(capacity, gold, slots) : null, delta: {}, overflow };
  });
}

function npcName(id: string): string {
  return NPCS.find((n) => n.id === id)?.name ?? id;
}

/** Offers and hand-ins an NPC has for this character right now. */
export function npcQuestActions(npcId: string, states: QuestState[]): { offers: string[]; turnIns: string[] } {
  const offers = questsAvailable(QUESTS, states).filter((q) => q.giver === npcId).map((q) => q.id);
  const turnIns = states.filter((s) => {
    const d = getQuest(s.id);
    return d && d.turnIn === npcId && questReady(s, d);
  }).map((s) => s.id);
  return { offers, turnIns };
}

export async function acceptQuest(pool: Pool, characterId: string, questId: string, states: QuestState[]): Promise<QuestState[]> {
  const def = getQuest(questId);
  if (!def || !questsAvailable(QUESTS, states).some((q) => q.id === questId)) throw new GameError("That quest isn't available.");
  const ins = await pool.query('INSERT INTO quest_progress (character_id, quest_id) VALUES ($1, $2) ON CONFLICT DO NOTHING RETURNING quest_id', [characterId, questId]);
  if (!ins.rowCount) throw new GameError('You already have that quest.');
  return [...states, { id: questId, step: 0, count: 0, done: false }];
}

/** Hand in a finished quest. The UPDATE ... WHERE done = false makes double claims impossible. */
export async function completeQuest(
  pool: Pool,
  characterId: string,
  questId: string,
): Promise<{ rewards: { gold: number; xp: number; items: Items }; inventory: ReturnType<typeof toState>; delta: ProgressDelta; overflow: Items }> {
  const def = getQuest(questId);
  if (!def) throw new GameError('Unknown quest.');
  return withTransaction(pool, async (tx) => {
    const { gold } = await lockCharacter(tx, characterId);
    const upd = await tx.query(
      'UPDATE quest_progress SET done = true, completed_at = now() WHERE character_id = $1 AND quest_id = $2 AND done = false AND step >= $3 RETURNING quest_id',
      [characterId, questId, def.steps.length],
    );
    if (!upd.rowCount) throw new GameError("That quest isn't finished yet.");
    const r = def.rewards;
    let money = gold;
    if (r.gold) money = (await changeGold(tx, characterId, r.gold, 'quest', { type: 'quest', id: questId })).after;
    const delta: ProgressDelta = {};
    if (r.xp) delta.character = await grantCharacterXpTx(tx, characterId, r.xp);
    let { capacity, slots } = await loadSlots(tx, characterId);
    const changed = new Set<number>();
    const overflow: Items = [];
    if (r.items?.length) slots = await giveItems(tx, characterId, r.items, slots, changed, overflow);
    if (changed.size) await writeSlots(tx, characterId, slots, [...changed]);
    return { rewards: { gold: r.gold ?? 0, xp: r.xp ?? 0, items: r.items ?? [] }, inventory: toState(capacity, money, slots), delta, overflow };
  });
}
