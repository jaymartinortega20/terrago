export type QuestObjectiveKind = 'talkTo' | 'killCount' | 'collectItem';

export interface QuestObjective {
  id: string;
  kind: QuestObjectiveKind;
  /** npcId for talkTo, monsterId for killCount, itemId for collectItem */
  targetId: string;
  count: number;
}

export interface QuestDef {
  id: string;
  name: string;
  giverNpcId: string;
  minBaseLevel: number;
  objectives: QuestObjective[];
  rewardExp: number;
  rewardGold: number;
  rewardItems: Array<{ itemId: string; qty: number }>;
  nextQuestId?: string;
}

// M1 needs only Act I's opening two quests (SPEC.md section 5). The rest of the
// quest line arrives with the milestone that builds its map.
export const QUESTS: Record<string, QuestDef> = {
  first_steps: {
    id: 'first_steps',
    name: 'First Steps',
    giverNpcId: 'elder_fin',
    minBaseLevel: 1,
    objectives: [{ id: 'talk', kind: 'talkTo', targetId: 'elder_fin', count: 1 }],
    rewardExp: 10,
    rewardGold: 5,
    rewardItems: [],
    nextQuestId: 'cleaning_the_horizon',
  },
  cleaning_the_horizon: {
    id: 'cleaning_the_horizon',
    name: 'Cleaning the Horizon',
    giverNpcId: 'elder_fin',
    minBaseLevel: 1,
    objectives: [{ id: 'kill_slimes', kind: 'killCount', targetId: 'slime', count: 5 }],
    rewardExp: 40,
    rewardGold: 15,
    rewardItems: [{ itemId: 'potion_hp_small', qty: 3 }],
  },
};
