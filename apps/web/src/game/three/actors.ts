/**
 * Animated 3D actors built from the model pack: heroes (KayKit adventurers,
 * recoloured to your look, wearing your actual weapon, shield, helmet and
 * armour tier), monsters (Quaternius, KayKit skeletons...), NPCs, mounts,
 * pets and farm animals. Models load in the background; the actor shows up
 * as soon as its files arrive.
 *
 * Local space: feet at y = 0, facing +Z, 1 unit = 1 tile.
 */
import * as THREE from 'three';
import { HAIR_COLORS, OUTFITS, SKIN_TONES, type Appearance, type NpcAccessory } from '@terrago/shared';
import { boundsOf, findClip, glowModel, instance, loadModel, ownMaterials, recolorAtlas, tintModel } from './assets';
import { GLOW_TIER, glowSprite, tierMetal } from './kit';
import { weaponModel, type WingStyle } from './chibi';

export type Weapon3D = 'sword' | 'axe' | 'spear' | 'bow' | 'staff' | 'wand' | 'dagger' | 'mace' | 'fist';

export interface MoveState {
  moving: boolean;
  /** Tiles per second. */
  speed: number;
  sit?: boolean;
  mounted?: boolean;
  dead?: boolean;
}

export type OneShot = 'attack' | 'cast' | 'spin' | 'hit' | 'wave' | 'cheer' | 'dance' | 'bow' | 'chop' | 'mine' | 'dig' | 'fish' | 'craft' | 'pickup' | 'interact';

/** Shared animation player: a looping base pose plus one-shot actions on top. */
class Animator {
  mixer: THREE.AnimationMixer;
  private base: THREE.AnimationAction | null = null;
  private baseName = '';
  private shot: THREE.AnimationAction | null = null;
  private shotUntil = 0;
  constructor(
    root: THREE.Object3D,
    readonly clips: THREE.AnimationClip[],
  ) {
    this.mixer = new THREE.AnimationMixer(root);
  }

  setBase(clip: THREE.AnimationClip | undefined, speed = 1): void {
    if (!clip) return;
    if (this.baseName === clip.name) {
      if (this.base) this.base.timeScale = speed;
      return;
    }
    const next = this.mixer.clipAction(clip);
    next.reset().setLoop(THREE.LoopRepeat, Infinity).fadeIn(0.18).play();
    next.timeScale = speed;
    this.base?.fadeOut(0.18);
    this.base = next;
    this.baseName = clip.name;
  }

  /** Play once; `hold` keeps the last frame (death). */
  once(clip: THREE.AnimationClip | undefined, now: number, opts: { speed?: number; hold?: boolean; weight?: number } = {}): void {
    if (!clip) return;
    const a = this.mixer.clipAction(clip);
    if (this.shot && this.shot !== a) this.shot.fadeOut(0.08);
    a.reset();
    a.setLoop(THREE.LoopOnce, 1);
    a.clampWhenFinished = !!opts.hold;
    a.timeScale = opts.speed ?? 1;
    a.setEffectiveWeight(opts.weight ?? 1);
    a.fadeIn(0.06).play();
    this.shot = a;
    this.shotUntil = now + (clip.duration / (opts.speed ?? 1)) * 1000;
    if (!opts.hold) this.base?.setEffectiveWeight(1);
  }

  busy(now: number): boolean {
    return now < this.shotUntil;
  }

  stopShot(): void {
    this.shot?.fadeOut(0.15);
    this.shot = null;
    this.shotUntil = 0;
  }

  update(dt: number, now: number): void {
    if (this.shot && now > this.shotUntil + 30 && !this.shot.clampWhenFinished) {
      this.shot.fadeOut(0.15);
      this.shot = null;
    }
    this.mixer.update(dt);
  }
}

// ---------------------------------------------------------------------------
// Actor base
// ---------------------------------------------------------------------------

export abstract class Actor {
  readonly root = new THREE.Group();
  /** Model holder (scaled); swapped in when files load. */
  protected holder = new THREE.Group();
  protected anim: Animator | null = null;
  protected flashMats: { m: THREE.MeshStandardMaterial; e: THREE.Color; i: number }[] = [];
  private flashUntil = 0;
  height = 1.2;
  ready = false;
  disposed = false;

  constructor() {
    this.root.add(this.holder);
  }

  protected collectFlash(o: THREE.Object3D): void {
    this.flashMats = [];
    o.traverse((x) => {
      const m = x as THREE.Mesh;
      if (!m.isMesh) return;
      for (const mat of Array.isArray(m.material) ? m.material : [m.material]) {
        const s = mat as THREE.MeshStandardMaterial;
        if (s.emissive) this.flashMats.push({ m: s, e: s.emissive.clone(), i: s.emissiveIntensity });
      }
    });
  }

  flash(now: number, ms = 90): void {
    this.flashUntil = now + ms;
  }

  protected updateFlash(now: number): void {
    const on = now < this.flashUntil;
    for (const f of this.flashMats) {
      if (on) {
        f.m.emissive.setRGB(1, 1, 1);
        f.m.emissiveIntensity = 0.75;
      } else if (f.m.emissiveIntensity === 0.75 && f.m.emissive.r === 1) {
        f.m.emissive.copy(f.e);
        f.m.emissiveIntensity = f.i;
      }
    }
  }

