/**
 * The actual game world (task #80): tilemap rendering, camera follow +
 * clamp, local-player click-to-move/WASD with prediction + server
 * reconciliation, and every remote entity (other players and monsters)
 * rendered from world:snapshot with ~100ms interpolation. Combat feedback
 * (damage floaters, hit flashes, AUTO mode) and the DOM HUD are separate,
 * later tasks (#81/#82) layered on top of what this scene already renders
 * and already sends intents for.
 */
import Phaser from 'phaser';
import { MAPS, type EntitySnapshot, type EquipmentSlot, type Facing, type MapDef } from '@terago/shared';
import { REMOTE_INTERPOLATION_DELAY_MS, TILE_SIZE_PX } from '../config.js';
import { sceneContext } from '../state/sceneContext.js';
import type { SelfState } from '../state/GameState.js';
import { isTallTile, tileKeyFor } from '../world/tilemap.js';
import {
  createLocalPrediction,
  predictMoveDir,
  predictMoveTo,
  reconcile,
  stepLocalPrediction,
  type LocalPredictionState,
} from '../world/localPrediction.js';
import { RemoteInterpolator } from '../world/remoteInterpolation.js';
import { EntityView, MonsterView, entityHitArea } from '../world/entityView.js';

interface LocalDisplayState {
  anim: EntitySnapshot['anim'];
  hpPct: number;
  mounted: boolean;
  equipment: Partial<Record<EquipmentSlot, string | null>>;
}

interface RemoteEntry {
  kind: 'player' | 'monster';
  view: EntityView | MonsterView;
  interp: RemoteInterpolator;
  name: string;
  facing: Facing;
  anim: EntitySnapshot['anim'];
  hpPct: number;
  mounted: boolean;
  equipment: Partial<Record<EquipmentSlot, string | null>>;
  monsterId?: string;
}

type WasdKeys = Record<'W' | 'A' | 'S' | 'D', Phaser.Input.Keyboard.Key>;

export class WorldScene extends Phaser.Scene {
  private net!: ReturnType<typeof sceneContext>['net'];
  private gameState!: ReturnType<typeof sceneContext>['gameState'];
  private map!: MapDef;
  private loadedMapId: string | null = null;
  private localId: string | null = null;

  private localPredictionState!: LocalPredictionState;
  private localView!: EntityView;
  private localDisplay: LocalDisplayState = { anim: 'idle', hpPct: 100, mounted: false, equipment: {} };

  private readonly remotes = new Map<string, RemoteEntry>();
  private wasdKeys: WasdKeys | null = null;
  private lastSentDir = { dx: 0, dy: 0 };
  private unsubscribers: Array<() => void> = [];

  constructor() {
    super('World');
  }

  create(): void {
    const { net, gameState } = sceneContext(this);
    this.net = net;
    this.gameState = gameState;

    const mapId = gameState.mapId ?? 'map1';
    this.map = MAPS[mapId]!;
    this.loadedMapId = mapId;
    this.localId = gameState.self?.characterId ?? null;
    this.remotes.clear();
    this.lastSentDir = { dx: 0, dy: 0 };

    this.cameras.main.setBackgroundColor('#0a0710');
    this.renderTilemap();
    this.renderNpcMarkers();
    this.createLocalPlayer();
    this.seedKnownEntities();
    this.wireInput();
    this.wireGameState();

    this.events.once('shutdown', () => this.cleanup());
  }

  update(_time: number, delta: number): void {
    const dtSeconds = delta / 1000;

    this.pollWasd();
    stepLocalPrediction(this.localPredictionState, this.map, dtSeconds);
    this.localView.setWorldPosition(this.localPredictionState.x, this.localPredictionState.y);
    this.localView.update({
      facing: this.localPredictionState.facing,
      anim: this.localDisplay.anim,
      mounted: this.localDisplay.mounted,
      hpPct: this.localDisplay.hpPct,
      equipment: this.localDisplay.equipment,
    });

    const now = performance.now();
    for (const entry of this.remotes.values()) {
      const pos = entry.interp.positionAt(now, REMOTE_INTERPOLATION_DELAY_MS);
      if (!pos) continue;
      entry.view.setWorldPosition(pos.x, pos.y);
      if (entry.view instanceof EntityView) {
        entry.view.update({ facing: entry.facing, anim: entry.anim, mounted: entry.mounted, hpPct: entry.hpPct, equipment: entry.equipment });
      } else {
        entry.view.update({ anim: entry.anim, hpPct: entry.hpPct }, entry.monsterId);
      }
    }
  }

  // ------------------------------------------------------------ setup

