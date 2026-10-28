/**
 * 3D chibi characters: big head, small body, with the gear you wear actually
 * visible — weapon in hand, shield, helmet, chest plate, wings, capes and
 * crowns — and simple procedural animation (walk, strike, flinch, fall, sit).
 *
 * Local space: feet at y = 0, facing +Z, about 1.15 units tall (a tile is 1).
 */
import * as THREE from 'three';
import { EYE_COLORS, HAIR_COLORS, OUTFITS, SKIN_TONES, type Appearance, type NpcAccessory } from '@terrago/shared';
import { GLOW_TIER, box, cone, cyl, glowMat, glowSprite, ico, mat, part, shade, sphere, tierMetal, torus } from './kit';

export type Weapon3D = 'sword' | 'axe' | 'spear' | 'bow' | 'staff' | 'wand' | 'dagger' | 'mace' | 'fist';
export type WingStyle = 'fairy' | 'angel' | 'demon' | 'dragon';

export interface ChibiLook {
  appearance: Appearance;
  accessory?: NpcAccessory;
  weapon?: { type: Weapon3D; tier: number; glow: number } | null;
  /** Shield tier (offhand). */
  shield?: number | null;
  /** Head / chest armour tier (0 = padded leather). */
  helm?: number | null;
  chest?: number | null;
  wings?: { style: WingStyle; color: string } | null;
  armorGlow?: number;
}

export interface ChibiState {
  moving: boolean;
  /** Tiles per second (walk cycle speed). */
  speed: number;
  /** 0..1 while striking / casting, else -1. */
  act: number;
  /** 0..1 flinch. */
  hurt: number;
  dead: boolean;
  sit: boolean;
  mounted: boolean;
}

// Partial spheres (hair caps, helmets, hoods) are cached by shape.
const capCache = new Map<string, THREE.BufferGeometry>();
function cap(r: number, theta: number, ws = 10, hs = 6): THREE.BufferGeometry {
  const k = `${r},${theta},${ws},${hs}`;
  let g = capCache.get(k);
  if (!g) {
    g = new THREE.SphereGeometry(r, ws, hs, 0, Math.PI * 2, 0, theta);
    capCache.set(k, g);
  }
  return g;
}

// Wing outlines (left wing, in the XY plane, root at the origin).
const wingCache = new Map<WingStyle, THREE.BufferGeometry>();
function wingGeo(style: WingStyle): THREE.BufferGeometry {
  let g = wingCache.get(style);
  if (g) return g;
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
    // Bat / dragon membrane with scalloped edge.
    s.moveTo(0, 0);
    s.lineTo(0.3, 0.32);
    s.lineTo(0.72, 0.4);
    s.quadraticCurveTo(0.6, 0.18, 0.66, 0.02);
    s.quadraticCurveTo(0.5, 0.06, 0.44, -0.14);
    s.quadraticCurveTo(0.3, -0.04, 0.2, -0.22);
    s.quadraticCurveTo(0.12, -0.06, 0, 0);
  }
  g = new THREE.ShapeGeometry(s, 6);
  wingCache.set(style, g);
  return g;
}