  abstract update(now: number, dt: number, s: MoveState): void;
  abstract play(kind: OneShot, now: number): void;

  dispose(): void {
    this.disposed = true;
    this.root.removeFromParent();
    this.anim?.mixer.stopAllAction();
  }
}

// ---------------------------------------------------------------------------
// Heroes (players and human NPCs)
// ---------------------------------------------------------------------------

/** Hero height in tiles (chibi heroes stand a bit taller than a tile). */
const HERO_H = 1.45;

export type HeroBase = 'knight' | 'barbarian' | 'mage' | 'ranger' | 'rogue' | 'rogue_hooded';

export interface HeroLook {
  base: HeroBase;
  appearance: Appearance;
  weapon?: { type: Weapon3D; tier: number; glow: number } | null;
  shield?: number | null;
  helm?: number | null;
  chest?: number | null;
  wings?: { style: WingStyle; color: string } | null;
  armorGlow?: number;
  /** Override colours (monsters built on hero bodies: orcs, dark mages). */
  skin?: string;
  outfit?: string;
  hair?: string;
  scale?: number;
}

/** Atlas cells per base: which swatches are the outfit (cloth) and the armour metal. */
const CELLS: Record<HeroBase, { outfit: [number, number][]; metal: [number, number][] }> = {
  knight: { outfit: [[0, 1]], metal: [[3, 0], [7, 0]] },
  barbarian: { outfit: [[2, 1], [1, 3]], metal: [[3, 0]] },
  mage: { outfit: [[0, 1], [1, 1]], metal: [] },
  ranger: { outfit: [[0, 1], [7, 0]], metal: [] },
  rogue: { outfit: [[0, 1], [1, 1]], metal: [] },
  rogue_hooded: { outfit: [[1, 1], [0, 1]], metal: [] },
};

let heroClips: Promise<THREE.AnimationClip[]> | null = null;
export function heroAnimations(): Promise<THREE.AnimationClip[]> {
  heroClips ??= loadModel('heroes/anims.glb').then((g) => g.animations);
  return heroClips;
}

const WEAPON_FILE: Record<string, (tier: number) => string | null> = {
  sword: (t) => (t >= 4 ? 'gear/sword_2handed.glb' : 'gear/sword_1handed.glb'),
  axe: (t) => (t >= 4 ? 'gear/axe_2handed.glb' : 'gear/axe_1handed.glb'),
  dagger: () => 'gear/dagger.glb',
  staff: () => 'gear/staff.glb',
  wand: () => 'gear/wand.glb',
  bow: () => 'gear/bow_withString.glb',
  spear: () => null,
  mace: () => null,
  fist: () => null,
};

export function heroKey(l: HeroLook): string {
  const a = l.appearance;
  return [l.base, a.skinTone, a.hairColor, a.outfit, l.weapon ? `${l.weapon.type}${l.weapon.tier}g${l.weapon.glow}` : '', l.shield ?? '', l.helm ?? '', l.chest ?? '', l.wings ? `${l.wings.style}${l.wings.color}` : '', l.armorGlow ?? 0, l.skin ?? '', l.outfit ?? '', l.hair ?? '', l.scale ?? 1].join('|');
}

export class HeroActor extends Actor {
  readonly key: string;
  private weapon: Weapon3D = 'fist';
  private twoHanded = false;
  private swing = 0;
  private wings: THREE.Object3D[] = [];
  private aura: THREE.Sprite | null = null;
  private dead = false;

  constructor(readonly look: HeroLook) {
    super();
    this.key = heroKey(look);
    this.height = HERO_H * (look.scale ?? 1);
    void this.build().catch((e) => console.warn('[3d] hero', e));
  }

