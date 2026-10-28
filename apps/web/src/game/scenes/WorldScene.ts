import Phaser from 'phaser';
import { QUESTS, getCrop, getItem, getJob, getMap, getMonster, getNode, getQuest, getSkillDef } from '@terrago/game-data';
import { SPELL, SpellFx, type SpellColors } from '../fx/SpellFx';
import { Atmosphere, GRAPHICS_ORDER, applyCameraLook, bakeGround, type GraphicsMode } from '../fx/hd2d';
import { itemIcon, itemIconHd } from '../art/world';
import { audio, trackFor } from '../audio';
import { CombatFx, FIRE_PAL, HOLY_PAL, ICE_PAL, MAGIC_PAL, MONSTER_PAL, POISON_PAL, paletteFor, type WeaponType } from '../fx/CombatFx';
import { fxSettings, onFxSettings, setFxSettings, type FxSettings } from '../fx/settings';
import { monsterSheet } from '../art/monsters';
import { mountSheet } from '../art/mounts';
import {
  CHAT,
  MAX_VIEW,
  PROP_TYPES,
  TILE_SIZE,
  cropStatus,
  questReady,
  questsAvailable,
  tileCenter,
  type Appearance,
  type ChatMessage,
  glowTier,
  type Direction,
  type MoveInput,
  type NpcAccessory,
  type CombatEvent,
  type WorldObject,
  darknessAt,
  weatherRegion,
  weatherAt,
  MOUNT_CHANNEL_MS,
  getMountStyle,
  type MountLook,
  type MapDef,
} from '@terrago/shared';
import { cropArt, needsWaterArt, readyArt, soilArt, type SoilState } from '../art/farm';
import { nodeArt } from '../art/nodes';
import { CHAR_FRAMES_PER_DIR, FRAME_ACTION, FRAME_SIT, buildCharacterSheet, characterSheetKey } from '../art/characters';
import { emoteIcon } from '../art/emotes';
import { wingCanvas } from '../art/wings';
import { HdSheets } from '../hd/HdSheets';
import { FX_TEX, burst, ensureFxTextures, flash, shockwave } from '../fx/juice';
import { TEXT_RES, renderDpr } from '../hd/screen';
import { BAKE_RES } from '../hd/baker';
import { HERO_ANIMS, HERO_COLS, HERO_FRAME, heroSheet, type HeroAnim } from '../hd/heroes';
import { CREATURE_ANIMS, CREATURE_COLS, bakeCreature, hasMountModel, mountSeat } from '../hd/creatures';
import { bakeBuilding, bakeDeco, bakeNode, bakeProp, decoVariants, propVariants, type StillArt } from '../hd/scenery';
import type { Sheet } from '../hd/baker';
import { classBase, heroKey, npcBase, type HeroLook, type Weapon3D } from '../hd/actors';
import { buildingArt } from '../art/world';
import { groundRes, renderGroundHd } from '../art/groundHd';
import { isTyping, joystickToInput, touchInput } from '../input';
import { pushNotice } from '../store';
import type { GameClient, RemoteMonster, RemotePlayer } from '../net/client';

const DIR_ROW: Record<Direction, number> = { down: 0, left: 1, right: 2, up: 3 };
const WALK_CYCLE = [1, 0, 2, 0];

/** Monster art (shape/colour/size) from game data. */
function MONSTER_ART(id: string): { shape: string; color: string; size: number } {
  const a = getMonster(id)?.art;
  return { shape: a?.shape ?? 'slime', color: a?.color ?? '#7cc35a', size: a?.size ?? 1 };
}
const LABEL_FONT = '"Fredoka", "Nunito", system-ui, sans-serif';
const LABEL_DEPTH = 1_000_000;
/** Props that lie flat on the ground and cast no shadow. */
const FLAT_PROPS = new Set(['teleport_pad', 'flower_bed', 'rug', 'path', 'crop_row', 'puddle', 'bones', 'ladder_down']);

interface ObjectView {
  key: string;
  parts: Phaser.GameObjects.Image[];
}

interface Avatar {
  /** Soft ground shadow (HD-2D). */
  shadow?: Phaser.GameObjects.Image;
  mount?: Phaser.GameObjects.Sprite | null;
  /** HD mount sheet in use, and the rider's lift on it (world px). */
  mountHd?: string | null;
  mountLift?: number;
  mountId?: string | null;
  /** Mount id + look the mount sprite was built for, and the trail colour. */
  mountKey?: string | null;
  trail?: string | null;
  trailAt?: number;
  sprite: Phaser.GameObjects.Sprite;
  label: Phaser.GameObjects.Text;
  bubble: Phaser.GameObjects.Container | null;
  bubbleTimer: Phaser.Time.TimerEvent | null;
  hand?: Phaser.GameObjects.Image | null;
  handKey?: string | null;
  /** Animation timers (scene time, ms). */
  actionUntil?: number;
  lunge?: { x: number; y: number; until: number } | null;
  hurtUntil?: number;
  deadUntil?: number;
  danceUntil?: number;
  bowUntil?: number;
  emote?: Phaser.GameObjects.Image | null;
  tinted?: boolean;
  /** HD sheet in use (texture key), the one wanted, and when to re-check the look. */
  hd?: string | null;
  hdWant?: string | null;
  hdCheckAt?: number;
  /** NPCs: who they are (body choice) and which way they face. */
  npcId?: string;
  accessory?: NpcAccessory;
  facing?: Direction;
  /** The current strike / cast / work pose. */
  actionAt?: number;
  actionMs?: number;
  actionKind?: HeroAnim;
  dustAt?: number;
  /** Wings (back slot) and upgrade glows. */
  wings?: [Phaser.GameObjects.Image, Phaser.GameObjects.Image] | null;
  wingKey?: string | null;
  weaponGlow?: Phaser.GameObjects.Image | null;
  aura?: Phaser.GameObjects.Image | null;
  nextSparkle?: number;
}

const GLOW_COLOR = [0, 0x5fb0ff, 0xc07aff, 0xffe9a8] as const;
const HAWK_SKILLS = new Set(['falcon_strike', 'blind_blitz', 'hunters_eye']);
const HAWK_PAL = { core: 0xe8c890, glow: 0x8a5a2a, spark: 0xffffff };

/**
 * The world view. Rendering only — all rules live on the server, and
 * prediction/interpolation live in GameClient.
 */
export class WorldScene extends Phaser.Scene {
  private client!: GameClient;
  private mapLayer: Phaser.GameObjects.GameObject[] = [];
  /** Buildings, trees and props: hidden while off screen so they cost nothing to draw. */
  private statics: Phaser.GameObjects.Image[] = [];
  private nextCullAt = 0;
  private local: Avatar | null = null;
  private remotes = new Map<string, Avatar>();
  private monsterViews = new Map<string, { sprite: Phaser.GameObjects.Sprite; label: Phaser.GameObjects.Text; bar: Phaser.GameObjects.Graphics; frameW: number; shadow?: Phaser.GameObjects.Image; kick?: { x: number; y: number; until: number }; hd?: string | null; scale: number; attackAt?: number; hurtAt?: number }>();
  private hdSheets: HdSheets | null = null;
  private get hd(): HdSheets {
    return (this.hdSheets ??= new HdSheets(this));
  }
  /** Hit-stop: the picture holds still until then (performance.now ms). */
  private freezeUntil = 0;
  private predictedSwingAt = -1e9;
  private lastKillTarget: string | null = null;
  private targetRing!: Phaser.GameObjects.Graphics;
  private guide!: Phaser.GameObjects.Graphics;
  private npcMarkers = new Map<string, Phaser.GameObjects.Text>();
  private lastQuestRefresh = 0;
  private guideTarget: { x: number; y: number } | null = null;
  private npcAvatars = new Map<string, Avatar>();
  private signs: { x: number; y: number; text: string; label: Phaser.GameObjects.Text }[] = [];
  private prompt!: Phaser.GameObjects.Text;
  private keys!: Record<'up' | 'down' | 'left' | 'right' | 'w' | 'a' | 's' | 'd' | 'e' | 'space', Phaser.Input.Keyboard.Key>;
  private acc = 0;
  private lastFrameAt = 0;
  private unsubs: (() => void)[] = [];
  private lastHint: string | null = null;
  private lastTileKey = '';
  private objectViews = new Map<string, ObjectView>();
  private cursor!: Phaser.GameObjects.Graphics;
  private lastObjectRefresh = 0;
  private lastSweep = 0;
  private lastLevel = 0;
  private lastActionHint: string | null = null;

  constructor() {
    super('world');
  }

  init(data: { client: GameClient }): void {
    this.client = data.client;
  }

  private fx!: CombatFx;
  private spell!: SpellFx;
  private gfx: GraphicsMode = 'hd';
  private groundImage: Phaser.GameObjects.Image | null = null;
  private atmos!: Atmosphere;
  private outdoors = true;

