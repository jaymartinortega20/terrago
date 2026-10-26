/**
 * The 3D view (TerraGo 3.0 beta). It draws the same world the 2D scene
 * simulates: the WorldScene keeps running movement, prediction, interaction
 * hints and sound, and this class only renders GameClient's state with
 * three.js — a lush floating island, animated heroes wearing their real
 * gear, monsters, buildings, trees — with bloom, soft shadows and flashy
 * effects, plus names, bubbles and damage numbers as a light DOM layer.
 * Clicks are picked here and turned into the same actions as in 2D.
 */
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { QUESTS, getCrop, getItem, getJob, getMap, getMonster, getNode, getQuest } from '@terrago/game-data';
import { CHAT, FISHABLE_TILES, PROP_TYPES, STATION_PROPS, TILE_SIZE, cropStatus, darknessAt, getMountStyle, questReady, questsAvailable, type CombatEvent, type Direction, type MapDef, type PropType, type WorldObject } from '@terrago/shared';
import type { GameClient } from '../net/client';
import { fxSettings } from '../fx/settings';
import { ANIMAL_SPEC, CreatureActor, HeroActor, PET_SPEC, classBase, heroKey, monsterSpec, mountGait, mountModel, npcBase, type Actor, type Animator, type HeroLook, type OneShot, type Weapon3D } from './actors';
import { boundsOf, instance, ownMaterials, tintModel, glowModel } from './assets';
import { bolt, burst, lootBeam, magicCircle, pillar, ringWave, slash, sparkle, type Fx } from './fx3d';
import { Baker, VCOLOR, VCOLOR_GLOW, cone, glowMat, glowSprite, hash01, part, torus } from './kit';
import { hovergear, mountShade, quadruped } from './mountShowcase';
import { FLAT_PROPS, PROP_VARIANTS, cropGeometry, propGeometry } from './props3d';
import { buildProps, buildingModel, groundCover, propHasModel } from './scenery';
import { buildTerrain, isUnderground, type Terrain } from './terrain';

const T = TILE_SIZE;
const DIR_YAW: Record<Direction, number> = { down: 0, up: Math.PI, right: Math.PI / 2, left: -Math.PI / 2 };
const EMOJI: Record<string, string> = { wave: '👋', laugh: '😄', heart: '❤️', cheer: '🎉', angry: '💢', cry: '😢', dance: '💃', bow: '🙇', zzz: '💤' };

// ---------------------------------------------------------------------------
// Camera yaw (45° steps) is shared with the input code so WASD stays
// "up = away from the camera" when you rotate the view.
// ---------------------------------------------------------------------------

let yawStep = 0;
let active3d = false;
export const view3d = {
  get active() {
    return active3d;
  },
  /** Rotate screen-relative movement into map directions. */
  rotate(dx: number, dy: number): { dx: -1 | 0 | 1; dy: -1 | 0 | 1 } {
    if (!active3d || yawStep % 8 === 0 || (dx === 0 && dy === 0)) return { dx: dx as -1 | 0 | 1, dy: dy as -1 | 0 | 1 };
    const yaw = (yawStep * Math.PI) / 4;
    const fx = -Math.sin(yaw);
    const fz = -Math.cos(yaw);
    const rx = Math.cos(yaw);
    const rz = -Math.sin(yaw);
    const wx = dx * rx + -dy * fx;
    const wz = dx * rz + -dy * fz;
    const sg = (v: number) => (v > 0.38 ? 1 : v < -0.38 ? -1 : 0) as -1 | 0 | 1;
    return { dx: sg(wx), dy: sg(wz) };
  },
};

interface Ent {
  actor: Actor;
  key: string;
  root: THREE.Group;
  height: number;
  yaw: number;
  lastX: number;
  lastY: number;
  movingUntil: number;
  speed: number;
  deadUntil: number;
  mount?: { key: string; holder: THREE.Group; seat: number; anim: Animator | null; trail: string | null } | null;
  pet?: { key: string; a: Actor; x: number; z: number; strike?: { x: number; z: number; at: number } } | null;
  label?: HTMLDivElement;
  labelKey?: string;
  bar?: HTMLDivElement;
  bubble?: { el: HTMLDivElement; until: number } | null;
  emote?: { el: HTMLDivElement; until: number } | null;
  seen: number;
}

export class World3D {
  readonly renderer: THREE.WebGLRenderer;
  private composer: EffectComposer | null = null;
  private bloom: UnrealBloomPass | null = null;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(36, 1, 0.1, 500);
  private sun = new THREE.DirectionalLight('#fff1d6', 2.6);
  private hemi = new THREE.HemisphereLight('#cfe8ff', '#6a5a3a', 1.1);
  private world = new THREE.Group();
  private terrain: Terrain | null = null;
  private mapKey = '';
  private mapGen = 0;
  private ents = new Map<string, Ent>();
  private npcs = new Map<string, Ent>();
  private dyn = new Map<string, { key: string; obj: THREE.Object3D }>();
  private animals: { a: Actor; x: number; z: number; tx: number; tz: number; wait: number }[] = [];
  private fx: Fx[] = [];
  private raf = 0;
  private last = performance.now();
  private labels: HTMLDivElement;
  private ro: ResizeObserver;
  private unsubs: (() => void)[] = [];
  private yaw = 0;
  dist = 10.5;
  pitch = 0.72;
  /** Debug: force a time of day (0 = noon, 0.58 = night). */
  darkOverride: number | null = null;
  private focus = new THREE.Vector3();
  private shake = 0;
  private drag: { x: number; step: number } | null = null;
  private lastObjSync = 0;
  private lastQuest = 0;
  private markers = new Map<string, string>();
  private guide: { x: number; y: number } | null = null;
  private guideObj: THREE.Group;
  private targetRing: THREE.Mesh;
  private cursor: THREE.Mesh;
  private lowEnd: boolean;
  private clouds: THREE.Group | null = null;
  private signs: { x: number; z: number; y: number; near: boolean; el: HTMLDivElement }[] = [];
  private prompt: HTMLDivElement;
  private lamps: THREE.PointLight[] = [];
  private sunDir = new THREE.Vector3(0.5, 0.8, 0.3);
  /** Frame-rate watch: step quality down on slow devices. */
  private perf = { start: 0, frames: 0, level: 0 };
  private underground = false;

  constructor(
    private readonly host: HTMLElement,
    private readonly client: GameClient,
  ) {
    const q = fxSettings().graphics;
    this.lowEnd = q === 'lite' || q === 'classic' || window.matchMedia('(pointer: coarse)').matches;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(this.lowEnd ? 1.25 : 2, window.devicePixelRatio || 1));
    this.renderer.shadowMap.enabled = !this.lowEnd || q === 'lite';
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.12;
    const el = this.renderer.domElement;
    el.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;touch-action:none;';
    el.dataset.testid = 'game-3d';
    host.appendChild(el);
    this.labels = document.createElement('div');
    this.labels.style.cssText = 'position:absolute;inset:0;pointer-events:none;overflow:hidden;font-family:"Pixelify Sans",system-ui,sans-serif;';
    host.appendChild(this.labels);
    this.prompt = this.mkLabel('l3d-prompt');
    this.prompt.style.display = 'none';

    // Soft image-based light so models look rounded, not flat.
    const pm = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pm.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environmentIntensity = 0.3;
    pm.dispose();

    this.scene.add(this.world, this.hemi, this.sun, this.sun.target);
    this.sun.castShadow = this.renderer.shadowMap.enabled;
    this.sun.shadow.mapSize.set(this.lowEnd ? 1024 : 2048, this.lowEnd ? 1024 : 2048);
    const sc = this.sun.shadow.camera;
    sc.left = -18;
    sc.right = 18;
    sc.top = 18;
    sc.bottom = -18;
    sc.near = 1;
    sc.far = 90;
    this.sun.shadow.bias = -0.0005;
    this.sun.shadow.normalBias = 0.04;
    this.sun.shadow.radius = 4;