  private async build(): Promise<void> {
    const l = this.look;
    const [{ root }, clips, knight] = await Promise.all([instance(`heroes/${l.base}.glb`), heroAnimations(), l.helm != null && l.base !== 'knight' ? instance('heroes/knight.glb') : Promise.resolve(null)]);
    if (this.disposed) return;
    const o = OUTFITS[l.appearance.outfit] ?? OUTFITS[0]!;
    const changes: { cell: [number, number]; color: string }[] = [
      { cell: [0, 0], color: l.skin ?? SKIN_TONES[l.appearance.skinTone] ?? SKIN_TONES[1]! },
      { cell: [1, 0], color: l.hair ?? HAIR_COLORS[l.appearance.hairColor] ?? HAIR_COLORS[1]! },
      ...CELLS[l.base].outfit.map((cell) => ({ cell, color: l.outfit ?? o.shirt })),
      ...(l.chest != null ? CELLS[l.base].metal.map((cell) => ({ cell, color: l.chest === 0 ? '#8a5a34' : tierMetal(l.chest!) })) : []),
    ];
    ownMaterials(root);
    let atlasKey = changes.map((c) => `${c.cell}${c.color}`).join(',');
    root.traverse((x) => {
      const m = x as THREE.SkinnedMesh;
      if (!m.isMesh) return;
      const s = m.material as THREE.MeshStandardMaterial;
      if (s.map) s.map = recolorAtlas(s.map, changes, atlasKey);
      // Helmets show only when one is worn; the knight's is his own.
      if (/Helmet/.test(m.name)) m.visible = l.helm != null;
    });
    // Another class wearing a helmet: borrow the knight's, bound to this rig.
    if (knight && l.helm != null) {
      const bones = new Map<string, THREE.Bone>();
      root.traverse((x) => (x as THREE.Bone).isBone && bones.set(x.name, x as THREE.Bone));
      const metal = l.helm === 0 ? '#8a5a34' : tierMetal(l.helm);
      knight.root.traverse((x) => {
        const m = x as THREE.SkinnedMesh;
        if (!m.isSkinnedMesh || !/Helmet/.test(m.name)) return;
        const mesh = m.clone();
        const mat = (mesh.material as THREE.MeshStandardMaterial).clone();
        if (mat.map) mat.map = recolorAtlas(mat.map, [{ cell: [3, 0], color: metal }, { cell: [7, 0], color: metal }], `helm${metal}`);
        mesh.material = mat;
        const sk = new THREE.Skeleton(m.skeleton.bones.map((b) => bones.get(b.name) ?? b), m.skeleton.boneInverses);
        mesh.bind(sk, m.bindMatrix);
        mesh.frustumCulled = false;
        root.add(mesh);
      });
      // Hide hats and hoods under it.
      root.traverse((x) => {
        if ((x as THREE.Mesh).isMesh && /_Hat|Hood|BearHat/.test(x.name) && !/Helmet/.test(x.name)) x.visible = false;
      });
    }
    // Weapon and shield in the hand slots.
    const slot = (n: string) => root.getObjectByName(n.replace('.', '')) ?? root.getObjectByName(n);
    const w = l.weapon;
    if (w && w.type !== 'fist') {
      this.weapon = w.type;
      const file = WEAPON_FILE[w.type]?.(w.tier) ?? null;
      this.twoHanded = !!file && /2handed/.test(file);
      let model: THREE.Object3D;
      if (file) {
        model = (await instance(file)).root;
        ownMaterials(model);
        if (w.tier >= 2) tintModel(model, tierMetal(w.tier), 0.45);
      } else {
        model = weaponModel(w.type === 'spear' ? 'spear' : 'mace', w.tier, 0);
        model.scale.setScalar(1.6);
      }
      if (w.glow) {
        const gc = GLOW_TIER[w.glow] ?? 0xffffff;
        glowModel(model, gc, 0.5 + w.glow * 0.35);
        const sp = glowSprite(gc, 1.2 + w.glow * 0.3, 0.55);
        sp.position.y = 0.5;
        model.add(sp);
      }
      const hand = w.type === 'bow' ? slot('handslot.l') : slot('handslot.r');
      hand?.add(model);
    }
    if (l.shield != null && !this.twoHanded && this.weapon !== 'bow') {
      const file = l.shield >= 5 ? 'gear/shield_spikes.glb' : l.shield >= 3 ? 'gear/shield_badge.glb' : l.shield >= 1 ? 'gear/shield_square.glb' : 'gear/shield_round.glb';
      const s = (await instance(file)).root;
      ownMaterials(s);
      if (l.shield >= 2) tintModel(s, tierMetal(l.shield), 0.35);
      slot('handslot.l')?.add(s);
    }
    if (this.disposed) return;
    // Scale to about 1.3 tiles tall.
    const h = boundsOf(root).getSize(new THREE.Vector3()).y || 2.4;
    root.scale.setScalar((HERO_H / h) * (l.scale ?? 1));
    this.holder.add(root);
    // Wings on the back.
    if (l.wings) {
      const chest = slot('chest');
      const wing = makeWings(l.wings.style, l.wings.color);
      wing.forEach((x) => (chest ?? root).add(x));
      this.wings = wing;
    }
    const ag = (l.armorGlow ?? 0) >= 10 ? 3 : (l.armorGlow ?? 0) >= 7 ? 2 : (l.armorGlow ?? 0) >= 4 ? 1 : 0;
    if (ag) {
      this.aura = glowSprite(GLOW_TIER[ag] ?? 0xffffff, 1.6, 0.3);
      this.aura.position.y = 0.6;
      this.root.add(this.aura);
    }
    this.anim = new Animator(root, clips);
    this.anim.setBase(findClip(clips, this.twoHanded ? 'Melee_2H_Idle' : 'Idle_A'));
    this.collectFlash(root);
    this.ready = true;
  }

  private clip(...p: (RegExp | string)[]): THREE.AnimationClip | undefined {
    return this.anim ? findClip(this.anim.clips, ...p) : undefined;
  }