/** A weapon model along +Y from the grip. */
export function weaponModel(type: Weapon3D, tier: number, glow: number): THREE.Group {
  const g = new THREE.Group();
  const metalC = tierMetal(tier);
  const gl = GLOW_TIER[glow] ?? 0;
  const blade = gl ? mat(metalC, { metal: 0.6, rough: 0.3, emissive: gl, ei: 0.6 + glow * 0.25 }) : mat(metalC, { metal: 0.6, rough: 0.35 });
  const wood = mat('#6d4428');
  const grip = mat('#3a2a22');
  const gold = mat('#e8c24a', { metal: 0.6, rough: 0.35 });
  let tip = 0.5;
  switch (type) {
    case 'sword':
      g.add(part(cyl(0.025, 0.025, 0.16), grip, 0, 0, 0));
      g.add(part(box(0.22, 0.04, 0.06), gold, 0, 0.09, 0));
      g.add(part(box(0.07, 0.52, 0.025), blade, 0, 0.37, 0));
      g.add(part(cone(0.05, 0.1, 4), blade, 0, 0.68, 0, 0, Math.PI / 4));
      tip = 0.6;
      break;
    case 'dagger':
      g.add(part(cyl(0.022, 0.022, 0.1), grip, 0, 0, 0));
      g.add(part(box(0.13, 0.03, 0.05), gold, 0, 0.06, 0));
      g.add(part(box(0.055, 0.24, 0.02), blade, 0, 0.19, 0));
      g.add(part(cone(0.04, 0.08, 4), blade, 0, 0.35, 0, 0, Math.PI / 4));
      tip = 0.3;
      break;
    case 'axe':
      g.add(part(cyl(0.025, 0.03, 0.62), wood, 0, 0.2, 0));
      g.add(part(box(0.06, 0.2, 0.05), blade, 0.06, 0.44, 0));
      g.add(part(cyl(0.12, 0.12, 0.04, 8, ), blade, 0.13, 0.44, 0, Math.PI / 2, 0, 0));
      tip = 0.45;
      break;
    case 'mace':
      g.add(part(cyl(0.025, 0.03, 0.45), wood, 0, 0.12, 0));
      g.add(part(ico(0.1, 0), blade, 0, 0.4, 0));
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        g.add(part(cone(0.03, 0.08, 4), blade, Math.cos(a) * 0.1, 0.4, Math.sin(a) * 0.1, Math.sin(a) * 1.57, 0, -Math.cos(a) * 1.57));
      }
      tip = 0.4;
      break;
    case 'spear':
      g.add(part(cyl(0.022, 0.022, 1.1), wood, 0, 0.25, 0));
      g.add(part(cone(0.05, 0.22, 4), blade, 0, 0.9, 0));
      g.add(part(torus(0.035, 0.012, 4, 8), gold, 0, 0.78, 0, Math.PI / 2));
      tip = 0.9;
      break;
    case 'staff': {
      g.add(part(cyl(0.025, 0.03, 1.0), wood, 0, 0.2, 0));
      const orb = gl || Number(new THREE.Color(metalC).getHex());
      g.add(part(torus(0.08, 0.015, 4, 10), gold, 0, 0.74, 0));
      const o = part(ico(0.07, 1), glowMat(tier >= 3 ? metalC : '#b06ad6'), 0, 0.74, 0);
      g.add(o);
      const s = glowSprite(gl || (tier >= 3 ? orb : 0xb06ad6), 0.45, 0.7);
      s.position.set(0, 0.74, 0);
      g.add(s);
      tip = 0.74;
      break;
    }
    case 'wand': {
      g.add(part(cyl(0.018, 0.022, 0.34), wood, 0, 0.08, 0));
      g.add(part(ico(0.045, 0), glowMat('#ffe48a'), 0, 0.28, 0));
      const s = glowSprite(gl || 0xffe48a, 0.3, 0.7);
      s.position.set(0, 0.28, 0);
      g.add(s);
      tip = 0.28;
      break;
    }
    case 'bow': {
      const arc = part(torus(0.34, 0.022, 4, 12, Math.PI), wood, 0, 0.1, 0, 0, Math.PI / 2, -Math.PI / 2);
      g.add(arc);
      g.add(part(box(0.005, 0.68, 0.005), glowMat('#efe7cf'), 0, 0.1, -0.0, 0, 0, 0, false));
      for (const y of [0.44, -0.24]) g.add(part(box(0.04, 0.06, 0.04), blade, 0, y, 0.0));
      tip = 0.1;
      break;
    }
    default:
      break;
  }
  if (gl && type !== 'fist') {
    const s = glowSprite(gl, 0.35 + glow * 0.12, 0.5 + glow * 0.12);
    s.position.set(0, tip * 0.75, 0);
    s.name = 'weaponGlow';
    g.add(s);
  }
  return g;
}

export class Chibi {
  readonly root = new THREE.Group();
  /** Everything above the feet (raised on a mount). */
  readonly body = new THREE.Group();
  private torso = new THREE.Group();
  private head = new THREE.Group();
  private armL = new THREE.Group();
  private armR = new THREE.Group();
  private legL = new THREE.Group();
  private legR = new THREE.Group();
  private hand = new THREE.Group();
  private cape: THREE.Group | null = null;
  private wings: [THREE.Object3D, THREE.Object3D] | null = null;
  private aura: THREE.Sprite | null = null;
  private phase = 0;
  private flashUntil = 0;
  readonly key: string;
  private weaponType: Weapon3D = 'fist';

