/**
 * The on-screen views for the two kinds of character WorldScene renders:
 * `EntityView` composites the 7 paper-doll layers + wings for a player
 * (local or remote); `MonsterView` is the much simpler single-sprite
 * equivalent for a monster. Both share a name label + thin HP bar and the
 * same "position by feet, depth-sort by y" convention (see
 * FOOT_ANCHOR_Y_RATIO) so a player and a monster standing on the same
 * tile sort correctly against each other. WorldScene owns *where* each
 * one's position comes from (local prediction vs. remote interpolation);
 * these only own how one entity is drawn given a position + display state.
 */
import Phaser from 'phaser';
import type { EntitySnapshot, EquipmentSlot, Facing } from '@terago/shared';
import { SPRITE_FRAME_SIZE_PX, TILE_SIZE_PX } from '../config.js';
import { monsterAnimKey, paperDollAnimKey, wingsAnimKey } from '../assets/paperDollAnims.js';
import { PAPER_DOLL_COMPOSITE_ORDER } from '../assets/paperDollManifest.js';
import { monsterSpriteIdFor } from '../assets/monsterManifest.js';
import type { PaperDollFacing as PdFacing } from '../assets/generators/paperDoll.js';

/** paperDoll.ts's computeAnchors has footY = 60 (+/- a small pose bob)
 * out of a 64px frame - using that as every sprite's origin.y means a
 * sprite positioned at (worldX, worldY) has its FEET at (worldX,
 * worldY), which is what tile-grid placement and y-sorting both want.
 * The monster sprites (generators/monsters.ts) were drawn to the same
 * convention specifically so this one ratio covers both view types. */
const FOOT_ANCHOR_Y_RATIO = 60 / SPRITE_FRAME_SIZE_PX;

const HP_BAR_WIDTH = 28;
const HP_BAR_HEIGHT = 4;
const HP_BAR_OFFSET_Y = -46;
const NAME_OFFSET_Y = -56;

export type DisplayKind = 'player' | 'monster';

export interface EntityVisualState {
  x: number;
  y: number;
  facing: Facing;
  anim: EntitySnapshot['anim'];
  mounted: boolean;
  hpPct: number;
  equipment: Partial<Record<EquipmentSlot, string | null>>;
}

/** 'right' is never generated (SPEC.md: "mirrored left") - every sprite
 * in a view uses the 'left' textures with flipX when facing right. */
function textureFacing(facing: Facing): { pdFacing: PdFacing; flipX: boolean } {
  if (facing === 'right') return { pdFacing: 'left', flipX: true };
  return { pdFacing: facing, flipX: false };
}

interface NameAndHpBar {
  nameText: Phaser.GameObjects.Text;
  hpBarBg: Phaser.GameObjects.Rectangle;
  hpBarFill: Phaser.GameObjects.Rectangle;
}

function createNameAndHpBar(scene: Phaser.Scene, kind: DisplayKind, name: string): NameAndHpBar {
  const hpBarBg = scene.add.rectangle(0, HP_BAR_OFFSET_Y, HP_BAR_WIDTH, HP_BAR_HEIGHT, 0x000000, 0.55).setOrigin(0.5);
  const hpBarFill = scene.add
    .rectangle(-HP_BAR_WIDTH / 2, HP_BAR_OFFSET_Y, HP_BAR_WIDTH, HP_BAR_HEIGHT - 1, kind === 'player' ? 0x5fd15f : 0xd1595f)
    .setOrigin(0, 0.5);
  const nameText = scene.add
    .text(0, NAME_OFFSET_Y, name, {
      fontFamily: 'sans-serif',
      fontSize: '11px',
      color: kind === 'player' ? '#dce8ff' : '#ffd0d0',
      stroke: '#000000',
      strokeThickness: 3,
    })
    .setOrigin(0.5);
  return { nameText, hpBarBg, hpBarFill };
}

function updateHpBar(bar: NameAndHpBar, hpPct: number): void {
  const pct = Math.max(0, Math.min(100, hpPct));
  bar.hpBarFill.width = (HP_BAR_WIDTH * pct) / 100;
  bar.hpBarBg.setVisible(pct < 100);
  bar.hpBarFill.setVisible(pct < 100);
}

/** A hit-test rectangle roughly covering the sprite from head to feet,
 * for click-to-target (WorldScene calls `container.setInteractive(...)`
 * with this, since a Container has no intrinsic size the way a Sprite
 * does). Shared by both view types since they're both one tile wide. */
export function entityHitArea(): Phaser.Geom.Rectangle {
  return new Phaser.Geom.Rectangle(-TILE_SIZE_PX / 2, -SPRITE_FRAME_SIZE_PX, TILE_SIZE_PX, SPRITE_FRAME_SIZE_PX);
}

/** How long a crit's "hit flash" (SPEC.md section 11) holds before
 * clearing - quick enough to read as a flash, not a tint. */
const HIT_FLASH_MS = 90;