  play(kind: OneShot, now: number): void {
    const a = this.anim;
    if (!a || this.dead) return;
    switch (kind) {
      case 'attack': {
        this.swing++;
        if (this.weapon === 'bow') a.once(this.clip('Ranged_Bow_Release'), now, { speed: 1.6 });
        else if (this.weapon === 'staff' || this.weapon === 'wand') a.once(this.clip('Ranged_Magic_Shoot'), now, { speed: 1.5 });
        else if (this.weapon === 'fist') a.once(this.clip('Melee_Unarmed_Attack_Punch_A'), now, { speed: 1.5 });
        else if (this.twoHanded || this.weapon === 'spear') a.once(this.clip(this.swing % 2 ? 'Melee_2H_Attack_Chop' : 'Melee_2H_Attack_Slice'), now, { speed: 1.7 });
        else a.once(this.clip(['Melee_1H_Attack_Chop', 'Melee_1H_Attack_Slice_Diagonal', 'Melee_1H_Attack_Slice_Horizontal'][this.swing % 3]!), now, { speed: 1.7 });
        break;
      }
      case 'cast':
        a.once(this.clip(this.weapon === 'bow' ? 'Ranged_Bow_Draw' : 'Ranged_Magic_Spellcasting', 'Ranged_Magic_Raise'), now, { speed: 1.4 });
        break;
      case 'spin':
        a.once(this.clip('Melee_2H_Attack_Spin'), now, { speed: 1.4 });
        break;
      case 'hit':
        if (!a.busy(now)) a.once(this.clip('Hit_A', 'Hit_B'), now, { speed: 1.6, weight: 0.8 });
        break;
      case 'wave':
        a.once(this.clip('Waving'), now);
        break;
      case 'cheer':
      case 'dance':
        a.once(this.clip('Cheering'), now);
        break;
      case 'bow':
        a.once(this.clip('Interact'), now);
        break;
      case 'chop':
        a.once(this.clip('Chopping', 'Chop'), now, { speed: 1.6 });
        break;
      case 'mine':
        a.once(this.clip('Pickaxing', 'Pickaxe'), now, { speed: 1.6 });
        break;
      case 'dig':
        a.once(this.clip('Digging', 'Dig'), now, { speed: 1.6 });
        break;
      case 'fish':
        a.once(this.clip('Fishing_Cast'), now);
        break;
      case 'craft':
        a.once(this.clip('Hammering', 'Working_A'), now, { speed: 1.6 });
        break;
      case 'pickup':
        a.once(this.clip('PickUp'), now, { speed: 1.5 });
        break;
      case 'interact':
        a.once(this.clip('Interact', 'Use_Item'), now, { speed: 1.5 });
        break;
    }
  }

  update(now: number, dt: number, s: MoveState): void {
    const a = this.anim;
    if (a) {
      if (s.dead && !this.dead) {
        this.dead = true;
        a.once(this.clip('Death_A'), now, { hold: true });
      } else if (!s.dead && this.dead) {
        this.dead = false;
        a.stopShot();
      }
      if (!this.dead) {
        if (s.mounted) a.setBase(this.clip('Sit_Chair_Idle', 'Sit_Floor_Idle'));
        else if (s.sit) a.setBase(this.clip('Sit_Floor_Idle'));
        else if (s.moving) a.setBase(s.speed > 4.2 ? this.clip('Running_A') : this.clip('Running_B', 'Running_A'), Math.max(0.7, Math.min(1.6, s.speed / 3.6)));
        else a.setBase(this.clip(this.twoHanded ? 'Melee_2H_Idle' : this.weapon === 'bow' ? 'Ranged_Bow_Idle' : 'Idle_A', 'Idle_A'));
      }
      a.update(dt, now);
    }
    const t = now / 1000;
    if (this.wings.length) {
      const f = Math.sin(t * (s.moving ? 10 : 3)) * (s.moving ? 0.45 : 0.18);
      this.wings[0]!.rotation.y = -0.5 - f;
      this.wings[1]!.rotation.y = 0.5 + f;
    }
    if (this.aura) (this.aura.material as THREE.SpriteMaterial).opacity = 0.22 + Math.sin(t * 2.5) * 0.08;
    this.updateFlash(now);
  }
}

function makeWings(style: WingStyle, color: string): THREE.Object3D[] {
  const s = new THREE.Shape();
  if (style === 'fairy') {
    s.moveTo(0, 0);
    s.bezierCurveTo(0.15, 0.45, 0.55, 0.55, 0.5, 0.25);
    s.bezierCurveTo(0.48, 0.1, 0.25, 0.02, 0, 0);
    s.bezierCurveTo(0.2, -0.05, 0.4, -0.25, 0.3, -0.33);
    s.bezierCurveTo(0.2, -0.38, 0.05, -0.2, 0, 0);
  } else if (style === 'angel') {
    s.moveTo(0, 0);
    s.quadraticCurveTo(0.25, 0.45, 0.75, 0.42);
    s.lineTo(0.62, 0.3);
    s.lineTo(0.7, 0.22);
    s.lineTo(0.55, 0.12);
    s.lineTo(0.6, 0.02);
    s.lineTo(0.42, -0.04);
    s.lineTo(0.45, -0.14);
    s.lineTo(0.25, -0.15);
    s.quadraticCurveTo(0.08, -0.1, 0, 0);
  } else {
    s.moveTo(0, 0);
    s.lineTo(0.3, 0.32);
    s.lineTo(0.72, 0.4);
    s.quadraticCurveTo(0.6, 0.18, 0.66, 0.02);
    s.quadraticCurveTo(0.5, 0.06, 0.44, -0.14);
    s.quadraticCurveTo(0.3, -0.04, 0.2, -0.22);
    s.quadraticCurveTo(0.12, -0.06, 0, 0);
  }
  const geo = new THREE.ShapeGeometry(s, 10);
  const mat = new THREE.MeshStandardMaterial({
    color,
    side: THREE.DoubleSide,
    transparent: style === 'fairy',
    opacity: style === 'fairy' ? 0.75 : 1,
    emissive: color,
    emissiveIntensity: style === 'fairy' ? 0.6 : style === 'angel' ? 0.25 : 0.1,
    roughness: 0.6,
  });
  return [1, -1].map((sx) => {
    const p = new THREE.Group();
    // In the rig's units (the hero is ~2.4 tall before scaling).
    p.position.set(sx * 0.1, 0.35, -0.3);
    const m = new THREE.Mesh(geo, mat);
    m.scale.set(sx * 2.0, 2.0, 2.0);
    m.rotation.z = 0.35 * sx;
    m.castShadow = true;
    p.add(m);
    return p;
  });
}

