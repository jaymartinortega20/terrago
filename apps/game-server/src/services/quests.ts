import { FIRST_QUEST, getItem, getQuest } from '@terrago/game-data';
import { addItem, type QuestState, type QuestStepType } from '@terrago/shared';
import { withTransaction, type Pool } from '../db';
import { loadSlots, lockCharacter, toState, writeSlots } from './inventory';
import { changeGold, logItemMovement } from './ledger';
import { grantCharacterXpTx, type ProgressDelta } from './progress';

/**
 * Quests. Progress is counted from game events (kills, harvests, crafts...)
 * that the server itself produced — never from anything the client claims.
 */

export async function loadQuests(pool: Pool, characterId: string): Promise<QuestState[]> {
  await pool.query(`INSERT INTO quest_progress (character_id, quest_id) SELECT $1, $2 WHERE NOT EXISTS (SELECT 1 FROM quest_progress WHERE character_id = $1)`, [characterId, FIRST_QUEST]);
  const { rows } = await pool.query('SELECT quest_id, step, count, done FROM quest_progress WHERE character_id = $1 ORDER BY started_at', [characterId]);
  return rows.map((r) => ({ id: r.quest_id, step: r.step, count: r.count, done: r.done }));
}

export interface QuestOutcome {
  quests: QuestState[];
  messages: string[];
  inventory: ReturnType<typeof toState> | null;
  delta: ProgressDelta;
  overflow: { itemId: string; quantity: number }[];
}

/**
 * Apply one event to the character's active quests, inside a transaction
 * (rewards and progress commit together). Returns null if nothing matched.
 */
export async function questEvent(pool: Pool, characterId: string, current: QuestState[], type: QuestStepType, target: string | null, n: number): Promise<QuestOutcome | null> {
  const matches = current.filter((q) => {
    if (q.done) return false;
    const st = getQuest(q.id)?.steps[q.step];
    return st && st.type === type && (!st.target || st.target === target);
  });
  if (!matches.length) return null;
  return withTransaction(pool, async (tx) => {
    const { gold } = await lockCharacter(tx, characterId);
    let money = gold;
    let { capacity, slots } = await loadSlots(tx, characterId);
    const changed = new Set<number>();
    const messages: string[] = [];
    const overflow: { itemId: string; quantity: number }[] = [];
    const delta: ProgressDelta = {};
    const quests = current.map((q) => ({ ...q }));
    const give = async (items: { itemId: string; quantity: number }[]) => {
      for (const it of items) {
        const def = getItem(it.itemId)!;
        const res = addItem(slots, { itemId: def.id, quality: 0, durability: def.maxDurability, bound: def.bind === 'pickup', enhance: 0 }, it.quantity, def.stackSize, false);
        if (res.ok) {
          slots = res.slots;
          res.changed.forEach((i) => changed.add(i));
          if (res.added > 0) await logItemMovement(tx, { itemId: def.id, quantity: res.added, to: characterId, reason: 'quest' });
          if (res.added < it.quantity) overflow.push({ itemId: def.id, quantity: it.quantity - res.added });
        } else overflow.push(it);
      }
    };
    for (const m of matches) {
      const q = quests.find((x) => x.id === m.id)!;
      const def = getQuest(q.id)!;
      const st = def.steps[q.step]!;
      q.count = Math.min(st.count, q.count + n);
      if (q.count >= st.count) {
        const stepItems = def.stepRewards?.[String(q.step)];
        if (stepItems) {
          await give(stepItems);
          messages.push(`Received: ${stepItems.map((i) => `${i.quantity}× ${getItem(i.itemId)?.name}`).join(', ')}`);
        }
        q.step++;
        q.count = 0;
        if (q.step >= def.steps.length) {
          q.done = true;
          const r = def.rewards;
          if (r.gold) money = (await changeGold(tx, characterId, r.gold, 'quest', { type: 'quest', id: q.id })).after;
          if (r.xp) delta.character = await grantCharacterXpTx(tx, characterId, r.xp);
          if (r.items?.length) await give(r.items);
          const parts = [r.gold ? `${r.gold} Gold` : '', r.xp ? `${r.xp} XP` : '', ...(r.items ?? []).map((i) => `${i.quantity}× ${getItem(i.itemId)?.name}`)].filter(Boolean);
          messages.push(`Quest complete: ${def.name}! ${parts.join(', ')}`);
          await tx.query('UPDATE quest_progress SET step = $3, count = 0, done = true, completed_at = now() WHERE character_id = $1 AND quest_id = $2', [characterId, q.id, q.step]);
          if (def.next && !quests.some((x) => x.id === def.next)) {
            await tx.query('INSERT INTO quest_progress (character_id, quest_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [characterId, def.next]);
            quests.push({ id: def.next, step: 0, count: 0, done: false });
            messages.push(`New quest: ${getQuest(def.next)!.name}`);
          }
          continue;
        }
        messages.push(`${def.name}: ${def.steps[q.step]!.text}`);
      }
      await tx.query('UPDATE quest_progress SET step = $3, count = $4 WHERE character_id = $1 AND quest_id = $2', [characterId, q.id, q.step, q.count]);
    }
    if (changed.size) await writeSlots(tx, characterId, slots, [...changed]);
    return { quests, messages, inventory: changed.size || money !== gold ? toState(capacity, money, slots) : null, delta, overflow };
  });
}
