/**
 * Quest state machine per character (docs/ARCHITECTURE.md, SPEC.md section
 * 5): not started -> active -> ready to turn in -> complete. Pure
 * functions only - no repository/network access. `repo.getQuestStates`
 * never stores a 'notStarted' row (there's nothing to persist about a quest
 * nobody has touched), so every function here treats "no row" as
 * notStarted and the caller (sim/room.ts) is the one that reads/writes the
 * repository and applies rewards.
 */
import { QUESTS, type QuestDef, type QuestObjectiveKind } from '@terago/shared';

export type QuestDisplayState = 'notStarted' | 'active' | 'readyToTurnIn' | 'complete';

/** Shape of a stored quest row, duck-typed against
 * server/src/db/repository.ts's QuestStateRow so this module has no
 * dependency on db/. */
export interface StoredQuestState {
  questId: string;
  state: 'active' | 'readyToTurnIn' | 'complete';
  progress: Record<string, number>;
}

export function questDisplayState(rows: readonly StoredQuestState[], questId: string): QuestDisplayState {
  return rows.find((r) => r.questId === questId)?.state ?? 'notStarted';
}

export function startingProgress(quest: QuestDef): Record<string, number> {
  const progress: Record<string, number> = {};
  for (const objective of quest.objectives) progress[objective.id] = 0;
  return progress;
}

export function isQuestComplete(quest: QuestDef, progress: Record<string, number>): boolean {
  return quest.objectives.every((o) => (progress[o.id] ?? 0) >= o.count);
}

/** Bumps every objective of `quest` that matches `kind`/`targetId` by
 * `amount` (capped at that objective's count), leaving the rest untouched.
 * Returns a new progress object (never mutates the input) and whether
 * anything actually changed. */
export function applyObjectiveProgress(
  quest: QuestDef,
  progress: Record<string, number>,
  kind: QuestObjectiveKind,
  targetId: string,
  amount = 1
): { progress: Record<string, number>; changed: boolean } {
  let changed = false;
  const next = { ...progress };
  for (const objective of quest.objectives) {
    if (objective.kind !== kind || objective.targetId !== targetId) continue;
    const current = next[objective.id] ?? 0;
    if (current >= objective.count) continue;
    next[objective.id] = Math.min(objective.count, current + amount);
    changed = true;
  }
  return { progress: next, changed };
}

export function questsGivenBy(npcId: string): QuestDef[] {
  return Object.values(QUESTS).filter((q) => q.giverNpcId === npcId);
}

/** A quest is only ever handed out by talking to its giver if nothing else
 * already leads into it via `nextQuestId` - that kind of quest only starts
 * as the direct, automatic result of its predecessor's turn-in (see
 * resolveNpcTalk below), never just because the player happens to be
 * standing in front of the same NPC. */
function isRootQuest(quest: QuestDef, allQuests: readonly QuestDef[]): boolean {
  return !allQuests.some((q) => q.nextQuestId === quest.id);
}

export type QuestTalkEvent =
  | { type: 'start'; quest: QuestDef; progress: Record<string, number>; readyToTurnIn: boolean }
  | { type: 'turnIn'; quest: QuestDef };

/**
 * Resolves everything one NPC interaction does to that character's quests,
 * as an ordered list of events for the caller to apply (repo writes,
 * reward grants, quest:update messages) - this function itself never
 * touches a repository. Handles, in one pass over `existingRows`:
 *
 *  - Turning in any of this NPC's quests already at readyToTurnIn.
 *  - Immediately chain-starting that quest's `nextQuestId` (if any),
 *    bypassing the level gate (a quest giver hands off the next step of
 *    their own story regardless of level - only a *root* quest, picked up
 *    cold, needs the level check).
 *  - Handing out any of this NPC's *root* quests the character hasn't
 *    started yet and meets the level requirement for. Starting a quest
 *    whose first objective is itself "talk to this NPC" (e.g. "First
 *    Steps") immediately satisfies that objective in the same event, so a
 *    talkTo-only quest can start and become ready to turn in in one visit
 *    (the actual turn-in - and reward grant - still happens as its own
 *    event, one loop pass later, so the caller can show "quest started"
 *    and "quest complete" as distinct beats).
 *
 * Loops until nothing changes, bounded by the total quest count so a
 * malformed nextQuestId cycle in data can't spin forever.
 */
export function resolveNpcTalk(
  existingRows: readonly StoredQuestState[],
  npcId: string,
  baseLevel: number
): QuestTalkEvent[] {
  const allQuests = Object.values(QUESTS);
  const npcQuests = allQuests.filter((q) => q.giverNpcId === npcId);
  const states = new Map<string, { state: QuestDisplayState; progress: Record<string, number> }>();
  for (const row of existingRows) {
    states.set(row.questId, { state: row.state, progress: row.progress });
  }

  const events: QuestTalkEvent[] = [];

  function tryStart(questId: string, bypassLevelGate: boolean): boolean {
    const quest = QUESTS[questId];
    if (!quest) return false;
    const state = states.get(questId)?.state ?? 'notStarted';
    if (state !== 'notStarted') return false;
    if (!bypassLevelGate && baseLevel < quest.minBaseLevel) return false;

    const { progress } = applyObjectiveProgress(quest, startingProgress(quest), 'talkTo', npcId);
    const ready = isQuestComplete(quest, progress);
    events.push({ type: 'start', quest, progress, readyToTurnIn: ready });
    states.set(questId, { state: ready ? 'readyToTurnIn' : 'active', progress });
    return true;
  }

  const maxPasses = allQuests.length + 1;
  for (let pass = 0; pass < maxPasses; pass++) {
    let changed = false;

    for (const quest of npcQuests) {
      const entry = states.get(quest.id);
      if (entry?.state !== 'readyToTurnIn') continue;
      events.push({ type: 'turnIn', quest });
      states.set(quest.id, { state: 'complete', progress: entry.progress });
      changed = true;
      if (quest.nextQuestId) {
        changed = tryStart(quest.nextQuestId, true) || changed;
      }
    }

    for (const quest of npcQuests) {
      if (!isRootQuest(quest, allQuests)) continue;
      changed = tryStart(quest.id, false) || changed;
    }

    if (!changed) break;
  }

  return events;
}

export interface QuestProgressUpdate {
  questId: string;
  progress: Record<string, number>;
  readyToTurnIn: boolean;
}

/** Progresses every currently-active quest whose objectives match
 * `kind`/`targetId` (e.g. every active quest with a killCount objective
 * for "slime", when a slime dies). Returns only the quests that actually
 * changed, so the caller can skip no-op repo writes and quest:update sends. */
export function progressActiveObjectives(
  rows: readonly StoredQuestState[],
  kind: QuestObjectiveKind,
  targetId: string,
  amount = 1
): QuestProgressUpdate[] {
  const updates: QuestProgressUpdate[] = [];
  for (const row of rows) {
    if (row.state !== 'active') continue;
    const quest = QUESTS[row.questId];
    if (!quest) continue;
    const { progress, changed } = applyObjectiveProgress(quest, row.progress, kind, targetId, amount);
    if (!changed) continue;
    updates.push({ questId: row.questId, progress, readyToTurnIn: isQuestComplete(quest, progress) });
  }
  return updates;
}