    if (!this.lowEnd) {
      this.composer = new EffectComposer(this.renderer);
      this.composer.addPass(new RenderPass(this.scene, this.camera));
      this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.4, 0.5, 1.0);
      this.composer.addPass(this.bloom);
      this.composer.addPass(new OutputPass());
    }

    // Target ring, action cursor and quest guide.
    this.targetRing = new THREE.Mesh(new THREE.RingGeometry(0.42, 0.52, 48), new THREE.MeshBasicMaterial({ color: '#ff4a3a', transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthWrite: false }));
    this.targetRing.rotation.x = -Math.PI / 2;
    this.targetRing.visible = false;
    this.scene.add(this.targetRing);
    this.cursor = new THREE.Mesh(new THREE.RingGeometry(0.36, 0.48, 4, 1, Math.PI / 4), new THREE.MeshBasicMaterial({ color: '#ffe48a', transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthWrite: false }));
    this.cursor.rotation.x = -Math.PI / 2;
    this.cursor.visible = false;
    this.scene.add(this.cursor);
    this.guideObj = new THREE.Group();
    this.guideObj.add(part(cone(0.22, 0.45, 4), glowMat('#ffe48a'), 0, 0, 0, Math.PI, 0, 0, false));
    this.guideObj.add(glowSprite(0xffe48a, 1.0, 0.5));
    this.guideObj.visible = false;
    this.scene.add(this.guideObj);

    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(host);
    this.resize();
    this.bindInput();

    const c = client;
    this.unsubs.push(
      c.on('combat', (ev) => this.onCombat(ev)),
      c.on('chat', (m) => {
        if (m.channel !== 'local' || !m.fromId) return;
        const e = this.ents.get(m.fromId);
        if (!e) return;
        e.bubble?.el.remove();
        const el2 = this.mkLabel('l3d-bubble');
        el2.textContent = m.text;
        e.bubble = { el: el2, until: performance.now() + CHAT.bubbleMs };
      }),
      c.on('emote', (e) => {
        const ent = this.ents.get(e.id);
        if (!ent) return;
        if (e.emote === 'wave' || e.emote === 'cheer' || e.emote === 'dance' || e.emote === 'bow') ent.actor.play(e.emote as OneShot, performance.now());
        const icon = EMOJI[e.emote];
        if (!icon) return;
        ent.emote?.el.remove();
        const el2 = this.mkLabel('l3d-emote');
        el2.textContent = icon;
        ent.emote = { el: el2, until: performance.now() + 2600 };
      }),
      c.on('swing', () => this.selfEnt()?.actor.play('attack', performance.now())),
      c.on('acted', ({ tx, ty }) => {
        const me = this.selfEnt();
        if (me) {
          me.actor.play(this.workKind(tx, ty), performance.now());
          me.yaw = Math.atan2(tx + 0.5 - me.root.position.x, ty + 0.5 - me.root.position.z);
        }
        this.puff(tx + 0.5, ty + 0.5, '#f0e6c8');
      }),
      c.on('work', (w) => {
        const e = this.ents.get(w.id);
        if (e) e.actor.play(this.workKind(w.tx, w.ty, w.tool), performance.now());
        this.puff(w.tx + 0.5, w.ty + 0.5, '#f0e6c8');
      }),
      c.on('telegraph', (t) => this.telegraph(t)),
      c.on('animals', (list) => this.setAnimals(list)),
      c.on('monsterRemove', (id) => this.dropEnt(id)),
      c.on('remove', (id) => this.dropEnt(id)),
    );
    active3d = true;
    this.loop();
  }

  // -------------------------------------------------------------------------
  // Setup
  // -------------------------------------------------------------------------

  private mkLabel(cls: string): HTMLDivElement {
    const d = document.createElement('div');
    d.className = `l3d ${cls}`;
    this.labels.appendChild(d);
    return d;
  }

  resize(): void {
    const w = Math.max(1, this.host.clientWidth);
    const h = Math.max(1, this.host.clientHeight);
    this.renderer.setSize(w, h, false);
    this.composer?.setSize(w, h);
    this.bloom?.resolution.set(w / 2, h / 2);
    this.camera.aspect = w / h;
    // Phones in portrait see less sideways: pull back.
    if (w < h) this.dist = Math.max(this.dist, 16);
    this.camera.updateProjectionMatrix();
  }

  rotateView(step: number): void {
    yawStep = (yawStep + step + 8) % 8;
  }

  zoom(k: number): void {
    this.dist = Math.max(5, Math.min(24, this.dist * k));
  }

  private bindInput(): void {
    const el = this.renderer.domElement;
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    el.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        this.zoom(e.deltaY > 0 ? 1.1 : 1 / 1.1);
      },
      { passive: false },
    );
    el.addEventListener('pointerdown', (e) => {
      if (e.button === 2 || e.button === 1) {
        this.drag = { x: e.clientX, step: yawStep };
        el.setPointerCapture(e.pointerId);
        return;
      }
      if (e.button === 0) this.click(e.clientX, e.clientY);
    });
    el.addEventListener('pointermove', (e) => {
      if (!this.drag) return;
      const d = e.clientX - this.drag.x;
      yawStep = (((this.drag.step - Math.round(d / 90)) % 8) + 8) % 8;
    });
    const end = () => (this.drag = null);
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      if (e.key === '[') this.rotateView(-1);
      else if (e.key === ']') this.rotateView(1);
      else if (e.key === '-') this.zoom(1.12);
      else if (e.key === '=' || e.key === '+') this.zoom(1 / 1.12);
    };
    window.addEventListener('keydown', onKey);
    this.unsubs.push(() => window.removeEventListener('keydown', onKey));
  }

  private selfId(): string | null {
    return this.client.ui.get().self?.characterId ?? null;
  }

  private selfEnt(): Ent | undefined {
    const id = this.selfId();
    return id ? this.ents.get(id) : undefined;
  }

  private h(x: number, z: number): number {
    return this.terrain?.heightAt(x, z) ?? 0;
  }

  // -------------------------------------------------------------------------
  // Map
  // -------------------------------------------------------------------------

  private buildMap(map: MapDef): void {
    const gen = ++this.mapGen;
    this.terrain?.dispose();
    for (const o of [...this.world.children]) this.world.remove(o);
    for (const e of [...this.ents.keys()]) this.dropEnt(e);
    for (const e of this.npcs.values()) this.disposeEnt(e);
    this.npcs.clear();
    for (const d of this.dyn.values()) d.obj.removeFromParent();
    this.dyn.clear();
    for (const s of this.signs) s.el.remove();
    this.signs = [];
    for (const a of this.animals) a.a.dispose();
    this.animals = [];
    this.lamps = [];

    this.underground = isUnderground(map);
    this.terrain = buildTerrain(map);
    this.world.add(this.terrain.group);
    const later = (p: Promise<THREE.Object3D>) =>
      void p
        .then((o) => {
          if (gen === this.mapGen) this.world.add(o);
        })
        .catch((e) => console.warn('[3d] scenery', e));

    // Buildings (models), props (models where we have them, hand-built otherwise).
    const modelled: { type: PropType; x: number; z: number; y: number; w: number; h: number }[] = [];
    const groups = new Map<string, { type: PropType; v: number; at: { x: number; z: number; y: number }[] }>();
    for (const o of map.objects) {
      if (o.kind === 'building') {
        later(buildingModel(o, this.h(o.x + o.w / 2, o.y + o.h - 0.5)).then((b) => b.obj));
        const sign = this.mkLabel('l3d-building');
        sign.textContent = o.name;
        this.signs.push({ x: o.x + o.w / 2, z: o.y + o.h, y: 2.6, near: false, el: sign });
        continue;
      }
      const size = PROP_TYPES[o.type] ?? { w: 1, h: 1 };
      const cx = o.x + size.w / 2;
      const cz = o.y + size.h / 2;
      const y = this.h(cx, cz);
      if (propHasModel(o.type)) modelled.push({ type: o.type, x: cx, z: cz, y, w: size.w, h: size.h });
      else {
        const key = `${o.type}|0`;
        if (!groups.has(key)) groups.set(key, { type: o.type, v: 0, at: [] });
        groups.get(key)!.at.push({ x: cx, z: cz, y });
      }
      if (o.type === 'sign' && o.text) {
        const el = this.mkLabel('l3d-sign');
        el.textContent = o.text;
        el.style.display = 'none';
        this.signs.push({ x: cx, z: cz, y: 1.2, near: true, el });
      }
      if ((o.type === 'lamp' || o.type === 'torch' || o.type === 'campfire') && this.lamps.length < 8 && !this.lowEnd) {
        const l = new THREE.PointLight(o.type === 'lamp' ? '#ffcf7a' : '#ff9a4a', 0, 7, 1.6);
        l.position.set(cx, y + (o.type === 'lamp' ? 1.5 : 1.0), cz);
        this.world.add(l);
        this.lamps.push(l);
      }
    }
    later(buildProps(modelled, this.lowEnd));
    // Hand-built props (benches, stalls, stations, waystones...).
    const m4 = new THREE.Matrix4();
    for (const g of groups.values()) {
      const geo = propGeometry(g.type, g.v % PROP_VARIANTS);
      const mk = (bg: THREE.BufferGeometry | null, mat: THREE.Material, shadow: boolean) => {
        if (!bg) return;
        const im = new THREE.InstancedMesh(bg, mat, g.at.length);
        g.at.forEach((p, i) => im.setMatrixAt(i, m4.makeTranslation(p.x, p.y, p.z)));
        im.castShadow = shadow && !FLAT_PROPS.has(g.type);
        im.receiveShadow = true;
        im.computeBoundingSphere();
        this.world.add(im);
      };
      mk(geo.solid, VCOLOR, true);
      mk(geo.glow, VCOLOR_GLOW, false);
    }
    // Lush ground cover.
    later(groundCover(map, (x, z) => this.h(x, z), this.lowEnd ? 400 : 1800));

    // Portals: a shimmering ring and glow at each exit.
    for (const p of map.portals) {
      const w = Math.max(p.w, p.h);
      const s = glowSprite(0x9ad8ff, Math.max(1.5, w * 0.9), 0.4);
      s.position.set(p.x + p.w / 2, 0.8, p.y + p.h / 2);
      this.world.add(s);
      const ring = part(torus(0.5, 0.05, 6, 32), glowMat('#bfe6ff', 0.7), p.x + p.w / 2, this.h(p.x + p.w / 2, p.y + p.h / 2) + 0.06, p.y + p.h / 2, Math.PI / 2, 0, 0, false);
      ring.scale.set(Math.max(1, p.w * 0.9), Math.max(1, p.h * 0.9), 1);
      ring.name = 'portal';
      this.world.add(ring);
    }

    // NPCs: villagers built on hero bodies.
    for (const n of this.client.npcs) {
      const actor = new HeroActor({ base: npcBase(n.accessory, n.id), appearance: n.appearance });
      const root = new THREE.Group();
      root.add(actor.root, blobShadow(0.55));
      root.position.set(n.x + 0.5, this.h(n.x + 0.5, n.y + 0.6), n.y + 0.6);
      root.rotation.y = DIR_YAW[n.dir];
      this.world.add(root);
      const label = this.mkLabel('l3d-npc');
      label.innerHTML = `<b class="nm">${esc(n.name)}</b><span>${esc(n.title)}</span>`;
      this.npcs.set(n.id, { actor, key: '', root, height: 1.35, yaw: DIR_YAW[n.dir], lastX: 0, lastY: 0, movingUntil: 0, speed: 0, deadUntil: 0, label, seen: 0 });
    }

    // Sky, fog, clouds.
    const theme = map.theme ?? 'meadow';
    const SKY: Record<string, [string, string]> = {
      meadow: ['#5cb2f0', '#d6f0ff'],
      forest: ['#5aa8e0', '#d0f0e8'],
      lake: ['#62b8f0', '#e0f4ff'],
      snow: ['#8ab0e0', '#f0f6ff'],
      desert: ['#e8a860', '#fbe6b8'],
      volcano: ['#3a1414', '#c0502a'],
      swamp: ['#5a7a6a', '#b8c8a8'],
      ruins: ['#7a9ad0', '#f0e6d8'],
      peak: ['#4a72c0', '#e0e8f8'],
      cave: ['#0a0810', '#1e1830'],
    };
    const [top, bottom] = this.underground ? SKY.cave! : (SKY[theme] ?? SKY.meadow!);
    this.scene.background = skyTexture(top, bottom);
    this.scene.fog = new THREE.Fog(bottom, this.underground ? 14 : 34, this.underground ? 38 : 110);
    if (this.clouds) this.scene.remove(this.clouds);
    this.clouds = null;
    if (!this.underground) {
      const g = new THREE.Group();
      this.clouds = g;
      this.scene.add(g);
      void cloudsAround(map.width, map.height, theme === 'volcano' ? '#8a6a6a' : '#ffffff').then((c) => g.add(c));
    }
  }

  // -------------------------------------------------------------------------
  // Entities
  // -------------------------------------------------------------------------

  private heroLook(id: string): HeroLook | null {
    const ui = this.client.ui.get();
    const self = ui.self;
    const tierOf = (itemId: string | null | undefined) => {
      const d = itemId ? getItem(itemId) : undefined;
      return d ? Number(d.icon.split(':')[2]) || 0 : null;
    };
    const weaponOf = (itemId: string | null | undefined, glow: number): HeroLook['weapon'] => {
      const d = itemId ? getItem(itemId) : undefined;
      const t = d?.equip?.weapon;
      if (!d || !t || t === 'shield') return null;
      return { type: t as Weapon3D, tier: tierOf(itemId) ?? 0, glow: glow >= 10 ? 3 : glow >= 7 ? 2 : glow >= 4 ? 1 : 0 };
    };
    const wings = (back: string | null | undefined) => (back ? ((getItem(back)?.wings as HeroLook['wings']) ?? null) : null);
    const showWeapon = fxSettings().handWeapon;
    if (self && id === self.characterId) {
      const eq = ui.inventory?.equipment ?? [];
      const at = (s: number) => eq.find((e) => e.slot === s);
      const armor = eq.filter((e) => e.slot >= 2 && e.slot <= 5).map((e) => e.enhance ?? 0);
      return {
        base: classBase(self.classId, self.job),
        appearance: self.appearance,
        weapon: showWeapon ? weaponOf(at(0)?.itemId, at(0)?.enhance ?? 0) : null,
        shield: at(1) ? tierOf(at(1)!.itemId) : null,
        helm: at(2) ? tierOf(at(2)!.itemId) : null,
        chest: at(3) ? tierOf(at(3)!.itemId) : null,
        wings: wings(at(8)?.itemId),
        armorGlow: armor.length ? Math.max(...armor) : 0,
      };
    }
    const r = this.client.remotes.get(id);
    if (!r) return null;
    const i = r.info;
    return {
      base: classBase(i.classId, i.job),
      appearance: i.appearance,
      weapon: showWeapon ? weaponOf(i.weapon, i.weaponGlow ?? 0) : null,
      shield: i.offhand ? tierOf(i.offhand) : null,
      helm: i.head ? tierOf(i.head) : null,
      chest: i.chest ? tierOf(i.chest) : null,
      wings: wings(i.back),
      armorGlow: i.armorGlow ?? 0,
    };
  }

  private newEnt(actor: Actor, key: string): Ent {
    const root = new THREE.Group();
    root.add(actor.root);
    root.add(blobShadow(Math.max(0.45, Math.min(2.2, actor.height * 0.42))));
    this.world.add(root);
    return { actor, key, root, height: actor.height, yaw: 0, lastX: NaN, lastY: NaN, movingUntil: 0, speed: 0, deadUntil: 0, seen: 0 };
  }

  private syncPlayer(
    id: string,
    x: number,
    y: number,
    dir: Direction,
    moving: boolean,
    now: number,
    dt: number,
    frame: number,
    extra: { name: string; sit: boolean; mount: string | null | undefined; mountLook: import('@terrago/shared').MountLook | null | undefined; pet: string | null | undefined; petStage: number; self: boolean; level: number; guild?: string | null; job?: string | null; shop?: string | null; hawk: boolean; hp: number },
  ): void {
    const look = this.heroLook(id);
    if (!look) return;
    const key = heroKey(look);
    let e = this.ents.get(id);
    if (e && e.key !== key) {
      // Gear changed: swap the model, keep the entity.
      e.actor.dispose();
      e.actor = new HeroActor(look);
      e.key = key;
      e.root.add(e.actor.root);
    }
    if (!e) {
      e = this.newEnt(new HeroActor(look), key);
      e.yaw = DIR_YAW[dir];
      this.ents.set(id, e);
    }
    e.seen = frame;
    const wx = x / T;
    const wz = y / T;
    if (!Number.isNaN(e.lastX)) {
      const dx = wx - e.lastX;
      const dz = wz - e.lastY;
      const d = Math.hypot(dx, dz);
      if (d > 0.002) {
        e.yaw = turn(e.yaw, Math.atan2(dx, dz), dt * 14);
        e.movingUntil = now + 120;
        e.speed = THREE.MathUtils.lerp(e.speed, d / Math.max(dt, 0.001), 0.2);
      } else if (!moving) e.yaw = turn(e.yaw, DIR_YAW[dir], dt * 10);
    }
    e.lastX = wx;
    e.lastY = wz;
    const gy = this.h(wx, wz);
    e.root.position.set(wx, gy, wz);
    e.root.rotation.y = e.yaw;
    const isMoving = moving || now < e.movingUntil;
    // Mount.
    const mk = extra.mount ? `${extra.mount}|${extra.mountLook?.saddle ?? ''}|${extra.mountLook?.barding ?? ''}|${extra.mountLook?.trail ?? ''}` : null;
    if ((e.mount?.key ?? null) !== mk) {
      e.mount?.holder.removeFromParent();
      e.mount = null;
      const def = extra.mount ? getItem(extra.mount)?.mount : undefined;
      if (def && mk) {
        const holder = new THREE.Group();
        const m: NonNullable<Ent['mount']> = { key: mk, holder, seat: 0.9, anim: null, trail: getMountStyle(extra.mountLook?.trail)?.color ?? null };
        e.mount = m;
        e.root.add(holder);
        if (def.kind === 'hovergear') {
          const g = new THREE.Group();
          const sm = { kind: def.kind, color: def.color, glow: def.glow ?? null };
          const seat = hovergear(g, sm, new THREE.MeshStandardMaterial({ color: def.color, roughness: 0.5, metalness: 0.4 }));
          g.rotation.y = -Math.PI / 2;
          g.scale.setScalar(0.62);
          holder.add(g);
          m.seat = seat * 0.62;
        } else {
          void mountModel(def.kind, def.color, def.glow).then((r) => {
            if (!r || e!.mount !== m) return;
            holder.add(r.root);
            m.seat = r.seat;
            m.anim = r.anim;
            const saddle = getMountStyle(extra.mountLook?.saddle)?.color;
            if (saddle) holder.add(part(new THREE.BoxGeometry(0.38, 0.08, 0.42), new THREE.MeshStandardMaterial({ color: saddle, roughness: 0.7 }), 0, r.seat - 0.02, -0.05));
          });
          // Placeholder until the model loads.
          void quadruped;
          void mountShade;
        }
      }
    }
    if (e.mount) {
      const gallop = isMoving ? Math.abs(Math.sin(now / 95)) * 0.05 : 0;
      e.actor.root.position.set(0, e.mount.seat - 0.32 + gallop, -0.08);
      if (e.mount.anim) {
        mountGait(e.mount.anim, isMoving, e.speed > 5);
        e.mount.anim.update(dt, now);
      }
      if (e.mount.trail && isMoving && Math.random() < 0.6) this.addFx(sparkle(new THREE.Vector3(wx, gy + 0.4, wz), e.mount.trail, 0.5));
    } else e.actor.root.position.set(0, 0, 0);
    e.actor.update(now, dt, { moving: isMoving && !extra.sit, speed: Math.max(2.5, e.speed), sit: extra.sit, mounted: !!e.mount, dead: extra.hp <= 0 || now < e.deadUntil });
    // Pet / hawk companion.
    const petDef = extra.pet ? getItem(extra.pet)?.pet : undefined;
    const pk = extra.hawk ? 'hawk' : petDef ? `${petDef.kind}|${petDef.color}|${extra.petStage}` : null;
    if ((e.pet?.key ?? null) !== pk) {
      e.pet?.a.dispose();
      e.pet = null;
      if (pk) {
        const spec = extra.hawk ? PET_SPEC.hawk! : (PET_SPEC[petDef!.kind] ?? PET_SPEC.dog!);
        const a = new CreatureActor(extra.hawk ? 'hawk' : petDef!.kind, spec, extra.hawk ? '#a8743f' : petDef!.color, 1 + 0.22 * (extra.petStage - 1), { elite: extra.petStage >= 3 });
        this.world.add(a.root);
        e.pet = { key: pk, a, x: wx - 0.8, z: wz };
      }
    }
    if (e.pet) {
      const p = e.pet;
      const hawk = p.key === 'hawk';
      let tx = hawk ? wx + Math.cos(now / 900) * 0.9 : wx - Math.sin(e.yaw) * 0.8 + Math.cos(e.yaw) * 0.6;
      let tz = hawk ? wz + Math.sin(now / 900) * 0.9 : wz - Math.cos(e.yaw) * 0.8 - Math.sin(e.yaw) * 0.6;
      if (p.strike) {
        const k = (now - p.strike.at) / 400;
        if (k >= 1) p.strike = undefined;
        else {
          const j = Math.sin(k * Math.PI);
          tx += (p.strike.x - tx) * j;
          tz += (p.strike.z - tz) * j;
        }
      }
      const dx = tx - p.x;
      const dz = tz - p.z;
      const mv = Math.hypot(dx, dz) > 0.06;
      const f = p.strike ? 0.4 : 0.1;
      p.x += dx * f;
      p.z += dz * f;
      p.a.root.position.set(p.x, this.h(p.x, p.z), p.z);
      if (mv) p.a.root.rotation.y = turn(p.a.root.rotation.y, Math.atan2(dx, dz), dt * 10);
      p.a.update(now, dt, { moving: mv, speed: 3 });
    }
    // Name label.
    const job = getJob(extra.job ?? null)?.name;
    const lk = `${extra.guild ?? ''}|${extra.name}|${extra.level}|${job ?? ''}|${extra.shop ?? ''}|${extra.self}`;
    if (!e.label) e.label = this.mkLabel(extra.self ? 'l3d-name l3d-self' : 'l3d-name');
    if (e.labelKey !== lk) {
      e.labelKey = lk;
      e.label.innerHTML = `${extra.shop ? `<i>🛒 ${esc(extra.shop)}</i>` : ''}<span class="lv">${extra.level}</span>${extra.guild ? `<em>[${esc(extra.guild)}]</em> ` : ''}${esc(extra.name)}${job ? ` <small>${esc(job)}</small>` : ''}`;
    }
    e.height = (e.mount ? e.mount.seat - 0.2 : 0) + e.actor.height;
  }

  private syncMonster(id: string, frame: number, now: number, dt: number): void {
    const m = this.client.monsters.get(id)!;
    let e = this.ents.get(id);
    if (!e) {
      const def = getMonster(m.info.monsterId);
      const a = def?.art ?? { shape: 'slime', color: '#7cc35a', size: 1 };
      const size = (a.size ?? 1) * (m.info.elite ? 1.15 : 1);
      const actor = new CreatureActor(m.info.monsterId, monsterSpec(m.info.monsterId, a.shape), a.color, Math.min(size, 3.2), { elite: m.info.elite, boss: m.info.boss });
      e = this.newEnt(actor, '');
      e.yaw = DIR_YAW[m.dir];
      this.ents.set(id, e);
      e.label = this.mkLabel(m.info.boss ? 'l3d-mon l3d-boss' : m.info.elite ? 'l3d-mon l3d-elite' : 'l3d-mon');
      e.label.innerHTML = `<div class="nm">${m.info.elite ? '★ ' : ''}${esc(m.info.name)} <small>Lv ${m.info.level}</small></div><div class="hp"><div></div></div>`;
      e.bar = e.label.querySelector('.hp > div') as HTMLDivElement;
    }
    e.seen = frame;
    const wx = m.x / T;
    const wz = m.y / T;
    if (!Number.isNaN(e.lastX)) {
      const dx = wx - e.lastX;
      const dz = wz - e.lastY;
      if (Math.hypot(dx, dz) > 0.002) {
        e.yaw = turn(e.yaw, Math.atan2(dx, dz), dt * 10);
        e.movingUntil = now + 150;
      }
    }
    e.lastX = wx;
    e.lastY = wz;
    e.root.position.set(wx, this.h(wx, wz), wz);
    e.root.rotation.y = e.yaw;
    e.actor.update(now, dt, { moving: m.moving || now < e.movingUntil, speed: 2.5, dead: m.hp <= 0 });
    e.height = e.actor.height;
    if (e.bar) {
      e.bar.style.width = `${Math.max(0, Math.min(100, m.hp))}%`;
      e.bar.className = m.hp > 50 ? 'ok' : m.hp > 25 ? 'mid' : 'low';
    }
  }

  private disposeEnt(e: Ent): void {
    e.actor.dispose();
    e.pet?.a.dispose();
    e.root.removeFromParent();
    e.label?.remove();
    e.bubble?.el.remove();
    e.emote?.el.remove();
  }

  private dropEnt(id: string): void {
    const e = this.ents.get(id);
    if (!e) return;
    this.disposeEnt(e);
    this.ents.delete(id);
  }

  /** Which work animation fits the tile that was used. */
  private workKind(tx: number, ty: number, tool?: string | null): OneShot {
    const o = this.client.objectAt(tx, ty);
    if (o?.kind === 'node') {
      const skill = getNode(o.type)?.skill;
      return skill === 'mining' ? 'mine' : skill === 'woodcutting' ? 'chop' : 'pickup';
    }
    if (o?.kind === 'plot') return 'dig';
    if (o?.kind === 'drop') return 'pickup';
    const map = this.client.map;
    if (map && FISHABLE_TILES.has(map.tiles[ty]?.[tx] ?? '')) return 'fish';
    if (tool && /pick/.test(tool)) return 'mine';
    if (tool && /axe/.test(tool)) return 'chop';
    if (map?.objects.some((p) => p.kind === 'prop' && (STATION_PROPS as readonly string[]).includes(p.type) && Math.abs(p.x - tx) <= 2 && Math.abs(p.y - ty) <= 2)) return 'craft';
    return 'interact';
  }

  // -------------------------------------------------------------------------
  // Objects (farm plots, nodes, loot)
  // -------------------------------------------------------------------------

  private syncObjects(): void {
    const now = this.client.serverNow();
    const want = new Set<string>();
    for (const o of this.client.objects.values()) {
      want.add(o.id);
      const key = objKey(o, now);
      const cur = this.dyn.get(o.id);
      if (cur?.key === key) continue;
      cur?.obj.removeFromParent();
      const obj = this.objMesh(o, now);
      obj.position.set(o.x + 0.5, this.h(o.x + 0.5, o.y + 0.5), o.y + 0.5);
      this.world.add(obj);
      this.dyn.set(o.id, { key, obj });
    }
    for (const [id, d] of this.dyn)
      if (!want.has(id)) {
        d.obj.removeFromParent();
        this.dyn.delete(id);
      }
  }

  private objMesh(o: WorldObject, now: number): THREE.Object3D {
    const g = new THREE.Group();
    const addModel = (file: string, height: number, tint?: string, glow?: string) =>
      void instance(file).then(({ root }) => {
        const b = boundsOf(root);
        root.scale.multiplyScalar(height / Math.max(0.01, b.max.y - b.min.y));
        root.position.y -= boundsOf(root).min.y;
        root.rotation.y = hash01(o.x * 3 + o.y) * 6.28;
        if (tint || glow) ownMaterials(root);
        if (tint) tintModel(root, tint, 0.85);
        if (glow) glowModel(root, glow, 0.6);
        g.add(root);
      });
    if (o.kind === 'node') {
      const def = getNode(o.type);
      const art = def?.art ?? { kind: 'rock', color: '#9a968e' };
      const used = o.depletedUntil > now;
      const r = hash01(o.x * 7 + o.y);
      if (art.kind === 'tree') addModel(used ? 'props/tree_single_A_cut.glb' : `nature/CommonTree_${1 + Math.floor(r * 5)}.glb`, used ? 0.45 : 2.3, art.color === '#2f7a46' || art.color === '#3f6f2c' ? undefined : art.color);
      else if (art.kind === 'bush') addModel(used ? 'nature/Bush_Common.glb' : 'nature/Bush_Large_Flowers.glb', 0.8);
      else if (art.kind === 'herb' || art.kind === 'grass') addModel(used ? 'nature/Clover_1.glb' : art.kind === 'herb' ? 'nature/Plant_1.glb' : 'nature/Grass_Wheat.glb', used ? 0.2 : 0.6);
      else if (art.kind === 'mushroom') addModel('nature/Mushroom_Common.glb', used ? 0.2 : 0.45, art.color, art.color === '#5fd4e6' ? art.color : undefined);
      else {
        // Ore: a boulder with glowing veins / crystals in the ore's colour.
        addModel(`nature/Rock_Medium_${1 + Math.floor(r * 3)}.glb`, 0.7, used ? '#6a6460' : undefined);
        if (!used) {
          const b = new Baker();
          const n = art.kind === 'crystal' ? 5 : 4;
          for (let i = 0; i < n; i++) b.glowAdd(cone(art.kind === 'crystal' ? 0.1 : 0.07, art.kind === 'crystal' ? 0.55 : 0.22, 5), art.color, Math.cos(i * 1.6) * 0.22, 0.45 + (i % 2) * 0.12, Math.sin(i * 1.6) * 0.2, Math.cos(i) * 0.5, 0, Math.sin(i) * 0.5);
          const bk = b.bake();
          if (bk.glow) g.add(new THREE.Mesh(bk.glow, VCOLOR_GLOW));
          const s = glowSprite(art.color, 1.0, 0.35);
          s.position.y = 0.55;
          g.add(s);
        }
      }
    } else if (o.kind === 'plot') {
      const b = new Baker();
      const wet = o.crop ? o.crop.waterUntil > now : o.wetUntil > now;
      if (o.locked) b.add(new THREE.BoxGeometry(0.9, 0.04, 0.9), '#5a4a3a', 0, 0.02, 0);
      else b.add(new THREE.BoxGeometry(0.94, 0.1, 0.94), o.tilled ? (wet ? '#4a3020' : '#7a5230') : '#6a8a4a', 0, 0.03, 0);
      if (o.tilled && !o.locked) for (let i = 0; i < 3; i++) b.add(new THREE.CylinderGeometry(0.05, 0.05, 0.8, 6), wet ? '#3a2418' : '#6a4428', 0, 0.09, -0.28 + i * 0.28, 0, 0, Math.PI / 2);
      const bk = b.bake();
      if (bk.solid) {
        const m = new THREE.Mesh(bk.solid, VCOLOR);
        m.receiveShadow = true;
        g.add(m);
      }
      if (o.crop) {
        const def = getCrop(o.crop.cropId);
        if (def) {
          const st = cropStatus(o.crop, def, now);
          const c = cropGeometry(st.stage, st.ready, def.art?.leaf ?? '#4a9a3c', def.art?.fruit ?? '#f08a2e', def.art?.shape ?? 'root');
          if (c.solid) {
            const m = new THREE.Mesh(c.solid, VCOLOR);
            m.castShadow = true;
            m.scale.setScalar(1.3);
            g.add(m);
          }
          if (st.ready) {
            const s = glowSprite(0xffe48a, 0.9, 0.4);
            s.position.y = 0.5;
            g.add(s);
          }
        }
      }
    } else if (o.kind === 'drop') {
      const q = ['#e8e0d0', '#5fd45a', '#5fb0ff', '#c07aff', '#ffb04a'][Math.max(0, Math.min(4, o.quality ?? 0))]!;
      addModel('mon/chest.glb', 0.5);
      g.add(lootBeam(q));
      const s = glowSprite(q, 1.4, 0.6);
      s.position.y = 0.35;
      g.add(s);
      g.userData.loot = true;
    }
    return g;
  }

  private setAnimals(list: { id: number; kind: string }[]): void {
    for (const a of this.animals) a.a.dispose();
    this.animals = [];
    const pen = this.client.map?.pen;
    if (!pen) return;
    for (const a of list) {
      const spec = ANIMAL_SPEC[a.kind] ?? ANIMAL_SPEC.chicken!;
      const actor = new CreatureActor(a.kind, spec, '#ffffff', 1);
      const x = pen.x + 0.5 + Math.random() * (pen.w - 1);
      const z = pen.y + 0.8 + Math.random() * (pen.h - 1);
      actor.root.position.set(x, this.h(x, z), z);
      this.world.add(actor.root);
      this.animals.push({ a: actor, x, z, tx: x, tz: z, wait: Math.random() * 3 });
    }
  }

  // -------------------------------------------------------------------------
  // Effects
  // -------------------------------------------------------------------------

  private addFx(f: Fx): void {
    this.scene.add(f.obj);
    this.fx.push(f);
  }

  private entPos(id: string): THREE.Vector3 | null {
    const e = this.ents.get(id);
    if (!e) return null;
    return new THREE.Vector3(e.root.position.x, e.root.position.y + e.height * 0.55, e.root.position.z);
  }

  private onCombat(events: CombatEvent[]): void {
    const me = this.selfId();
    const opts = fxSettings();
    const now = performance.now();
    for (const e of events) {
      const tgt = this.ents.get(e.t);
      const src = this.ents.get(e.s);
      const at = this.entPos(e.t);
      if (!at) continue;
      const color = skillColor(e.sk);
      if (e.sk === 'pet' || e.sk === 'hawk') {
        if (src?.pet) {
          src.pet.strike = { x: at.x, z: at.z, at: now };
          src.pet.a.play('attack', now);
        }
      } else if (src && e.k !== 'death' && e.k !== 'dot') {
        // My own basic swings already animated when I pressed attack.
        const predicted = e.s === me && !e.sk;
        if (e.k === 'cast') src.actor.play(/whirl|spin/.test(e.sk ?? '') ? 'spin' : 'cast', now);
        else if (!predicted) src.actor.play('attack', now);
        if (e.s !== e.t && src.root) src.yaw = Math.atan2(at.x - src.root.position.x, at.z - src.root.position.z);
      }
      if (tgt && (e.k === 'hit' || e.k === 'crit')) {
        tgt.actor.flash(now);
        tgt.actor.play('hit', now);
        if (e.s === me && e.k === 'crit' && opts.shake) this.shake = 0.22;
      }
      if (tgt && e.k === 'death') {
        tgt.deadUntil = now + 1800;
        if (opts.level !== 'off') this.addFx(burst(at, '#ffffff', 16, 1.2));
        continue;
      }
      if (opts.level !== 'off') {
        const from = this.entPos(e.s);
        if (e.k === 'cast') {
          const p = src?.root.position;
          if (p) this.addFx(magicCircle(new THREE.Vector3(p.x, p.y, p.z), color, 1.1, 800));
          if (/heal|bless|holy_light|sanct/.test(e.sk ?? '') && p) this.addFx(pillar(new THREE.Vector3(p.x, p.y, p.z), '#9affb0'));
          continue;
        }
        if (e.k === 'miss') continue;
        const ranged = from && from.distanceTo(at) > 1.7;
        if (ranged && from && e.s !== e.t) this.addFx(bolt(from, at, e.sk ? color : '#ffe9b0'));
        else if (src && e.s !== e.t && (e.k === 'hit' || e.k === 'crit') && opts.level === 'full') {
          const p = src.root.position;
          this.addFx(slash(new THREE.Vector3(p.x, p.y + 0.6, p.z), src.yaw, e.sk ? color : e.s === me ? weaponColor(opts.style) : '#ffffff', e.k === 'crit'));
        }
        if (e.k === 'heal') {
          this.addFx(pillar(new THREE.Vector3(at.x, at.y - 0.6, at.z), '#7fe07a', 2.4, 700));
          this.addFx(burst(at, '#7fe07a', 10, 0.8));
        } else if (e.k === 'crit') {
          this.addFx(burst(at, '#ffe48a', 18, 1.4));
          this.addFx(ringWave(new THREE.Vector3(at.x, at.y - 0.6, at.z), '#ffe48a', 2.2));
        } else if (e.k === 'hit') this.addFx(burst(at, e.sk ? color : '#ffffff', opts.level === 'full' ? 10 : 5, 0.9));
      }
      if (e.k === 'cast' || !opts.numbers) continue;
      const kind = e.k === 'miss' ? 'miss' : e.k === 'heal' ? 'heal' : e.k === 'dot' ? 'dot' : e.t === me ? 'taken' : e.s === me ? (e.k === 'crit' ? 'crit' : 'hit') : 'other';
      this.number(at, e.k === 'miss' ? 'MISS' : `${e.k === 'heal' ? '+' : ''}${e.a.toLocaleString()}`, kind);
    }
  }

  private number(at: THREE.Vector3, text: string, kind: string): void {
    const p = at.clone();
    p.y += 0.8;
    const s = this.toScreen(p);
    if (!s) return;
    const el = this.mkLabel(`l3d-num l3d-${kind}`);
    el.innerHTML = kind === 'crit' ? `<small>CRITICAL</small>${text}` : text;
    el.style.transform = `translate(${s.x + (Math.random() * 30 - 15)}px, ${s.y}px) translate(-50%, -100%)`;
    setTimeout(() => el.remove(), 1100);
  }

  private puff(x: number, z: number, color: string): void {
    if (fxSettings().level === 'off') return;
    this.addFx(burst(new THREE.Vector3(x, this.h(x, z) + 0.2, z), color, 8, 0.6));
  }

  private telegraph(t: { x: number; y: number; r: number; ms: number; name: string }): void {
    const x = t.x / T;
    const z = t.y / T;
    const r = t.r / T;
    const y = this.h(x, z) + 0.06;
    const g = new THREE.Group();
    const edge = new THREE.Mesh(new THREE.RingGeometry(r * 0.94, r, 64), new THREE.MeshBasicMaterial({ color: '#ff5a4a', transparent: true, opacity: 0.95, side: THREE.DoubleSide, depthWrite: false }));
    const fill = new THREE.Mesh(new THREE.CircleGeometry(r, 48), new THREE.MeshBasicMaterial({ color: '#ff3a2a', transparent: true, opacity: 0.32, depthWrite: false, side: THREE.DoubleSide }));
    edge.rotation.x = fill.rotation.x = -Math.PI / 2;
    g.add(edge, fill);
    g.position.set(x, y, z);
    this.scene.add(g);
    const born = performance.now();
    const label = this.mkLabel('l3d-tele');
    label.textContent = t.name;
    this.fx.push({
      obj: g,
      born,
      until: born + t.ms + 300,
      update: (k) => {
        const at = k * (t.ms + 300);
        if (at < t.ms) fill.scale.setScalar(Math.max(0.05, at / t.ms));
        else {
          (fill.material as THREE.MeshBasicMaterial).color.set('#ffd0a0');
          (fill.material as THREE.MeshBasicMaterial).opacity = 0.85 * (1 - (at - t.ms) / 300);
          if (!g.userData.boom) {
            g.userData.boom = true;
            this.shake = 0.35;
            label.remove();
            this.addFx(burst(new THREE.Vector3(x, y + 0.3, z), '#ff8a4a', 24, r * 0.8));
          }
        }
        const s = this.toScreen(new THREE.Vector3(x, y + 0.2, z - r));
        if (s && !g.userData.boom) label.style.transform = `translate(${s.x}px, ${s.y}px) translate(-50%, -100%)`;
        if (k >= 1) label.remove();
      },
    });
  }

  // -------------------------------------------------------------------------
  // Picking
  // -------------------------------------------------------------------------

  toScreen(p: THREE.Vector3): { x: number; y: number } | null {
    const v = p.clone().project(this.camera);
    if (v.z > 1) return null;
    return { x: (v.x * 0.5 + 0.5) * this.host.clientWidth, y: (-v.y * 0.5 + 0.5) * this.host.clientHeight };
  }

  private click(sx: number, sy: number): void {
    const c = this.client;
    if (c.ui.get().dialogue) return;
    const rect = this.renderer.domElement.getBoundingClientRect();
    const px = sx - rect.left;
    const py = sy - rect.top;
    const me = this.selfId();
    let best: { id: string; d: number; kind: 'monster' | 'player' | 'npc' } | null = null;
    const consider = (id: string, e: Ent, kind: 'monster' | 'player' | 'npc') => {
      const a = this.toScreen(e.root.position.clone().setY(e.root.position.y + e.height * 0.5));
      const top = this.toScreen(e.root.position.clone().setY(e.root.position.y + e.height));
      const foot = this.toScreen(e.root.position);
      if (!a || !top || !foot) return;
      const rad = Math.max(24, Math.abs(foot.y - top.y) * 0.6);
      const d = Math.hypot(px - a.x, py - a.y);
      if (d < rad && (!best || d < best.d)) best = { id, d, kind };
    };
    for (const [id, e] of this.ents) if (id !== me) consider(id, e, c.monsters.has(id) ? 'monster' : 'player');
    for (const [id, e] of this.npcs) consider(id, e, 'npc');
    const hit = best as { id: string; d: number; kind: 'monster' | 'player' | 'npc' } | null;
    if (hit) {
      if (hit.kind === 'monster') return c.engage(hit.id);
      if (hit.kind === 'player') {
        const duel = c.ui.get().duel;
        if (duel && duel.id === hit.id) return c.setTarget(hit.id, true);
        const r = c.remotes.get(hit.id);
        if (r) c.ui.set({ playerMenu: { id: hit.id, name: r.info.name } });
        return;
      }
      const n = c.npcs.find((x) => x.id === hit.id);
      if (!n) return;
      if (c.nearestNpc()?.id === n.id) c.interact();
      else if (c.map) c.autoWalkTo({ map: c.map.id, x: n.x, y: n.y + 1, label: n.name });
      return;
    }
    const ray = new THREE.Raycaster();
    ray.setFromCamera(new THREE.Vector2((px / rect.width) * 2 - 1, -(py / rect.height) * 2 + 1), this.camera);
    const ground = this.terrain?.group.getObjectByName('ground');
    const hits = ground ? ray.intersectObject(ground, false) : [];
    const p = hits[0]?.point ?? ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), new THREE.Vector3());
    if (!p) return;
    const tx = Math.floor(p.x);
    const ty = Math.floor(p.z);
    if (Math.hypot((tx + 0.5) * T - c.pos.x, (ty + 0.5) * T - (c.pos.y - 8)) > 1.7 * T) return;
    c.targetAt(tx, ty)?.run();
  }

  // -------------------------------------------------------------------------
  // Frame
  // -------------------------------------------------------------------------

  private frame = 0;

  private loop = (): void => {
    this.raf = requestAnimationFrame(this.loop);
    const now = performance.now();
    const dt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    try {
      this.tick(now, dt);
    } catch (err) {
      console.warn('[3d]', err);
    }
  };

  private tick(now: number, dt: number): void {
    const c = this.client;
    const map = c.map;
    const ui = c.ui.get();
    if (!map) return;
    const mk = `${map.id}|${ui.mapOwnerId ?? ''}|${c.npcs.length}`;
    if (mk !== this.mapKey) {
      this.mapKey = mk;
      this.buildMap(map);
    }
    const frame = ++this.frame;
    const self = ui.self;
    const rp = c.renderPos ?? c.pos;
    if (self)
      this.syncPlayer(self.characterId, rp.x, rp.y, c.dir, c.moving, now, dt, frame, {
        name: self.name,
        sit: c.pose === 'sit',
        mount: self.mount,
        mountLook: self.mountLook,
        pet: self.pet,
        petStage: ui.pet && ui.pet.id === self.pet ? ui.pet.stage : 1,
        self: true,
        level: self.level,
        guild: ui.guild?.tag ?? null,
        job: self.job ?? null,
        hawk: self.job === 'beastmaster',
        hp: self.hp,
      });
    for (const [id, r] of c.remotes)
      this.syncPlayer(id, r.x, r.y, r.dir, r.moving, now, dt, frame, {
        name: r.info.name,
        sit: r.info.pose === 'sit',
        mount: r.info.mount,
        mountLook: r.info.mountLook,
        pet: r.info.pet,
        petStage: r.info.petStage ?? 1,
        self: false,
        level: r.info.level,
        guild: r.info.guild,
        job: r.info.job,
        shop: r.info.shop,
        hawk: r.info.job === 'beastmaster',
        hp: r.hp,
      });
    for (const id of c.monsters.keys()) this.syncMonster(id, frame, now, dt);
    for (const [id, e] of this.ents) if (e.seen !== frame) this.dropEnt(id);
    for (const e of this.npcs.values()) e.actor.update(now, dt, { moving: false, speed: 0 });
    // Farm animals wander the pen.
    const pen = map.pen;
    for (const a of this.animals) {
      if (!pen) break;
      a.wait -= dt;
      if (a.wait <= 0 && Math.hypot(a.tx - a.x, a.tz - a.z) < 0.05) {
        a.tx = pen.x + 0.5 + Math.random() * (pen.w - 1);
        a.tz = pen.y + 0.8 + Math.random() * (pen.h - 1);
        a.wait = 2 + Math.random() * 4;
      }
      const dx = a.tx - a.x;
      const dz = a.tz - a.z;
      const d = Math.hypot(dx, dz);
      if (d > 0.05) {
        const s = Math.min(d, dt * 0.8);
        a.x += (dx / d) * s;
        a.z += (dz / d) * s;
        a.a.root.rotation.y = Math.atan2(dx, dz);
      }
      a.a.root.position.set(a.x, this.h(a.x, a.z), a.z);
      a.a.update(now, dt, { moving: d > 0.05, speed: 1 });
    }
    if (now - this.lastObjSync > 400) {
      this.lastObjSync = now;
      this.syncObjects();
    }
    for (const d of this.dyn.values())
      if (d.obj.userData.loot) {
        const beam = d.obj.getObjectByName('beam');
        if (beam) beam.rotation.y += dt;
      }
    for (const o of this.world.children) if (o.name === 'portal') o.rotation.z += dt * 0.6;
    this.clouds?.children.forEach((g) => g.children.forEach((cl, i) => (cl.position.x += dt * (0.12 + (i % 3) * 0.05)) > map.width + 40 && (cl.position.x = -40)));

    // Camera: follow with a smooth lag, rotate in 45° steps.
    const me = this.selfEnt();
    const target = me ? me.root.position : new THREE.Vector3(map.spawn.x, 0, map.spawn.y);
    this.focus.lerp(new THREE.Vector3(target.x, target.y + 0.7, target.z), 1 - Math.pow(0.0008, dt));
    this.yaw = turn(this.yaw, (yawStep * Math.PI) / 4, dt * 7);
    const dist = this.dist * (self?.mount ? 1.12 : 1);
    const cp = new THREE.Vector3(Math.sin(this.yaw) * Math.cos(this.pitch) * dist, Math.sin(this.pitch) * dist, Math.cos(this.yaw) * Math.cos(this.pitch) * dist).add(this.focus);
    if (this.shake > 0) {
      cp.x += (Math.random() - 0.5) * this.shake;
      cp.y += (Math.random() - 0.5) * this.shake;
      this.shake = Math.max(0, this.shake - dt * 1.3);
    }
    this.camera.position.copy(cp);
    this.camera.lookAt(this.focus);
    // Sun follows the player so shadows stay crisp nearby; day and night.
    const dark = this.darkOverride ?? (this.underground ? 0.35 : darknessAt(c.serverNow()));
    const day = 1 - dark / 0.58;
    this.sunDir.set(0.45, 0.85, 0.35).normalize();
    this.sun.position.copy(this.focus).addScaledVector(this.sunDir, 30);
    this.sun.target.position.copy(this.focus);
    this.sun.intensity = this.underground ? 0.6 : 0.6 + 1.5 * day;
    this.sun.color.set(day < 0.5 ? '#a8b8ff' : day < 0.85 ? '#ffd2a0' : '#fff1d6');
    this.hemi.intensity = this.underground ? 0.6 : 0.55 + 0.35 * day;
    this.hemi.color.set(day < 0.5 ? '#8a9ad8' : '#cfe8ff');
    this.renderer.toneMappingExposure = this.underground ? 1.15 : 0.9 + 0.15 * day;
    if (this.bloom) this.bloom.strength = 0.4 + (1 - day) * 0.3;
    for (const l of this.lamps) l.intensity = (1 - day) * 4 * (0.9 + Math.sin(now / 130 + l.position.x) * 0.08);

    // Target ring, action cursor, quest guide.
    const tid = ui.targetId;
    const te = tid ? this.ents.get(tid) : undefined;
    this.targetRing.visible = !!te;
    if (te) {
      this.targetRing.position.set(te.root.position.x, te.root.position.y + 0.05, te.root.position.z);
      this.targetRing.scale.setScalar(Math.max(1, te.height * 0.7) * (1 + Math.sin(now / 150) * 0.06));
      this.targetRing.rotation.z = now / 600;
    }
    const npc = c.nearestNpc();
    const at = !npc && !ui.dialogue ? c.actionTarget() : null;
    this.cursor.visible = !!at?.hint;
    if (at?.hint) {
      this.cursor.scale.set(Math.max(at.w, 1) * 1.2, Math.max(at.h, 1) * 1.2, 1);
      this.cursor.position.set(at.x + at.w / 2, this.h(at.x + 0.5, at.y + 0.5) + 0.07, at.y + at.h / 2);
      (this.cursor.material as THREE.MeshBasicMaterial).opacity = 0.65 + Math.sin(now / 160) * 0.25;
    }
    if (now - this.lastQuest > 400) {
      this.lastQuest = now;
      this.refreshQuests();
    }
    const g = this.guide;
    const near = g && me ? Math.hypot(g.x - me.root.position.x, g.y - me.root.position.z) < 1.5 : true;
    this.guideObj.visible = !!g && !near;
    if (g && !near) {
      this.guideObj.position.set(g.x, this.h(g.x, g.y) + 2.4 + Math.sin(now / 180) * 0.15, g.y);
      this.guideObj.rotation.y = now / 600;
    }
    this.fx = this.fx.filter((f) => {
      const k = Math.min(1, (now - f.born) / (f.until - f.born));
      f.update(k);
      if (k >= 1) {
        f.obj.removeFromParent();
        return false;
      }
      return true;
    });
    this.terrain?.update(now / 1000, this.sunDir);

    this.watchPerf(now);
    if (this.composer) this.composer.render(dt);
    else this.renderer.render(this.scene, this.camera);
    this.placeLabels(now, npc?.id ?? null);
  }

  /** Under ~28 FPS for a few seconds: drop bloom, then shadows and resolution. */
  private watchPerf(now: number): void {
    const p = this.perf;
    if (!p.start) p.start = now + 6000; // let models load first
    if (now < p.start || p.level >= 2) return;
    p.frames++;
    if (now - p.start < 4000) return;
    const fps = (p.frames * 1000) / (now - p.start);
    p.start = now;
    p.frames = 0;
    if (fps >= 28) return;
    p.level++;
    if (p.level === 1 && this.composer) {
      this.composer.dispose();
      this.composer = null;
      this.bloom = null;
    } else {
      p.level = 2;
      this.renderer.shadowMap.enabled = false;
      this.sun.castShadow = false;
      this.renderer.setPixelRatio(1);
      this.resize();
      this.scene.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.material) for (const mm of Array.isArray(m.material) ? m.material : [m.material]) mm.needsUpdate = true;
      });
    }
    console.info('[3d] lowered quality for smoother play', p.level);
  }

  private refreshQuests(): void {
    const c = this.client;
    const quests = c.ui.get().quests;
    const offers = new Set(questsAvailable(QUESTS, quests, c.ui.get().self?.level ?? 1).map((q) => q.giver));
    const ready = new Set<string>();
    const pending = new Set<string>();
    for (const q of quests) {
      const d = getQuest(q.id);
      if (!d || q.done) continue;
      if (questReady(q, d)) ready.add(d.turnIn);
      else {
        pending.add(d.turnIn);
        const st = d.steps[q.step];
        if (st?.type === 'talk' && st.target) ready.add(st.target);
      }
    }
    this.markers.clear();
    for (const n of c.npcs) {
      const m = ready.has(n.id) ? '?' : offers.has(n.id) ? '!' : pending.has(n.id) ? '…' : null;
      if (m) this.markers.set(n.id, m);
    }
    const t = c.questTarget();
    const here = c.map?.id;
    this.guide = null;
    if (!t || !here) return;
    if (t.map === here) {
      this.guide = { x: t.x + 0.5, y: t.y + 0.5 };
      return;
    }
    const prev = new Map<string, { from: string; portal: { x: number; y: number; w: number; h: number } }>();
    const queue = [here];
    const seen = new Set([here]);
    while (queue.length) {
      const id = queue.shift()!;
      if (id === t.map) break;
      for (const p of getMap(id)?.portals ?? []) {
        if (seen.has(p.to)) continue;
        seen.add(p.to);
        prev.set(p.to, { from: id, portal: p });
        queue.push(p.to);
      }
    }
    if (!prev.has(t.map)) return;
    let step = prev.get(t.map)!;
    while (step.from !== here) step = prev.get(step.from)!;
    const p = step.portal;
    this.guide = { x: p.x + p.w / 2, y: p.y + p.h / 2 };
  }

  private placeLabels(now: number, nearNpc: string | null): void {
    const me = this.selfEnt();
    const mx = me?.root.position.x ?? 0;
    const mz = me?.root.position.z ?? 0;
    const W = this.host.clientWidth;
    const H = this.host.clientHeight;
    const place = (el: HTMLElement, p: THREE.Vector3, maxDist = 18): boolean => {
      const s = Math.hypot(p.x - mx, p.z - mz) < maxDist ? this.toScreen(p) : null;
      if (!s || s.x < -100 || s.y < -60 || s.x > W + 100 || s.y > H + 60) {
        if (el.style.display !== 'none') el.style.display = 'none';
        return false;
      }
      if (el.style.display === 'none') el.style.display = '';
      el.style.transform = `translate(${s.x.toFixed(1)}px, ${s.y.toFixed(1)}px) translate(-50%, -100%)`;
      return true;
    };
    const v = new THREE.Vector3();
    const tid = this.client.ui.get().targetId;
    for (const [id, e] of this.ents) {
      const top = e.root.position.y + e.height + 0.12;
      if (e.label) {
        const mon = this.client.monsters.get(id);
        const show = !mon || tid === id || mon.hp < 100 || Math.hypot(e.root.position.x - mx, e.root.position.z - mz) < 7;
        if (show) place(e.label, v.set(e.root.position.x, top, e.root.position.z));
        else e.label.style.display = 'none';
      }
      if (e.bubble) {
        if (now > e.bubble.until) {
          e.bubble.el.remove();
          e.bubble = null;
        } else place(e.bubble.el, v.set(e.root.position.x, top + 0.5, e.root.position.z));
      }
      if (e.emote) {
        if (now > e.emote.until) {
          e.emote.el.remove();
          e.emote = null;
        } else place(e.emote.el, v.set(e.root.position.x, top + (e.bubble ? 1.1 : 0.5), e.root.position.z));
      }
    }
    for (const [id, e] of this.npcs) {
      const top = e.root.position.y + 1.45;
      const mark = this.markers.get(id);
      const lbl = e.label!;
      const want = mark ? `<b class="m${mark === '…' ? ' wait' : ''}">${mark}</b>` : '';
      if (lbl.dataset.mark !== want) {
        lbl.dataset.mark = want;
        lbl.querySelector('b.m')?.remove();
        if (want) lbl.insertAdjacentHTML('afterbegin', want);
      }
      place(lbl, v.set(e.root.position.x, top, e.root.position.z));
    }
    if (nearNpc && !this.client.ui.get().dialogue) {
      const e = this.npcs.get(nearNpc);
      const touch = window.matchMedia('(pointer: coarse)').matches;
      const n = this.client.npcs.find((x) => x.id === nearNpc);
      if (e && n) {
        this.prompt.textContent = touch ? `Talk to ${n.name}` : `[E] Talk to ${n.name}`;
        place(this.prompt, v.set(e.root.position.x, e.root.position.y + 2.3, e.root.position.z));
      }
    } else this.prompt.style.display = 'none';
    for (const s of this.signs) {
      if (s.near) {
        if (Math.hypot(s.x - mx, s.z - mz) < 2.2) place(s.el, v.set(s.x, s.y, s.z));
        else s.el.style.display = 'none';
      } else place(s.el, v.set(s.x, this.h(s.x, s.z) + s.y, s.z + 0.1), 22);
    }
  }

  dispose(): void {
    cancelAnimationFrame(this.raf);
    active3d = false;
    this.mapGen++;
    this.unsubs.forEach((u) => u());
    this.ro.disconnect();
    for (const e of this.ents.values()) this.disposeEnt(e);
    for (const e of this.npcs.values()) this.disposeEnt(e);
    for (const a of this.animals) a.a.dispose();
    this.terrain?.dispose();
    this.composer?.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
    this.labels.remove();
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let blobTex: THREE.Texture | null = null;
/** A soft round shadow under every character (grounds them even without real shadows). */
function blobShadow(r: number): THREE.Mesh {
  if (!blobTex) {
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const g = c.getContext('2d')!;
    const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, 'rgba(0,0,0,0.55)');
    gr.addColorStop(0.6, 'rgba(0,0,0,0.25)');
    gr.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = gr;
    g.fillRect(0, 0, 64, 64);
    blobTex = new THREE.CanvasTexture(c);
  }
  const m = new THREE.Mesh(new THREE.PlaneGeometry(r * 2, r * 2), new THREE.MeshBasicMaterial({ map: blobTex, transparent: true, depthWrite: false }));
  m.rotation.x = -Math.PI / 2;
  m.position.y = 0.03;
  m.renderOrder = 1;
  return m;
}

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]!);
}

