import { describe, expect, it } from 'vitest';
import { QUESTS } from '@terago/shared';
import {
  applyObjectiveProgress,
  isQuestComplete,
  progressActiveObjectives,
  questDisplayState,
  questsGivenBy,
  resolveNpcTalk,
  startingProgress,
  type StoredQuestState,
} from './quests.js';

const FIRST_STEPS = QUESTS.first_steps!;
const CLEANING = QUESTS.cleaning_the_horizon!;

describe('questDisplayState', () => {
  it('is notStarted when no row exists', () => {
    expect(questDisplayState([], 'first_steps')).toBe('notStarted');
  });

  it('reflects the stored row otherwise', () => {
    const rows: StoredQuestState[] = [{ questId: 'first_steps', state: 'active', progress: { talk: 0 } }];
    expect(questDisplayState(rows, 'first_steps')).toBe('active');
  });
});

describe('startingProgress / isQuestComplete', () => {
  it('starts every objective at 0 and is not complete', () => {
    const progress = startingProgress(CLEANING);
    expect(progress).toEqual({ kill_slimes: 0 });
    expect(isQuestComplete(CLEANING, progress)).toBe(false);
  });

  it('is complete once every objective meets its count', () => {
    expect(isQuestComplete(CLEANING, { kill_slimes: 5 })).toBe(true);
    expect(isQuestComplete(CLEANING, { kill_slimes: 4 })).toBe(false);
    expect(isQuestComplete(CLEANING, { kill_slimes: 99 })).toBe(true); // overshoot still counts
  });
});

describe('applyObjectiveProgress', () => {
  it('bumps only objectives matching kind+targetId, capped at count', () => {
    const { progress, changed } = applyObjectiveProgress(CLEANING, { kill_slimes: 4 }, 'killCount', 'slime', 3);
    expect(changed).toBe(true);
    expect(progress.kill_slimes).toBe(5); // capped at count=5, not 7
  });

  it('reports unchanged for a non-matching kind/targetId', () => {
    const { progress, changed } = applyObjectiveProgress(CLEANING, { kill_slimes: 0 }, 'killCount', 'goblin', 1);
    expect(changed).toBe(false);
    expect(progress).toEqual({ kill_slimes: 0 });
  });

  it('reports unchanged once the objective is already maxed', () => {
    const { changed } = applyObjectiveProgress(CLEANING, { kill_slimes: 5 }, 'killCount', 'slime', 1);
    expect(changed).toBe(false);
  });

  it('never mutates the input progress object', () => {
    const input = { kill_slimes: 0 };
    applyObjectiveProgress(CLEANING, input, 'killCount', 'slime', 1);
    expect(input.kill_slimes).toBe(0);
  });
});

describe('questsGivenBy', () => {
  it('finds both M1 quests for elder_fin', () => {
    const quests = questsGivenBy('elder_fin').map((q) => q.id);
    expect(quests).toContain('first_steps');
    expect(quests).toContain('cleaning_the_horizon');
  });

  it('returns nothing for an NPC with no quests', () => {
    expect(questsGivenBy('blacksmith')).toEqual([]);
  });
});