// ---------------------------------------------------------------------------
// Monsters, pets, animals
// ---------------------------------------------------------------------------

interface MonsterSpec {
  file?: string;
  hero?: HeroBase;
  /** Height in tiles at size 1. */
  h: number;
  tint?: string | true;
  tintAmt?: number;
  glow?: string;
  hover?: number;
  skin?: string;
  outfit?: string;
  hair?: string;
  weapon?: Weapon3D;
  /** Flip a model that faces backwards. */
  turn?: number;
}

const ICE = '#9ad8ff';
const SPEC: Record<string, MonsterSpec> = {
  green_slime: { file: 'mon/slime.glb', h: 0.6, tint: true, tintAmt: 0.7 },
  blue_slime: { file: 'mon/slime.glb', h: 0.6, tint: true, tintAmt: 0.8 },
  bog_lurker: { file: 'mon/slime.glb', h: 0.7, tint: true, tintAmt: 0.8 },
  king_slime: { file: 'mon/slime.glb', h: 0.7, tint: true, tintAmt: 0.6 },
  boulder_mite: { file: 'mon/slime.glb', h: 0.55, tint: '#8a7a6a', tintAmt: 0.9 },
  frost_mite: { file: 'mon/slime.glb', h: 0.55, tint: ICE, tintAmt: 0.9, glow: ICE },
  field_rat: { file: 'mon/rat.glb', h: 0.45 },
  wild_boar: { file: 'mon/pig.glb', h: 0.75, tint: '#7a5a3a', tintAmt: 0.85 },
  forest_wolf: { file: 'mon/wolf.glb', h: 0.95 },
  snow_wolf: { file: 'mon/wolf.glb', h: 0.95, tint: '#eef4fa', tintAmt: 0.75 },
  magma_hound: { file: 'mon/wolf.glb', h: 0.95, tint: '#d8502a', tintAmt: 0.8, glow: '#ff6a1a' },
  fields_warden: { file: 'mon/wolf.glb', h: 0.95, tint: '#6a5a3a', tintAmt: 0.6 },
  young_drake: { file: 'mon/dragon.glb', h: 1.1, hover: 0.4 },
  elder_drake: { file: 'mon/dragon_evolved.glb', h: 1.3, hover: 0.4, tint: '#7a1a1a', tintAmt: 0.4 },
  ancient_wyvern: { file: 'mon/dragon_evolved.glb', h: 1.3, hover: 0.5, tint: '#4a7a3a', tintAmt: 0.7 },
  drake_champion: { file: 'mon/dragon_evolved.glb', h: 1.3, hover: 0.4 },
  drake_broodmother: { file: 'mon/dragon_evolved.glb', h: 1.3, hover: 0.4, tint: '#8a2a1a', tintAmt: 0.4 },
  wb_elder_dragon: { file: 'mon/dragon_evolved.glb', h: 1.2, hover: 0.6 },
  wyrm_hatchling: { file: 'mon/dragon-cute.glb', h: 0.8, hover: 0.5 },
  goblin_scout: { file: 'mon/goblin.glb', h: 1.0 },
  goblin_warchief: { file: 'mon/goblin.glb', h: 1.0, tint: '#4f7a2c', tintAmt: 0.3 },
  crypt_ghoul: { file: 'mon/zombie.glb', h: 1.15 },
  fire_imp: { file: 'mon/q_demon.glb', h: 0.95, tint: '#ff6a2a', tintAmt: 0.3 },
  dust_bandit: { hero: 'rogue_hooded', h: 1.25, outfit: '#c9a06a', skin: '#c08155', weapon: 'dagger' },
  giant_spider: { file: 'mon/spider.glb', h: 0.55 },
  sand_scorpion: { file: 'mon/crab.glb', h: 0.55, tint: '#d8a04a', tintAmt: 0.85 },
  cave_bat: { file: 'mon/bat.glb', h: 0.55, hover: 0.8 },
  ice_wisp: { file: 'mon/q_ghost.glb', h: 0.8, hover: 0.5, tint: ICE, tintAmt: 0.85, glow: ICE },
  wb_storm_roc: { file: 'mon/q_hywirl.glb', h: 1.0, hover: 0.8, tint: '#7a9ad8', tintAmt: 0.5, glow: '#bfe6ff' },
  skeleton: { file: 'mon/skeleton_minion.glb', h: 1.25, weapon: 'sword' },
  crypt_lord: { file: 'mon/skeleton_mage.glb', h: 1.3, tint: '#9b59d0', tintAmt: 0.3, glow: '#b06ad6', weapon: 'staff' },
  cursed_knight: { file: 'mon/skeleton_warrior.glb', h: 1.3, tint: '#7a5aa0', tintAmt: 0.3, weapon: 'axe' },
  sanctum_lich: { file: 'mon/skeleton_mage.glb', h: 1.2, tint: '#5a3a8a', tintAmt: 0.35, glow: '#b06ad6', weapon: 'staff' },
  orc: { hero: 'barbarian', h: 1.35, skin: '#6f9a3c', outfit: '#6b4628', hair: '#2a1c15', weapon: 'axe' },
  swamp_troll: { hero: 'barbarian', h: 1.4, skin: '#3f7a6a', outfit: '#4a3a2a', hair: '#2a3a2a', weapon: 'mace' },
  frost_giant: { file: 'mon/q_bluedemon.glb', h: 1.3, tint: ICE, tintAmt: 0.5 },
  frost_giant_brute: { file: 'mon/q_bluedemon.glb', h: 1.3, tint: '#bfe6ff', tintAmt: 0.4 },
  dragon_knight: { hero: 'knight', h: 1.35, outfit: '#5a1a2a', skin: '#c08155', weapon: 'sword' },
  dragon_knight_champion: { hero: 'knight', h: 1.35, outfit: '#2a1a3a', skin: '#94603d', weapon: 'sword' },
  stone_golem: { file: 'mon/robot.glb', h: 1.2, tint: '#8b8a86', tintAmt: 0.8 },
  rock_golem: { file: 'mon/robot.glb', h: 1.2, tint: '#7a7068', tintAmt: 0.8 },
  sand_golem: { file: 'mon/robot.glb', h: 1.2, tint: '#d8c08a', tintAmt: 0.8 },
  obsidian_golem: { file: 'mon/robot.glb', h: 1.2, tint: '#3a3048', tintAmt: 0.85, glow: '#7a4ad0' },
  ruin_sentinel: { file: 'mon/robot.glb', h: 1.2, tint: '#9a948a', tintAmt: 0.8, glow: '#7fe0ff' },
  stoneheart_golem: { file: 'mon/robot.glb', h: 1.2, tint: '#6a6460', tintAmt: 0.8 },
  magma_tyrant: { file: 'mon/q_demon.glb', h: 1.3, tint: '#e0602a', tintAmt: 0.4, glow: '#ff6a1a' },
  infernal_titan: { file: 'mon/q_demon.glb', h: 1.3, tint: '#d0301a', tintAmt: 0.4, glow: '#ff4a1a' },
  frost_yeti: { file: 'mon/q_dino.glb', h: 1.3, tint: '#eef4fa', tintAmt: 0.75 },
  earth_elemental: { file: 'mon/q_mushnub.glb', h: 1.0, tint: '#8a6a3a', tintAmt: 0.7 },
  wb_elder_treant: { file: 'mon/q_mushroomking.glb', h: 1.2, tint: '#4a7a2a', tintAmt: 0.5 },
  wb_glacial_behemoth: { file: 'mon/q_bluedemon.glb', h: 1.2, tint: ICE, tintAmt: 0.6, glow: ICE },
  dark_mage: { hero: 'mage', h: 1.3, outfit: '#4a2a6a', weapon: 'staff' },
  marsh_witch: { hero: 'mage', h: 1.3, outfit: '#3a6a3a', skin: '#8ab07a', weapon: 'staff' },
  crag_shaman: { hero: 'mage', h: 1.3, outfit: '#a07040', weapon: 'staff' },
  frost_priestess: { hero: 'mage', h: 1.3, outfit: '#9ad0ff', hair: '#eef4fa', weapon: 'wand' },
  glacier_warlock: { hero: 'mage', h: 1.3, outfit: '#3a5ab0', weapon: 'staff' },
  dragon_priest: { hero: 'mage', h: 1.3, outfit: '#a0302a', weapon: 'staff' },
  ember_elemental: { file: 'mon/q_ghost.glb', h: 0.95, hover: 0.3, tint: '#ff8a2a', tintAmt: 0.85, glow: '#ff6a1a' },
  wraith: { file: 'mon/q_ghost.glb', h: 0.95, hover: 0.3, tint: '#c8c8d8', tintAmt: 0.6 },
  ice_specter: { file: 'mon/q_ghost.glb', h: 0.95, hover: 0.3, tint: ICE, tintAmt: 0.8, glow: ICE },
};