  private renderTilemap(): void {
    for (let y = 0; y < this.map.height; y++) {
      for (let x = 0; x < this.map.width; x++) {
        const image = this.add.image(x * TILE_SIZE_PX + TILE_SIZE_PX / 2, y * TILE_SIZE_PX + TILE_SIZE_PX / 2, tileKeyFor(this.map, x, y));
        image.setDepth(isTallTile(this.map, x, y) ? y * TILE_SIZE_PX + TILE_SIZE_PX / 2 : 0);
      }
    }
    this.cameras.main.setBounds(0, 0, this.map.width * TILE_SIZE_PX, this.map.height * TILE_SIZE_PX);
  }

  private renderNpcMarkers(): void {
    for (const npc of this.map.npcs) {
      const px = npc.x * TILE_SIZE_PX + TILE_SIZE_PX / 2;
      const py = npc.y * TILE_SIZE_PX + TILE_SIZE_PX / 2;
      const circle = this.add.circle(0, 0, TILE_SIZE_PX * 0.3, 0x3cb4e2).setStrokeStyle(2, 0x1f6b8a);
      const label = this.add
        .text(0, -TILE_SIZE_PX * 0.55, npc.name, {
          fontFamily: 'sans-serif',
          fontSize: '11px',
          color: '#bfe9ff',
          stroke: '#000000',
          strokeThickness: 3,
        })
        .setOrigin(0.5);
      const container = this.add.container(px, py, [circle, label]);
      container.setDepth(py);
      container.setData('entityId', npc.id);
      container.setInteractive(entityHitArea(), Phaser.Geom.Rectangle.Contains);
    }
  }

  private createLocalPlayer(): void {
    const localEntity = this.gameState.localEntity();
    const self = this.gameState.self;
    const startX = localEntity?.x ?? this.map.spawnPoint.x;
    const startY = localEntity?.y ?? this.map.spawnPoint.y;

    this.localPredictionState = createLocalPrediction(startX, startY, localEntity?.facing ?? 'down');
    this.localDisplay = {
      anim: localEntity?.anim ?? 'idle',
      hpPct: localEntity?.hpPct ?? Math.round(((self?.hp ?? 1) / (self?.maxHp ?? 1)) * 100),
      mounted: localEntity?.mounted ?? false,
      equipment: localEntity?.equipment ?? self?.equipment ?? {},
    };

    this.localView = new EntityView(this, self?.name ?? 'Recruit');
    this.localView.setWorldPosition(startX, startY);
    this.localView.update({
      facing: this.localPredictionState.facing,
      anim: this.localDisplay.anim,
      mounted: this.localDisplay.mounted,
      hpPct: this.localDisplay.hpPct,
      equipment: this.localDisplay.equipment,
    });

    this.cameras.main.startFollow(this.localView.container, true, 0.12, 0.12);
  }

  /** world:snapshot entries that arrived before this scene existed (e.g.
   * between self:state and the scene transition) are already sitting in
   * GameState.entities - without this they'd only show up once the next
   * snapshot tick updates them, a visible pop-in on fresh map arrival. */
  private seedKnownEntities(): void {
    for (const [id, snapshot] of this.gameState.entities) {
      if (id === this.localId) continue;
      this.upsertRemote(snapshot);
    }
  }

  private wireInput(): void {
    const keyboard = this.input.keyboard;
    if (keyboard) {
      this.wasdKeys = keyboard.addKeys('W,A,S,D') as WasdKeys;
    }

    this.input.on('gameobjectdown', (_pointer: Phaser.Input.Pointer, gameObject: Phaser.GameObjects.GameObject) => {
      const entityId = gameObject.getData('entityId') as string | undefined;
      if (entityId) this.net.send({ t: 'target:set', entityId });
    });

    this.input.on('pointerdown', (pointer: Phaser.Input.Pointer) => this.handleGroundClick(pointer));
  }

  private wireGameState(): void {
    const unsubEntered = this.gameState.onEntityEntered.on((s) => this.handleEntitySnapshot(s));
    const unsubUpdated = this.gameState.onEntityUpdated.on((s) => this.handleEntitySnapshot(s));
    const unsubLeft = this.gameState.onEntityLeft.on((id) => this.handleEntityLeft(id));
    const unsubSelf = this.gameState.onSelfState.on((self) => this.handleSelfState(self));
    this.unsubscribers = [unsubEntered, unsubUpdated, unsubLeft, unsubSelf];
  }

  // ------------------------------------------------------------ input

  private handleGroundClick(pointer: Phaser.Input.Pointer): void {
    // A click landing on an interactive entity/NPC is handled entirely by
    // the 'gameobjectdown' listener above (target:set); only a click on
    // open ground should path the player there.
    if (this.input.hitTestPointer(pointer).length > 0) return;

    const world = this.cameras.main.getWorldPoint(pointer.x, pointer.y);
    const tileX = Math.floor(world.x / TILE_SIZE_PX);
    const tileY = Math.floor(world.y / TILE_SIZE_PX);

    if (!predictMoveTo(this.localPredictionState, this.map, { x: tileX, y: tileY })) return;
    this.net.send({ t: 'move:to', target: { x: tileX, y: tileY } });
    this.showDestinationMarker(tileX, tileY);
  }