describe('resolveNpcTalk', () => {
  it('on a first-ever talk, starts and immediately completes a talkTo-only quest, then chain-starts the next quest', () => {
    const events = resolveNpcTalk([], 'elder_fin', 1);

    expect(events).toEqual([
      { type: 'start', quest: FIRST_STEPS, progress: { talk: 1 }, readyToTurnIn: true },
      { type: 'turnIn', quest: FIRST_STEPS },
      { type: 'start', quest: CLEANING, progress: { kill_slimes: 0 }, readyToTurnIn: false },
    ]);
  });

  it('does nothing for an NPC with no quests', () => {
    expect(resolveNpcTalk([], 'blacksmith', 1)).toEqual([]);
  });

  it('does nothing when the character is below the root quest\'s level requirement', () => {
    // first_steps.minBaseLevel is 1, so this exercises the gate with a
    // level below it to prove it's actually checked, not just always 1<=1.
    const events = resolveNpcTalk([], 'elder_fin', 0);
    expect(events).toEqual([]);
  });

  it('turns in a killCount quest once it is readyToTurnIn, without re-starting it', () => {
    const rows: StoredQuestState[] = [
      { questId: 'first_steps', state: 'complete', progress: { talk: 1 } },
      { questId: 'cleaning_the_horizon', state: 'readyToTurnIn', progress: { kill_slimes: 5 } },
    ];
    const events = resolveNpcTalk(rows, 'elder_fin', 1);
    expect(events).toEqual([{ type: 'turnIn', quest: CLEANING }]);
  });

  it('does nothing for a quest still in progress (active, not ready)', () => {
    const rows: StoredQuestState[] = [
      { questId: 'first_steps', state: 'complete', progress: { talk: 1 } },
      { questId: 'cleaning_the_horizon', state: 'active', progress: { kill_slimes: 2 } },
    ];
    expect(resolveNpcTalk(rows, 'elder_fin', 1)).toEqual([]);
  });

  it('does nothing once every quest from this NPC is complete', () => {
    const rows: StoredQuestState[] = [
      { questId: 'first_steps', state: 'complete', progress: { talk: 1 } },
      { questId: 'cleaning_the_horizon', state: 'complete', progress: { kill_slimes: 5 } },
    ];
    expect(resolveNpcTalk(rows, 'elder_fin', 1)).toEqual([]);
  });

  it('never hands out a chained quest on its own, even if the character meets its level requirement', () => {
    // cleaning_the_horizon is not a root quest (first_steps.nextQuestId
    // points to it), so it must never be started independently of
    // first_steps actually completing - even talking fresh at a level well
    // above its minBaseLevel must not grant it by itself.
    const events = resolveNpcTalk([], 'elder_fin', 50);
    const startedQuestIds = events.filter((e) => e.type === 'start').map((e) => e.quest.id);
    // cleaning_the_horizon only appears here because first_steps chained
    // into it, which this talk also does - the point is it never appears
    // standing alone without first_steps preceding it.
    expect(startedQuestIds).toEqual(['first_steps', 'cleaning_the_horizon']);
  });
});

describe('progressActiveObjectives', () => {
  it('advances every active quest with a matching killCount objective', () => {
    const rows: StoredQuestState[] = [
      { questId: 'cleaning_the_horizon', state: 'active', progress: { kill_slimes: 3 } },
    ];
    const updates = progressActiveObjectives(rows, 'killCount', 'slime');
    expect(updates).toEqual([{ questId: 'cleaning_the_horizon', progress: { kill_slimes: 4 }, readyToTurnIn: false }]);
  });

  it('flags readyToTurnIn once the last required kill lands', () => {
    const rows: StoredQuestState[] = [
      { questId: 'cleaning_the_horizon', state: 'active', progress: { kill_slimes: 4 } },
    ];
    const updates = progressActiveObjectives(rows, 'killCount', 'slime');
    expect(updates).toEqual([{ questId: 'cleaning_the_horizon', progress: { kill_slimes: 5 }, readyToTurnIn: true }]);
  });

  it('ignores quests that are not active', () => {
    const rows: StoredQuestState[] = [
      { questId: 'cleaning_the_horizon', state: 'readyToTurnIn', progress: { kill_slimes: 5 } },
    ];
    expect(progressActiveObjectives(rows, 'killCount', 'slime')).toEqual([]);
  });

  it('ignores a kill that matches no active objective', () => {
    const rows: StoredQuestState[] = [
      { questId: 'cleaning_the_horizon', state: 'active', progress: { kill_slimes: 0 } },
    ];
    expect(progressActiveObjectives(rows, 'killCount', 'goblin')).toEqual([]);
  });
});
