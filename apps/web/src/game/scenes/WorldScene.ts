import Phaser from 'phaser';
import { getCrop, getNode } from '@terrago/game-data';
import {
  CHAT,
  MAX_VIEW,
  TILE_SIZE,
  cropStatus,
  tileCenter,
  type Appearance,
  type ChatMessage,
  type Direction,
  type MoveInput,
  type NpcAccessory,
  type WorldObject,
} from '@terrago/shared';
import { cropArt, needsWaterArt, readyArt, soilArt, type SoilState } from '../art/farm';
import { nodeArt } from '../art/nodes';
import { buildCharacterSheet, characterSheetKey } from '../art/characters';
import { TREE_VARIANTS, buildingArt, propArt, renderGround } from '../art/world';
import { isTyping, joystickToInput, touchInput } from '../input';
import type { GameClient, RemotePlayer } from '../net/client';

const DIR_ROW: Record<Direction, number> = { down: 0, left: 1, right: 2, up: 3 };
const WALK_CYCLE = [1, 0, 2, 0];
const LABEL_FONT = '"Pixelify Sans", monospace';
const LABEL_DEPTH = 1_000_000;

interface ObjectView {
  key: string;
  parts: Phaser.GameObjects.Image[];
}

interface Avatar {
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
    // Click / tap a nearby tile to use it.
    this.input.on('pointerdown', (ptr: Phaser.Input.Pointer) => {
      if (ptr.button !== 0 || this.client.ui.get().dialogue) return;
      const wp = this.cameras.main.getWorldPoint(ptr.x, ptr.y);
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

  private destroyAvatar(av: Avatar): void {
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
    if (this.local) this.destroyAvatar(this.local);

    const W = map.width * TILE_SIZE;
    const H = map.height * TILE_SIZE;
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

  private addRemote(r: RemotePlayer): void {
    if (!this.client.map || this.remotes.has(r.info.id)) return;
    this.remotes.set(r.info.id, this.makeAvatar(r.x, r.y, r.info.appearance, `${r.info.name} · Lv ${r.info.level}`, '#ffffff'));
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
    const col = moving ? WALK_CYCLE[Math.floor(time / 130) % 4]! : 0;
    av.sprite.setPosition(rx, ry + 2).setFrame(DIR_ROW[dir] * 3 + col).setDepth(y);
    av.label.setPosition(rx, ry - 46);
    av.bubble?.setPosition(rx, ry - 62);
  }

  override update(time: number): void {
    const client = this.client;
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
    this.placeAvatar(this.local, lx, ly, client.dir, client.moving, time);

    client.interpolateRemotes();
    for (const [id, r] of client.remotes) {
      const av = this.remotes.get(id);
      if (av) this.placeAvatar(av, r.x, r.y, r.dir, r.moving, time);
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