  private showDestinationMarker(tileX: number, tileY: number): void {
    const px = tileX * TILE_SIZE_PX + TILE_SIZE_PX / 2;
    const py = tileY * TILE_SIZE_PX + TILE_SIZE_PX / 2;
    const marker = this.add.graphics({ x: px, y: py });
    marker.lineStyle(2, 0xffffff, 0.9);
    marker.strokeCircle(0, 0, TILE_SIZE_PX * 0.35);
    marker.setDepth(1_000_000);
    this.tweens.add({
      targets: marker,
      scale: { from: 1.4, to: 0.9 },
      alpha: { from: 1, to: 0 },
      duration: 450,
      onComplete: () => marker.destroy(),
    });
  }

  /** SPEC.md section 7: "Game keys are ignored while the chat box has
   * focus." There's no chat box yet (task #81), but the check costs
   * nothing and covers any future DOM text input the same way. */
  private isTextInputFocused(): boolean {
    const el = document.activeElement;
    return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA');
  }

  private pollWasd(): void {
    if (!this.wasdKeys || this.isTextInputFocused()) return;
    const dx = (this.wasdKeys.D.isDown ? 1 : 0) - (this.wasdKeys.A.isDown ? 1 : 0);
    const dy = (this.wasdKeys.S.isDown ? 1 : 0) - (this.wasdKeys.W.isDown ? 1 : 0);
    if (dx === this.lastSentDir.dx && dy === this.lastSentDir.dy) return;
    this.lastSentDir = { dx, dy };
    predictMoveDir(this.localPredictionState, dx, dy);
    this.net.send({ t: 'move:dir', dx, dy });
  }

  // ------------------------------------------------------------ gamestate wiring

  private handleEntitySnapshot(snapshot: EntitySnapshot): void {
    if (snapshot.id === this.localId) {
      reconcile(this.localPredictionState, { x: snapshot.x, y: snapshot.y });
      this.localDisplay = {
        anim: snapshot.anim,
        hpPct: snapshot.hpPct,
        mounted: snapshot.mounted ?? false,
        equipment: snapshot.equipment ?? {},
      };
      return;
    }
    this.upsertRemote(snapshot);
  }

  private upsertRemote(snapshot: EntitySnapshot): void {
    let entry = this.remotes.get(snapshot.id);
    if (!entry) {
      const view =
        snapshot.kind === 'player' ? new EntityView(this, snapshot.name) : new MonsterView(this, snapshot.name, snapshot.monsterId);
      view.container.setData('entityId', snapshot.id);
      view.container.setInteractive(entityHitArea(), Phaser.Geom.Rectangle.Contains);
      entry = {
        kind: snapshot.kind,
        view,
        interp: new RemoteInterpolator(),
        name: snapshot.name,
        facing: snapshot.facing,
        anim: snapshot.anim,
        hpPct: snapshot.hpPct,
        mounted: snapshot.mounted ?? false,
        equipment: snapshot.equipment ?? {},
        monsterId: snapshot.monsterId,
      };
      this.remotes.set(snapshot.id, entry);
    } else {
      entry.facing = snapshot.facing;
      entry.anim = snapshot.anim;
      entry.hpPct = snapshot.hpPct;
      entry.mounted = snapshot.mounted ?? entry.mounted;
      entry.equipment = snapshot.equipment ?? entry.equipment;
      entry.monsterId = snapshot.monsterId ?? entry.monsterId;
      if (entry.name !== snapshot.name) {
        entry.name = snapshot.name;
        if (entry.view instanceof EntityView) entry.view.setName(snapshot.name);
      }
    }
    entry.interp.push({ atMs: performance.now(), x: snapshot.x, y: snapshot.y });
  }

  private handleEntityLeft(id: string): void {
    const entry = this.remotes.get(id);
    if (!entry) return;
    entry.view.destroy();
    this.remotes.delete(id);
  }

  /** A portal/Waystone/`/tp` crossing is the only thing that changes
   * mapId - restarting the scene re-runs create() fresh against whichever
   * map gameState.mapId now names, rather than this scene trying to
   * rebuild its own tilemap/camera/entity state in place. */
  private handleSelfState(self: SelfState): void {
    if (this.loadedMapId !== null && self.mapId !== this.loadedMapId) {
      this.scene.restart();
    }
  }

  private cleanup(): void {
    for (const unsubscribe of this.unsubscribers) unsubscribe();
    this.unsubscribers = [];
    for (const entry of this.remotes.values()) entry.view.destroy();
    this.remotes.clear();
  }
}
