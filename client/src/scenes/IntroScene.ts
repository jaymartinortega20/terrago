/**
 * The story intro (SPEC.md section 4): three text scrolls with a
 * typewriter effect, each over its own dark, painterly illustration that
 * cross-fades in and slowly pans/zooms (Ken Burns). Click/Space shows the
 * rest of the current scroll at once, then advances; Esc skips the whole
 * intro. After the third scroll, a soft chime plays and the scene fades
 * to WorldScene, sending `intro:seen` so a later login skips straight
 * past this scene (handled server-side by sim/room.ts's
 * handleIntroSeen).
 *
 * The spec also describes what happens AFTER this scene - "the camera
 * glides down from the sky into the fixed view of Map 1... the player's
 * chibi character plays a short wake-up animation beside the town's
 * central Waystone" - but that choreography needs the real tilemap and a
 * placed Waystone entity, which is task #80's WorldScene rebuild, not
 * this stand-in. This scene's job ends at the fade-to-World handoff; the
 * `wakeUp` pose/animation already exists (pose.ts, paperDollAnims.ts) and
 * is ready for WorldScene to use once it has somewhere real to play it.
 */
import Phaser from 'phaser';
import { sceneContext } from '../state/sceneContext.js';
import { playSoftChime } from '../audio/chime.js';

/** SPEC.md section 4: "Use this text exactly as written." */
const SCROLL_TEXTS = [
  'For a thousand generations, the core of Terago hummed in absolute balance, suspended in a sea of clouds. Its lifeblood—Aetherite Crystals—was protected by the floating island temples.',
  'Then came the Fracture. A violent, unknown surge tore through the lower strata, shattering the crystals and pulling the World Bosses from their dormant slumbers. Darkness spilled into the fields, and the world began to bleed.',
  'You awake as a newly arrived Recruit in Oakhaven Sanctuary, the last standing safe haven. Your memory is fractured, but the call in your veins is clear: mend the crystal core, or watch Terago fall into the endless abyss.',
] as const;

const TYPEWRITER_CHARS_PER_SECOND = 32;
const KEN_BURNS_DURATION_MS = 10000;

export class IntroScene extends Phaser.Scene {
  private scrollIndex = 0;
  private typingElapsedMs = 0;
  private fullyShown = false;
  private finishing = false;
  private background?: Phaser.GameObjects.Image;
  private textObject!: Phaser.GameObjects.Text;

  constructor() {
    super('Intro');
  }

  create(): void {
    const { width, height } = this.scale;
    this.scrollIndex = 0;
    this.finishing = false;
    this.background = undefined;
    this.cameras.main.setBackgroundColor('#000000');

    const barHeight = Math.round(height * 0.14);
    this.add.rectangle(0, 0, width, barHeight, 0x000000).setOrigin(0).setDepth(50);
    this.add.rectangle(0, height - barHeight, width, barHeight, 0x000000).setOrigin(0).setDepth(50);

    this.textObject = this.add
      .text(width / 2, height - barHeight / 2, '', {
        fontFamily: 'Georgia, serif',
        fontSize: '20px',
        color: '#f0e9ff',
        align: 'center',
        wordWrap: { width: width * 0.78 },
        lineSpacing: 6,
      })
      .setOrigin(0.5)
      .setDepth(51);

    const hint = this.add
      .text(width - 16, height - 16, 'Click / Space to continue — Esc to skip', {
        fontFamily: 'sans-serif',
        fontSize: '12px',
        color: '#8a7aa0',
      })
      .setOrigin(1)
      .setDepth(51);
    this.tweens.add({ targets: hint, alpha: { from: 0.4, to: 0.9 }, duration: 1400, yoyo: true, repeat: -1 });

    this.showScroll(0);

    const keyboard = this.input.keyboard;
    const onSpace = (): void => this.advance();
    const onEsc = (): void => this.skip();
    const onPointerDown = (): void => this.advance();
    keyboard?.on('keydown-SPACE', onSpace);
    keyboard?.on('keydown-ESC', onEsc);
    this.input.on('pointerdown', onPointerDown);

    this.events.once('shutdown', () => {
      keyboard?.off('keydown-SPACE', onSpace);
      keyboard?.off('keydown-ESC', onEsc);
      this.input.off('pointerdown', onPointerDown);
    });
  }

  update(_time: number, delta: number): void {
    if (this.fullyShown || this.finishing) return;
    this.typingElapsedMs += delta;
    const fullText = SCROLL_TEXTS[this.scrollIndex]!;
    const targetChars = Math.floor(this.typingElapsedMs / (1000 / TYPEWRITER_CHARS_PER_SECOND));
    if (targetChars >= fullText.length) {
      this.textObject.setText(fullText);
      this.fullyShown = true;
    } else {
      this.textObject.setText(fullText.slice(0, targetChars));
    }
  }

  private showScroll(index: number): void {
    this.scrollIndex = index;
    this.typingElapsedMs = 0;
    this.fullyShown = false;
    this.textObject.setText('');

    const { width, height } = this.scale;
    const key = `intro_bg_scroll${index + 1}`;
    const bg = this.add.image(width / 2, height / 2, key).setDepth(0).setAlpha(0);
    const coverScale = Math.max(width / bg.width, height / bg.height) * 1.12;
    bg.setScale(coverScale);

    const previous = this.background;
    this.background = bg;

    this.tweens.add({ targets: bg, alpha: 1, duration: 700 });
    if (previous) {
      this.tweens.add({ targets: previous, alpha: 0, duration: 700, onComplete: () => previous.destroy() });
    }

    // Ken Burns: a slow drift and zoom for as long as the scroll is on screen.
    this.tweens.add({
      targets: bg,
      scale: coverScale * 1.12,
      x: bg.x + (index % 2 === 0 ? -36 : 36),
      duration: KEN_BURNS_DURATION_MS,
      ease: 'Sine.easeInOut',
    });
  }

  private advance(): void {
    if (this.finishing) return;
    if (!this.fullyShown) {
      this.textObject.setText(SCROLL_TEXTS[this.scrollIndex]!);
      this.fullyShown = true;
      return;
    }
    if (this.scrollIndex < SCROLL_TEXTS.length - 1) {
      this.showScroll(this.scrollIndex + 1);
    } else {
      this.finish();
    }
  }

  private skip(): void {
    if (this.finishing) return;
    this.finish();
  }

  private finish(): void {
    this.finishing = true;
    playSoftChime();

    const targets: Phaser.GameObjects.GameObject[] = [this.textObject];
    if (this.background) targets.push(this.background);

    this.tweens.add({
      targets,
      alpha: 0,
      duration: 600,
      onComplete: () => {
        const { net } = sceneContext(this);
        net.send({ t: 'intro:seen' });
        this.scene.start('World');
      },
    });
  }
}