/** Turn an angle toward a target by at most `k` (radians), the short way. */
function turn(a: number, b: number, k: number): number {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + Math.max(-k, Math.min(k, d));
}

function objKey(o: WorldObject, now: number): string {
  if (o.kind === 'node') return `n|${o.type}|${o.depletedUntil > now}`;
  if (o.kind === 'drop') return `d|${o.itemId}|${o.quality}`;
  const def = o.crop ? getCrop(o.crop.cropId) : undefined;
  const st = o.crop && def ? cropStatus(o.crop, def, now) : null;
  const wet = o.crop ? o.crop.waterUntil > now : o.wetUntil > now;
  return `p|${o.locked}|${o.tilled}|${wet}|${o.crop?.cropId ?? ''}|${st?.stage ?? ''}|${st?.ready ?? ''}`;
}

const SKILL_COLORS: [RegExp, string][] = [
  [/fire|meteor|power_strike|hunters_mark/, '#ff7a2a'],
  [/frost|ice/, '#7fd0ff'],
  [/holy|smite|judg|bless|sanct|divine|purge/, '#ffe066'],
  [/heal|volley|arrow_storm|poison/, '#6fe07a'],
  [/drain|curse|backstab|shadow/, '#b06ad6'],
  [/lightning|falcon|blitz|eye/, '#9fe8ff'],
  [/war_cry|blood|cleave|whirl/, '#ff4a3a'],
  [/arcane|aimed|pierc/, '#c8a0ff'],
];
function skillColor(sk: string | undefined): string {
  if (!sk) return '#ffffff';
  return SKILL_COLORS.find(([r]) => r.test(sk))?.[1] ?? '#ffe48a';
}

