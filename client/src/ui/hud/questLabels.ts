/**
 * Pure quest-tracker text formatting (SPEC.md section 5: the tracker shows
 * "Slimes defeated 3/5"-style progress) - kept framework-free and
 * separate from questTracker.ts's DOM rendering so it's unit-testable
 * without a browser, matching world/tilemap.ts's split of "pure lookup"
 * from "DOM/Phaser glue" elsewhere in this client.
 */
import { ITEMS, MAPS, MONSTERS, QUESTS, type QuestObjective } from '@terago/shared';

/** Searches every map's NPC list rather than taking a mapId, since a
 * quest's giver NPC isn't necessarily standing on the player's current
 * map (SPEC.md's quest chain moves across maps as Act I progresses). */
function npcName(npcId: string): string {
  for (const map of Object.values(MAPS)) {
    const npc = map.npcs.find((n) => n.id === npcId);
    if (npc) return npc.name;
  }
  return npcId;
}

function monsterName(monsterId: string): string {
  return MONSTERS[monsterId]?.name ?? monsterId;
}

function itemName(itemId: string): string {
  return ITEMS[itemId]?.name ?? itemId;
}

/** "Talk to Elder Fin", "Defeat Slimes", "Collect Slime Gel" - the verb
 * matches each objective kind, the noun is resolved from its targetId via
 * the same shared config the rest of the client already reads display
 * names from (no separate quest-text data file to keep in sync). */
export function objectiveLabel(objective: QuestObjective): string {
  switch (objective.kind) {
    case 'talkTo':
      return `Talk to ${npcName(objective.targetId)}`;
    case 'killCount':
      return `Defeat ${monsterName(objective.targetId)}`;
    case 'collectItem':
      return `Collect ${itemName(objective.targetId)}`;
  }
}

export function questDisplayName(questId: string): string {
  return QUESTS[questId]?.name ?? questId;
}

export function objectivesFor(questId: string): readonly QuestObjective[] {
  return QUESTS[questId]?.objectives ?? [];
}
