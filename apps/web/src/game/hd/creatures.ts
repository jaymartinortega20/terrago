/**
 * HD creature sprite sheets (monsters, pets, farm animals, mounts) baked
 * from the Quaternius / KayKit models.
 */
import * as THREE from 'three';
import { CreatureActor, MOUNT_SPEC, PET_SPEC, ANIMAL_SPEC, monsterSpec } from './actors';
import { bakeSheet, clipFrames, toonify, TILE_PX, type FrameSpec, type Sheet } from './baker';

export type CreatureAnim = 'idle' | 'walk' | 'attack' | 'hurt' | 'dead';
export const CREATURE_ANIMS: Record<CreatureAnim, { start: number; n: number }> = { idle: { start: 0, n: 4 }, walk: { start: 4, n: 6 }, attack: { start: 10, n: 4 }, hurt: { start: 14, n: 1 }, dead: { start: 15, n: 1 } };
export const CREATURE_COLS = 16;
/** Rows: facing the camera, facing right (left is mirrored), facing away. */
const YAW = [0.65, 1.35, Math.PI - 0.65];

export interface CreatureSheet extends Sheet {
  /** World px from the bottom of a frame to the feet. */
  foot: number;
  /** Frame size in world px. */
  w: number;
  h: number;
  /** Height of the creature above its feet (world px). */
  top: number;
}

type Kind = 'monster' | 'pet' | 'animal' | 'mount';

function specOf(kind: Kind, id: string, shape: string) {
  if (kind === 'pet') return PET_SPEC[id] ?? PET_SPEC.dog!;
  if (kind === 'animal') return ANIMAL_SPEC[id] ?? ANIMAL_SPEC.chicken!;
  if (kind === 'mount') return { ...(MOUNT_SPEC[id] ?? MOUNT_SPEC.horse!), tint: true as const, tintAmt: 0.55 };
  return monsterSpec(id, shape);
}

export function hasMountModel(kind: string): boolean {
  return !!MOUNT_SPEC[kind];
}

export async function bakeCreature(kind: Kind, id: string, shape: string, color: string, size: number, priority = 0): Promise<CreatureSheet> {
  const spec = specOf(kind, id, shape);
  const actor = new CreatureActor(id, spec, color, size);
  await actor.built;
  toonify(actor.root);
  const clips = actor.clipList();
  const c = (...p: RegExp[]) => {
    for (const r of p) {
      const hit = clips.find((x) => r.test(x.name));
      if (hit) return hit;
    }
    return undefined;
  };
  const idle = c(/Skeletons_Idle/, /^Idle_A$/, /Flying_Idle/, /^Idle$/i, /idle/i, /^Baked frames$/, /fly/i, /walk/i) ?? clips[0];
  const walk = c(/Skeletons_Walking/, /^Walking_A$/, /Fast_Flying/, /^Walk$/i, /_Walk$/, /walk/i, /run/i, /fly/i) ?? idle;
  const attack = c(/Melee_1H_Attack_Chop/, /attack/i, /bite_front/i, /punch/i, /headbutt/i, /weapon/i) ?? idle;
  const hurt = c(/^Hit_A$/, /hitreact/i, /hitrecieve/i, /recievehit/i, /_hit$/i, /hit/i) ?? idle;
  const dead = c(/Skeletons_Death$/, /^Death_A$/, /death/i, /dying/i, /defeat/i, /die/i);
  const hover = actor.hoverHeight();
  const bob = (fs: FrameSpec[], amp = 0.06, lift = hover) => fs.map((f, i) => ({ pose: () => (f.pose(), (actor.root.position.y = lift ? lift + Math.sin((i / fs.length) * Math.PI * 2) * amp : 0)) }));
  const frames: FrameSpec[] = [
    ...bob(clipFrames(actor, idle, 4, true)),
    ...bob(clipFrames(actor, walk, 6, true)),
    ...bob(clipFrames(actor, attack, 4, false, 0.15, 0.75), 0),
    ...bob(clipFrames(actor, hurt, 1, false, 0.3), 0),
    ...bob(dead ? clipFrames(actor, dead, 1, false, 0.999) : [{ pose: () => actor.poseAt(idle, 0) }], 0, 0),
  ];
  // Frame size from the model's bounds (with room for attacks and a hover).
  actor.poseAt(idle, 0);
  const b = new THREE.Box3().setFromObject(actor.root, true);
  const sz = b.getSize(new THREE.Vector3());
  const tall = (sz.y + hover) * TILE_PX * 0.95;
  const wide = Math.max(sz.x, sz.z) * TILE_PX * 1.15;
  const h = Math.ceil(Math.max(40, tall + 22) / 4) * 4;
  const w = Math.ceil(Math.max(40, wide + 16, h * 0.8) / 4) * 4;
  const foot = 10;
  try {
    const sh = await bakeSheet(actor.root, { frameW: w, frameH: h, foot, rows: YAW, frames }, priority);
    return { ...sh, foot, w, h, top: Math.round(tall) };
  } finally {
    actor.dispose();
  }
}

/** Seat height of a mount in tiles (where the rider sits). */
export function mountSeat(kind: string): number {
  return MOUNT_SPEC[kind]?.seat ?? 0.9;
}