  create(): void {
    ensureFxTextures(this);
    this.fx = new CombatFx(this, LABEL_DEPTH - 8); // above the night overlay, below names
    this.spell = new SpellFx(this, LABEL_DEPTH - 8, LABEL_FONT);
    // HD-2D: camera bloom / focus blur / colour grade, sun shadows and sunbeams.
    this.gfx = fxSettings().graphics;
    this.atmos = new Atmosphere(this, LABEL_DEPTH - 11);
    applyCameraLook(this.cameras.main, this.gfx, this.game.renderer as never);
    const offGfx = onFxSettings((st) => {
      if (st.graphics === this.gfx) return;
      this.gfx = st.graphics;
      applyCameraLook(this.cameras.main, this.gfx, this.game.renderer as never);
      this.applyGround();
      if (this.gfx === 'hd' || this.gfx === 'ultra') {
        if (this.outdoors) this.atmos.build(this.client.map?.theme);
      } else this.atmos.destroy();
    });
    this.events.once('shutdown', offGfx);
    const kb = this.input.keyboard!;
    // No key capture: chat inputs must still receive W/A/S/D and Space.
    kb.disableGlobalCapture();
    const k = (code: number) => kb.addKey(code, false);
    const K = Phaser.Input.Keyboard.KeyCodes;
    this.keys = {
      up: k(K.UP),
      down: k(K.DOWN),
      left: k(K.LEFT),
      right: k(K.RIGHT),
      w: k(K.W),
      a: k(K.A),
      s: k(K.S),
      d: k(K.D),
      e: k(K.E),
      space: k(K.SPACE),
    };
    const interact = () => {
      if (isTyping()) return;
      this.client.primaryAction();
    };
    this.keys.e.on('down', interact);
    this.keys.space.on('down', interact);

    this.prompt = this.add
      .text(0, 0, '', { fontFamily: LABEL_FONT, fontSize: '12px', color: '#2a2030', backgroundColor: '#f3e6c4', padding: { x: 4, y: 2 } })
      .setOrigin(0.5, 1)
      .setDepth(LABEL_DEPTH + 10)
      .setResolution(TEXT_RES)
      .setVisible(false);

    this.cursor = this.add.graphics().setDepth(LABEL_DEPTH - 3);
    this.targetRing = this.add.graphics().setDepth(-4);
    this.guide = this.add.graphics().setDepth(LABEL_DEPTH + 15);
    // Click / tap a nearby tile to use it.
    this.input.on('pointerdown', (ptr: Phaser.Input.Pointer) => {
      if (ptr.button !== 0 || this.client.ui.get().dialogue) return;
      const wp = this.cameras.main.getWorldPoint(ptr.x, ptr.y);
      const duel = this.client.ui.get().duel;
      if (duel) {
        const av = this.remotes.get(duel.id);
        if (av && av.sprite.getBounds().contains(wp.x, wp.y)) {
          this.client.setTarget(duel.id, true);
          return;
        }
      }
      // Clicking another player opens the Trade / Duel menu.
      for (const [id, av] of this.remotes) {
        if (av.sprite.getBounds().contains(wp.x, wp.y)) {
          const r = this.client.remotes.get(id);
          if (r) this.client.ui.set({ playerMenu: { id, name: r.info.name } });
          return;
        }
      }
      // Clicking a monster targets and attacks it.
      for (const [id, v] of this.monsterViews) {
        const b = v.sprite.getBounds();
        if (b.contains(wp.x, wp.y)) {
          // Walk into range (around walls) and start attacking.
          this.client.engage(id);
          return;
        }
      }
      const tx = Math.floor(wp.x / TILE_SIZE);
      const ty = Math.floor(wp.y / TILE_SIZE);
      const cx = tx * TILE_SIZE + TILE_SIZE / 2;
      const cy = ty * TILE_SIZE + TILE_SIZE / 2;
      if (Math.hypot(cx - this.client.pos.x, cy - (this.client.pos.y - 8)) > 1.7 * TILE_SIZE) return;
      this.client.targetAt(tx, ty)?.run();
    });

    this.cameras.main.setRoundPixels(true);
    this.scale.on('resize', this.updateZoom, this);
    this.updateZoom();

    this.unsubs.push(
      this.client.on('enter', () => this.buildMap()),
      this.client.on('add', (r) => this.addRemote(r)),
      this.client.on('remove', (id) => this.removeRemote(id)),
      this.client.on('chat', (m) => this.showBubble(m)),
      this.client.on('objects', (changed, removed) => {
        for (const id of removed) this.destroyObjectView(id);
        for (const o of changed) this.syncObject(o);
      }),
      this.client.on('acted', ({ tx, ty }) => {
        this.puff(tx, ty);
        const c = { x: tx * TILE_SIZE + TILE_SIZE / 2, y: ty * TILE_SIZE + TILE_SIZE / 2 };
        this.pose(this.local, 420, c, 'work');
        const me = this.entityPos(this.client.ui.get().self?.characterId ?? '');
        const slot = this.client.ui.get().inventory?.slots.find((x) => x.slot === this.client.ui.get().selectedSlot)?.itemId ?? null;
        if (me && fxSettings().level !== 'off') this.fx.workSwing(me, c.x, c.y, this.toolIcon(slot && getItem(slot)?.category === 'tool' ? slot : null, tx, ty));
        const selfId = this.client.ui.get().self?.characterId;
        if (selfId) this.swinging.set(selfId, this.time.now + 400);
      }),
      this.client.on('work', (w) => {
        const av = this.remotes.get(w.id);
        const from = this.entityPos(w.id);
        if (!av || !from) return;
        const c = { x: w.tx * TILE_SIZE + TILE_SIZE / 2, y: w.ty * TILE_SIZE + TILE_SIZE / 2 };
        this.pose(av, 420, c, 'work');
        if (fxSettings().level !== 'off') this.fx.workSwing(from, c.x, c.y, this.toolIcon(w.tool, w.tx, w.ty));
        this.swinging.set(w.id, this.time.now + 400);
        this.puff(w.tx, w.ty);
      }),
      this.client.on('emote', (e) => this.showEmote(e.id, e.emote)),
      this.client.on('monsterAdd', (m) => this.addMonster(m)),
      this.client.on('monsterRemove', (id) => this.removeMonster(id)),
      this.client.on('combat', (ev) => this.showCombat(ev)),
      this.client.on('swing', (id) => {
        // Instant feedback: strike pose toward the target before the server answers.
        const to = this.entityPos(id);
        if (to) this.pose(this.local, 340, to);
        this.predictedSwingAt = this.time.now;
      }),
      this.client.on('telegraph', (t) => this.showTelegraph(t)),
      this.client.on('animals', (list) => this.drawAnimals(list)),
      this.client.on('look', (id) => {
        const self = this.client.ui.get().self;
        if (self && id === self.characterId && this.local) {
          this.local.hdCheckAt = 0;
          return;
        }
        const r = this.client.remotes.get(id);
        const av = this.remotes.get(id);
        if (r && av) {
          av.hdCheckAt = 0;
          this.setAvatarMount(av, r.info.mount, r.info.mountLook);
          av.label.setText(remoteLabel(r.info));
        }
      }),
    );
    if (this.client.map) this.buildMap();

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.unsubs.forEach((u) => u()));
  }

  private baseZoom = 1;
  private mountedView = false;

  /**
   * Camera feel: look a little ahead of where you're walking, and pull back half a
   * zoom step while mounted (you move twice as fast and need to see further).
   */
  private updateCameraFeel(delta: number, mounted: boolean): void {
    const cam = this.cameras.main;
    const c = this.client;
    const v = c.moving ? { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] }[c.dir] ?? [0, 0] : [0, 0];
    const k = 1 - Math.pow(0.04, delta / 1000);
    cam.followOffset.x += (-v[0]! * 30 - cam.followOffset.x) * k;
    cam.followOffset.y += (24 - v[1]! * 22 - cam.followOffset.y) * k;
    if (mounted !== this.mountedView) {
      this.mountedView = mounted;
      const target = mounted ? this.baseZoom * 0.8 : this.baseZoom;
      this.tweens.add({ targets: cam, zoom: target, duration: 450, ease: 'Sine.easeInOut' });
    }
  }

  /** Zoom so the visible world never exceeds MAX_VIEW; art stays crisp at 0.5 steps. */
  private updateZoom(): void {
    // The canvas is drawn at device resolution; zoom is worked out in CSS pixels.
    const dpr = renderDpr();
    const { width, height } = this.scale.gameSize;
    const min = Math.max(width / dpr / MAX_VIEW.width, height / dpr / MAX_VIEW.height);
    const zoom = Math.max(1, Math.ceil(min * 0.92 * 4) / 4) * dpr;
    this.baseZoom = zoom;
    this.cameras.main.setZoom(this.mountedView ? zoom * 0.8 : zoom);
  }

  // ---------------------------------------------------------------------------
  // Building the map
  // ---------------------------------------------------------------------------

  private canvasTexture(key: string, make: () => HTMLCanvasElement): string {
    if (!this.textures.exists(key)) this.textures.addCanvas(key, make());
    return key;
  }

  private charTexture(a: Appearance, accessory?: NpcAccessory): string {
    const key = characterSheetKey(a, accessory);
    if (!this.textures.exists(key)) {
      const tex = this.textures.addCanvas(key, buildCharacterSheet(a, accessory))!;
      for (let row = 0; row < 4; row++) for (let col = 0; col < CHAR_FRAMES_PER_DIR; col++) tex.add(row * CHAR_FRAMES_PER_DIR + col, 0, col * 32, row * 48, 32, 48);
    }
    return key;
  }

  private makeAvatar(x: number, y: number, a: Appearance, label: string, color: string, accessory?: NpcAccessory): Avatar {
    const sprite = this.add.sprite(Math.round(x), Math.round(y) + 2, this.charTexture(a, accessory), 0).setOrigin(0.5, 1).setVisible(false);
    sprite.setDepth(y);
    const text = this.add
      .text(Math.round(x), Math.round(y) - 58, label, {
        fontFamily: LABEL_FONT,
        fontSize: '12px',
        color,
        stroke: '#2a2030',
        strokeThickness: 3,
        align: 'center',
      })
      .setOrigin(0.5, 1)
      .setResolution(TEXT_RES)
      .setDepth(LABEL_DEPTH);
    return { sprite, label: text, bubble: null, bubbleTimer: null, accessory };
  }

  // ---------------------------------------------------------------------------
  // HD heroes: baked sprite sheets wearing the character's real gear
  // ---------------------------------------------------------------------------

  /** What a character looks like: body for the class, colours, and visible gear. */
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
      return {
        base: classBase(self.classId, self.job),
        appearance: self.appearance,
        weapon: showWeapon ? weaponOf(at(0)?.itemId, at(0)?.enhance ?? 0) : null,
        shield: at(1) ? tierOf(at(1)!.itemId) : null,
        helm: at(2) ? tierOf(at(2)!.itemId) : null,
        chest: at(3) ? tierOf(at(3)!.itemId) : null,
        wings: wings(at(8)?.itemId),
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
    };
  }

  /** Point an avatar at the HD sheet for `look` (baking it in the background if needed). */
  private syncHd(av: Avatar, look: HeroLook | null, priority = 0): void {
    if (!look) return;
    const key = `hd:hero:${heroKey(look)}`;
    if (av.hdWant === key) return;
    av.hdWant = key;
    void this.hd.ensure(key, () => heroSheet(look, priority)).then((ok) => {
      if (!ok || av.hdWant !== key || !av.sprite.active) return;
      av.sprite.setTexture(key, 0).setOrigin(0.5, 1 - HERO_FRAME.foot / HERO_FRAME.h).setScale(1 / BAKE_RES).setVisible(true);
      if (av.hd && av.hd !== key) av.sprite.setFlipX(false);
      av.hd = key;
      // A new look flashes so you notice the change.
      if (av.hdCheckAt) {
        av.sprite.setTintFill(0xffffff);
        this.time.delayedCall(90, () => av.sprite.active && av.sprite.clearTint());
      }
    });
  }

  /** Re-check an avatar's look a couple of times a second. */
  private syncHdFor(av: Avatar, id: string, now: number): void {
    if ((av.hdCheckAt ?? 0) > now && av.hdWant) return;
    av.hdCheckAt = now + 400;
    this.syncHd(av, this.heroLook(id), av === this.local ? 10 : 5);
  }

  /** Which HD frame to show. */
  private heroFrame(av: Avatar, dir: Direction, anim: HeroAnim, time: number, speed = 1): void {
    const a = HERO_ANIMS[anim];
    let i = 0;
    if (anim === 'walk') i = Math.floor(time / (95 / Math.max(0.6, Math.min(2.2, speed)))) % a.n;
    else if (anim === 'idle') i = Math.floor(time / 320) % a.n;
    else if (anim === 'attack' || anim === 'cast' || anim === 'work') {
      const k = av.actionMs ? (time - (av.actionAt ?? 0)) / av.actionMs : 1;
      i = Math.max(0, Math.min(a.n - 1, Math.floor(k * a.n)));
    }
    const row = dir === 'down' ? 0 : dir === 'up' ? 2 : 1;
    this.hd.get(av.hd!);
    av.sprite.setFrame(row * HERO_COLS + a.start + i).setFlipX(dir === 'left');
  }

  /** Show (or hide) the mount under an avatar, wearing its saddle, barding and trail. */
  private setAvatarMount(av: Avatar, mountId: string | null | undefined, look?: MountLook | null): void {
    const want = mountId ? `${mountId}|${look?.saddle ?? ''}|${look?.barding ?? ''}|${look?.trail ?? ''}` : null;
    if ((av.mountKey ?? null) === want) return;
    const changedLook = !!av.mountKey && !!want && av.mountId === mountId;
    av.mount?.destroy();
    av.mount = null;
    av.mountId = mountId ?? null;
    av.mountKey = want;
    av.trail = null;
    const def = mountId ? getItem(mountId)?.mount : undefined;
    if (!def) return;
    const saddle = getMountStyle(look?.saddle)?.color;
    const barding = getMountStyle(look?.barding)?.color;
    av.trail = getMountStyle(look?.trail)?.color ?? null;
    av.mountHd = null;
    if (hasMountModel(def.kind)) {
      const hk = `hd:mount:${def.kind}:${def.color}`;
      const sp = this.add.sprite(av.sprite.x, av.sprite.y, '__DEFAULT').setVisible(false);
      av.mount = sp;
      av.mountLift = Math.round(mountSeat(def.kind) * 27 - 16);
      void this.hd.ensure(hk, () => bakeCreature('mount', def.kind, '', def.color, 1, 6)).then((ok) => {
        if (!ok || av.mount !== sp || !sp.active) return;
        const info = this.hd.get(hk)!;
        sp.setTexture(hk, 0).setOrigin(0.5, 1 - (info.meta?.foot ?? 10) / (info.meta?.h ?? 48)).setScale(1 / BAKE_RES).setVisible(true);
        av.mountHd = hk;
      });
      return;
    }
    const key = `mount:${def.kind}:${def.color}:${saddle ?? ''}:${barding ?? ''}`;
    if (!this.textures.exists(key)) {
      const sh = mountSheet(def.kind, def.color, { saddle, barding });
      const tex = this.textures.addCanvas(key, sh.canvas)!;
      tex.add(0, 0, 0, 0, sh.w * 2, sh.h * 2);
      tex.add(1, 0, sh.w * 2, 0, sh.w * 2, sh.h * 2);
    }
    av.mount = this.add.sprite(av.sprite.x, av.sprite.y, key, 0).setOrigin(0.5, 1);
    // A new saddle, barding or trail flashes so you notice the change.
    if (changedLook) {
      av.mount.setTintFill(0xffffff);
      this.time.delayedCall(90, () => av.mount?.clearTint());
      this.time.delayedCall(180, () => av.mount?.setTintFill(0xffffff));
      this.time.delayedCall(270, () => av.mount?.clearTint());
    }
  }

  /** Particles left behind a moving mount that wears a trail. */
  private mountTrail(av: Avatar, x: number, y: number, now: number): void {
    if (!av.trail || !av.mount || now - (av.trailAt ?? 0) < 55) return;
    av.trailAt = now;
    const c = Phaser.Display.Color.HexStringToColor(av.trail).color;
    const dot = this.add.rectangle(x + (Math.random() * 20 - 10), y - 2 - Math.random() * 8, 3, 3, c).setDepth(y - 1).setBlendMode(Phaser.BlendModes.ADD);
    this.tweens.add({ targets: dot, y: dot.y - 10 - Math.random() * 8, alpha: 0, scale: 0.4, duration: 600, onComplete: () => dot.destroy() });
  }

  /** The 0.5 s bar over your head while getting on a mount. */
  private mountBar?: Phaser.GameObjects.Graphics;
  private drawMountChannel(x: number, y: number): void {
    const until = this.client.ui.get().self?.mountChannelUntil;
    const left = until ? until - this.client.serverNow() : 0;
    if (!until || left <= -150) {
      this.mountBar?.setVisible(false);
      return;
    }
    const g = (this.mountBar ??= this.add.graphics());
    const k = Math.max(0, Math.min(1, 1 - left / MOUNT_CHANNEL_MS));
    g.clear().setVisible(true).setDepth(LABEL_DEPTH + 40);
    g.fillStyle(0x0b0d15, 0.85).fillRoundedRect(x - 21, y - 76, 42, 8, 3);
    g.fillStyle(0xf2c14e, 1).fillRoundedRect(x - 19, y - 74, 38 * k, 4, 2);
  }

  private destroyAvatar(av: Avatar): void {
    av.shadow?.destroy();
    av.wings?.forEach((w) => w.destroy());
    av.weaponGlow?.destroy();
    av.aura?.destroy();
    av.emote?.destroy();
    av.mount?.destroy();
    av.hand?.destroy();
    av.bubbleTimer?.remove();
    av.bubble?.destroy();
    av.sprite.destroy();
    av.label.destroy();
  }

  /** Shadows to bake into one ground layer for this map (HD-2D). */
  private shadowDraws: { src: HTMLCanvasElement; left: number; by: number; blur: number }[] = [];

  /** The long soft shadow an object casts (HD-2D); `left` is the art's left edge, `by` its ground line. */
  private castShadow(key: string, left: number, by: number, blur: number): void {
    this.shadowDraws.push({ src: this.textures.get(key).getSourceImage() as HTMLCanvasElement, left, by, blur });
  }

  /** Swap the ground texture for the current graphics mode (shadows + grade baked in, or plain). */
  private applyGround(): void {
    const map = this.client.map;
    if (!map || !this.groundImage) return;
    const plainKey = `ground:${map.id}`;
    const plain = this.textures.get(plainKey).getSourceImage() as HTMLCanvasElement;
    const want = this.gfx === 'classic' ? plainKey : `ground:${map.id}:${this.gfx === 'lite' ? 'lite' : 'hd'}`;
    if (!this.textures.exists(want)) this.textures.addCanvas(want, bakeGround(plain, this.shadowDraws, this.gfx !== 'lite'));
    const old = this.groundImage.texture.key;
    this.groundImage.setTexture(want);
    // Keep GPU memory low: only the plain ground and the one in use stay loaded.
    if (old !== want && old !== plainKey) this.textures.remove(old);
  }

  /** Grass tufts, flowers, ferns and pebbles sprinkled over the ground (decoration only). */
  private scatterGroundCover(map: MapDef): void {
    if (this.gfx === 'classic') return;
    const taken = new Set<string>();
    for (const o of map.objects) {
      const w = o.kind === 'building' ? o.w : (PROP_TYPES[o.type]?.w ?? 1);
      const h = o.kind === 'building' ? o.h : (PROP_TYPES[o.type]?.h ?? 1);
      for (let y = o.y - 1; y <= o.y + h; y++) for (let x = o.x - 1; x <= o.x + w; x++) taken.add(`${x},${y}`);
    }
    const theme = map.theme ?? 'meadow';
    const cold = theme === 'snow' || theme === 'peak';
    const hot = theme === 'volcano';
    const lite = this.gfx === 'lite';
    let budget = lite ? 350 : 900;
    const hash = (x: number, y: number, k: number) => {
      let h = (x * 73856093) ^ (y * 19349663) ^ (k * 83492791);
      h = Math.imul(h ^ (h >>> 13), 1274126177);
      return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
    };
    for (let y = 0; y < map.height && budget > 0; y++)
      for (let x = 0; x < map.width && budget > 0; x++) {
        if (taken.has(`${x},${y}`)) continue;
        const t = map.tiles[y]![x];
        const r = hash(x, y, 1);
        let kind: string | null = null;
        if ((t === '.' || t === ',') && !cold && !hot) kind = t === ',' ? (r < 0.75 ? 'tall' : r < 0.85 ? 'grass' : null) : r < 0.2 ? 'grass' : r < 0.25 ? 'clover' : r < 0.28 ? 'flower' : null;
        else if (t === '*') kind = r < 0.7 ? 'flower' : r < 0.85 ? 'grass' : null;
        else if (t === 'f') kind = r < 0.35 ? 'fern' : r < 0.42 ? 'shroom' : r < 0.55 ? 'grass' : null;
        else if (t === '=' || t === 's' || t === 'h' || t === 'a' || t === 'k' || t === 'n' || t === 'c') kind = r < 0.05 ? 'pebble' : r < 0.08 && (t === 'k' || t === 'a' || t === 'n') ? 'dry' : null;
        if (!kind) continue;
        budget--;
        const v = Math.floor(hash(x, y, 2) * decoVariants(kind));
        const px = (x + 0.2 + hash(x, y, 3) * 0.6) * TILE_SIZE;
        const py = (y + 0.25 + hash(x, y, 4) * 0.6) * TILE_SIZE;
        const img = this.add.image(px, py, '__DEFAULT').setDepth(kind === 'pebble' || kind === 'clover' ? -3 : py).setVisible(false);
        this.mapLayer.push(img);
        this.statics.push(img);
        const key = `hd:deco:${kind}:${v}`;
        const flip = hash(x, y, 5) < 0.5;
        void this.hd.ensure(key, async () => this.stillSheet(await bakeDeco(kind!, v))).then((ok) => {
          if (!ok || !img.active) return;
          const m = this.hd.get(key)!.meta!;
          img.setTexture(key, 0).setOrigin(m.ox!, m.oy!).setScale(1 / BAKE_RES).setFlipX(flip).setVisible(true);
        });
      }
  }

  /** Turn a still bake into a one-frame sheet (keeps its ground point and size). */
  private stillSheet(a: StillArt): Sheet & { foot?: number; w?: number; h?: number; ox?: number; oy?: number } {
    return { canvas: a.canvas, fw: a.canvas.width, fh: a.canvas.height, cols: 1, rows: 1, perLine: 1, w: a.w, h: a.h, ox: a.ox, oy: a.oy };
  }

  /** A soft contact shadow on the ground under scenery. */
  private groundBlob(x: number, y: number, w: number, h: number): void {
    if (this.gfx === 'classic') return;
    const img = this.add.image(x, y, this.blobKey()).setDisplaySize(w, h).setAlpha(0.75).setDepth(-4);
    this.mapLayer.push(img);
  }

  /** A soft dark blob under feet (characters and monsters). */
  private blobKey(): string {
    return this.canvasTexture('hd2d:blob', () => {
      const c = document.createElement('canvas');
      c.width = 64;
      c.height = 32;
      const g = c.getContext('2d')!;
      const gr = g.createRadialGradient(32, 16, 2, 32, 16, 30);
      gr.addColorStop(0, 'rgba(8,10,24,0.55)');
      gr.addColorStop(1, 'rgba(8,10,24,0)');
      g.fillStyle = gr;
      g.beginPath();
      g.ellipse(32, 16, 31, 15, 0, 0, Math.PI * 2);
      g.fill();
      return c;
    });
  }

  private buildMap(): void {
    const map = this.client.map!;
    this.mapLayer.forEach((o) => o.destroy());
    this.mapLayer = [];
    this.signs.forEach((s) => s.label.destroy());
    this.signs = [];
    this.npcAvatars.forEach((a) => this.destroyAvatar(a));
    this.npcAvatars.clear();
    this.remotes.forEach((a) => this.destroyAvatar(a));
    this.remotes.clear();
    for (const id of [...this.monsterViews.keys()]) this.removeMonster(id);
    if (this.local) this.destroyAvatar(this.local);

    audio.sfx('portal');
    this.areaTrack = trackFor(map.music, map.theme);
    this.nextSoundCheck = 0;
    const W = map.width * TILE_SIZE;
    const H = map.height * TILE_SIZE;
    // Night: a dark-blue veil over the world (under names), with warm glows around lights.
    this.night = this.add.rectangle(0, 0, W, H, 0x0a0f2c, 0).setOrigin(0, 0).setDepth(LABEL_DEPTH - 10);
    this.mapLayer.push(this.night);
    this.glows = [];
    this.windowGlows = [];
    this.chimneys = [];
    const indoor = !weatherRegion(map.theme);
    this.indoorDim = indoor ? (map.dungeon ? 0.32 : 0.22) : 0;
    for (const o of map.objects) {
      if (o.kind !== 'prop' || !['lamp', 'torch', 'campfire'].includes(o.type)) continue;
      const key = this.glowKey();
      const g = this.add
        .image((o.x + 0.5) * TILE_SIZE, (o.y + 0.5) * TILE_SIZE, key)
        .setScale(o.type === 'campfire' ? 1.6 : 1.1)
        .setAlpha(0)
        .setBlendMode(Phaser.BlendModes.ADD)
        .setDepth(LABEL_DEPTH - 9);
      this.glows.push(g);
      this.mapLayer.push(g);
    }
    // HD painted ground, in chunks (only this map's stay in memory).
    for (const k of this.textures.getTextureKeys()) if ((k.startsWith('ground:') || k.startsWith('groundhd:')) && !k.startsWith(`groundhd:${map.id}:`)) this.textures.remove(k);
    const gres = groundRes();
    const chunkKeys = this.textures.getTextureKeys().filter((k) => k.startsWith(`groundhd:${map.id}:`));
    const chunks = chunkKeys.length ? null : renderGroundHd(map, gres);
    const placed = chunks
      ? chunks.map((ch, i) => {
          const key = `groundhd:${map.id}:${i}:${ch.x}:${ch.y}`;
          this.textures.addCanvas(key, ch.canvas);
          return { key, x: ch.x, y: ch.y };
        })
      : chunkKeys.map((key) => {
          const [, , , x, y] = key.split(':');
          return { key, x: Number(x), y: Number(y) };
        });
    for (const p of placed) this.mapLayer.push(this.add.image(p.x, p.y, p.key).setOrigin(0, 0).setScale(1 / gres).setDepth(-10));
    this.groundImage = null;
    this.statics = [];
    this.nextCullAt = 0;
    this.shadowDraws = [];
    this.outdoors = !indoor;
    if (this.outdoors && (this.gfx === 'hd' || this.gfx === 'ultra')) this.atmos.build(map.theme);
    else this.atmos.destroy();

    for (const o of map.objects) {
      if (o.kind === 'building') {
        const art = buildingArt(o);
        const bx = o.x * TILE_SIZE;
        const by = (o.y + o.h) * TILE_SIZE;
        const cx = bx + (o.w * TILE_SIZE) / 2;
        const bimg = this.add.image(cx, by, '__DEFAULT').setDepth(by).setVisible(false);
        this.mapLayer.push(bimg);
        this.statics.push(bimg);
        this.groundBlob(cx, by - 6, o.w * TILE_SIZE * 0.62, 18);
        const sign = this.add
          .text(cx, by - 40, o.name, { fontFamily: LABEL_FONT, fontSize: '11px', color: '#fff6dc', fontStyle: 'bold', stroke: '#2a1a10', strokeThickness: 4 })
          .setOrigin(0.5, 1)
          .setResolution(TEXT_RES)
          .setDepth(LABEL_DEPTH - 3);
        this.mapLayer.push(sign);
        const key = `hd:bld:${o.id}:${o.w}x${o.h}:${o.style ?? ''}`;
        void this.hd.ensure(key, async () => this.stillSheet(await bakeBuilding(o))).then((ok) => {
          if (!ok || !bimg.active) return;
          const m = this.hd.get(key)!.meta!;
          bimg.setTexture(key, 0).setOrigin(m.ox!, m.oy!).setScale(1 / BAKE_RES).setVisible(true);
          sign.setY(by - m.h! * m.oy! + 6);
        });
        // Night: lanterns glow and chimneys smoke.
        for (const l of art.lights) {
          const g = this.add.image(bx + l.x, by + l.y, this.glowKey()).setScale(l.r / 40).setAlpha(0).setBlendMode(Phaser.BlendModes.ADD).setDepth(LABEL_DEPTH - 9);
          this.glows.push(g);
          this.mapLayer.push(g);
        }
        for (const c of art.chimneys) this.chimneys.push({ x: bx + c.x, y: by + c.y, next: 0 });
      } else {
        const size = PROP_TYPES[o.type] ?? { w: 1, h: 1 };
        const variant = (o.x * 7 + o.y * 13) % propVariants(o.type);
        const cx = (o.x + size.w / 2) * TILE_SIZE;
        const cy = (o.y + size.h / 2) * TILE_SIZE;
        const by = (o.y + size.h) * TILE_SIZE;
        const flat = o.type === 'teleport_pad' || o.type === 'flower_bed' || FLAT_PROPS.has(o.type);
        const depth = flat ? 0 : by - 1;
        const pimg = this.add.image(cx, cy, '__DEFAULT').setDepth(depth).setVisible(false);
        this.mapLayer.push(pimg);
        this.statics.push(pimg);
        if (!flat) this.groundBlob(cx, cy + 4, Math.max(18, size.w * TILE_SIZE * (o.type.startsWith('tree') ? 0.85 : 0.6)), Math.max(8, size.h * 10));
        const key = `hd:prop:${o.type}:${variant}`;
        void this.hd.ensure(key, async () => this.stillSheet(await bakeProp(o.type, variant))).then((ok) => {
          if (!ok || !pimg.active) return;
          const m = this.hd.get(key)!.meta!;
          pimg.setTexture(key, 0).setOrigin(m.ox!, m.oy!).setScale(1 / BAKE_RES).setVisible(true);
        });
        if (o.text) {
          const label = this.add
            .text(cx, by - 48, o.text, {
              fontFamily: LABEL_FONT,
              fontSize: '12px',
              color: '#2a2030',
              backgroundColor: '#f3e6c4',
              padding: { x: 6, y: 4 },
              wordWrap: { width: 220 },
              align: 'center',
            })
            .setOrigin(0.5, 1)
            .setResolution(TEXT_RES)
            .setDepth(LABEL_DEPTH + 5)
            .setVisible(false);
          this.signs.push({ x: cx, y: by, text: o.text, label });
        }
      }
    }

    this.scatterGroundCover(map);
    this.applyGround();
    for (const id of [...this.objectViews.keys()]) this.destroyObjectView(id);
    for (const o of this.client.objects.values()) this.syncObject(o);

    this.npcMarkers.forEach((m) => m.destroy());
    this.npcMarkers.clear();
    for (const n of this.client.npcs) {
      const c = tileCenter(n.x, n.y);
      const av = this.makeAvatar(c.x, c.y, n.appearance, n.name, '#b9f08a', n.accessory);
      av.npcId = n.id;
      av.facing = n.dir;
      this.syncHd(av, { base: npcBase(n.accessory, n.id), appearance: n.appearance });
      av.label.setDepth(LABEL_DEPTH - 1);
      this.npcAvatars.set(n.id, av);
    }

    const self = this.client.ui.get().self!;
    this.local = this.makeAvatar(this.client.pos.x, this.client.pos.y, self.appearance, `${self.name} · Lv ${self.level}`, '#ffe48a');
    for (const r of this.client.remotes.values()) this.addRemote(r);
    for (const m of this.client.monsters.values()) this.addMonster(m);

    const cam = this.cameras.main;
    cam.setBounds(0, 0, W, H);
    cam.startFollow(this.local.sprite, true, 0.18, 0.18, 0, 24);
    cam.centerOn(this.client.pos.x, this.client.pos.y);
    this.updateZoom();
  }

  // ---------------------------------------------------------------------------
  // Objects (farm plots)
  // ---------------------------------------------------------------------------

  private bufferTexture(key: string, make: () => { toCanvas: () => HTMLCanvasElement }): string {
    return this.canvasTexture(key, () => make().toCanvas());
  }

  /** Visual state of an object; when it changes, the view is rebuilt. */
  private objectKey(o: WorldObject, now: number): string {
    if (o.kind === 'node') return `${o.type}|${o.depletedUntil > now ? 'spent' : 'ok'}`;
    if (o.kind === 'drop') return `drop|${o.itemId}`;
    if (o.locked) return 'wild';
    const soil: SoilState = !o.tilled ? 'farmland' : o.wetUntil > now ? 'wet' : 'tilled';
    if (!o.crop) return soil;
    const def = getCrop(o.crop.cropId);
    if (!def) return soil;
    const st = cropStatus(o.crop, def, now);
    const badge = st.ready ? 'ready' : st.pests ? 'pests' : !st.watered ? 'dry' : '';
    return `${soil}|${def.id}:${st.stage}|${badge}`;
  }

  private syncObject(o: WorldObject): void {
    const key = this.objectKey(o, this.client.serverNow());
    const cur = this.objectViews.get(o.id);
    if (cur && cur.key === key) return;
    if (cur) cur.parts.forEach((p) => p.destroy());
    const parts: Phaser.GameObjects.Image[] = [];
    const x = o.x * TILE_SIZE;
    const y = o.y * TILE_SIZE;
    if (o.kind === 'drop') {
      const def = getItem(o.itemId);
      if (def) {
        const key2 = this.canvasTexture(`iconhd:${def.icon}`, () => itemIconHd(def.icon, 96));
        const img = this.add.image(x + TILE_SIZE / 2, y + TILE_SIZE / 2, key2).setDisplaySize(26, 26).setDepth(y + TILE_SIZE / 2);
        this.tweens.add({ targets: img, y: y + TILE_SIZE / 2 - 4, yoyo: true, repeat: -1, duration: 700, ease: 'Sine.easeInOut' });
        parts.push(img);
      }
    }
    if (o.kind === 'node') {
      const def = getNode(o.type);
      const spent = key.endsWith('spent');
      if (def) {
        const seed = (o.x * 7 + o.y * 3) % 5;
        const hk = `hd:node:${o.type}:${spent ? 1 : 0}:${seed}`;
        const img = this.add.image(x + TILE_SIZE / 2, y + TILE_SIZE / 2, '__DEFAULT').setDepth(def.solid && !spent ? y + TILE_SIZE : y + 4).setVisible(false);
        parts.push(img);
        void this.hd.ensure(hk, async () => this.stillSheet(await bakeNode(def.art.kind, def.art.color, spent, seed)), ).then((ok) => {
          if (!img.active) return;
          if (ok) {
            const m = this.hd.get(hk)!.meta!;
            img.setTexture(hk, 0).setOrigin(m.ox!, m.oy!).setScale(1 / BAKE_RES).setVisible(true);
          } else {
            const nk = this.bufferTexture(`node:${o.type}:${spent ? 1 : 0}`, () => nodeArt(def, spent));
            img.setTexture(nk).setOrigin(0.5, 1).setPosition(x + TILE_SIZE / 2, y + TILE_SIZE + 2).setVisible(true);
          }
        });
      }
    }
    if (o.kind === 'plot') {
      const [soil, crop, badge] = key.split('|');
      const variant = (o.x * 3 + o.y * 5) % 3;
      const soilKey = this.bufferTexture(`soil:${soil}:${variant}`, () => soilArt(soil as SoilState, variant));
      parts.push(this.add.image(x, y, soilKey).setOrigin(0, 0).setDepth(-5));
      if (crop) {
        const [cropId, stage] = crop.split(':');
        const def = getCrop(cropId!);
        if (def) {
          const ck = this.bufferTexture(`crop:${cropId}:${stage}`, () => cropArt(def, Number(stage)));
          parts.push(this.add.image(x + TILE_SIZE / 2, y + TILE_SIZE - 2, ck).setOrigin(0.5, 1).setDepth(y + TILE_SIZE - 6));
        }
      }
      if (badge === 'dry') parts.push(this.add.image(x + TILE_SIZE - 6, y + 2, this.bufferTexture('badge:dry', needsWaterArt)).setOrigin(0.5, 1).setDepth(LABEL_DEPTH - 4).setAlpha(0.9));
      if (badge === 'pests') {
        // Little bugs crawling over the crop.
        const key = this.canvasTexture('badge:pests', () => {
          const c = document.createElement('canvas');
          c.width = c.height = TILE_SIZE;
          const ctx = c.getContext('2d')!;
          for (const [bx, by] of [[9, 12], [19, 9], [14, 20], [23, 17], [6, 22]] as const) {
            ctx.fillStyle = '#2a2030';
            ctx.fillRect(bx, by, 4, 3);
            ctx.fillStyle = '#7a9a3a';
            ctx.fillRect(bx + 1, by, 2, 1);
          }
          return c;
        });
        const bugs = this.add.image(x, y, key).setOrigin(0, 0).setDepth(y + TILE_SIZE - 5);
        this.tweens.add({ targets: bugs, x: x + 2, yoyo: true, repeat: -1, duration: 260 });
        parts.push(bugs);
      }
      if (badge === 'ready') {
        const sp = this.add.image(x + TILE_SIZE - 6, y + 4, this.bufferTexture('badge:ready', readyArt)).setOrigin(0.5, 1).setDepth(LABEL_DEPTH - 4);
        this.tweens.add({ targets: sp, alpha: 0.35, yoyo: true, repeat: -1, duration: 600 });
        parts.push(sp);
      }
    }
    this.objectViews.set(o.id, { key, parts });
  }

  private destroyObjectView(id: string): void {
    this.objectViews.get(id)?.parts.forEach((p) => p.destroy());
    this.objectViews.delete(id);
  }

  private bobber: Phaser.GameObjects.Graphics | null = null;
  private alert: Phaser.GameObjects.Text | null = null;

  /** Fishing bobber on the water, and a "!" when something bites. */
  private updateBobber(time: number): void {
    const f = this.client.ui.get().fishing;
    if (!f || f.phase === 'reeling') {
      this.bobber?.destroy();
      this.bobber = null;
      this.alert?.destroy();
      this.alert = null;
      return;
    }
    if (!this.bobber) this.bobber = this.add.graphics().setDepth(LABEL_DEPTH - 6);
    const bx = f.x * TILE_SIZE + TILE_SIZE / 2;
    const by = f.y * TILE_SIZE + TILE_SIZE / 2 + (f.phase === 'bite' ? Math.sin(time / 40) * 3 : Math.sin(time / 300) * 1.5);
    this.bobber.clear().lineStyle(1, 0xe6e2d3, 0.8).lineBetween(this.client.pos.x + 10, this.client.pos.y - 30, bx, by - 3);
    this.bobber.fillStyle(0xe0483a, 1).fillCircle(bx, by - 2, 3).fillStyle(0xffffff, 1).fillCircle(bx, by + 1, 3);
    if (f.phase === 'bite' && !this.alert) {
      this.alert = this.add
        .text(this.client.pos.x, this.client.pos.y - 70, '!', { fontFamily: LABEL_FONT, fontSize: '28px', color: '#ffe48a', stroke: '#2a2030', strokeThickness: 5 })
        .setOrigin(0.5, 1)
        .setDepth(LABEL_DEPTH + 20);
    }
    if (f.phase !== 'bite' && this.alert) {
      this.alert.destroy();
      this.alert = null;
    }
  }

  /** "!" = quest to pick up, "?" = ready to hand in (grey while still in progress). */
  private refreshQuestMarkers(): void {
    const quests = this.client.ui.get().quests;
    const offers = new Set(questsAvailable(QUESTS, quests, this.client.ui.get().self?.level ?? 1).map((q) => q.giver));
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
    for (const n of this.client.npcs) {
      const mark = ready.has(n.id) ? ['?', '#ffe48a'] : offers.has(n.id) ? ['!', '#ffe48a'] : pending.has(n.id) ? ['?', '#b0b0b0'] : null;
      let t = this.npcMarkers.get(n.id);
      if (!mark) {
        t?.destroy();
        this.npcMarkers.delete(n.id);
        continue;
      }
      if (!t) {
        t = this.add
          .text(0, 0, mark[0]!, { fontFamily: LABEL_FONT, fontSize: '24px', color: mark[1], stroke: '#2a2030', strokeThickness: 5 })
          .setOrigin(0.5, 1)
          .setResolution(TEXT_RES)
          .setDepth(LABEL_DEPTH + 3);
        this.npcMarkers.set(n.id, t);
      }
      t.setText(mark[0]!).setColor(mark[1]!);
    }
  }

  /** Where the guide arrow points in this map: the quest target, or the exit toward it. */
  private computeGuide(): { x: number; y: number } | null {
    const target = this.client.questTarget();
    const here = this.client.map?.id;
    if (!target || !here) return null;
    if (target.map === here) return { x: target.x * TILE_SIZE + TILE_SIZE / 2, y: target.y * TILE_SIZE + TILE_SIZE / 2 };
    // Breadth-first search over portals to find the first exit on the way.
    const prev = new Map<string, { from: string; portal: { x: number; y: number; w: number; h: number } }>();
    const queue = [here];
    const seen = new Set([here]);
    while (queue.length) {
      const id = queue.shift()!;
      if (id === target.map) break;
      for (const p of getMap(id)?.portals ?? []) {
        if (seen.has(p.to)) continue;
        seen.add(p.to);
        prev.set(p.to, { from: id, portal: p });
        queue.push(p.to);
      }
    }
    if (!prev.has(target.map)) return null;
    let cur = target.map;
    let step = prev.get(cur)!;
    while (step.from !== here) {
      cur = step.from;
      step = prev.get(cur)!;
    }
    const p = step.portal;
    return { x: (p.x + p.w / 2) * TILE_SIZE, y: (p.y + p.h / 2) * TILE_SIZE };
  }

  private drawGuide(time: number, px: number, py: number): void {
    const g = this.guide;
    g.clear();
    const t = this.guideTarget;
    if (!t || Math.hypot(t.x - px, t.y - py) < 40) return;
    const view = this.cameras.main.worldView;
    const bob = Math.sin(time / 180) * 4;
    if (view.contains(t.x, t.y - 20)) {
      // Bouncing marker above the target.
      const y = t.y - 40 + bob;
      g.fillStyle(0x2a2030, 1).fillTriangle(t.x - 11, y - 3, t.x + 11, y - 3, t.x, y + 12);
      g.fillStyle(0xffe48a, 1).fillTriangle(t.x - 8, y - 1, t.x + 8, y - 1, t.x, y + 9);
      return;
    }
    // Off-screen: an arrow at the edge of the view pointing toward it.
    const cx = view.centerX;
    const cy = view.centerY;
    const ang = Math.atan2(t.y - cy, t.x - cx);
    const m = 34;
    const hw = view.width / 2 - m;
    const hh = view.height / 2 - m;
    const k = Math.min(hw / Math.abs(Math.cos(ang) || 1e-6), hh / Math.abs(Math.sin(ang) || 1e-6));
    const ax = cx + Math.cos(ang) * (k + bob * 0.5);
    const ay = cy + Math.sin(ang) * (k + bob * 0.5);
    const pt = (r: number, a: number) => ({ x: ax + Math.cos(ang + a) * r, y: ay + Math.sin(ang + a) * r });
    const tip = pt(16, 0);
    const l = pt(12, 2.4);
    const r2 = pt(12, -2.4);
    g.fillStyle(0x2a2030, 0.9).fillCircle(ax, ay, 15);
    g.fillStyle(0xffe48a, 1).fillTriangle(tip.x, tip.y, l.x, l.y, r2.x, r2.y);
  }

  /** Tiny dust puff where an action happened. */
  private puff(tx: number, ty: number): void {
    const cx = tx * TILE_SIZE + TILE_SIZE / 2;
    const cy = ty * TILE_SIZE + TILE_SIZE / 2;
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      const dot = this.add.rectangle(cx, cy, 4, 4, i % 2 ? 0xc9a36b : 0xe8dcc0).setDepth(LABEL_DEPTH - 5);
      this.tweens.add({ targets: dot, x: cx + Math.cos(a) * 14, y: cy + Math.sin(a) * 10 - 6, alpha: 0, duration: 380, onComplete: () => dot.destroy() });
    }
  }

  private addMonster(m: RemoteMonster): void {
    if (!this.client.map || this.monsterViews.has(m.info.id)) return;
    const md = this.monsterDef(m.info.monsterId);
    const elite = !!m.info.elite;
    const scale = md.size * (elite ? 1.25 : 1);
    const sprite = this.add.sprite(m.x, m.y + 2, '__DEFAULT').setOrigin(0.5, 1).setVisible(false);
    if (elite) sprite.postFX?.addGlow(0xffb02e, 2, 0, false, 0.1, 8);
    const lvl = this.client.ui.get().self?.level ?? 1;
    const diff = m.info.level - lvl;
    const color = elite ? '#ffb02e' : diff >= 10 ? '#ff5a5a' : diff >= 5 ? '#ff9a3a' : diff >= 2 ? '#ffe48a' : diff <= -6 ? '#9a9a9a' : '#ffffff';
    const label = this.add
      .text(m.x, m.y - 40, `${elite ? '★ ' : ''}${m.info.name} · Lv ${m.info.level}`, { fontFamily: LABEL_FONT, fontSize: elite ? '12px' : '11px', fontStyle: elite ? 'bold' : 'normal', color, stroke: '#2a2030', strokeThickness: 3 })
      .setOrigin(0.5, 1)
      .setResolution(TEXT_RES)
      .setDepth(LABEL_DEPTH - 2);
    const bar = this.add.graphics().setDepth(LABEL_DEPTH - 2);
    const view = { sprite, label, bar, frameW: 32, scale, hd: null as string | null };
    this.monsterViews.set(m.info.id, view);
    const key = `hd:mon:${m.info.monsterId}`;
    void this.hd.ensure(key, () => bakeCreature('monster', m.info.monsterId, md.shape, md.color, md.size, 3)).then((ok) => {
      if (!sprite.active) return;
      if (ok) {
        const info = this.hd.get(key)!;
        sprite.setTexture(key, 0).setOrigin(0.5, 1 - (info.meta?.foot ?? 10) / (info.meta?.h ?? 48)).setScale((elite ? 1.25 : 1) / BAKE_RES);
        view.hd = key;
        view.frameW = info.meta?.w ?? 48;
      } else {
        // Fallback: the classic sprite.
        const pk = `mon:${m.info.monsterId}`;
        if (!this.textures.exists(pk)) {
          const sheet = monsterSheet(md.shape, md.color);
          const tex = this.textures.addCanvas(pk, sheet.canvas)!;
          tex.add(0, 0, 0, 0, sheet.w * 2, sheet.h * 2);
          tex.add(1, 0, sheet.w * 2, 0, sheet.w * 2, sheet.h * 2);
        }
        sprite.setTexture(pk, 0).setOrigin(0.5, 1).setScale(scale);
      }
      sprite.setVisible(true).setAlpha(0);
      this.tweens.add({ targets: sprite, alpha: 1, duration: 220 });
    });
  }

  /** Which HD frame a monster shows. */
  private monsterFrame(v: { sprite: Phaser.GameObjects.Sprite; hd?: string | null; attackAt?: number; hurtAt?: number }, dir: Direction, moving: boolean, time: number, seed: number): void {
    if (!v.hd) return;
    const A = CREATURE_ANIMS;
    let col: number;
    const atk = time - (v.attackAt ?? -1e9);
    const hurt = time - (v.hurtAt ?? -1e9);
    if (atk < 360) col = A.attack.start + Math.min(A.attack.n - 1, Math.floor((atk / 360) * A.attack.n));
    else if (hurt < 160) col = A.hurt.start;
    else if (moving) col = A.walk.start + (Math.floor((time + seed) / 95) % A.walk.n);
    else col = A.idle.start + (Math.floor((time + seed) / 230) % A.idle.n);
    const row = dir === 'down' ? 0 : dir === 'up' ? 2 : 1;
    this.hd.get(v.hd);
    v.sprite.setFrame(row * CREATURE_COLS + col).setFlipX(dir === 'left');
  }

  private monsterArt = new Map<string, { shape: string; color: string; size: number }>();
  private monsterDef(id: string): { shape: string; color: string; size: number } {
    let a = this.monsterArt.get(id);
    if (!a) {
      a = MONSTER_ART(id);
      this.monsterArt.set(id, a);
    }
    return a;
  }

  private removeMonster(id: string): void {
    const v = this.monsterViews.get(id);
    if (!v) return;
    this.monsterViews.delete(id);
    v.shadow?.destroy();
    v.label.destroy();
    v.bar.destroy();
    this.tweens.add({ targets: v.sprite, alpha: 0, duration: 300, onComplete: () => v.sprite.destroy() });
  }

  private entityPos(id: string): { x: number; y: number; h: number } | null {
    const self = this.client.ui.get().self;
    if (self && id === self.characterId) return { x: this.client.pos.x, y: this.client.pos.y, h: 54 };
    const mv = this.monsterViews.get(id);
    if (mv) return { x: mv.sprite.x, y: mv.sprite.y, h: mv.sprite.displayHeight };
    const r = this.remotes.get(id);
    if (r) return { x: r.sprite.x, y: r.sprite.y, h: 54 };
    return null;
  }

  /** A boss winds up: a red circle fills in, then flashes on impact. Step out! */
  private showTelegraph(t: { x: number; y: number; r: number; ms: number; name: string }): void {
    audio.sfx('telegraph');
    this.time.delayedCall(t.ms, () => audio.sfx('boom'));
    const ring = this.add.circle(t.x, t.y, t.r, 0xe0483a, 0.12).setStrokeStyle(2, 0xff6a5a, 0.9).setDepth(-3);
    const fill = this.add.circle(t.x, t.y, t.r, 0xe0483a, 0.35).setDepth(-3).setScale(0.05);
    const label = this.add
      .text(t.x, t.y - t.r - 6, t.name, { fontFamily: LABEL_FONT, fontSize: '12px', color: '#ffb0a0', stroke: '#2a2030', strokeThickness: 3 })
      .setOrigin(0.5, 1)
      .setResolution(TEXT_RES)
      .setDepth(LABEL_DEPTH + 20);
    this.tweens.add({
      targets: fill,
      scale: 1,
      duration: t.ms,
      onComplete: () => {
        ring.destroy();
        label.destroy();
        fill.setFillStyle(0xffd0a0, 0.8);
        this.cameras.main.shake(160, 0.004);
        this.tweens.add({ targets: fill, alpha: 0, scale: 1.15, duration: 280, onComplete: () => fill.destroy() });
      },
    });
  }

  /** Floating numbers for hits, crits, misses and heals, plus the attack effects. */
  private showCombat(events: CombatEvent[]): void {
    const me = this.client.ui.get().self?.characterId;
    const opts = fxSettings();
    for (const e of events) {
      if (e.sk === 'petguard') {
        this.petGuardHit(e.t, e.a);
        continue;
      }
      if (e.k === 'cast') {
        if (e.s === me) audio.sfx(['war_cry', 'evasion', 'hunters_mark', 'whirlwind', 'volley'].includes(e.sk ?? '') ? 'hit' : 'magic');
      } else if (e.s === me && e.t !== me) {
        if (e.k === 'crit') audio.sfx('crit');
        else if (e.k === 'hit') audio.sfx(e.sk && ['fireball', 'smite', 'frost_nova', 'arcane'].some((k) => e.sk!.includes(k)) ? 'magic' : 'hit');
        else if (e.k === 'miss') audio.sfx('miss');
      } else if (e.t === me) {
        if (e.k === 'hit' || e.k === 'crit') audio.sfx('hurt');
        else if (e.k === 'heal') audio.sfx('heal');
      } else if (e.k === 'death' && e.t === this.client.ui.get().targetId) audio.sfx('death');
      const pos = this.entityPos(e.t);
      if (!pos) continue;
      // Body language: attackers strike or cast, targets flinch, the defeated fall.
      const now = this.time.now;
      const srcAv = this.avatarOf(e.s);
      const tgtAv = this.avatarOf(e.t);
      const companion = e.sk === 'pet' || e.sk === 'hawk';
      if (companion && e.s !== e.t) this.companionStrike(e.s, e.sk === 'hawk', pos.x, pos.y);
      if (HAWK_SKILLS.has(e.sk ?? '')) this.companionStrike(e.s, true, pos.x, pos.y);
      // (My own basic attacks already posed when the button was pressed.)
      const predicted = e.s === me && !e.sk && now - this.predictedSwingAt < 700;
      if (srcAv && !companion && !predicted && e.k !== 'death' && e.k !== 'dot') this.pose(srcAv, e.sk ? 420 : 340, e.s !== e.t ? pos : undefined, e.sk && (e.s === e.t || e.k === 'heal' || e.k === 'cast') ? 'cast' : 'attack');
      // Hit-stop: a tiny freeze on my crits and kills sells the impact.
      if (opts.shake && e.s === me && e.k === 'crit') this.freezeUntil = performance.now() + 60;
      if (opts.shake && e.k === 'death' && this.lastKillTarget === e.t) this.freezeUntil = performance.now() + 75;
      if (e.s === me && (e.k === 'hit' || e.k === 'crit')) this.lastKillTarget = e.t;
      // Knock the monster's sprite back a few pixels (visual only).
      const kv = this.monsterViews.get(e.t);
      const src = this.entityPos(e.s);
      if (kv && src && (e.k === 'hit' || e.k === 'crit') && e.s !== e.t) {
        const a = Math.atan2(pos.y - src.y, pos.x - src.x);
        const d = e.k === 'crit' ? 6 : 3;
        kv.kick = { x: Math.cos(a) * d, y: Math.sin(a) * d * 0.6, until: now + 140 };
        kv.hurtAt = now;
      }
      const sv = this.monsterViews.get(e.s);
      if (sv && e.s !== e.t && e.k !== 'death' && e.k !== 'dot') sv.attackAt = now;
      if (tgtAv && (e.k === 'hit' || e.k === 'crit')) tgtAv.hurtUntil = now + (e.k === 'crit' ? 260 : 170);
      if (tgtAv && e.k === 'death') tgtAv.deadUntil = now + 1800;
      if (e.k === 'death') {
        if (opts.level !== 'off') this.deathFx(e.t, pos);
        continue;
      }
      try {
        this.attackFx(e, opts);
        this.spellFxFor(e, opts);
      } catch (err) {
        // Effects are decoration; never let them break the game.
        console.warn('[fx]', err);
      }
      if (e.k === 'cast') continue;
      const mine = e.t === me;
      if (opts.numbers) {
        const pet = e.sk === 'pet' || e.sk === 'hawk';
        const kind =
          e.k === 'miss' ? 'miss'
          : e.k === 'heal' ? 'heal'
          : e.k === 'dot' ? 'dot'
          : mine ? 'taken'
          : e.s === me ? (e.k === 'crit' ? 'crit' : 'hit')
          : 'other';
        this.spell.number(e.t, pos, e.a, kind, { pet });
      }
      const mv = this.monsterViews.get(e.t);
      if (mv && (e.k === 'hit' || e.k === 'crit' || e.k === 'dot')) {
        mv.sprite.setTintFill(0xffffff);
        this.time.delayedCall(70, () => mv.sprite.clearTint());
      }
    }
  }

  /** The weapon an entity holds: type, icon texture and tier. Monsters have none. */
  private weaponOf(id: string): { type: WeaponType; icon: string; tier: number } | null {
    const self = this.client.ui.get().self;
    let itemId: string | null | undefined;
    if (self && id === self.characterId) itemId = this.client.ui.get().inventory?.equipment?.find((x) => x.slot === 0)?.itemId;
    else if (this.client.remotes.has(id)) itemId = this.client.remotes.get(id)!.info.weapon;
    else return null;
    const def = itemId ? getItem(itemId) : undefined;
    const type = def?.equip?.weapon as WeaponType | undefined;
    if (!def || !type || type === 'shield') return { type: 'fist', icon: '', tier: 0 };
    const tier = Number(def.icon.split(':')[2]) || 0;
    return { type, icon: this.canvasTexture(`icon:${def.icon}`, () => itemIcon(def.icon, 2)), tier };
  }

  private avatarOf(id: string): Avatar | null {
    const self = this.client.ui.get().self;
    if (self && id === self.characterId) return this.local;
    return this.remotes.get(id) ?? null;
  }

  /** Hide the in-hand weapon while the swing copy is on screen. */
  private swinging = new Map<string, number>();

  /** Spell colours per skill. */
  private static SKILL_COLOR: Record<string, SpellColors> = {
    fireball: SPELL.fire, meteor: SPELL.fire, power_strike: SPELL.fire, war_cry: SPELL.blood, bloodlust: SPELL.blood, cleave: SPELL.blood, whirlwind: SPELL.blood,
    frost_nova: SPELL.frost, arcane_shield: SPELL.arcane, chain_lightning: SPELL.storm,
    smite: SPELL.holy, holy_light: SPELL.holy, judgment: SPELL.holy, holy_strike: SPELL.holy, blessing: SPELL.holy, sanctuary: SPELL.holy, divine_shield: SPELL.holy, purge: SPELL.holy, heal: SPELL.nature,
    life_drain: SPELL.shadow, curse: SPELL.shadow,
    aimed_shot: SPELL.arcane, piercing_arrow: SPELL.arcane, volley: SPELL.nature, arrow_storm: SPELL.nature, hunters_mark: SPELL.fire, poison_blade: SPELL.nature, backstab: SPELL.shadow,
    falcon_strike: SPELL.storm, blind_blitz: SPELL.storm, hunters_eye: SPELL.storm,
  };

  /**
   * The flashy layer on top of the basic attack effects: skill-name callouts,
   * rune circles under casters, lightning, meteors, pillars of light, splashes.
   */
  private spellFxFor(e: CombatEvent, opts: FxSettings): void {
    if (opts.level === 'off' || e.k === 'dot' || e.k === 'death') return;
    const full = opts.level === 'full';
    const sp = this.spell;
    const from = this.entityPos(e.s);
    const to = this.entityPos(e.t) ?? from;
    if (!to) return;
    const chest = (s: { x: number; y: number; h: number }) => ({ x: s.x, y: s.y - s.h * 0.5 });
    // Monster abilities.
    if (e.sk?.startsWith('monster_')) {
      if (e.sk === 'monster_explode') return sp.explosion(to, 2 * TILE_SIZE, SPELL.fire);
      if (e.sk === 'monster_summon' && from) return sp.magicCircle(from, SPELL.shadow, 34, 900);
      if (e.sk === 'monster_charge' && from) return sp.shockwave(from, SPELL.blood, 24);
      if (e.sk === 'monster_heal') return sp.shockwave(to, SPELL.nature, 20);
      return;
    }
    const sk = e.sk && e.sk !== 'pet' && e.sk !== 'hawk' && e.sk !== 'petguard' ? getSkillDef(e.sk) : undefined;
    if (!sk) {
      // Plain staff / wand bolts from players land in a swirling splash.
      if (from && e.k !== 'miss' && e.k !== 'heal' && full) {
        const w = this.weaponOf(e.s);
        if (w && (w.type === 'staff' || w.type === 'wand')) this.time.delayedCall(240, () => sp.vortex(chest(to), e.k === 'crit' ? SPELL.frost : SPELL.arcane, e.k === 'crit' ? 1.3 : 0.8));
      }
      return;
    }
    const c = WorldScene.SKILL_COLOR[sk.id] ?? (sk.magic ? SPELL.arcane : SPELL.blood);
    if (from && (e.k === 'cast' || sk.kind === 'attack' || sk.kind === 'heal' || sk.kind === 'debuff')) sp.callout(e.s, from, `${sk.name}!`, c);
    const T = TILE_SIZE;
    if (e.k === 'cast') {
      if (!from) return;
      if (e.s === this.client.ui.get().self?.characterId) audio.sfx('spell');
      switch (sk.id) {
        case 'frost_nova':
          return sp.iceSpikes(from, 2.2 * T);
        case 'meteor':
          sp.magicCircle(from, c, 30, 700);
          return sp.meteor(to, 2.2 * T);
        case 'cleave':
          return sp.bigSlash(from, c, 2 * T * 0.75);
        case 'war_cry':
        case 'bloodlust':
          sp.magicCircle(from, c, 34, 800);
          return sp.shockwave(from, c, 2 * T);
        case 'purge':
          sp.magicCircle(from, c, 2.2 * T, 800);
          return sp.shockwave(from, c, 2.2 * T);
        case 'sanctuary':
          sp.magicCircle(from, c, 2 * T, 1100);
          return sp.pillar(from, c, 30);
        case 'curse':
          sp.magicCircle(from, c, 26, 600);
          return sp.hex(to, c);
        case 'life_drain':
          return sp.drain(chest(from), chest(to), c);
        case 'arrow_storm':
        case 'volley':
          return sp.magicCircle(to, c, sk.radius ? sk.radius * T : 2 * T, 700);
        default:
          if (sk.magic || sk.kind === 'buff') sp.magicCircle(from, c, 30, 800);
          return;
      }
    }
    if (e.k === 'miss') return;
    if (from && sk.magic && (sk.kind === 'attack' || sk.kind === 'heal')) sp.magicCircle(from, c, 26, 600);
    switch (sk.id) {
      case 'chain_lightning':
        if (from) sp.lightning(chest(from), chest(to), c, full ? 4 : 1);
        return;
      case 'smite':
      case 'holy_light':
        return void this.time.delayedCall(80, () => sp.pillar(to, c));
      case 'judgment':
      case 'holy_strike':
        sp.pillar(to, c, 18);
        return sp.shockwave(to, c, 40);
      case 'fireball':
        return void this.time.delayedCall(260, () => sp.vortex(chest(to), c, e.k === 'crit' ? 1.3 : 1));
      case 'power_strike':
      case 'piercing_arrow':
        return sp.shockwave(to, c, e.k === 'crit' ? 50 : 36);
      case 'heal':
        return sp.shockwave(to, c, 30);
    }
  }

  /** The struck sprite flashes white for a moment. */
  private hitFlash(id: string): void {
    const sp = this.monsterViews.get(id)?.sprite ?? this.avatarOf(id)?.sprite;
    if (!sp || !sp.active) return;
    sp.setTintFill(0xffffff);
    this.time.delayedCall(70, () => sp.active && sp.clearTint());
  }

  /** A defeated monster bursts into light and its spirit rises. */
  private deathFx(id: string, pos: { x: number; y: number; h: number }): void {
    const v = this.monsterViews.get(id);
    if (!v) return;
    const d = LABEL_DEPTH - 7;
    const cy = pos.y - pos.h * 0.45;
    flash(this, pos.x, cy, 0xfff0c0, 130, d, 380);
    flash(this, pos.x, cy, 0xffffff, 80, d + 1, 260, FX_TEX.flare);
    shockwave(this, pos.x, pos.y - 2, 0xffe48a, 50, d - 2, 460);
    burst(this, pos.x, cy, { tex: FX_TEX.spark, n: 18, color: [0xffe48a, 0xffffff, 0xffb03a], speed: [120, 300], life: [250, 500], scale: [0.3, 0.55], endScale: 0.05, gravity: 380, rotate: true, depth: d });
    burst(this, pos.x, cy, { n: 26, color: [0xbfeaff, 0xffffff, 0xd8b0ff], speed: [10, 60], angle: [230, 310], life: [700, 1300], scale: [0.1, 0.24], gravity: -120, spread: 14, depth: d });
    burst(this, pos.x, pos.y, { tex: FX_TEX.smoke, n: 6, color: [0xe8e0d0], speed: [20, 60], angle: [180, 360], life: [400, 700], scale: [0.4, 0.7], endScale: 1.3, alpha: 0.45, add: false, depth: d - 3 });
    // The body flashes and shrinks away.
    v.sprite.setTintFill(0xffffff);
    this.tweens.add({ targets: v.sprite, scaleX: v.sprite.scaleX * 1.25, scaleY: v.sprite.scaleY * 0.2, alpha: 0, duration: 260, ease: 'Quad.easeIn' });
  }

  /** Level up: a pillar of light, rings and sparkles around the hero. */
  private levelUpFx(x: number, y: number): void {
    const d = LABEL_DEPTH - 7;
    const pillar = this.add.image(x, y + 4, FX_TEX.dot).setTint(0xffe48a).setBlendMode(Phaser.BlendModes.ADD).setOrigin(0.5, 0.95).setDepth(d).setScale(0.2, 0.2);
    this.tweens.add({ targets: pillar, scaleX: 0.9, scaleY: 6, duration: 260, ease: 'Cubic.easeOut', yoyo: true, hold: 500, onComplete: () => pillar.destroy() });
    for (let i = 0; i < 3; i++) this.time.delayedCall(i * 180, () => shockwave(this, x, y, i % 2 ? 0xffffff : 0xffcb52, 60 + i * 16, d - 1, 700));
    flash(this, x, y - 26, 0xffe48a, 160, d + 1, 700);
    burst(this, x, y - 10, { n: 40, color: [0xffe48a, 0xffffff, 0xffcb52], speed: [20, 90], angle: [230, 310], life: [900, 1600], scale: [0.12, 0.26], gravity: -60, spread: 20, depth: d + 1 });
    burst(this, x, y - 20, { tex: FX_TEX.flare, n: 10, color: [0xffffff, 0xffe48a], speed: [40, 120], life: [500, 900], scale: [0.15, 0.3], depth: d + 2 });
    const t = this.add
      .text(x, y - 70, 'LEVEL UP!', { fontFamily: LABEL_FONT, fontSize: '26px', fontStyle: 'bold', color: '#fff3b0', stroke: '#6a3a00', strokeThickness: 7 })
      .setOrigin(0.5)
      .setResolution(TEXT_RES)
      .setDepth(LABEL_DEPTH + 30)
      .setScale(0.3);
    t.setShadow(0, 0, '#ffb000', 16, true, true);
    this.tweens.add({ targets: t, scale: 1, duration: 260, ease: 'Back.easeOut' });
    this.tweens.add({ targets: t, y: t.y - 26, alpha: 0, delay: 1300, duration: 600, onComplete: () => t.destroy() });
    this.cameras.main.flash(180, 255, 236, 170, false);
  }

  /** Little dust puffs at a runner's feet. */
  private footDust(av: Avatar, x: number, y: number, now: number, fast: boolean): void {
    if (now < (av.dustAt ?? 0) || this.gfx === 'classic') return;
    av.dustAt = now + (fast ? 150 : 230);
    if (av === this.local && !av.mount) audio.sfx('step');
    const c = this.outdoors ? 0xe8dcc0 : 0xb8b0c0;
    burst(this, x + (Math.random() * 6 - 3), y, { tex: FX_TEX.smoke, n: 2, color: [c], speed: [6, 22], angle: [190, 350], life: [350, 600], scale: [0.14, 0.24], endScale: 0.4, alpha: 0.5, add: false, depth: y - 2 });
  }

  private attackFx(e: CombatEvent, opts: FxSettings): void {
    if (opts.level === 'off') return;
    const full = opts.level === 'full';
    const fx = this.fx;
    const from = this.entityPos(e.s);
    const to = this.entityPos(e.t)!;
    const me = this.client.ui.get().self?.characterId;
    const w = this.weaponOf(e.s);
    const monster = !w ? this.client.monsters.get(e.s) : undefined;
    const pal = w ? paletteFor(e.s === me ? opts.style : 'weapon', w.tier, this.time.now) : monster && getMonster(monster.info.monsterId)?.magic ? MAGIC_PAL : MONSTER_PAL;
    // HD heroes swing the weapon they hold in the sprite itself.
    const icon = this.avatarOf(e.s)?.hd ? null : w?.icon || null;
    const hold = (ms: number) => this.swinging.set(e.s, this.time.now + ms + 260);
    const shake = () => {
      if (e.s === me && opts.shake) this.cameras.main.shake(140, 0.006);
    };
    const land = (p = pal) => {
      if (e.k === 'miss') fx.whoosh(to);
      else {
        fx.impact(to, p, e.k === 'crit', full);
        this.hitFlash(e.t);
        if (e.k === 'crit') shake();
        else if (e.s === me && opts.shake) this.cameras.main.shake(70, 0.0018);
        else if (e.t === me && opts.shake) this.cameras.main.shake(110, 0.003);
      }
    };
    const melee = (p = pal, big = false) => {
      if (!from || !w) return land(p);
      hold(260);
      if (e.s === me) audio.sfx('swing');
      const ms = fx.swing(e.s, from, to, w.type === 'bow' ? 'fist' : w.type, icon, p, { big, full });
      this.time.delayedCall(ms, () => land(p));
    };

    if (e.k === 'heal') {
      if (from && e.s !== e.t && full) fx.motes(from, 0x9cf06a);
      return fx.heal(to, full);
    }
    if (e.k === 'dot') {
      if (full) fx.bubbles(to, 0x9cf06a);
      return;
    }
    if (e.k === 'cast') {
      if (!from) return;
      switch (e.sk) {
        case 'whirlwind':
          hold(fx.spin(from, icon, pal, 1.8 * TILE_SIZE * 0.6, full));
          return;
        case 'frost_nova':
          return fx.nova(from, ICE_PAL, 2.2 * TILE_SIZE, full);
        case 'volley':
          if (w?.type === 'bow') fx.bow(from, to, icon);
          return fx.rain(to, 2 * TILE_SIZE * 0.7, full);
        case 'hunters_mark':
          if (w?.type === 'bow') fx.bow(from, to, icon);
          return fx.reticle(to, 0xe8a03a);
        case 'war_cry':
          return fx.shout(from, MONSTER_PAL);
        case 'arcane_shield':
          return fx.bubble(from, MAGIC_PAL);
        case 'blessing':
          return fx.motes(from, 0xf2c14e);
        case 'evasion':
          return fx.afterimage(this.avatarOf(e.s)?.sprite ?? null, MAGIC_PAL);
        default:
          return;
      }
    }

    // A pet's bite or the hawk's talons: a quick impact on the target.
    if (e.sk === 'pet' || e.sk === 'hawk') return void this.time.delayedCall(170, () => land(e.sk === 'hawk' ? HAWK_PAL : pal));
    if (HAWK_SKILLS.has(e.sk ?? '')) return void this.time.delayedCall(200, () => land(HAWK_PAL));

    // Damage from an area skill: the cast already drew the big effect; just mark each hit.
    if (e.sk === 'whirlwind') return land();
    if (e.sk === 'frost_nova') return land(ICE_PAL);
    if (e.sk === 'volley') return void this.time.delayedCall(220, () => land());

    if (from) {
      switch (e.sk) {
        case 'power_strike':
          return melee(pal, true);
        case 'poison_blade':
          return melee(POISON_PAL);
        case 'backstab':
          hold(200);
          fx.backstab(from, to, icon, pal, full);
          return void this.time.delayedCall(120, () => land());
        case 'aimed_shot':
          if (w?.type === 'bow') fx.bow(from, to, icon);
          return fx.shoot(from, to, 'arrow', pal, { full, glow: true, onHit: () => land() });
        case 'fireball':
          if (w) fx.raise(from, to, icon, FIRE_PAL);
          return fx.shoot(from, to, 'fire', FIRE_PAL, { full, onHit: () => (e.k === 'miss' ? land() : (fx.explode(to, FIRE_PAL, full), e.k === 'crit' && shake())) });
        case 'smite':
          if (w) fx.raise(from, to, icon, HOLY_PAL);
          return void this.time.delayedCall(80, () => (e.k === 'miss' ? land() : (fx.beam(to, HOLY_PAL, full), land(HOLY_PAL))));
      }
    }

    // Plain attacks.
    if (!w) {
      if (!from) return land();
      if (pal === MAGIC_PAL) return fx.shoot(from, to, 'orb', pal, { full, onHit: () => land() });
      fx.claws(to, pal, (monster && getMonster(monster.info.monsterId)?.boss) || from.h > 60);
      if (full && e.k !== 'miss') fx.sparks(to.x, to.y - to.h * 0.5, pal.spark, 4, 14);
      return;
    }
    if (!from) return land();
    if (w.type === 'bow') {
      fx.bow(from, to, icon);
      hold(220);
      return fx.shoot(from, to, 'arrow', pal, { full, onHit: () => land() });
    }
    if (w.type === 'staff' || w.type === 'wand') {
      fx.raise(from, to, icon, pal);
      hold(260);
      return fx.shoot(from, to, 'orb', pal, { full, onHit: () => land() });
    }
    melee();
  }

  /** A soft white radial glow (tinted per use). */
  private whiteGlowKey(): string {
    return this.canvasTexture('glow_white', () => {
      const c = document.createElement('canvas');
      c.width = c.height = 128;
      const ctx = c.getContext('2d')!;
      const grad = ctx.createRadialGradient(64, 64, 2, 64, 64, 64);
      grad.addColorStop(0, 'rgba(255,255,255,1)');
      grad.addColorStop(0.35, 'rgba(255,255,255,0.5)');
      grad.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, 128, 128);
      return c;
    });
  }

  /** Gear others can see: weapon/armor upgrade level and the back item (wings). */
  private gearOf(id: string): { weaponGlow: number; armorGlow: number; back: string | null } {
    const self = this.client.ui.get().self;
    if (self && id === self.characterId) {
      const eq = this.client.ui.get().inventory?.equipment ?? [];
      const armor = eq.filter((e) => e.slot >= 2 && e.slot <= 5).map((e) => e.enhance ?? 0);
      return { weaponGlow: eq.find((e) => e.slot === 0)?.enhance ?? 0, armorGlow: armor.length ? Math.max(...armor) : 0, back: eq.find((e) => e.slot === 8)?.itemId ?? null };
    }
    const r = this.client.remotes.get(id);
    return { weaponGlow: r?.info.weaponGlow ?? 0, armorGlow: r?.info.armorGlow ?? 0, back: r?.info.back ?? null };
  }

  /** Wings that flap behind the character, and the glow of upgraded gear (+4 blue, +7 purple, +10 radiant gold). */
  private placeGear(av: Avatar, id: string, dir: Direction, moving: boolean, time: number): void {
    const look = this.gearOf(id);
    const s = av.sprite;
    const now = this.time.now;
    const dead = (av.deadUntil ?? 0) > now;
    // --- Wings
    const def = look.back && !av.hd ? getItem(look.back)?.wings : undefined;
    const wkey = def ? `wing:${def.style}:${def.color}` : null;
    if ((av.wingKey ?? null) !== wkey) {
      av.wings?.forEach((w) => w.destroy());
      av.wings = null;
      av.wingKey = wkey;
      if (def && wkey) {
        const tex = this.canvasTexture(wkey, () => wingCanvas(def.style, def.color));
        const alpha = def.style === 'fairy' ? 0.82 : 1;
        av.wings = [this.add.image(0, 0, tex).setOrigin(0, 0.6).setAlpha(alpha), this.add.image(0, 0, tex).setFlipX(true).setOrigin(1, 0.6).setAlpha(alpha)];
      }
    }
    if (av.wings) {
      const side = dir === 'left' || dir === 'right';
      const flap = 0.8 + (moving ? 0.22 : 0.1) * Math.sin(time / (moving ? 85 : 240));
      const sx = side ? 0.5 : 1;
      const back = dir === 'right' ? -5 : dir === 'left' ? 5 : 0;
      const y = s.y - 30;
      const [right, left] = av.wings;
      // Raised and angled up from the shoulder blades; they beat faster while moving.
      const tilt = -0.32 - (flap - 0.8) * 0.6;
      right.setPosition(s.x + 3 + back, y).setScale(flap * sx * 0.85, 0.85).setRotation(tilt).setDepth(dir === 'up' ? s.depth + 0.02 : s.depth - 0.02).setVisible(!dead);
      left.setPosition(s.x - 3 + back, y).setScale(flap * sx * 0.85, 0.85).setRotation(-tilt).setDepth(dir === 'up' ? s.depth + 0.02 : s.depth - 0.02).setVisible(!dead);
    }
    // --- Armor aura
    const ta = glowTier(look.armorGlow);
    if (ta && !dead) {
      av.aura ??= this.add.image(0, 0, this.whiteGlowKey()).setBlendMode(Phaser.BlendModes.ADD);
      av.aura
        .setPosition(s.x, s.y - 20)
        .setTint(GLOW_COLOR[ta])
        .setScale(0.35 + ta * 0.08, 0.5 + ta * 0.08)
        .setAlpha(0.18 + ta * 0.07 + Math.sin(time / 400) * 0.06)
        .setDepth(s.depth - 0.03);
    } else if (av.aura) {
      av.aura.destroy();
      av.aura = null;
    }
    // --- Weapon glow (follows the weapon in hand)
    const tw = glowTier(look.weaponGlow);
    const hand = av.hand && av.hand.visible ? av.hand : null;
    const hdHand = av.hd && fxSettings().handWeapon ? { x: s.x + (dir === 'left' ? -11 : dir === 'right' ? 11 : dir === 'down' ? -10 : 10), y: s.y - 6, depth: s.depth + 0.01, flipX: false } : null;
    const at = hand ?? hdHand;
    if (tw && at && !dead) {
      av.weaponGlow ??= this.add.image(0, 0, this.whiteGlowKey()).setBlendMode(Phaser.BlendModes.ADD);
      const flip = at.flipX ? -1 : 1;
      const gx = at.x + flip * 7;
      const gy = at.y - 8;
      av.weaponGlow
        .setPosition(gx, gy)
        .setTint(GLOW_COLOR[tw])
        .setScale(0.16 + tw * 0.07)
        .setAlpha(0.45 + tw * 0.12 + Math.sin(time / 180) * 0.12)
        .setDepth(at.depth + 0.01);
      // +10: radiant sparkles drifting off the blade.
      if (tw === 3 && now > (av.nextSparkle ?? 0)) {
        av.nextSparkle = now + 160;
        const sp = this.add.rectangle(gx + (Math.random() * 12 - 6), gy + (Math.random() * 12 - 6), 2, 2, Math.random() < 0.5 ? 0xffffff : 0xffe48a).setDepth(LABEL_DEPTH - 8).setBlendMode(Phaser.BlendModes.ADD);
        this.tweens.add({ targets: sp, y: sp.y - 14, alpha: 0, duration: 700, onComplete: () => sp.destroy() });
      }
    } else if (av.weaponGlow) {
      av.weaponGlow.destroy();
      av.weaponGlow = null;
    }
  }

  /** Draw each character's equipped weapon in their hand. */
  private placeHand(av: Avatar, id: string, dir: Direction, moving: boolean, time: number, show: boolean): void {
    // HD heroes hold their real weapon in the baked sprite.
    if (av.hd) show = false;
    const w = show && (this.swinging.get(id) ?? 0) < this.time.now ? this.weaponOf(id) : null;
    const icon = w && w.type !== 'fist' ? w.icon : null;
    if ((av.handKey ?? null) !== icon) {
      av.hand?.destroy();
      av.hand = icon ? this.add.image(0, 0, icon).setScale(0.68) : null;
      av.handKey = icon;
    }
    if (!av.hand || !w) return;
    const s = av.sprite;
    const bob = moving && !av.mount ? (Math.floor(time / 130) % 2) * -1 : 0;
    const base = s.y - 15 + bob;
    const bow = w.type === 'bow';
    av.hand.setFlipX(dir === 'left');
    if (bow) av.hand.setOrigin(0.5, 0.6);
    else av.hand.setOrigin(dir === 'left' ? 0.88 : 0.12, 0.88);
    const lay = {
      down: { x: -9, r: bow ? 0 : -0.15, d: 0.01 },
      up: { x: 9, r: bow ? 0 : -0.15, d: -0.01 },
      right: { x: 3, r: bow ? 0 : 0.35, d: 0.01 },
      left: { x: -3, r: bow ? 0 : -0.35, d: 0.01 },
    }[dir];
    av.hand.setPosition(s.x + lay.x, base).setRotation(lay.r).setDepth(s.depth + lay.d);
  }

  private addRemote(r: RemotePlayer): void {
    if (!this.client.map || this.remotes.has(r.info.id)) return;
    const av = this.makeAvatar(r.x, r.y, r.info.appearance, remoteLabel(r.info), '#ffffff');
    this.remotes.set(r.info.id, av);
    this.setAvatarMount(av, r.info.mount, r.info.mountLook);
  }

  private removeRemote(id: string): void {
    const av = this.remotes.get(id);
    if (av) this.destroyAvatar(av);
    this.remotes.delete(id);
  }

  private showBubble(m: ChatMessage): void {
    if (m.channel !== 'local' || !m.fromId) return;
    const av = m.fromId === this.client.ui.get().self?.characterId ? this.local : this.remotes.get(m.fromId);
    if (!av) return;
    av.bubbleTimer?.remove();
    av.bubble?.destroy();
    const text = this.add.text(0, 0, m.text, {
      fontFamily: LABEL_FONT,
      fontSize: '12px',
      color: '#2a2030',
      wordWrap: { width: 170, useAdvancedWrap: true },
      align: 'center',
    });
    text.setResolution(TEXT_RES).setOrigin(0.5, 1);
    const w = Math.ceil(text.width) + 12;
    const h = Math.ceil(text.height) + 8;
    const g = this.add.graphics();
    g.fillStyle(0x2a2030, 1).fillRect(-w / 2 - 2, -h - 2, w + 4, h + 4);
    g.fillStyle(0xfffaf0, 1).fillRect(-w / 2, -h, w, h);
    g.fillStyle(0x2a2030, 1).fillTriangle(-5, 1, 5, 1, 0, 7);
    g.fillStyle(0xfffaf0, 1).fillTriangle(-3, -1, 3, -1, 0, 4);
    text.setPosition(0, -4);
    av.bubble = this.add.container(0, 0, [g, text]).setDepth(LABEL_DEPTH + 2);
    av.bubbleTimer = this.time.delayedCall(CHAT.bubbleMs, () => {
      av.bubble?.destroy();
      av.bubble = null;
    });
  }

  // ---------------------------------------------------------------------------
  // Frame loop
  // ---------------------------------------------------------------------------

  private readInput(): MoveInput {
    const ui = this.client.ui.get();
    if (isTyping() || ui.dialogue) return { dx: 0, dy: 0 };
    const k = this.keys;
    let dx = (k.right.isDown || k.d.isDown ? 1 : 0) - (k.left.isDown || k.a.isDown ? 1 : 0);
    let dy = (k.down.isDown || k.s.isDown ? 1 : 0) - (k.up.isDown || k.w.isDown ? 1 : 0);
    if (dx === 0 && dy === 0 && touchInput.active) ({ dx, dy } = joystickToInput(touchInput.joyX, touchInput.joyY));
    return { dx: dx as MoveInput['dx'], dy: dy as MoveInput['dy'] };
  }

  private placeAvatar(av: Avatar, x: number, y: number, dir: Direction, moving: boolean, time: number, opts: { sit?: boolean; speed?: number } = {}): void {
    const now = this.time.now;
    let rx = Math.round(x);
    let ry = Math.round(y);
    const lift = av.mount ? (av.mountHd ? (av.mountLift ?? 10) : 14) : 0;
    // Faster characters (speed boosts) run: the walk cycle speeds up with them.
    const stepMs = 130 / Math.max(0.6, Math.min(2.2, opts.speed ?? 1));
    let col = av.mount ? 0 : moving ? WALK_CYCLE[Math.floor(time / stepMs) % 4]! : 0;
    if (!moving && opts.sit && !av.mount) col = FRAME_SIT;
    if ((av.actionUntil ?? 0) > now && !av.mount) col = FRAME_ACTION;
    if (av.lunge && av.lunge.until > now) {
      const k = (av.lunge.until - now) / 220;
      rx += Math.round(av.lunge.x * Math.sin(k * Math.PI));
      ry += Math.round(av.lunge.y * Math.sin(k * Math.PI));
    }
    let shownDir = dir;
    if ((av.danceUntil ?? 0) > now) {
      ry -= Math.round(Math.abs(Math.sin(now / 110)) * 6);
      shownDir = (['down', 'left', 'up', 'right'] as Direction[])[Math.floor(now / 220) % 4]!;
      col = Math.floor(now / 220) % 2 ? FRAME_ACTION : 0;
    }
    const hurt = (av.hurtUntil ?? 0) > now;
    const dead = (av.deadUntil ?? 0) > now;
    if (hurt) rx += Math.round(Math.sin(now / 12) * 2);
    if (av.hd) {
      const acting = (av.actionUntil ?? 0) > now && !av.mount;
      const anim: HeroAnim = dead ? 'dead' : av.mount ? 'ride' : acting ? (av.actionKind ?? 'attack') : !moving && opts.sit ? 'sit' : hurt ? 'hurt' : moving ? 'walk' : 'idle';
      av.sprite.setPosition(rx, ry + 2 - lift).setDepth(y + 0.5);
      if (moving && !dead) this.footDust(av, rx, ry + 2, now, (opts.speed ?? 1) > 1.3 || !!av.mount);
      this.heroFrame(av, shownDir, (av.danceUntil ?? 0) > now ? 'idle' : anim, time, opts.speed ?? 1);
    } else av.sprite.setPosition(rx, ry + 2 - lift).setFrame(DIR_ROW[shownDir] * CHAR_FRAMES_PER_DIR + col).setDepth(y + 0.5);
    if (!av.shadow) av.shadow = this.add.image(rx, ry, this.blobKey()).setDepth(-4);
    av.shadow.setPosition(rx + 4, ry + 3).setScale(av.mount ? 1 : 0.55, av.mount ? 0.7 : 0.5).setVisible(this.gfx !== 'classic' && !dead);
    // Taking damage flashes red; a fallen character lies down, greyed.
    if (hurt || dead) {
      av.sprite.setTint(dead ? 0x9a9aa8 : 0xff7a6a);
      av.tinted = true;
    } else if (av.tinted) {
      av.sprite.clearTint();
      av.tinted = false;
    }
    const k = av.hd ? 1 / BAKE_RES : 1;
    av.sprite.setRotation(dead && !av.hd ? (dir === 'left' ? -Math.PI / 2 : Math.PI / 2) : 0);
    av.sprite.setScale(k, ((av.bowUntil ?? 0) > now ? 0.86 : 1) * k);
    if (av.hd && dead) av.sprite.setTint(0xb8b8c8);
    if (av.mount && av.mountHd) {
      av.mount.setPosition(rx, ry + 3).setDepth(dir === 'up' ? y + 1 : y);
      this.monsterFrame({ sprite: av.mount, hd: av.mountHd }, dir, moving, time, 0);
    } else if (av.mount && av.mount.texture.key !== '__DEFAULT') av.mount.setPosition(rx, ry + 4).setFlipX(dir === 'left').setFrame(moving ? Math.floor(time / 110) % 2 : 0).setDepth(dir === 'up' ? y + 1 : y);
    if (moving) this.mountTrail(av, rx, ry + 4, now);
    const sitDrop = col === FRAME_SIT ? 6 : 0;
    av.label.setPosition(rx, ry - 58 - lift + sitDrop);
    av.bubble?.setPosition(rx, ry - 72 - lift + sitDrop);
    av.emote?.setPosition(rx, ry - 76 - lift + sitDrop + Math.round(Math.sin(now / 160) * 2));
    if (av.hand) av.hand.setVisible(col !== FRAME_SIT && !dead && (av.danceUntil ?? 0) <= now);
  }

  /** Strike/cast/work pose for a moment, with a small lunge toward a point. */
  private pose(av: Avatar | null, ms: number, toward?: { x: number; y: number }, kind: HeroAnim = 'attack'): void {
    if (!av) return;
    const now = this.time.now;
    av.actionUntil = now + ms;
    av.actionAt = now;
    av.actionMs = ms;
    av.actionKind = kind;
    if (toward) {
      const a = Math.atan2(toward.y - av.sprite.y, toward.x - av.sprite.x);
      av.lunge = { x: Math.cos(a) * 4, y: Math.sin(a) * 3, until: now + 220 };
    }
  }

  /** An emote bubble above someone's head (and dance/bow moves). */
  private showEmote(id: string, emote: string): void {
    const av = this.avatarOf(id);
    if (!av) return;
    const now = this.time.now;
    if (emote === 'dance') av.danceUntil = now + 2200;
    if (emote === 'bow') av.bowUntil = now + 900;
    if (emote === 'wave' || emote === 'cheer') av.actionUntil = now + 700;
    const icon = emoteIcon(emote);
    if (!icon) return;
    av.emote?.destroy();
    const img = this.add.image(av.sprite.x, av.sprite.y - 64, this.canvasTexture(`emote:${emote}`, () => icon)).setOrigin(0.5, 1).setDepth(LABEL_DEPTH + 4).setScale(0.3);
    av.emote = img;
    this.tweens.add({ targets: img, scale: 1, duration: 160, ease: 'Back.easeOut' });
    this.time.delayedCall(2600, () => {
      if (av.emote !== img) return;
      this.tweens.add({ targets: img, alpha: 0, duration: 250, onComplete: () => img.destroy() });
      av.emote = null;
    });
  }

  /** Tool for a work swing: the held tool, else whatever fits the tile. */
  private toolIcon(itemId: string | null, tx: number, ty: number): string | null {
    let icon = itemId ? getItem(itemId)?.icon : undefined;
    if (!icon) {
      const at = this.client.objectAt(tx, ty);
      if (at?.kind === 'node') icon = at.type.startsWith('rock') ? 'tool:pickaxe:0' : at.type.startsWith('tree') ? 'tool:axe:0' : 'tool:sickle:0';
      else if (at?.kind === 'plot') icon = 'tool:hoe:0';
    }
    if (!icon) return null;
    return this.canvasTexture(`icon:${icon}`, () => itemIcon(icon!, 2));
  }

  private animalSprites: Phaser.GameObjects.Image[] = [];
  private pets = new Map<string, { item: string; stage: number; sprite: Phaser.GameObjects.Sprite; strike?: { x: number; y: number; at: number }; hd?: string | null; attackAt?: number }>();
  /** Beastmasters' hawks, by owner. */
  private hawks = new Map<string, { sprite: Phaser.GameObjects.Sprite; strike?: { x: number; y: number; at: number } }>();

  /** A pet took a hit for its owner: flash it and show the damage over it. */
  private petGuardHit(ownerId: string, amount: number): void {
    const c = this.pets.get(ownerId) ?? this.hawks.get(ownerId);
    if (!c) return;
    c.sprite.setTintFill(0xff9a8a);
    this.time.delayedCall(110, () => c.sprite.clearTint());
    if (!fxSettings().numbers) return;
    const t = this.add
      .text(c.sprite.x, c.sprite.y - c.sprite.displayHeight - 2, `🛡${amount}`, { fontFamily: LABEL_FONT, fontSize: '12px', color: '#9ad0ff', stroke: '#2a2030', strokeThickness: 4 })
      .setOrigin(0.5, 1)
      .setResolution(TEXT_RES)
      .setDepth(LABEL_DEPTH + 30);
    this.tweens.add({ targets: t, y: t.y - 20, alpha: 0, duration: 800, onComplete: () => t.destroy() });
  }

  /** Send a companion (pet or hawk) diving at a target for a moment. */
  private companionStrike(ownerId: string, hawk: boolean, x: number, y: number): void {
    const c = hawk ? this.hawks.get(ownerId) : this.pets.get(ownerId);
    if (c) c.strike = { x, y, at: this.time.now };
  }

  /** Hawks circle above their Beastmaster and dive when it attacks. */
  private updateHawks(time: number): void {
    const want = new Map<string, { x: number; y: number }>();
    const self = this.client.ui.get().self;
    if (self?.job === 'beastmaster' && this.local) want.set(self.characterId, { x: this.local.sprite.x, y: this.local.sprite.y });
    for (const [id, r] of this.client.remotes) {
      const av = this.remotes.get(id);
      if (r.info.job === 'beastmaster' && av) want.set(id, { x: av.sprite.x, y: av.sprite.y });
    }
    for (const [id, h] of this.hawks)
      if (!want.has(id)) {
        h.sprite.destroy();
        this.hawks.delete(id);
      }
    const key = 'pet:hawk';
    if (want.size && !this.textures.exists(key)) {
      const sheet = monsterSheet('bat', '#8a5a2a');
      const tex = this.textures.addCanvas(key, sheet.canvas)!;
      tex.add(0, 0, 0, 0, sheet.w * 2, sheet.h * 2);
      tex.add(1, 0, sheet.w * 2, 0, sheet.w * 2, sheet.h * 2);
    }
    for (const [id, w] of want) {
      let h = this.hawks.get(id);
      if (!h) {
        h = { sprite: this.add.sprite(w.x, w.y - 60, key, 0).setOrigin(0.5, 1).setScale(0.62).setTint(0xd8b080) };
        this.hawks.set(id, h);
      }
      const sp = h.sprite;
      // Circle lazily above the owner's head.
      let tx = w.x + Math.cos(time / 900 + id.length) * 22;
      let ty = w.y - 52 + Math.sin(time / 450) * 5;
      if (h.strike) {
        const k = (this.time.now - h.strike.at) / 420;
        if (k >= 1) h.strike = undefined;
        else {
          const dive = Math.sin(k * Math.PI);
          tx = tx + (h.strike.x - tx) * dive;
          ty = ty + (h.strike.y - 10 - ty) * dive;
        }
      }
      sp.x += (tx - sp.x) * (h.strike ? 0.5 : 0.1);
      sp.y += (ty - sp.y) * (h.strike ? 0.5 : 0.1);
      sp.setFlipX(tx < sp.x).setFrame(Math.floor(time / 110) % 2).setDepth(LABEL_DEPTH - 12);
    }
  }

  private static PET_ART: Record<string, { shape: string; scale: number }> = {
    dog: { shape: 'wolf', scale: 0.5 },
    cat: { shape: 'rat', scale: 0.7 },
    fox: { shape: 'wolf', scale: 0.45 },
    slime: { shape: 'slime', scale: 0.55 },
    dragonling: { shape: 'bat', scale: 0.75 },
  };

  /** Pets trot after their owners (local player and everyone visible). */
  private updatePets(): void {
    const want = new Map<string, { item: string; x: number; y: number; dir: string; stage: number }>();
    const ui = this.client.ui.get();
    const self = ui.self;
    const myStage = ui.pet && ui.pet.id === self?.pet ? ui.pet.stage : 1;
    if (self?.pet && this.local) want.set(self.characterId, { item: self.pet, x: this.local.sprite.x, y: this.local.sprite.y, dir: this.client.dir, stage: myStage });
    for (const [id, r] of this.client.remotes) {
      const av = this.remotes.get(id);
      if (r.info.pet && av) want.set(id, { item: r.info.pet, x: av.sprite.x, y: av.sprite.y, dir: r.dir, stage: r.info.petStage ?? 1 });
    }
    for (const [id, pet] of this.pets)
      if (want.get(id)?.item !== pet.item || want.get(id)?.stage !== pet.stage) {
        pet.sprite.destroy();
        this.pets.delete(id);
      }
    for (const [id, w] of want) {
      let pet = this.pets.get(id);
      if (!pet) {
        const def = getItem(w.item)?.pet;
        if (!def) continue;
        const art = WorldScene.PET_ART[def.kind] ?? WorldScene.PET_ART.dog!;
        const key = `pet:${def.kind}:${def.color}`;
        if (!this.textures.exists(key)) {
          const sheet = monsterSheet(art.shape, def.color);
          const tex = this.textures.addCanvas(key, sheet.canvas)!;
          tex.add(0, 0, 0, 0, sheet.w * 2, sheet.h * 2);
          tex.add(1, 0, sheet.w * 2, 0, sheet.w * 2, sheet.h * 2);
        }
        // Evolved pets are bigger; Mythic ones glow.
        const grow = 1 + 0.22 * (w.stage - 1);
        const sprite = this.add.sprite(w.x - 20, w.y, key, 0).setOrigin(0.5, 1).setScale(art.scale * grow).setVisible(false);
        if (w.stage >= 3 && sprite.preFX) sprite.preFX.addGlow(0xc9a0ff, 3, 0, false, 0.1, 8);
        const p = { item: w.item, stage: w.stage, sprite, hd: null as string | null };
        pet = p;
        this.pets.set(id, pet);
        const hk = `hd:pet:${def.kind}:${def.color}`;
        void this.hd.ensure(hk, () => bakeCreature('pet', def.kind, '', def.color, 1, 4)).then((ok) => {
          if (!sprite.active) return;
          if (ok) {
            const info = this.hd.get(hk)!;
            sprite.setTexture(hk, 0).setOrigin(0.5, 1 - (info.meta?.foot ?? 10) / (info.meta?.h ?? 48)).setScale(grow / BAKE_RES);
            p.hd = hk;
          }
          sprite.setVisible(true);
        });
      }
      const side = w.dir === 'left' ? 22 : -22;
      let tx = w.x + (w.dir === 'up' || w.dir === 'down' ? -18 : side);
      let ty = w.y + (w.dir === 'up' ? 14 : w.dir === 'down' ? -6 : 2);
      if (pet.strike) {
        // Pounce at the target and come back.
        const k = (this.time.now - pet.strike.at) / 380;
        if (k >= 1) pet.strike = undefined;
        else {
          const jump = Math.sin(k * Math.PI);
          tx += (pet.strike.x - tx) * jump;
          ty += (pet.strike.y - ty) * jump;
        }
      }
      const sp = pet.sprite;
      const dx = tx - sp.x;
      const dy = ty - sp.y;
      const moving = Math.hypot(dx, dy) > 3;
      sp.x += dx * (pet.strike ? 0.45 : 0.12);
      sp.y += dy * (pet.strike ? 0.45 : 0.12);
      if (pet.hd) {
        const d: Direction = Math.abs(dx) > Math.abs(dy) * 1.2 ? (dx < 0 ? 'left' : 'right') : moving ? (dy < 0 ? 'up' : 'down') : w.dir === 'left' || w.dir === 'right' ? (w.dir as Direction) : 'down';
        this.monsterFrame({ sprite: sp, hd: pet.hd, attackAt: pet.strike?.at }, d, moving, this.time.now, id.length * 77);
      } else {
        if (Math.abs(dx) > 1) sp.setFlipX(dx < 0);
        sp.setFrame(moving && Math.floor(this.time.now / 160) % 2 ? 1 : 0);
      }
      sp.setDepth(sp.y);
    }
  }

  /** Draw the homestead's animals wandering around the pen. */
  private drawAnimals(list: { id: number; kind: string }[]): void {
    this.animalSprites.forEach((a) => a.destroy());
    this.animalSprites = [];
    const pen = this.client.map?.pen;
    if (!pen) return;
    for (const a of list) {
      const key = this.canvasTexture(`animal:${a.kind}`, () => itemIcon(`animal:${a.kind}`, a.kind === 'chicken' ? 2 : 3));
      const px = () => (pen.x + 0.5 + Math.random() * (pen.w - 1)) * TILE_SIZE;
      const py = () => (pen.y + 0.8 + Math.random() * (pen.h - 1)) * TILE_SIZE;
      const img = this.add.image(px(), py(), key).setOrigin(0.5, 1);
      img.setDepth(img.y);
      const wander = () => {
        if (!img.active) return;
        const nx = px();
        img.setFlipX(nx < img.x);
        this.tweens.add({ targets: img, x: nx, y: py(), duration: 2500 + Math.random() * 2500, delay: 800 + Math.random() * 3000, onUpdate: () => img.setDepth(img.y), onComplete: wander });
      };
      wander();
      this.animalSprites.push(img);
    }
  }

  private areaTrack: string | null = null;
  private nextSoundCheck = 0;

  /** Pick music (boss fights get their own) and weather/night ambience, once a second. */
  private updateSound(time: number): void {
    if (time < this.nextSoundCheck || !this.client.map) return;
    this.nextSoundCheck = time + 1000;
    const c = this.client;
    const boss = [...c.monsters.values()].some((m) => m.info.boss && Math.hypot(m.x - c.pos.x, m.y - c.pos.y) < 12 * TILE_SIZE);
    audio.playMusic(boss ? 'boss' : this.areaTrack);
    const now = c.serverNow();
    const theme = c.map?.theme;
    let amb: string | null = null;
    if (weatherRegion(theme)) {
      const w = weatherAt(theme, now);
      if (w === 'rain' || w === 'storm') amb = w;
      else if (w === 'snow' || (w === 'fog' && theme === 'snow')) amb = 'wind';
      else if (darknessAt(now) > 0.4) amb = 'night';
      if (w === 'storm' && Math.random() < 0.06) audio.thunder();
    }
    audio.setAmbient(amb);
  }

  private night: Phaser.GameObjects.Rectangle | null = null;
  private windowGlows: Phaser.GameObjects.Rectangle[] = [];
  private chimneys: { x: number; y: number; next: number }[] = [];

  private glowKey(): string {
    return this.canvasTexture('glow', () => {
      const c = document.createElement('canvas');
      c.width = c.height = 128;
      const ctx = c.getContext('2d')!;
      const grad = ctx.createRadialGradient(64, 64, 4, 64, 64, 64);
      grad.addColorStop(0, 'rgba(255,200,120,1)');
      grad.addColorStop(0.45, 'rgba(255,170,90,0.45)');
      grad.addColorStop(1, 'rgba(255,150,60,0)');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, 128, 128);
      return c;
    });
  }

  /** Chimney smoke: a soft grey puff now and then from every chimney on screen. */
  private updateSmoke(time: number): void {
    if (!this.chimneys.length) return;
    const view = this.cameras.main.worldView;
    for (const c of this.chimneys) {
      if (time < c.next) continue;
      c.next = time + 650 + Math.random() * 500;
      if (!view.contains(c.x, c.y + 40)) continue;
      const puff = this.add.circle(c.x + (Math.random() * 4 - 2), c.y - 2, 4 + Math.random() * 2, 0xd8d4cc, 0.55).setDepth(LABEL_DEPTH - 11);
      this.tweens.add({ targets: puff, x: puff.x + 10 + Math.random() * 8, y: puff.y - 34 - Math.random() * 14, scale: 2.6, alpha: 0, duration: 2600, ease: 'Sine.easeOut', onComplete: () => puff.destroy() });
    }
  }
  private glows: Phaser.GameObjects.Image[] = [];
  private indoorDim = 0;

  /** Darkness from the time of day (outdoors) or a fixed dimness (caves, dungeons). */
  private updateLighting(time: number): void {
    if (!this.night) return;
    const dark = this.indoorDim || darknessAt(this.client.serverNow());
    // Colour grade: warm golden light as the sun sets, deep blue moonlight at night.
    if (this.indoorDim) this.night.setBlendMode(Phaser.BlendModes.NORMAL).setFillStyle(0x0a0f2c, dark);
    else {
      const dusk = Math.max(0, 1 - Math.abs(dark - 0.28) / 0.22);
      const c = Phaser.Display.Color.Interpolate.ColorWithColor(
        Phaser.Display.Color.ValueToColor(0xffffff),
        Phaser.Display.Color.ValueToColor(dark > 0.28 ? 0x3a4a9a : 0xffc890),
        100,
        Math.round(Math.min(1, dark > 0.28 ? (dark - 0.1) * 1.15 : dusk * 0.8) * 100),
      );
      this.night.setBlendMode(Phaser.BlendModes.MULTIPLY).setFillStyle(Phaser.Display.Color.GetColor(c.r, c.g, c.b), 1);
    }
    const flicker = 0.85 + Math.sin(time / 130) * 0.05 + Math.sin(time / 47) * 0.04;
    const glow = Math.min(0.5, (dark + (this.indoorDim ? 0.15 : 0)) * 0.75) * flicker;
    for (const g of this.glows) g.setAlpha(glow * 1.6);
    const lit = Math.max(0, Math.min(0.85, (dark - 0.12) * 1.6));
    for (const w of this.windowGlows) w.setFillStyle(0xffc060, lit * (0.9 + Math.sin(time / 600 + w.x) * 0.06));
    // Sun shadows fade at night; sunbeams and dust only in daylight outdoors (HD-2D).
    const day = Math.max(0, Math.min(1, 1 - dark / 0.55));
    const dt = this.lastLightAt ? time - this.lastLightAt : 16;
    this.lastLightAt = time;
    this.atmos?.update(time, dt, day, (this.gfx !== 'hd' && this.gfx !== 'ultra') || !this.outdoors);
    this.watchFps(time, dt);
  }
  private lastLightAt = 0;
  private fpsWindow = { start: 0, frames: 0, slow: 0 };

  /**
   * Low-end PCs: if the game runs under ~40 FPS for a while, step the graphics
   * down one level (Ultra → HD-2D → Lite → Classic) and say so.
   */
  private watchFps(time: number, dt: number): void {
    const w = this.fpsWindow;
    if (!w.start) w.start = time + 8000; // let the map settle first
    if (time < w.start) return;
    w.frames++;
    if (time - w.start < 5000) return;
    const fps = (w.frames * 1000) / (time - w.start);
    w.start = time;
    w.frames = 0;
    if (document.hidden || dt > 1000) return;
    w.slow = fps < 40 ? w.slow + 1 : 0;
    if (w.slow < 2) return;
    w.slow = 0;
    const next = GRAPHICS_ORDER[GRAPHICS_ORDER.indexOf(this.gfx) + 1];
    if (!next) return;
    setFxSettings({ graphics: next });
    const label = { ultra: 'Ultra', hd: 'HD-2D', lite: 'Lite', classic: 'Classic' }[next];
    pushNotice(this.client.ui, 'info', `Graphics lowered to ${label} for smoother play (Settings → Graphics).`, 5000);
  }

  /** Hide static map art outside the camera (checked 5× a second, with a margin). */
  private cullStatics(time: number): void {
    if (time < this.nextCullAt) return;
    this.nextCullAt = time + 200;
    const v = this.cameras.main.worldView;
    const m = 96;
    const x0 = v.x - m;
    const x1 = v.right + m;
    const y0 = v.y - m;
    const y1 = v.bottom + m;
    for (const o of this.statics) {
      const left = o.x - o.displayWidth * o.originX;
      const top = o.y - o.displayHeight * o.originY;
      o.setVisible(left < x1 && left + o.displayWidth > x0 && top < y1 && top + o.displayHeight > y0);
    }
  }

  override update(time: number): void {
    const client = this.client;
    this.cullStatics(time);
    this.updateLighting(time);
    this.updateSmoke(time);
    this.updateSound(time);
    this.updatePets();
    this.updateHawks(time);
    // Phaser's delta is smoothed toward 60 FPS; movement must follow real time
    // or slow devices would walk slower than the server allows.
    const nowMs = performance.now();
    const delta = this.lastFrameAt ? nowMs - this.lastFrameAt : 16.7;
    this.lastFrameAt = nowMs;
    if (!client.map || !this.local) return;
    const frozen = nowMs < this.freezeUntil;

    // Fixed-step input simulation (matches the server's 20 Hz movement steps).
    this.acc += Math.min(delta, 300);
    let steps = 0;
    while (this.acc >= 50 && steps < 8) {
      const manual = this.readInput();
      if (manual.dx || manual.dy) {
        client.stopAutoWalk();
        client.step(manual);
      } else client.step(client.autoWalkInput() ?? manual);
      this.acc -= 50;
      steps++;
    }
    const alpha = Math.min(1, this.acc / 50);
    // Hit-stop: hold the picture for a few frames (input and simulation keep running).
    if (frozen) return;

    // Decay any reconciliation correction smoothly.
    const decay = Math.pow(0.001, delta / 1000);
    client.correction.x *= decay;
    client.correction.y *= decay;
    if (Math.abs(client.correction.x) < 0.05) client.correction.x = 0;
    if (Math.abs(client.correction.y) < 0.05) client.correction.y = 0;

    const lx = client.prevPos.x + (client.pos.x - client.prevPos.x) * alpha + client.correction.x;
    const ly = client.prevPos.y + (client.pos.y - client.prevPos.y) * alpha + client.correction.y;
    this.setAvatarMount(this.local, client.ui.get().self?.mount, client.ui.get().self?.mountLook);
    const meId = client.ui.get().self?.characterId;
    if (meId) this.syncHdFor(this.local, meId, time);
    this.placeAvatar(this.local, lx, ly, client.dir, client.moving, time, { sit: client.pose === 'sit', speed: client.speed() });
    this.drawMountChannel(lx, ly);
    const lvl = client.ui.get().self?.level ?? 0;
    if (this.lastLevel && lvl > this.lastLevel && fxSettings().level !== 'off') this.levelUpFx(lx, ly);
    this.lastLevel = lvl;
    this.updateCameraFeel(delta, !!client.ui.get().self?.mount);
    const fxo = fxSettings();
    const selfId = client.ui.get().self?.characterId;
    if (selfId) {
      this.placeHand(this.local, selfId, client.dir, client.moving, time, fxo.handWeapon);
      this.placeGear(this.local, selfId, client.dir, client.moving, time);
    }

    client.interpolateRemotes();
    for (const [id, r] of client.remotes) {
      const av = this.remotes.get(id);
      if (av) {
        this.syncHdFor(av, id, time);
        this.placeAvatar(av, r.x, r.y, r.dir, r.moving, time, { sit: r.info.pose === 'sit' });
        this.placeHand(av, id, r.dir, r.moving, time, fxo.handWeapon);
        this.placeGear(av, id, r.dir, r.moving, time);
      }
    }
    this.targetRing.clear();
    const tid = client.ui.get().targetId;
    for (const [id, m] of client.monsters) {
      const v = this.monsterViews.get(id);
      if (!v) continue;
      const rx = Math.round(m.x);
      const ry = Math.round(m.y);
      const k = v.kick && v.kick.until > time ? (v.kick.until - time) / 140 : 0;
      v.sprite.setPosition(rx + Math.round((v.kick?.x ?? 0) * k), ry + 2 + Math.round((v.kick?.y ?? 0) * k)).setDepth(m.y);
      if (v.hd) this.monsterFrame(v, m.dir, m.moving, time, id.length * 131);
      else if (v.sprite.texture.key !== '__DEFAULT') v.sprite.setFrame(m.moving ? Math.floor(time / 180) % 2 : 0).setFlipX(m.dir === 'left');
      if (!v.shadow) v.shadow = this.add.image(rx, ry, this.blobKey()).setDepth(-4);
      v.shadow.setPosition(rx + 4, ry + 3).setScale(Math.min(2.4, (v.hd ? v.frameW * 0.55 : v.sprite.displayWidth) / 52), 0.55).setVisible(this.gfx !== 'classic' && v.sprite.alpha > 0.5);
      const top = v.hd ? ry - (this.hd.get(v.hd)?.meta?.top ?? 30) * (v.sprite.scaleX * BAKE_RES) - 4 : ry - v.sprite.displayHeight - 2;
      v.label.setPosition(rx, top - 6);
      v.bar.clear();
      if (m.hp < 100 || id === tid) {
        v.bar.fillStyle(0x2a2030, 1).fillRect(rx - 15, top - 4, 30, 5);
        v.bar.fillStyle(m.hp > 50 ? 0x5fd45a : m.hp > 25 ? 0xe0a52e : 0xd64545, 1).fillRect(rx - 14, top - 3, Math.max(0, Math.round((28 * m.hp) / 100)), 3);
      }
      if (id === tid) this.targetRing.lineStyle(2, 0xff5a5a, 0.9).strokeEllipse(rx, ry, Math.max(26, v.hd ? v.frameW * 0.6 : v.sprite.displayWidth * 0.9), 12);
    }
    if (tid && this.remotes.has(tid)) {
      const av = this.remotes.get(tid)!;
      this.targetRing.lineStyle(2, 0xff5a5a, 0.9).strokeEllipse(av.sprite.x, av.sprite.y, 28, 12);
    }
    for (const av of this.npcAvatars.values()) {
      av.bubble?.setPosition(av.sprite.x, av.sprite.y - 72);
      if (av.hd) this.heroFrame(av, av.facing ?? 'down', 'idle', time + (av.sprite.x % 997));
    }

    // Interaction prompt for the nearest NPC.
    const npc = client.nearestNpc();
    const ui = client.ui.get();
    if (npc && !ui.dialogue) {
      const av = this.npcAvatars.get(npc.id)!;
      const touch = touchInput.active || window.matchMedia('(pointer: coarse)').matches;
      this.prompt.setText(touch ? `Talk to ${npc.name}` : `[E] Talk to ${npc.name}`).setPosition(av.sprite.x, av.sprite.y - 76).setVisible(true);
    } else this.prompt.setVisible(false);
    const hint = npc && !ui.dialogue ? npc.name : null;
    if (hint !== this.lastHint) {
      this.lastHint = hint;
      client.ui.set({ interactHint: hint });
    }

    // Quest markers over NPCs and the guide arrow.
    if (nowMs - this.lastQuestRefresh > 400) {
      this.lastQuestRefresh = nowMs;
      this.refreshQuestMarkers();
      this.guideTarget = this.computeGuide();
    }
    for (const [id, mk] of this.npcMarkers) {
      const av = this.npcAvatars.get(id);
      if (av) mk.setPosition(av.sprite.x, av.sprite.y - 74 + Math.sin(time / 220) * 3);
    }
    this.drawGuide(time, lx, ly);

    // Crops grow on their own: refresh visuals a couple of times per second.
    // Free HD sheets nobody has shown for a minute (scenery stays while on the map).
    if (nowMs - this.lastSweep > 20000) {
      this.lastSweep = nowMs;
      this.hd.sweep(60000, (k) => k.startsWith('hd:prop') || k.startsWith('hd:bld') || k.startsWith('hd:node') || k.startsWith('hd:deco'));
    }
    if (nowMs - this.lastObjectRefresh > 400) {
      this.lastObjectRefresh = nowMs;
      for (const o of client.objects.values()) this.syncObject(o);
    }

    // Target cursor + what the action key would do.
    const target = !npc && !ui.dialogue ? client.actionTarget() : null;
    const hintText = target?.hint ?? null;
    this.cursor.clear();
    if (target && hintText) {
      const w = target.w * TILE_SIZE;
      const h = target.h * TILE_SIZE;
      this.cursor.lineStyle(2, 0xffe48a, 0.95).strokeRect(target.x * TILE_SIZE + 1, target.y * TILE_SIZE + 1, w - 2, h - 2);
      this.cursor.lineStyle(2, 0x2a2030, 0.6).strokeRect(target.x * TILE_SIZE + 3, target.y * TILE_SIZE + 3, w - 6, h - 6);
    }
    this.updateBobber(time);
    if (hintText !== this.lastActionHint) {
      this.lastActionHint = hintText;
      client.ui.set({ actionHint: hintText });
    }

    // Signs show their text when you stand next to them.
    for (const s of this.signs) s.label.setVisible(Math.hypot(s.x - lx, s.y - ly) < 64);

    const tile = client.tile();
    const key = `${tile.x},${tile.y}`;
    if (key !== this.lastTileKey) {
      this.lastTileKey = key;
      client.ui.set({ tile });
    }
  }
}

function remoteLabel(info: { name: string; level: number; guild?: string | null; shop?: string | null; job?: string | null }): string {
  const job = getJob(info.job)?.name;
  const base = `${info.guild ? `[${info.guild}] ` : ''}${info.name} · Lv ${info.level}${job ? ` ${job}` : ''}`;
  return info.shop ? `[Shop] ${info.shop}\n${base}` : base;
}