  constructor(readonly look: ChibiLook) {
    this.key = Chibi.keyOf(look);
    this.build();
  }

  static keyOf(l: ChibiLook): string {
    const a = l.appearance;
    return [a.bodyType, a.skinTone, a.hairStyle, a.hairColor, a.eyeColor, a.outfit, l.accessory ?? '', l.weapon ? `${l.weapon.type}${l.weapon.tier}g${l.weapon.glow}` : '', l.shield ?? '', l.helm ?? '', l.chest ?? '', l.wings ? `${l.wings.style}${l.wings.color}` : '', l.armorGlow ?? 0].join('|');
  }

  private build(): void {
    const { appearance: a } = this.look;
    const o = OUTFITS[a.outfit] ?? OUTFITS[0]!;
    const skin = mat(SKIN_TONES[a.skinTone] ?? SKIN_TONES[0]!);
    const hairC = HAIR_COLORS[a.hairColor] ?? HAIR_COLORS[0]!;
    const hair = mat(hairC);
    const shirt = mat(o.shirt);
    const shirtShade = mat(o.shirtShade);
    const pants = mat(o.pants);
    const shoes = mat(o.shoes);
    const accent = mat(o.accent);
    const slim = a.bodyType === 'b';
    const extras = new Set<string>([...(o.extras ?? []), ...(this.look.accessory ? [this.look.accessory] : [])]);
    const helmTier = this.look.helm ?? (extras.has('helmet') ? 2 : null);

    // Legs (pivot at the hip).
    for (const [leg, x] of [
      [this.legL, 0.085],
      [this.legR, -0.085],
    ] as const) {
      leg.position.set(x, 0.3, 0);
      leg.add(part(box(0.12, 0.24, 0.13), pants, 0, -0.12, 0));
      leg.add(part(box(0.13, 0.08, 0.19), shoes, 0, -0.26, 0.025));
      this.body.add(leg);
    }

    this.torso.position.y = 0.3;
    this.body.add(this.torso);
    const sw = slim ? 0.32 : 0.36;
    this.torso.add(part(box(sw, 0.34, 0.23), shirt, 0, 0.17, 0));
    this.torso.add(part(box(sw + 0.01, 0.05, 0.24), accent, 0, 0.04, 0));
    if (o.robe) this.torso.add(part(cyl(0.17, 0.25, 0.34, 8), shirtShade, 0, -0.1, 0));
    if (extras.has('apron')) this.torso.add(part(box(0.26, 0.38, 0.02), mat('#efe7cf'), 0, 0.02, 0.125));
    if (this.look.chest != null) {
      const plate = this.look.chest === 0 ? mat('#8a5a34') : mat(tierMetal(this.look.chest), { metal: 0.55, rough: 0.4 });
      this.torso.add(part(box(sw + 0.04, 0.24, 0.27), plate, 0, 0.21, 0));
      for (const x of [sw / 2 + 0.02, -sw / 2 - 0.02]) this.torso.add(part(sphere(0.085, 6, 4), plate, x, 0.31, 0));
    }

    // Arms (pivot at the shoulder).
    for (const [arm, x] of [
      [this.armL, sw / 2 + 0.05],
      [this.armR, -sw / 2 - 0.05],
    ] as const) {
      arm.position.set(x, 0.3, 0);
      arm.add(part(box(0.1, 0.24, 0.1), shirt, 0, -0.11, 0));
      arm.add(part(sphere(0.06, 6, 4), skin, 0, -0.26, 0.01));
      this.torso.add(arm);
    }
    this.hand.position.set(0, -0.26, 0.02);
    this.armR.add(this.hand);
    const w = this.look.weapon;
    if (w && w.type !== 'fist') {
      this.weaponType = w.type;
      const wm = weaponModel(w.type, w.tier, w.glow);
      this.hand.add(wm);
    }
    if (this.look.shield != null) {
      const sm = this.look.shield === 0 ? mat('#8a5a34') : mat(tierMetal(this.look.shield), { metal: 0.55, rough: 0.4 });
      const sh = new THREE.Group();
      sh.add(part(cyl(0.17, 0.17, 0.04, 8), sm, 0, 0, 0, Math.PI / 2, 0, 0));
      sh.add(part(cyl(0.05, 0.05, 0.05, 6), mat('#e8c24a', { metal: 0.6 }), 0, 0, 0.03, Math.PI / 2));
      sh.position.set(0.07, -0.16, 0.05);
      sh.rotation.y = Math.PI / 2;
      this.armL.add(sh);
    }

    // Head.
    this.head.position.y = 0.6;
    this.torso.add(this.head);
    const headM = part(sphere(0.29, 12, 9), skin, 0, 0, 0);
    headM.scale.set(1.05, 0.95, 0.95);
    this.head.add(headM);
    const eye = mat(EYE_COLORS[a.eyeColor] ?? EYE_COLORS[0]!);
    for (const x of [0.1, -0.1]) {
      this.head.add(part(box(0.065, slim ? 0.1 : 0.09, 0.03), eye, x, -0.02, 0.265, 0, 0, 0, false));
      this.head.add(part(box(0.025, 0.03, 0.01), glowMat('#ffffff'), x + 0.015, 0.01, 0.282, 0, 0, 0, false));
    }
    this.head.add(part(box(0.06, 0.015, 0.01), mat(shade(SKIN_TONES[a.skinTone] ?? '#f1c6a5', -0.25)), 0, -0.12, 0.27, 0, 0, 0, false));
    if (slim) for (const x of [0.17, -0.17]) this.head.add(part(sphere(0.035, 5, 3), glowMat('#f2a0a0', 0.5), x, -0.09, 0.22, 0, 0, 0, false));

    const hidden = helmTier != null || extras.has('hood');
    const hairG = new THREE.Group();
    this.head.add(hairG);
    const style = a.hairStyle;
    if (!hidden) {
      const top = part(cap(style === 5 ? 0.3 : 0.315, Math.PI * (style === 4 ? 0.62 : 0.52)), hair, 0, 0.02, -0.02, -0.28);
      hairG.add(top);
      if (style !== 5) hairG.add(part(box(0.44, 0.09, 0.08), hair, 0, 0.17, 0.22, -0.35));
      if (style === 1)
        for (let i = 0; i < 6; i++) {
          const ang = (i / 6) * Math.PI * 2;
          hairG.add(part(cone(0.07, 0.18, 4), hair, Math.cos(ang) * 0.16, 0.27, Math.sin(ang) * 0.14 - 0.04, Math.sin(ang) * 0.7, 0, -Math.cos(ang) * 0.7));
        }
    }
    if (style === 2) hairG.add(part(box(0.5, 0.5, 0.12), hair, 0, -0.14, -0.2, 0.1));
    if (style === 3) {
      hairG.add(part(sphere(0.1, 6, 4), hair, 0, 0.1, -0.3));
      hairG.add(part(cyl(0.06, 0.03, 0.35, 5), hair, 0, -0.1, -0.36, -0.3));
    }
    if (style === 4) hairG.add(part(box(0.58, 0.3, 0.42), hair, 0, -0.08, -0.06));
    if (style === 6)
      for (const x of [0.25, -0.25]) {
        hairG.add(part(cyl(0.045, 0.035, 0.42, 5), hair, x, -0.24, -0.05));
        hairG.add(part(sphere(0.045, 5, 3), accent, x, -0.46, -0.05));
      }

    if (helmTier != null) {
      const hm = helmTier === 0 ? mat('#8a5a34') : mat(tierMetal(helmTier), { metal: 0.55, rough: 0.4 });
      this.head.add(part(cap(0.33, Math.PI * 0.55), hm, 0, 0.0, 0, -0.1));
      this.head.add(part(torus(0.315, 0.025, 4, 14), hm, 0, -0.02, -0.02, Math.PI / 2 - 0.1));
      this.head.add(part(box(0.04, 0.16, 0.04), hm, 0, 0.03, 0.31));
      if (helmTier >= 4) this.head.add(part(cone(0.05, 0.22, 4), mat('#c0392b'), 0, 0.36, -0.05));
    }
    if (extras.has('hood')) this.head.add(part(cap(0.35, Math.PI * 0.68, 10, 6), mat(o.shirtShade), 0, 0.02, -0.04, -0.45));
    if (extras.has('crown')) {
      const gold = mat('#f2c14e', { metal: 0.7, rough: 0.3, emissive: '#5a4010', ei: 0.4 });
      this.head.add(part(cyl(0.17, 0.19, 0.08, 10), gold, 0, 0.29, -0.02));
      for (let i = 0; i < 5; i++) {
        const ang = (i / 5) * Math.PI * 2;
        this.head.add(part(cone(0.035, 0.1, 4), gold, Math.cos(ang) * 0.17, 0.37, Math.sin(ang) * 0.17 - 0.02));
      }
      this.head.add(part(ico(0.03, 0), glowMat('#e0483a'), 0, 0.3, 0.17));
    }
    if (extras.has('hat')) {
      this.head.add(part(cyl(0.42, 0.42, 0.03, 12), accent, 0, 0.2, 0));
      this.head.add(part(cyl(0.2, 0.24, 0.22, 10), accent, 0, 0.32, 0));
      this.head.add(part(cyl(0.245, 0.245, 0.05, 10), mat(o.shirt), 0, 0.24, 0));
    }
    if (extras.has('bandana')) {
      this.head.add(part(torus(0.3, 0.03, 4, 14), accent, 0, 0.1, 0, Math.PI / 2 - 0.15));
      this.head.add(part(box(0.06, 0.16, 0.03), accent, 0.05, 0.0, -0.3, 0.3, 0, 0.3));
    }
    if (extras.has('cape')) {
      this.cape = new THREE.Group();
      this.cape.position.set(0, 0.34, -0.13);
      this.cape.add(part(box(0.38, 0.6, 0.025), mat(o.robe ? o.accent : o.shirtShade, { side: THREE.DoubleSide }), 0, -0.3, 0));
      this.torso.add(this.cape);
    }

    // Wings.
    const wd = this.look.wings;
    if (wd) {
      const geo = wingGeo(wd.style);
      const wmat = wd.style === 'fairy' ? mat(wd.color, { opacity: 0.7, emissive: wd.color, ei: 0.35, side: THREE.DoubleSide }) : mat(wd.color, { side: THREE.DoubleSide, emissive: wd.style === 'angel' ? '#3a3020' : '#000000' });
      const scale = wd.style === 'fairy' ? 0.9 : 1.05;
      const mk = (sx: number) => {
        const pivot = new THREE.Group();
        pivot.position.set(sx * 0.05, 0.27, -0.13);
        const m = part(geo, wmat, 0, 0, 0, 0, 0, 0.35);
        m.scale.set(sx * scale, scale, scale);
        pivot.add(m);
        this.torso.add(pivot);
        return pivot;
      };
      this.wings = [mk(1), mk(-1)];
    }
    const ag = GLOW_TIER[Math.min(3, Math.floor((this.look.armorGlow ?? 0) >= 10 ? 3 : (this.look.armorGlow ?? 0) >= 7 ? 2 : (this.look.armorGlow ?? 0) >= 4 ? 1 : 0))] ?? 0;
    if (ag) {
      this.aura = glowSprite(ag, 1.3, 0.35);
      this.aura.position.y = 0.55;
      this.root.add(this.aura);
    }
    this.root.add(this.body);
    this.root.traverse((c) => {
      if ((c as THREE.Mesh).isMesh) c.userData.chibi = true;
    });
  }