export class EntityView {
  readonly container: Phaser.GameObjects.Container;
  private readonly scene: Phaser.Scene;
  private readonly wings: Phaser.GameObjects.Sprite;
  private readonly layers: Record<string, Phaser.GameObjects.Sprite>;
  private readonly bar: NameAndHpBar;

  constructor(scene: Phaser.Scene, name: string) {
    this.scene = scene;
    this.wings = scene.add.sprite(0, 0, 'pd_wings_down_0').setOrigin(0.5, FOOT_ANCHOR_Y_RATIO);

    this.layers = {};
    for (const layer of PAPER_DOLL_COMPOSITE_ORDER) {
      this.layers[layer] = scene.add.sprite(0, 0, `pd_${layer}_down_idle_0`).setOrigin(0.5, FOOT_ANCHOR_Y_RATIO);
    }

    this.bar = createNameAndHpBar(scene, 'player', name);

    this.container = scene.add.container(0, 0, [
      this.wings,
      ...PAPER_DOLL_COMPOSITE_ORDER.map((layer) => this.layers[layer]!),
      this.bar.hpBarBg,
      this.bar.hpBarFill,
      this.bar.nameText,
    ]);
  }

  setName(name: string): void {
    this.bar.nameText.setText(name);
  }

  /** Repositions the container in world pixels and sets its render depth
   * to its own y so taller neighbors (other characters, obstacle/Waystone
   * tiles - see world/tilemap.ts's isTallTile) sort correctly against it. */
  setWorldPosition(tileX: number, tileY: number): void {
    const px = tileX * TILE_SIZE_PX + TILE_SIZE_PX / 2;
    const py = tileY * TILE_SIZE_PX + TILE_SIZE_PX / 2;
    this.container.setPosition(px, py);
    this.container.setDepth(py);
  }

  update(state: Pick<EntityVisualState, 'facing' | 'anim' | 'mounted' | 'hpPct' | 'equipment'>): void {
    const { pdFacing, flipX } = textureFacing(state.facing);
    const animName = state.mounted ? 'mounted' : state.anim;

    this.wings.setFlipX(flipX);
    const wingsVisible = state.equipment.wings != null;
    this.wings.setVisible(wingsVisible);
    if (wingsVisible) this.wings.play(wingsAnimKey(pdFacing), true);

    for (const layer of PAPER_DOLL_COMPOSITE_ORDER) {
      const sprite = this.layers[layer]!;
      sprite.setFlipX(flipX);
      if (layer === 'weapon' || layer === 'helmet' || layer === 'chest' || layer === 'boots') {
        sprite.setVisible(state.equipment[layer] != null);
      }
      sprite.play(paperDollAnimKey(layer, pdFacing, animName), true);
    }

    updateHpBar(this.bar, state.hpPct);
  }

  /** A brief white tint flash across every visible layer, for a crit's
   * "hit flash on the target" (SPEC.md section 11). */
  flashHit(): void {
    const sprites = [this.wings, ...Object.values(this.layers)];
    for (const sprite of sprites) sprite.setTintFill(0xffffff);
    this.scene.time.delayedCall(HIT_FLASH_MS, () => {
      for (const sprite of sprites) sprite.clearTint();
    });
  }

  destroy(): void {
    this.container.destroy(); // destroys every added child too
  }
}

export class MonsterView {
  readonly container: Phaser.GameObjects.Container;
  private readonly scene: Phaser.Scene;
  private readonly sprite: Phaser.GameObjects.Sprite;
  private readonly bar: NameAndHpBar;
  private spriteId: string;

  constructor(scene: Phaser.Scene, name: string, monsterId: string | undefined) {
    this.scene = scene;
    this.spriteId = monsterSpriteIdFor(monsterId);
    this.sprite = scene.add.sprite(0, 0, `mon_${this.spriteId}_idle_0`).setOrigin(0.5, FOOT_ANCHOR_Y_RATIO);
    this.bar = createNameAndHpBar(scene, 'monster', name);
    this.container = scene.add.container(0, 0, [this.sprite, this.bar.hpBarBg, this.bar.hpBarFill, this.bar.nameText]);
  }

  setWorldPosition(tileX: number, tileY: number): void {
    const px = tileX * TILE_SIZE_PX + TILE_SIZE_PX / 2;
    const py = tileY * TILE_SIZE_PX + TILE_SIZE_PX / 2;
    this.container.setPosition(px, py);
    this.container.setDepth(py);
  }

  update(state: Pick<EntityVisualState, 'anim' | 'hpPct'>, monsterId: string | undefined): void {
    this.spriteId = monsterSpriteIdFor(monsterId);
    this.sprite.play(monsterAnimKey(this.spriteId, state.anim), true);
    updateHpBar(this.bar, state.hpPct);
  }

  /** Same role as EntityView.flashHit - kept as an identically-named
   * method on both view classes so WorldScene can call it without an
   * instanceof check. */
  flashHit(): void {
    this.sprite.setTintFill(0xffffff);
    this.scene.time.delayedCall(HIT_FLASH_MS, () => this.sprite.clearTint());
  }

  destroy(): void {
    this.container.destroy();
  }
}
