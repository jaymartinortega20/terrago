import { NPCS, type NpcDef } from '@terrago/game-data';
import type { DialogueAction, DialogueActionId, DialogueResult, InventoryState } from '@terrago/shared';
import { GameError, withTransaction, type Pool } from '../db';
import { grantItemsTx, lockCharacter, toState } from './inventory';

const byId = new Map(NPCS.map((n) => [n.id, n]));

export function getNpc(id: unknown): NpcDef | undefined {
  return typeof id === 'string' ? byId.get(id) : undefined;
}

const ACTION_LABELS: Record<DialogueActionId, string> = {
  shop: 'Shop',
  farm_upgrade: 'Expand my farm',
  repair: 'Repair my tools',
  lift: 'Take the lift',
  bank: 'Open my vault',
  job: 'Choose my second job',
  enhance: 'Upgrade my gear',
  quest_offer: 'Quest',
  quest_complete: 'Complete quest',
  bounty: 'Bounty board',
};

function actionFor(id: DialogueActionId): DialogueAction {
  return { id, label: ACTION_LABELS[id] };
}

export function npcOffers(npc: NpcDef, service: DialogueActionId): boolean {
  return !!npc.services?.includes(service);
}

/**
 * Talk to an NPC. The first conversation shows the NPC's introduction and
 * grants any rewards. The `met:<npc>` flag is inserted in the same
 * transaction as the reward, and its primary key makes double-claiming
 * impossible — even if two requests race.
 */
export async function talkToNpc(
  pool: Pool,
  characterId: string,
  npc: NpcDef,
  rand: () => number = Math.random,
): Promise<{ dialogue: DialogueResult; inventory: InventoryState | null }> {
  const base = { npcId: npc.id, name: npc.name, title: npc.title, ...(npc.services?.length ? { actions: npc.services.map(actionFor) } : {}) };

  try {
    return await withTransaction(pool, async (tx) => {
      const { gold } = await lockCharacter(tx, characterId);
      const flag = await tx.query(
        'INSERT INTO character_flags (character_id, flag) VALUES ($1, $2) ON CONFLICT DO NOTHING RETURNING flag',
        [characterId, `met:${npc.id}`],
      );
      const firstTime = (flag.rowCount ?? 0) > 0 && !!npc.firstMeeting;
      if (!firstTime) {
        const lines = npc.greetings[Math.floor(rand() * npc.greetings.length)] ?? ['...'];
        return { dialogue: { ...base, lines }, inventory: null };
      }
      const rewards = npc.firstMeeting!.rewards ?? [];
      let inventory: InventoryState | null = null;
      if (rewards.length > 0) {
        const res = await grantItemsTx(tx, characterId, rewards, 'npc_reward', { type: 'npc', id: npc.id });
        inventory = toState(res.capacity, gold, res.slots);
      }
      return { dialogue: { ...base, lines: npc.firstMeeting!.lines, rewards }, inventory };
    });
  } catch (err) {
    if (err instanceof GameError && err.message.includes('bag is full')) {
      // The whole transaction (including the "met" flag) rolled back, so the
      // player can come back for the reward after making room.
      return {
        dialogue: { ...base, lines: ['Oh! Your bag is completely full. Make a little room and come back — I have something for you.'] },
        inventory: null,
      };
    }
    throw err;
  }
}