  /** Brief white flash when hit. */
  flash(now: number, ms = 90): void {
    this.flashUntil = now + ms;
  }

  update(now: number, dt: number, s: ChibiState): void {
    const t = now / 1000;
    if (s.moving) this.phase += dt * (5 + s.speed * 1.4);
    const swing = s.moving && !s.mounted ? Math.sin(this.phase) : 0;
    const bob = s.moving && !s.mounted ? Math.abs(Math.sin(this.phase)) * 0.045 : Math.sin(t * 2.2) * 0.008;
    this.body.position.y = bob;
    this.legL.rotation.set(swing * 0.75, 0, 0);
    this.legR.rotation.set(-swing * 0.75, 0, 0);
    this.armL.rotation.set(-swing * 0.6, 0, 0.08);
    this.armR.rotation.set(swing * 0.6, 0, -0.08);
    this.torso.rotation.set(0, 0, 0);
    this.torso.position.y = 0.3;
    this.head.rotation.set(0, 0, Math.sin(t * 1.3) * 0.03);
    // Holding pose for the weapon.
    const holding = this.weaponType !== 'fist';
    this.hand.rotation.set(this.weaponType === 'bow' ? 0 : 1.3, 0, 0);
    if (holding && !s.moving) this.armR.rotation.x = -0.25;
    if (this.weaponType === 'staff' && !s.moving) this.armR.rotation.x = -0.1;
    if (s.mounted || s.sit) {
      this.legL.rotation.set(-1.45, 0, s.mounted ? 0.45 : 0.05);
      this.legR.rotation.set(-1.45, 0, s.mounted ? -0.45 : -0.05);
    }
    if (s.sit) {
      this.body.position.y = -0.2;
    }
    if (s.act >= 0) {
      const k = s.act;
      const magic = this.weaponType === 'staff' || this.weaponType === 'wand';
      if (magic) {
        this.armR.rotation.x = -2.6 + Math.sin(k * Math.PI) * 0.5;
        this.armL.rotation.x = -1.2 * Math.sin(k * Math.PI);
      } else if (this.weaponType === 'bow') {
        this.armR.rotation.x = -1.45;
        this.hand.rotation.x = 1.45;
        this.armL.rotation.x = -1.45 + Math.sin(k * Math.PI) * 0.3;
        this.armL.rotation.z = -0.3;
      } else {
        // Wind up, then a fast downward slash.
        const e = k < 0.3 ? k / 0.3 : 1 - (k - 0.3) / 0.7;
        this.armR.rotation.x = k < 0.3 ? -2.6 * e : -2.6 + 1.9 * Math.min(1, (k - 0.3) / 0.25);
        this.torso.rotation.y = (k < 0.3 ? -0.35 * e : 0.35 * Math.sin(Math.min(1, (k - 0.3) / 0.7) * Math.PI)) * 1;
      }
    }
    if (s.hurt > 0) {
      this.torso.rotation.x = -0.35 * s.hurt;
      this.head.rotation.x = -0.25 * s.hurt;
    }
    // Cape sways with movement, wings beat.
    if (this.cape) this.cape.rotation.x = 0.12 + (s.moving ? 0.35 + Math.sin(this.phase * 2) * 0.08 : Math.sin(t * 1.5) * 0.04);
    if (this.wings) {
      const f = Math.sin(t * (s.moving ? 11 : 3.2)) * (s.moving ? 0.45 : 0.18);
      this.wings[0].rotation.set(0, -0.55 - f, 0);
      this.wings[1].rotation.set(0, 0.55 + f, 0);
    }
    if (this.aura) (this.aura.material as THREE.SpriteMaterial).opacity = 0.25 + Math.sin(t * 2.5) * 0.08;
    // Defeated: fall on your back.
    this.root.rotation.x = s.dead ? -Math.PI / 2 : 0;
    this.root.position.y = s.dead ? 0.15 : 0;
    const flashing = now < this.flashUntil;
    if (flashing !== !!this.root.userData.flashing) {
      this.root.userData.flashing = flashing;
      this.root.traverse((c) => {
        const m = c as THREE.Mesh;
        if (!m.isMesh || !m.userData.chibi) return;
        if (flashing) {
          m.userData.orig = m.material;
          m.material = FLASH;
        } else if (m.userData.orig) m.material = m.userData.orig;
      });
    }
  }

  dispose(): void {
    this.root.removeFromParent();
    this.root.traverse((c) => {
      const sp = c as THREE.Sprite;
      if (sp.isSprite) (sp.material as THREE.Material).dispose();
    });
  }
}

export const FLASH = new THREE.MeshBasicMaterial({ color: 0xffffff });
