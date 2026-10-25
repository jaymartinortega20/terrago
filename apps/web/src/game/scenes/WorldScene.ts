import Phaser from 'phaser';
import { QUESTS, getCrop, getItem, getJob, getMap, getMonster, getNode, getQuest } from '@terrago/game-data';
import { itemIcon } from '../art/world';
import { audio, trackFor } from '../audio';
import { CombatFx, FIRE_PAL, HOLY_PAL, ICE_PAL, MAGIC_PAL, MONSTER_PAL, POISON_PAL, paletteFor, type WeaponType } from '../fx/CombatFx';
import { fxSettings, type FxSettings } from '../fx/settings';
import { monsterSheet } from '../art/monsters';
import { mountSheet } from '../art/mounts';
import {
  CHAT,
  MAX_VIEW,
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
} from '@terrago/shared';
import { cropArt, needsWaterArt, readyArt, soilArt, type SoilState } from '../art/farm';
import { nodeArt } from '../art/nodes';
import { CHAR_FRAMES_PER_DIR, FRAME_ACTION, FRAME_SIT, buildCharacterSheet, characterSheetKey } from '../art/characters';
import { emoteIcon } from '../art/emotes';
import { wingCanvas } from '../art/wings';
import { TREE_VARIANTS, buildingArt, propArt, renderGround } from '../art/world';
import { isTyping, joystickToInput, touchInput } from '../input';
import type { GameClient, RemoteMonster, RemotePlayer } from '../net/client';

const DIR_ROW: Record<Direction, number> = { down: 0, left: 1, right: 2, up: 3 };
const WALK_CYCLE = [1, 0, 2, 0];

/** Monster art (shape/colour/size) from game data. */
function MONSTER_ART(id: string): { shape: string; color: string; size: number } {
  const a = getMonster(id)?.art;
  return { shape: a?.shape ?? 'slime', color: a?.color ?? '#7cc35a', size: a?.size ?? 1 };
}
const LABEL_FONT = '"Pixelify Sans", monospace';
const LABEL_DEPTH = 1_000_000;

interface ObjectView {
  key: string;
  parts: Phaser.GameObjects.Image[];
}

interface Avatar {
  mount?: Phaser.GameObjects.Sprite | null;
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
  private local: Avatar | null = null;
  private remotes = new Map<string, Avatar>();
  private monsterViews = new Map<string, { sprite: Phaser.GameObjects.Sprite; label: Phaser.GameObjects.Text; bar: Phaser.GameObjects.Graphics; frameW: number }>();
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
  private lastActionHint: string | null = null;

  constructor() {
    super('world');
  }

  init(data: { client: GameClient }): void {
    this.client = data.client;
  }

  private fx!: CombatFx;

