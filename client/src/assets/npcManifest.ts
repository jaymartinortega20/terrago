/**
 * One static chibi texture per stationary NPC (generators/npc.ts) - the
 * NPC equivalent of monsterManifest.ts, simplified since NPCs never
 * animate or face more than one direction.
 */
import { NPC_PALETTES, type NpcId } from './palette.js';
import { drawNpcFrame } from './generators/npc.js';

/** A generic, friendly-looking fallback for any NPC id maps.ts defines
 * that doesn't (yet) have its own palette entry - forward-compatible with
 * new NPCs being added to map data ahead of art for them, same pattern as
 * monsterManifest.ts's FALLBACK_MONSTER_SPRITE_ID. */
const FALLBACK_NPC_ID: NpcId = 'shopkeeper';

export function npcSpriteIdFor(npcId: string): NpcId {
  return npcId in NPC_PALETTES ? (npcId as NpcId) : FALLBACK_NPC_ID;
}

export function npcFrameKey(npcId: string): string {
  return `npc_${npcSpriteIdFor(npcId)}`;
}

export interface NpcSpriteAsset {
  key: string;
  draw: (ctx: CanvasRenderingContext2D) => void;
}

export function listNpcFrameAssets(): NpcSpriteAsset[] {
  return (Object.keys(NPC_PALETTES) as NpcId[]).map((npcId) => ({
    key: npcFrameKey(npcId),
    draw: (ctx) => drawNpcFrame(ctx, npcId),
  }));
}