const BY_SHAPE: Record<string, MonsterSpec> = {
  slime: SPEC.green_slime!,
  rat: SPEC.field_rat!,
  boar: SPEC.wild_boar!,
  wolf: SPEC.forest_wolf!,
  goblin: SPEC.goblin_scout!,
  spider: SPEC.giant_spider!,
  bat: SPEC.cave_bat!,
  skeleton: SPEC.skeleton!,
  orc: SPEC.orc!,
  golem: SPEC.stone_golem!,
  mage: SPEC.dark_mage!,
};

export const PET_SPEC: Record<string, MonsterSpec> = {
  dog: { file: 'mon/dog.glb', h: 0.5 },
  cat: { file: 'mon/cat.glb', h: 0.45 },
  fox: { file: 'mon/fox.glb', h: 0.5 },
  slime: { file: 'mon/slime.glb', h: 0.45, tint: true, tintAmt: 0.7 },
  dragonling: { file: 'mon/dragon-cute.glb', h: 0.6, hover: 0.5 },
  hawk: { file: 'mon/bat.glb', h: 0.45, hover: 1.2, tint: '#a8743f', tintAmt: 0.7 },
};

export const ANIMAL_SPEC: Record<string, MonsterSpec> = {
  chicken: { file: 'mon/chicken.glb', h: 0.45 },
  cow: { file: 'mon/cow.glb', h: 1.05 },
  sheep: { file: 'mon/sheep.glb', h: 0.8 },
  pig: { file: 'mon/pig.glb', h: 0.7 },
  goat: { file: 'mon/sheep.glb', h: 0.8, tint: '#c8b8a0', tintAmt: 0.5 },
};