  create(): void {
    this.fx = new CombatFx(this, LABEL_DEPTH - 8); // above the night overlay, below names
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
      .setResolution(2)
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
          this.client.setTarget(id, true);
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
        this.pose(this.local, 300, c);
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
        this.pose(av, 300, c);
        if (fxSettings().level !== 'off') this.fx.workSwing(from, c.x, c.y, this.toolIcon(w.tool, w.tx, w.ty));
        this.swinging.set(w.id, this.time.now + 400);
        this.puff(w.tx, w.ty);
      }),
      this.client.on('emote', (e) => this.showEmote(e.id, e.emote)),
      this.client.on('monsterAdd', (m) => this.addMonster(m)),
      this.client.on('monsterRemove', (id) => this.removeMonster(id)),
      this.client.on('combat', (ev) => this.showCombat(ev)),
      this.client.on('telegraph', (t) => this.showTelegraph(t)),
      this.client.on('animals', (list) => this.drawAnimals(list)),
      this.client.on('look', (id) => {
        const self = this.client.ui.get().self;
        if (self && id === self.characterId && this.local) {
          this.local.sprite.setTexture(this.charTexture(self.appearance), this.local.sprite.frame.name);
          return;
        }
        const r = this.client.remotes.get(id);
        const av = this.remotes.get(id);
        if (r && av) {
          av.sprite.setTexture(this.charTexture(r.info.appearance), av.sprite.frame.name);
          this.setAvatarMount(av, r.info.mount, r.info.mountLook);
          av.label.setText(remoteLabel(r.info));
        }
      }),
    );
    if (this.client.map) this.buildMap();

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.unsubs.forEach((u) => u()));
  }

  /** Zoom so the visible world never exceeds MAX_VIEW; art stays crisp at 0.5 steps. */
  private updateZoom(): void {
    const { width, height } = this.scale.gameSize;
    const min = Math.max(width / MAX_VIEW.width, height / MAX_VIEW.height);
    const zoom = Math.max(1, Math.ceil(min * 0.92 * 2) / 2);
    this.cameras.main.setZoom(zoom);
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
    const sprite = this.add.sprite(Math.round(x), Math.round(y) + 2, this.charTexture(a, accessory), 0).setOrigin(0.5, 1);
    sprite.setDepth(y);
    const text = this.add
      .text(Math.round(x), Math.round(y) - 46, label, {
        fontFamily: LABEL_FONT,
        fontSize: '12px',
        color,
        stroke: '#2a2030',
        strokeThickness: 3,
        align: 'center',
      })
      .setOrigin(0.5, 1)
      .setResolution(2)
      .setDepth(LABEL_DEPTH);
    return { sprite, label: text, bubble: null, bubbleTimer: null };
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
    const ground = this.add.image(0, 0, this.canvasTexture(`ground:${map.id}`, () => renderGround(map))).setOrigin(0, 0).setDepth(-10);
    this.mapLayer.push(ground);

    for (const o of map.objects) {
      if (o.kind === 'building') {
        const art = buildingArt(o);
        const key = this.canvasTexture(`bld:${map.id}:${o.id}`, () => art.canvas);
        const bx = o.x * TILE_SIZE;
        const by = (o.y + o.h) * TILE_SIZE;
        this.mapLayer.push(this.add.image(bx, by, key).setOrigin(0, 1).setDepth(by));
        // Night: windows light up, lanterns and torches glow, chimneys smoke.
        for (const wdw of art.windows) {
          const g = this.add.rectangle(bx + wdw.x, by + wdw.y, wdw.w, wdw.h, 0xffc060, 0).setOrigin(0, 0).setBlendMode(Phaser.BlendModes.ADD).setDepth(LABEL_DEPTH - 9);
          this.windowGlows.push(g);
          this.mapLayer.push(g);
        }
        for (const l of art.lights) {
          const g = this.add.image(bx + l.x, by + l.y, this.glowKey()).setScale(l.r / 40).setAlpha(0).setBlendMode(Phaser.BlendModes.ADD).setDepth(LABEL_DEPTH - 9);
          this.glows.push(g);
          this.mapLayer.push(g);
        }
        for (const c of art.chimneys) this.chimneys.push({ x: bx + c.x, y: by + c.y, next: 0 });
        this.mapLayer.push(
          this.add
            .text(bx + art.signX, by + art.signY, o.name, { fontFamily: LABEL_FONT, fontSize: '9px', color: '#fff6dc', fontStyle: 'bold' })
            .setOrigin(0.5, 0.5)
            .setResolution(3)
            .setDepth(by + 0.5),
        );
      } else {
        const variant = (o.x * 7 + o.y * 13) % TREE_VARIANTS;
        const art = propArt(o.type, variant);
        const key = this.canvasTexture(`prop:${o.type}:${variant}`, () => art.canvas);
        const cx = (o.x + art.footW / 2) * TILE_SIZE;
        const by = (o.y + art.footH) * TILE_SIZE;
        const depth = o.type === 'teleport_pad' || o.type === 'flower_bed' ? 0 : by;
        this.mapLayer.push(this.add.image(cx, by, key).setOrigin(0.5, 1).setDepth(depth));
        if (o.text) {
          const label = this.add
            .text(cx, by - art.canvas.height - 4, o.text, {
              fontFamily: LABEL_FONT,
              fontSize: '12px',
              color: '#2a2030',
              backgroundColor: '#f3e6c4',
              padding: { x: 6, y: 4 },
              wordWrap: { width: 220 },
              align: 'center',
            })
            .setOrigin(0.5, 1)
            .setResolution(2)
            .setDepth(LABEL_DEPTH + 5)
            .setVisible(false);
          this.signs.push({ x: cx, y: by, text: o.text, label });
        }
      }
    }

    for (const id of [...this.objectViews.keys()]) this.destroyObjectView(id);
    for (const o of this.client.objects.values()) this.syncObject(o);

    this.npcMarkers.forEach((m) => m.destroy());
    this.npcMarkers.clear();
    for (const n of this.client.npcs) {
      const c = tileCenter(n.x, n.y);
      const av = this.makeAvatar(c.x, c.y, n.appearance, n.name, '#b9f08a', n.accessory);
      av.sprite.setFrame(DIR_ROW[n.dir] * CHAR_FRAMES_PER_DIR);
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
        const key2 = this.canvasTexture(`icon:${def.icon}`, () => itemIcon(def.icon, 2));
        const img = this.add.image(x + TILE_SIZE / 2, y + TILE_SIZE / 2, key2).setDepth(y + TILE_SIZE / 2);
        this.tweens.add({ targets: img, y: y + TILE_SIZE / 2 - 4, yoyo: true, repeat: -1, duration: 700, ease: 'Sine.easeInOut' });
        parts.push(img);
      }
    }
    if (o.kind === 'node') {
      const def = getNode(o.type);
      const spent = key.endsWith('spent');
      if (def) {
        const nk = this.bufferTexture(`node:${o.type}:${spent ? 1 : 0}`, () => nodeArt(def, spent));
        const img = this.add.image(x + TILE_SIZE / 2, y + TILE_SIZE + 2, nk).setOrigin(0.5, 1).setDepth(def.solid && !spent ? y + TILE_SIZE : y + 4);
        parts.push(img);
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
    const offers = new Set(questsAvailable(QUESTS, quests).map((q) => q.giver));
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
          .setResolution(2)
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
    const key = `mon:${m.info.monsterId}`;
    let frameW = 32;
    if (!this.textures.exists(key)) {
      const sheet = monsterSheet(md.shape, md.color);
      const tex = this.textures.addCanvas(key, sheet.canvas)!;
      tex.add(0, 0, 0, 0, sheet.w * 2, sheet.h * 2);
      tex.add(1, 0, sheet.w * 2, 0, sheet.w * 2, sheet.h * 2);
      frameW = sheet.w * 2;
    } else frameW = this.textures.get(key).get(0).width;
    const sprite = this.add.sprite(m.x, m.y + 2, key, 0).setOrigin(0.5, 1).setScale(md.size);
    const lvl = this.client.ui.get().self?.level ?? 1;
    const diff = m.info.level - lvl;
    const color = diff >= 10 ? '#ff5a5a' : diff >= 5 ? '#ff9a3a' : diff >= 2 ? '#ffe48a' : diff <= -6 ? '#9a9a9a' : '#ffffff';
    const label = this.add
      .text(m.x, m.y - sprite.displayHeight - 8, `${m.info.name} · Lv ${m.info.level}`, { fontFamily: LABEL_FONT, fontSize: '11px', color, stroke: '#2a2030', strokeThickness: 3 })
      .setOrigin(0.5, 1)
      .setResolution(2)
      .setDepth(LABEL_DEPTH - 2);
    const bar = this.add.graphics().setDepth(LABEL_DEPTH - 2);
    this.monsterViews.set(m.info.id, { sprite, label, bar, frameW });
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
    v.label.destroy();
    v.bar.destroy();
    this.tweens.add({ targets: v.sprite, alpha: 0, duration: 300, onComplete: () => v.sprite.destroy() });
  }

  private entityPos(id: string): { x: number; y: number; h: number } | null {
    const self = this.client.ui.get().self;
    if (self && id === self.characterId) return { x: this.client.pos.x, y: this.client.pos.y, h: 46 };
    const mv = this.monsterViews.get(id);
    if (mv) return { x: mv.sprite.x, y: mv.sprite.y, h: mv.sprite.displayHeight };
    const r = this.remotes.get(id);
    if (r) return { x: r.sprite.x, y: r.sprite.y, h: 46 };
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
      .setResolution(2)
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
      if (srcAv && !companion && e.k !== 'death' && e.k !== 'dot') this.pose(srcAv, 280, e.s !== e.t ? pos : undefined);
      if (tgtAv && (e.k === 'hit' || e.k === 'crit')) tgtAv.hurtUntil = now + (e.k === 'crit' ? 260 : 170);
      if (tgtAv && e.k === 'death') tgtAv.deadUntil = now + 1800;
      if (e.k === 'death') continue;
      try {
        this.attackFx(e, opts);
      } catch (err) {
        // Effects are decoration; never let them break the game.
        console.warn('[fx]', err);
      }
      if (e.k === 'cast') continue;
      const mine = e.t === me;
      if (opts.numbers) {
        const text = e.k === 'miss' ? 'miss' : e.k === 'heal' ? `+${e.a}` : `${e.a}`;
        const color = e.k === 'heal' ? '#7cf06a' : e.k === 'miss' ? '#c8c8c8' : mine ? '#ff6a5a' : e.k === 'crit' ? '#ffb02e' : e.k === 'dot' ? '#b6f06a' : '#ffffff';
        const size = e.k === 'crit' ? '18px' : '14px';
        const t = this.add
          .text(pos.x + (Math.random() * 16 - 8), pos.y - pos.h - 4, e.k === 'crit' ? `${text}!` : text, { fontFamily: LABEL_FONT, fontSize: size, color, stroke: '#2a2030', strokeThickness: 4 })
          .setOrigin(0.5, 1)
          .setResolution(2)
          .setDepth(LABEL_DEPTH + 30);
        this.tweens.add({ targets: t, y: t.y - 26, alpha: 0, duration: 900, ease: 'Cubic.easeOut', onComplete: () => t.destroy() });
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
    const icon = w?.icon || null;
    const hold = (ms: number) => this.swinging.set(e.s, this.time.now + ms + 260);
    const shake = () => {
      if (e.s === me && opts.shake) this.cameras.main.shake(90, 0.003);
    };
    const land = (p = pal) => {
      if (e.k === 'miss') fx.whoosh(to);
      else {
        fx.impact(to, p, e.k === 'crit', full);
        if (e.k === 'crit') shake();
      }
    };
    const melee = (p = pal, big = false) => {
      if (!from || !w) return land(p);
      hold(260);
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
    const def = look.back ? getItem(look.back)?.wings : undefined;
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
    if (tw && hand && !dead) {
      av.weaponGlow ??= this.add.image(0, 0, this.whiteGlowKey()).setBlendMode(Phaser.BlendModes.ADD);
      const flip = hand.flipX ? -1 : 1;
      const gx = hand.x + flip * 7;
      const gy = hand.y - 8;
      av.weaponGlow
        .setPosition(gx, gy)
        .setTint(GLOW_COLOR[tw])
        .setScale(0.16 + tw * 0.07)
        .setAlpha(0.45 + tw * 0.12 + Math.sin(time / 180) * 0.12)
        .setDepth(hand.depth + 0.01);
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
    text.setResolution(2).setOrigin(0.5, 1);
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
    const lift = av.mount ? 14 : 0;
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
    av.sprite.setPosition(rx, ry + 2 - lift).setFrame(DIR_ROW[shownDir] * CHAR_FRAMES_PER_DIR + col).setDepth(y + 0.5);
    // Taking damage flashes red; a fallen character lies down, greyed.
    if (hurt || dead) {
      av.sprite.setTint(dead ? 0x9a9aa8 : 0xff7a6a);
      av.tinted = true;
    } else if (av.tinted) {
      av.sprite.clearTint();
      av.tinted = false;
    }
    av.sprite.setRotation(dead ? (dir === 'left' ? -Math.PI / 2 : Math.PI / 2) : 0);
    av.sprite.setScale(1, (av.bowUntil ?? 0) > now ? 0.86 : 1);
    if (av.mount) av.mount.setPosition(rx, ry + 4).setFlipX(dir === 'left').setFrame(moving ? Math.floor(time / 110) % 2 : 0).setDepth(dir === 'up' ? y + 1 : y);
    if (moving) this.mountTrail(av, rx, ry + 4, now);
    const sitDrop = col === FRAME_SIT ? 6 : 0;
    av.label.setPosition(rx, ry - 46 - lift + sitDrop);
    av.bubble?.setPosition(rx, ry - 62 - lift + sitDrop);
    av.emote?.setPosition(rx, ry - 64 - lift + sitDrop + Math.round(Math.sin(now / 160) * 2));
    if (av.hand) av.hand.setVisible(col !== FRAME_SIT && !dead && (av.danceUntil ?? 0) <= now);
  }

  /** Strike/cast/work pose for a moment, with a small lunge toward a point. */
  private pose(av: Avatar | null, ms: number, toward?: { x: number; y: number }): void {
    if (!av) return;
    const now = this.time.now;
    av.actionUntil = now + ms;
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
  private pets = new Map<string, { item: string; sprite: Phaser.GameObjects.Sprite; strike?: { x: number; y: number; at: number } }>();
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
      .setResolution(2)
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
    const want = new Map<string, { item: string; x: number; y: number; dir: string }>();
    const self = this.client.ui.get().self;
    if (self?.pet && this.local) want.set(self.characterId, { item: self.pet, x: this.local.sprite.x, y: this.local.sprite.y, dir: this.client.dir });
    for (const [id, r] of this.client.remotes) {
      const av = this.remotes.get(id);
      if (r.info.pet && av) want.set(id, { item: r.info.pet, x: av.sprite.x, y: av.sprite.y, dir: r.dir });
    }
    for (const [id, pet] of this.pets)
      if (want.get(id)?.item !== pet.item) {
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
        pet = { item: w.item, sprite: this.add.sprite(w.x - 20, w.y, key, 0).setOrigin(0.5, 1).setScale(art.scale) };
        this.pets.set(id, pet);
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
      if (Math.abs(dx) > 1) sp.setFlipX(dx < 0);
      sp.setFrame(moving && Math.floor(this.time.now / 160) % 2 ? 1 : 0);
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
    this.night.setFillStyle(0x0a0f2c, dark);
    const flicker = 0.85 + Math.sin(time / 130) * 0.05 + Math.sin(time / 47) * 0.04;
    const glow = Math.min(0.5, (dark + (this.indoorDim ? 0.15 : 0)) * 0.75) * flicker;
    for (const g of this.glows) g.setAlpha(glow * 1.6);
    const lit = Math.max(0, Math.min(0.85, (dark - 0.12) * 1.6));
    for (const w of this.windowGlows) w.setFillStyle(0xffc060, lit * (0.9 + Math.sin(time / 600 + w.x) * 0.06));
  }

  override update(time: number): void {
    const client = this.client;
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

    // Fixed-step input simulation (matches the server's 20 Hz movement steps).
    this.acc += Math.min(delta, 300);
    let steps = 0;
    while (this.acc >= 50 && steps < 8) {
      client.step(this.readInput());
      this.acc -= 50;
      steps++;
    }
    const alpha = Math.min(1, this.acc / 50);

    // Decay any reconciliation correction smoothly.
    const decay = Math.pow(0.001, delta / 1000);
    client.correction.x *= decay;
    client.correction.y *= decay;
    if (Math.abs(client.correction.x) < 0.05) client.correction.x = 0;
    if (Math.abs(client.correction.y) < 0.05) client.correction.y = 0;

    const lx = client.prevPos.x + (client.pos.x - client.prevPos.x) * alpha + client.correction.x;
    const ly = client.prevPos.y + (client.pos.y - client.prevPos.y) * alpha + client.correction.y;
    this.setAvatarMount(this.local, client.ui.get().self?.mount, client.ui.get().self?.mountLook);
    this.placeAvatar(this.local, lx, ly, client.dir, client.moving, time, { sit: client.pose === 'sit', speed: client.speed() });
    this.drawMountChannel(lx, ly);
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
      v.sprite.setPosition(rx, ry + 2).setDepth(m.y).setFrame(m.moving ? Math.floor(time / 180) % 2 : 0).setFlipX(m.dir === 'left');
      const top = ry - v.sprite.displayHeight - 2;
      v.label.setPosition(rx, top - 6);
      v.bar.clear();
      if (m.hp < 100 || id === tid) {
        v.bar.fillStyle(0x2a2030, 1).fillRect(rx - 15, top - 4, 30, 5);
        v.bar.fillStyle(m.hp > 50 ? 0x5fd45a : m.hp > 25 ? 0xe0a52e : 0xd64545, 1).fillRect(rx - 14, top - 3, Math.max(0, Math.round((28 * m.hp) / 100)), 3);
      }
      if (id === tid) this.targetRing.lineStyle(2, 0xff5a5a, 0.9).strokeEllipse(rx, ry, Math.max(26, v.sprite.displayWidth * 0.9), 12);
    }
    if (tid && this.remotes.has(tid)) {
      const av = this.remotes.get(tid)!;
      this.targetRing.lineStyle(2, 0xff5a5a, 0.9).strokeEllipse(av.sprite.x, av.sprite.y, 28, 12);
    }
    for (const av of this.npcAvatars.values()) {
      av.bubble?.setPosition(av.sprite.x, av.sprite.y - 64);
    }

    // Interaction prompt for the nearest NPC.
    const npc = client.nearestNpc();
    const ui = client.ui.get();
    if (npc && !ui.dialogue) {
      const av = this.npcAvatars.get(npc.id)!;
      const touch = touchInput.active || window.matchMedia('(pointer: coarse)').matches;
      this.prompt.setText(touch ? `Talk to ${npc.name}` : `[E] Talk to ${npc.name}`).setPosition(av.sprite.x, av.sprite.y - 66).setVisible(true);
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
      if (av) mk.setPosition(av.sprite.x, av.sprite.y - 62 + Math.sin(time / 220) * 3);
    }
    this.drawGuide(time, lx, ly);

    // Crops grow on their own: refresh visuals a couple of times per second.
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
