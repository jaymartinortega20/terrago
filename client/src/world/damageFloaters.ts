/**
 * Combat feedback floaters (task #82, SPEC.md section 11 "Damage
 * feedback"): spawns a tweened Phaser Text - plus, for a crit, a
 * starburst shape behind it - above an entity's container and lets it
 * float up and fade. Deliberately *not* re-tracked to the entity's
 * subsequent movement once spawned (standard MMO damage-floater
 * behavior): WorldScene hands this a snapshot of where the hit landed,
 * not a live reference it has to keep updating every frame.
 */
import Phaser from 'phaser';

export type FloaterKind = 'normal' | 'crit' | 'miss' | 'lucky' | 'heal';

const FLOAT_UP_PX = 46;
const LIFETIME_MS = 900;
/** Just above the name label (entityView.ts's NAME_OFFSET_Y = -56), so a
 * floater starts above the entity's head rather than overlapping it. */
const SPAWN_OFFSET_Y = -62;
/** Comfortably above every world depth (tiles/entities depth by world y,
 * which never exceeds a map's pixel height), so a floater is never hidden
 * behind a tall tile or another entity. */
const DEPTH = 5_000_000;

function textFor(kind: FloaterKind, amount: number | undefined): string {
  switch (kind) {
    case 'miss':
      return 'Miss';
    case 'lucky':
      return 'Lucky!';
    case 'heal':
      return `+${amount ?? 0}`;
    default:
      return String(amount ?? 0);
  }
}

function styleFor(kind: FloaterKind): Phaser.Types.GameObjects.Text.TextStyle {
  const base: Phaser.Types.GameObjects.Text.TextStyle = {
    fontFamily: 'sans-serif',
    fontSize: '18px',
    fontStyle: 'bold',
    color: '#ffffff',
    stroke: '#000000',
    strokeThickness: 3,
  };
  switch (kind) {
    case 'crit':
      // SPEC.md: "large gold numbers inside a jagged starburst".
      return { ...base, fontSize: '30px', color: '#ffd700', stroke: '#5c3d00', strokeThickness: 4 };
    case 'miss':
    case 'lucky':
      // SPEC.md: "Miss and Lucky (perfect dodge): italic cursive text."
      return { ...base, fontSize: '16px', fontStyle: 'italic', fontFamily: 'cursive, Georgia, serif', color: '#e8e4da' };
    case 'heal':
      // SPEC.md: "Healing: green numbers."
      return { ...base, color: '#4ade80' };
    default:
      return base;
  }
}

export class DamageFloaters {
  constructor(private readonly scene: Phaser.Scene) {}

  spawn(container: Phaser.GameObjects.Container, kind: FloaterKind, amount?: number): void {
    const jitterX = Phaser.Math.Between(-10, 10);
    const x = container.x + jitterX;
    const y = container.y + SPAWN_OFFSET_Y;

    const label = this.scene.add.text(x, y, textFor(kind, amount), styleFor(kind)).setOrigin(0.5).setDepth(DEPTH);

    const extras: Phaser.GameObjects.GameObject[] = [];
    if (kind === 'crit') {
      // A jagged 8-point star behind the number, scaling in alongside it.
      const star = this.scene.add.star(x, y, 8, 10, 22, 0xffd700, 0.5).setDepth(DEPTH - 1).setScale(0.3);
      extras.push(star);
      this.scene.tweens.add({ targets: star, scale: 1.1, alpha: { from: 0.5, to: 0 }, duration: LIFETIME_MS, ease: 'Cubic.easeOut' });
      // Small screen shake + a hit flash (the latter is the caller's job -
      // it has the target view, this module only knows about containers).
      this.scene.cameras.main.shake(120, 0.004);
    }

    label.setScale(kind === 'crit' ? 0.4 : 0.7);
    this.scene.tweens.add({
      targets: label,
      scale: kind === 'crit' ? 1.3 : 1,
      y: y - FLOAT_UP_PX,
      alpha: { from: 1, to: 0, delay: LIFETIME_MS * 0.5, duration: LIFETIME_MS * 0.5 },
      duration: LIFETIME_MS,
      ease: 'Back.easeOut',
      onComplete: () => {
        label.destroy();
        for (const extra of extras) extra.destroy();
      },
    });
  }
}