/** Rideable models (horse, stag, wolf, boar, wyvern; the hovergear stays hand-built). */
export const MOUNT_SPEC: Record<string, MonsterSpec & { seat: number }> = {
  horse: { file: 'mon/horse.glb', h: 1.35, seat: 0.95 },
  stag: { file: 'mon/deer.glb', h: 1.6, seat: 0.95 },
  wolf: { file: 'mon/wolf.glb', h: 1.1, seat: 0.75 },
  boar: { file: 'mon/pig.glb', h: 0.85, seat: 0.7 },
  wyvern: { file: 'mon/dragon.glb', h: 1.2, seat: 0.95 },
};

export class CreatureActor extends Actor {
  private hover = 0;
  private phase = Math.random() * 6;
  private dead = false;
  private hero: HeroActor | null = null;

  constructor(
    readonly id: string,
    spec: MonsterSpec,
    readonly color: string,
    readonly size: number,
    opts: { elite?: boolean; boss?: boolean } = {},
  ) {
    super();
    this.height = spec.h * size + (spec.hover ?? 0) * size;
    this.hover = (spec.hover ?? 0) * size;
    if (opts.elite || opts.boss) {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.5 * Math.max(1, size * 0.8), 0.035, 6, 40), new THREE.MeshBasicMaterial({ color: opts.boss ? '#ff5a3a' : '#f2c14e', transparent: true, opacity: 0.85 }));
      ring.rotation.x = Math.PI / 2;
      ring.position.y = 0.04;
      ring.name = 'ring';
      this.root.add(ring);
      const s = glowSprite(opts.boss ? 0xff5a3a : 0xf2c14e, 1.6 * size, 0.22);
      s.position.y = this.height * 0.5;
      this.root.add(s);
    }
    if (spec.hero) {
      // Humanoid monsters wear hero bodies.
      this.hero = new HeroActor({
        base: spec.hero,
        appearance: { bodyType: 'a', skinTone: 2, hairStyle: 0, hairColor: 0, eyeColor: 0, outfit: 0 },
        skin: spec.skin,
        outfit: spec.outfit,
        hair: spec.hair,
        weapon: spec.weapon ? { type: spec.weapon, tier: 2, glow: 0 } : null,
        scale: (spec.h / HERO_H) * size,
      });
      this.holder.add(this.hero.root);
      this.ready = true;
      return;
    }
    void this.build(spec).catch((e) => console.warn('[3d] creature', id, e));
  }

  private async build(spec: MonsterSpec): Promise<void> {
    const [{ root, clips }, heroClips] = await Promise.all([instance(spec.file!), spec.file!.startsWith('mon/skeleton_') ? heroAnimations() : Promise.resolve([])]);
    if (this.disposed) return;
    ownMaterials(root);
    if (spec.tint) tintModel(root, spec.tint === true ? this.color : spec.tint, spec.tintAmt ?? 0.6);
    if (spec.glow) glowModel(root, spec.glow, 0.35);
    // KayKit skeletons use the hero rig: give them a weapon too.
    if (spec.weapon && spec.file!.startsWith('mon/skeleton_')) {
      const file = spec.weapon === 'staff' ? 'gear/skeleton_staff.glb' : spec.weapon === 'axe' ? 'gear/skeleton_axe.glb' : 'gear/skeleton_blade.glb';
      const w = (await instance(file)).root;
      (root.getObjectByName('handslotr') ?? root.getObjectByName('handslot.r'))?.add(w);
    }
    const b = boundsOf(root);
    const h = b.getSize(new THREE.Vector3()).y || 1;
    root.scale.multiplyScalar((spec.h * this.size) / h);
    // Sit on the ground (some models have their origin above their feet).
    const b2 = boundsOf(root);
    root.position.y -= b2.min.y;
    if (spec.turn) root.rotation.y = spec.turn;
    this.holder.add(root);
    const all = clips.length ? clips : heroClips;
    this.anim = new Animator(root, all);
    this.anim.setBase(this.idleClip());
    this.collectFlash(root);
    this.ready = true;
  }

  private c(...p: RegExp[]): THREE.AnimationClip | undefined {
    return this.anim ? findClip(this.anim.clips, ...p) : undefined;
  }

  private idleClip() {
    return this.c(/Skeletons_Idle/, /^Idle_A$/, /Flying_Idle/, /idle/i, /fly/i, /^Baked frames$/, /walk/i) ?? this.anim?.clips[0];
  }

  play(kind: OneShot, now: number): void {
    if (this.hero) return this.hero.play(kind, now);
    const a = this.anim;
    if (!a || this.dead) return;
    if (kind === 'attack' || kind === 'cast' || kind === 'spin') a.once(this.c(/Melee_1H_Attack_Chop/, /attack/i, /bite_front/i, /punch/i, /headbutt/i, /weapon/i), now, { speed: 1.4 });
    else if (kind === 'hit' && !a.busy(now)) a.once(this.c(/^Hit_A$/, /hitreact/i, /hitrecieve/i, /recievehit/i, /_hit$/i, /hit/i), now, { speed: 1.5, weight: 0.8 });
  }

  update(now: number, dt: number, s: MoveState): void {
    if (this.hero) {
      this.hero.update(now, dt, s);
      this.updateRing(now);
      return;
    }
    const a = this.anim;
    if (a) {
      if (s.dead && !this.dead) {
        this.dead = true;
        a.once(this.c(/Skeletons_Death$/, /^Death_A$/, /death/i, /dying/i, /defeat/i, /die/i), now, { hold: true });
      } else if (!s.dead && this.dead) {
        this.dead = false;
        a.stopShot();
      }
      if (!this.dead) {
        if (s.moving) a.setBase(this.c(/Skeletons_Walking/, /^Walking_A$/, /fast_flying/i, /^walk$/i, /walk/i, /run/i, /fly/i) ?? this.idleClip(), 1.2);
        else a.setBase(this.idleClip());
      }
      a.update(dt, now);
    }
    const t = now / 1000;
    this.phase += dt;
    this.holder.position.y = this.hover ? this.hover + Math.sin(t * 2.4 + this.phase) * 0.06 : 0;
    this.updateRing(now);
    this.updateFlash(now);
  }

  private updateRing(now: number): void {
    const r = this.root.getObjectByName('ring');
    if (r) r.rotation.z = now / 1000;
  }

  flash(now: number, ms = 80): void {
    if (this.hero) this.hero.flash(now, ms);
    else super.flash(now, ms);
  }

  dispose(): void {
    this.hero?.dispose();
    super.dispose();
  }
}