function weaponColor(style: string): string {
  return ({ fire: '#ff7a2a', ice: '#7fd0ff', lightning: '#9fe8ff', shadow: '#b06ad6', holy: '#ffe066', nature: '#6fe07a', rainbow: '#ff7ad8' } as Record<string, string>)[style] ?? '#ffffff';
}

function skyTexture(top: string, bottom: string): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = 2;
  c.height = 256;
  const g = c.getContext('2d')!;
  const grad = g.createLinearGradient(0, 0, 0, 256);
  grad.addColorStop(0, top);
  grad.addColorStop(0.65, bottom);
  grad.addColorStop(1, bottom);
  g.fillStyle = grad;
  g.fillRect(0, 0, 2, 256);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** KayKit clouds drifting around and below the island, plus distant islets. */
async function cloudsAround(w: number, h: number, color: string): Promise<THREE.Object3D> {
  const g = new THREE.Group();
  const [big, small] = await Promise.all([instance('props/cloud_big.glb'), instance('props/cloud_small.glb')]);
  for (const m of [big.root, small.root]) {
    ownMaterials(m);
    m.traverse((o) => {
      const mm = o as THREE.Mesh;
      if (!mm.isMesh) return;
      mm.castShadow = false;
      const mat = mm.material as THREE.MeshStandardMaterial;
      mat.color.set(color);
      mat.emissive.set(color);
      mat.emissiveIntensity = 0.35;
      mat.transparent = true;
      mat.opacity = 0.95;
    });
  }
  for (let i = 0; i < 22; i++) {
    const src = i % 3 ? small.root : big.root;
    const cl = src.clone(true);
    const s = 2.5 + hash01(i * 7) * 3.5;
    cl.scale.setScalar(s);
    const side = i % 4;
    const x = side === 0 ? -6 - hash01(i) * 14 : side === 1 ? w + 6 + hash01(i) * 14 : hash01(i * 2) * w;
    const z = side === 2 ? -6 - hash01(i) * 14 : side === 3 ? h + 6 + hash01(i) * 14 : hash01(i * 5) * h;
    cl.position.set(x, -6 + hash01(i * 9) * 9, z);
    cl.rotation.y = hash01(i * 3) * 6.28;
    g.add(cl);
  }
  // Distant islets with a tree or two.
  const islet = await instance('props/hills_A_trees.glb').catch(() => null);
  if (islet) {
    for (let i = 0; i < 5; i++) {
      const isl = islet.root.clone(true);
      isl.scale.setScalar(3 + hash01(i * 11) * 2);
      const a = (i / 5) * Math.PI * 2 + 0.5;
      isl.position.set(w / 2 + Math.cos(a) * (w * 0.7 + 14), -4 + hash01(i) * 5, h / 2 + Math.sin(a) * (h * 0.7 + 14));
      g.add(isl);
    }
  }
  return g;
}
