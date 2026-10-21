import Phaser from 'phaser';
import { QUESTS, getCrop, getItem, getMap, getMonster, getNode, getQuest } from '@terrago/game-data';
import { itemIcon } from '../art/world';
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
  type Direction,
  type MoveInput,
  type NpcAccessory,
  type CombatEvent,
  type WorldObject,
  darknessAt,
  weatherRegion,
} from '@terrago/shared';
import { cropArt, needsWaterArt, readyArt, soilArt, type SoilState } from '../art/farm';
import { nodeArt } from '../art/nodes';
import { buildCharacterSheet, characterSheetKey } from '../art/characters';
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
  sprite: Phaser.GameObjects.Sprite;
  label: Phaser.GameObjects.Text;
  bubble: Phaser.GameObjects.Container | null;
  bubbleTimer: Phaser.Time.TimerEvent | null;
}

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

  create(): void {
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
      this.client.on('acted', ({ tx, ty }) => this.puff(tx, ty)),
      this.client.on('monsterAdd', (m) => this.addMonster(m)),
      this.client.on('monsterRemove', (id) => this.removeMonster(id)),
      this.client.on('combat', (ev) => this.showCombat(ev)),
      this.client.on('telegraph', (t) => this.showTelegraph(t)),
      this.client.on('look', (id) => {
        const r = this.client.remotes.get(id);
        const av = this.remotes.get(id);
        if (r && av) {
          this.setAvatarMount(av, r.info.mount);
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
      for (let row = 0; row < 4; row++) for (let col = 0; col < 3; col++) tex.add(row * 3 + col, 0, col * 32, row * 48, 32, 48);
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

  /** Show (or hide) the mount under an avatar. */
  private setAvatarMount(av: Avatar, mountId: string | null | undefined): void {
    if ((av.mountId ?? null) === (mountId ?? null)) return;
    av.mount?.destroy();
    av.mount = null;
    av.mountId = mountId ?? null;
    const def = mountId ? getItem(mountId)?.mount : undefined;
    if (!def) return;
    const key = `mount:${def.kind}:${def.color}`;
    if (!this.textures.exists(key)) {
      const sh = mountSheet(def.kind, def.color);
      const tex = this.textures.addCanvas(key, sh.canvas)!;
      tex.add(0, 0, 0, 0, sh.w * 2, sh.h * 2);
      tex.add(1, 0, sh.w * 2, 0, sh.w * 2, sh.h * 2);
    }
    av.mount = this.add.sprite(av.sprite.x, av.sprite.y, key, 0).setOrigin(0.5, 1);
  }

  private destroyAvatar(av: Avatar): void {
    av.mount?.destroy();
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

    const W = map.width * TILE_SIZE;
    const H = map.height * TILE_SIZE;
    // Night: a dark-blue veil over the world (under names), with warm glows around lights.
    this.night = this.add.rectangle(0, 0, W, H, 0x0a0f2c, 0).setOrigin(0, 0).setDepth(LABEL_DEPTH - 10);
    this.mapLayer.push(this.night);
    this.glows = [];
    const indoor = !weatherRegion(map.theme);
    this.indoorDim = indoor ? (map.dungeon ? 0.32 : 0.22) : 0;
    for (const o of map.objects) {
      if (o.kind !== 'prop' || !['lamp', 'torch', 'campfire'].includes(o.type)) continue;
      const key = this.canvasTexture('glow', () => {
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
      av.sprite.setFrame(DIR_ROW[n.dir] * 3);
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
    const badge = st.ready ? 'ready' : !st.watered ? 'dry' : '';
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

  /** Floating numbers for hits, crits, misses and heals. */
  private showCombat(events: CombatEvent[]): void {
    const me = this.client.ui.get().self?.characterId;
    for (const e of events) {
      const pos = this.entityPos(e.t);
      if (!pos) continue;
      if (e.k === 'death') continue;
      this.projectile(e);
      const mine = e.t === me;
      const text = e.k === 'miss' ? 'miss' : e.k === 'heal' ? `+${e.a}` : `${e.a}`;
      const color = e.k === 'heal' ? '#7cf06a' : e.k === 'miss' ? '#c8c8c8' : mine ? '#ff6a5a' : e.k === 'crit' ? '#ffb02e' : e.k === 'dot' ? '#b6f06a' : '#ffffff';
      const size = e.k === 'crit' ? '18px' : '14px';
      const t = this.add
        .text(pos.x + (Math.random() * 16 - 8), pos.y - pos.h - 4, e.k === 'crit' ? `${text}!` : text, { fontFamily: LABEL_FONT, fontSize: size, color, stroke: '#2a2030', strokeThickness: 4 })
        .setOrigin(0.5, 1)
        .setResolution(2)
        .setDepth(LABEL_DEPTH + 30);
      this.tweens.add({ targets: t, y: t.y - 26, alpha: 0, duration: 900, ease: 'Cubic.easeOut', onComplete: () => t.destroy() });
      const mv = this.monsterViews.get(e.t);
      if (mv && (e.k === 'hit' || e.k === 'crit' || e.k === 'dot')) {
        mv.sprite.setTintFill(0xffffff);
        this.time.delayedCall(70, () => mv.sprite.clearTint());
      }
    }
  }

  /** What flies from attacker to target: arrows for bows, orbs for magic. */
  private projectileKind(e: CombatEvent): { color: number; arrow: boolean; size: number } | null {
    const bySkill: Record<string, { color: number; arrow: boolean; size: number }> = {
      fireball: { color: 0xf5a623, arrow: false, size: 6 },
      smite: { color: 0xfff6a0, arrow: false, size: 5 },
      aimed_shot: { color: 0xe8dcc0, arrow: true, size: 3 },
      volley: { color: 0xe8dcc0, arrow: true, size: 3 },
      hunters_mark: { color: 0xe8a03a, arrow: true, size: 3 },
    };
    if (e.sk) return bySkill[e.sk] ?? null;
    if (e.k === 'heal' || e.k === 'dot') return null;
    const self = this.client.ui.get().self;
    let weaponItem: string | null | undefined = null;
    if (self && e.s === self.characterId) weaponItem = this.client.ui.get().inventory?.equipment?.find((x) => x.slot === 0)?.itemId;
    else if (this.client.remotes.has(e.s)) weaponItem = this.client.remotes.get(e.s)!.info.weapon;
    else {
      const m = this.client.monsters.get(e.s);
      if (m && getMonster(m.info.monsterId)?.magic) return { color: 0xb06ad6, arrow: false, size: 5 };
      return null;
    }
    const w = weaponItem ? getItem(weaponItem)?.equip : undefined;
    if (!w?.weapon) return null;
    if (w.weapon === 'bow') return { color: 0xe8dcc0, arrow: true, size: 3 };
    if (w.weapon === 'staff' || w.weapon === 'wand') return { color: 0x8fd0ff, arrow: false, size: 5 };
    return null;
  }

  private projectile(e: CombatEvent): void {
    const kind = this.projectileKind(e);
    const from = this.entityPos(e.s);
    const to = this.entityPos(e.t);
    if (!kind || !from || !to) return;
    const fx = from.x;
    const fy = from.y - from.h * 0.6;
    const tx = to.x;
    const ty = to.y - to.h * 0.5;
    if (Math.hypot(tx - fx, ty - fy) < 40) return;
    const angle = Math.atan2(ty - fy, tx - fx);
    const obj = kind.arrow
      ? this.add.rectangle(fx, fy, 14, kind.size, kind.color).setStrokeStyle(1, 0x2a2030).setRotation(angle)
      : this.add.circle(fx, fy, kind.size, kind.color).setStrokeStyle(2, 0xffffff, 0.6);
    obj.setDepth(LABEL_DEPTH + 25);
    this.tweens.add({ targets: obj, x: tx, y: ty, duration: Math.min(260, Math.hypot(tx - fx, ty - fy) * 1.1), onComplete: () => obj.destroy() });
  }

  private addRemote(r: RemotePlayer): void {
    if (!this.client.map || this.remotes.has(r.info.id)) return;
    const av = this.makeAvatar(r.x, r.y, r.info.appearance, remoteLabel(r.info), '#ffffff');
    this.remotes.set(r.info.id, av);
    this.setAvatarMount(av, r.info.mount);
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

  private placeAvatar(av: Avatar, x: number, y: number, dir: Direction, moving: boolean, time: number): void {
    const rx = Math.round(x);
    const ry = Math.round(y);
    const lift = av.mount ? 14 : 0;
    const col = av.mount ? 0 : moving ? WALK_CYCLE[Math.floor(time / 130) % 4]! : 0;
    av.sprite.setPosition(rx, ry + 2 - lift).setFrame(DIR_ROW[dir] * 3 + col).setDepth(y + 0.5);
    if (av.mount) av.mount.setPosition(rx, ry + 4).setFlipX(dir === 'left').setFrame(moving ? Math.floor(time / 110) % 2 : 0).setDepth(dir === 'up' ? y + 1 : y);
    av.label.setPosition(rx, ry - 46 - lift);
    av.bubble?.setPosition(rx, ry - 62 - lift);
  }

  private night: Phaser.GameObjects.Rectangle | null = null;
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
  }

  override update(time: number): void {
    const client = this.client;
    this.updateLighting(time);
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
    this.setAvatarMount(this.local, client.ui.get().self?.mount);
    this.placeAvatar(this.local, lx, ly, client.dir, client.moving, time);

    client.interpolateRemotes();
    for (const [id, r] of client.remotes) {
      const av = this.remotes.get(id);
      if (av) this.placeAvatar(av, r.x, r.y, r.dir, r.moving, time);
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

function remoteLabel(info: { name: string; level: number; guild?: string | null }): string {
  return `${info.guild ? `[${info.guild}] ` : ''}${info.name} · Lv ${info.level}`;
}
