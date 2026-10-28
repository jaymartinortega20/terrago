/**
 * HD hero sprite sheets: a KayKit chibi adventurer recoloured to the
 * character's look and wearing their actual gear (weapon, shield, helmet,
 * chest armour tint, wings, upgrade glow), baked into frames for every
 * animation the 2D game shows.
 */
import { HeroActor, heroKey, type HeroLook } from './actors';
import { bakeSheet, clipFrames, toonify, type FrameSpec, type Sheet } from './baker';

/** Frame sizes in world px (the sprite is drawn at this size). */
export const HERO_FRAME = { w: 84, h: 92, foot: 12 } as const;

/** Rows: facing the camera, facing right (left is mirrored), facing away. */
export const HERO_ROWS = ['down', 'side', 'up'] as const;
const YAW = [0.28, 1.3, Math.PI - 0.28];

export type HeroAnim = 'idle' | 'walk' | 'attack' | 'cast' | 'hurt' | 'sit' | 'ride' | 'dead' | 'work';

/** Column ranges in the sheet. */
export const HERO_ANIMS: Record<HeroAnim, { start: number; n: number }> = (() => {
  const order: [HeroAnim, number][] = [
    ['idle', 3],
    ['walk', 6],
    ['attack', 4],
    ['cast', 3],
    ['hurt', 1],
    ['sit', 1],
    ['ride', 1],
    ['dead', 1],
    ['work', 3],
  ];
  const out = {} as Record<HeroAnim, { start: number; n: number }>;
  let i = 0;
  for (const [k, n] of order) {
    out[k] = { start: i, n };
    i += n;
  }
  return out;
})();
export const HERO_COLS = Object.values(HERO_ANIMS).reduce((s, a) => s + a.n, 0);

export async function bakeHero(look: HeroLook, priority = 0, work: 'chop' | 'mine' | 'dig' | 'craft' = 'craft'): Promise<Sheet> {
  const hero = new HeroActor(look);
  await hero.built;
  toonify(hero.root);
  const c = (...p: (RegExp | string)[]) => hero.findClip(...p);
  const w = hero.weapon;
  const idle = c(hero.twoHanded ? 'Melee_2H_Idle' : w === 'bow' ? 'Ranged_Bow_Idle' : 'Idle_A', 'Idle_A');
  const walk = c('Running_A');
  const attack =
    w === 'bow'
      ? c('Ranged_Bow_Release')
      : w === 'staff' || w === 'wand'
        ? c('Ranged_Magic_Shoot')
        : w === 'fist'
          ? c('Melee_Unarmed_Attack_Punch_A')
          : hero.twoHanded
            ? c('Melee_2H_Attack_Chop')
            : c('Melee_1H_Attack_Chop');
  const cast = c(w === 'bow' ? 'Ranged_Bow_Draw' : 'Ranged_Magic_Spellcasting', 'Ranged_Magic_Raise');
  const workClip = c({ chop: 'Chopping', mine: 'Pickaxing', dig: 'Digging', craft: 'Hammering' }[work], 'Working_A');
  const flap = (fs: FrameSpec[], speed: number): FrameSpec[] =>
    fs.map((f, i) => ({
      pose: () => {
        f.pose();
        hero.setWingFlap(0.5 + 0.5 * Math.sin((i / fs.length) * Math.PI * 2 * speed));
      },
    }));
  const frames: FrameSpec[] = [
    ...flap(clipFrames(hero, idle, 3, true), 1),
    ...flap(clipFrames(hero, walk, 6, true), 2),
    ...clipFrames(hero, attack, 4, false, 0.12, 0.7),
    ...clipFrames(hero, cast, 3, false, 0.15, 0.85),
    ...clipFrames(hero, c('Hit_A'), 1, false, 0.3),
    ...clipFrames(hero, c('Sit_Floor_Idle'), 1, false, 0.1),
    ...clipFrames(hero, c('Sit_Chair_Idle'), 1, false, 0.1),
    ...clipFrames(hero, c('Death_A'), 1, false, 0.999),
    ...clipFrames(hero, workClip, 3, true),
  ];
  try {
    return await bakeSheet(hero.root, { frameW: HERO_FRAME.w, frameH: HERO_FRAME.h, foot: HERO_FRAME.foot, rows: YAW, frames }, priority);
  } finally {
    hero.dispose();
  }
}

/** Baked sheets shared by the game and the menus (most recent first). */
const sheetCache = new Map<string, Promise<Sheet>>();

/** A hero sheet, baked once per look. */
export function heroSheet(look: HeroLook, priority = 0): Promise<Sheet> {
  const k = heroKey(look);
  let p = sheetCache.get(k);
  if (p) {
    sheetCache.delete(k);
    sheetCache.set(k, p);
    return p;
  }
  p = bakeHero(look, priority);
  p.catch(() => sheetCache.delete(k));
  sheetCache.set(k, p);
  while (sheetCache.size > 24) sheetCache.delete(sheetCache.keys().next().value!);
  return p;
}
