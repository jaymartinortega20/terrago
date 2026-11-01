import { describe, expect, it } from 'vitest';
import { objectiveLabel, objectivesFor, questDisplayName } from './questLabels.js';

describe('questLabels', () => {
  it('formats a talkTo objective with the NPC\'s display name, found by searching every map', () => {
    expect(objectiveLabel({ id: 'talk', kind: 'talkTo', targetId: 'elder_fin', count: 1 })).toBe('Talk to Elder Fin');
  });

  it('formats a killCount objective with the monster\'s display name', () => {
    expect(objectiveLabel({ id: 'kill_slimes', kind: 'killCount', targetId: 'slime', count: 5 })).toBe('Defeat Slime');
  });

  it('formats a collectItem objective with the item\'s display name', () => {
    expect(objectiveLabel({ id: 'collect', kind: 'collectItem', targetId: 'slime_gel', count: 3 })).toBe('Collect Slime Gel');
  });

  it('falls back to the raw id for an unrecognized target, never leaving the label blank', () => {
    expect(objectiveLabel({ id: 'x', kind: 'killCount', targetId: 'not_a_real_monster', count: 1 })).toBe('Defeat not_a_real_monster');
  });

  it('resolves a known quest id to its display name and objectives', () => {
    expect(questDisplayName('first_steps')).toBe('First Steps');
    expect(objectivesFor('cleaning_the_horizon')).toHaveLength(1);
    expect(objectivesFor('cleaning_the_horizon')[0]).toMatchObject({ kind: 'killCount', targetId: 'slime', count: 5 });
  });

  it('falls back gracefully for an unknown quest id', () => {
    expect(questDisplayName('not_a_real_quest')).toBe('not_a_real_quest');
    expect(objectivesFor('not_a_real_quest')).toEqual([]);
  });
});