export function monsterSpec(id: string, shape: string): MonsterSpec {
  return SPEC[id] ?? BY_SHAPE[shape] ?? SPEC.green_slime!;
}

/** NPC villagers: hero bodies picked from their accessory and look. */
export function npcBase(acc: NpcAccessory | undefined, id: string): HeroBase {
  if (acc === 'helmet' || acc === 'crown') return 'knight';
  if (acc === 'hood') return 'rogue_hooded';
  if (acc === 'hat') return 'mage';
  if (acc === 'bandana') return 'rogue';
  if (acc === 'cape') return 'ranger';
  if (acc === 'apron') return 'barbarian';
  const h = [...id].reduce((s, c) => s + c.charCodeAt(0), 0);
  return (['ranger', 'rogue', 'barbarian', 'knight'] as HeroBase[])[h % 4]!;
}

/** Hero body for a class / job. */
export function classBase(classId: string, job?: string | null): HeroBase {
  if (job === 'berserker') return 'barbarian';
  if (job === 'beastmaster' || job === 'ranger') return 'ranger';
  if (job === 'inquisitor' || job === 'necromancer') return 'rogue_hooded';
  if (classId === 'warrior') return 'knight';
  if (classId === 'mage') return 'mage';
  if (classId === 'archer') return 'ranger';
  if (classId === 'acolyte') return 'rogue_hooded';
  return 'rogue';
}

/** A rideable mount model. */
export async function mountModel(kind: string, color: string, glow?: string | null): Promise<{ root: THREE.Object3D; seat: number; anim: Animator } | null> {
  const spec = MOUNT_SPEC[kind];
  if (!spec) return null;
  const { root, clips } = await instance(spec.file!);
  ownMaterials(root);
  tintModel(root, color, 0.55);
  if (glow) glowModel(root, glow, 0.25);
  const h = boundsOf(root).getSize(new THREE.Vector3()).y || 1;
  root.scale.multiplyScalar(spec.h / h);
  const b = boundsOf(root);
  root.position.y -= b.min.y;
  const anim = new Animator(root, clips);
  anim.setBase(findClip(clips, /^Idle$/i, /idle/i, /Flying_Idle/));
  return { root, seat: spec.seat, anim };
}

export function mountGait(anim: Animator, moving: boolean, fast: boolean): void {
  anim.setBase(moving ? findClip(anim.clips, fast ? /^Run$/i : /^Walk$/i, /run/i, /walk/i, /Fast_Flying/) : findClip(anim.clips, /^Idle$/i, /idle/i, /Flying_Idle/), moving ? 1.3 : 1);
}

export type { Animator };
