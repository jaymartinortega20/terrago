/**
 * The actual game world: tilemap, camera, movement, remote players and
 * monsters, HUD mounting. This is still a stand-in - task #80 replaces
 * its body with the real MapDef-driven tilemap renderer, client-side
 * prediction and world:snapshot-driven remote entity interpolation. For
 * now it proves the Boot -> Login -> Intro -> World pipeline actually
 * works end to end: it tiles the generated Oakhaven floor texture as a
 * background and spawns the local player's composed paper-doll sprite
 * playing its idle animation, confirming every texture and animation
 * BootScene registered actually renders correctly through real Phaser,
 * not just the canvas-to-canvas preview page.
 */
import Phaser from 'phaser';
import { TILE_SIZE_PX } from '../config.js';
import { paperDollAnimKey, wingsAnimKey } from '../assets/paperDollAnims.js';
import { PAPER_DOLL_LAYERS } from '../assets/paperDollManifest.js';
import { sceneContext } from '../state/sceneContext.js';

export class WorldScene extends Phaser.Scene {
  constructor() {
    super('World');
  }

  create(): void {
    const { net, gameState } = sceneContext(this);
    const { width, height } = this.scale;

    for (let x = 0; x < width; x += TILE_SIZE_PX) {
      for (let y = 0; y < height; y += TILE_SIZE_PX) {
        this.add.image(x, y, 'tile_oakhaven_floor_0').setOrigin(0).setDepth(0);
      }
    }

    const centerX = width / 2;
    const centerY = height / 2;
    for (const layer of PAPER_DOLL_LAYERS) {
      const sprite = this.add.sprite(centerX, centerY, `pd_${layer}_down_idle_0`).setDepth(10);
      sprite.play(paperDollAnimKey(layer, 'down', 'idle'));
    }
    const wings = this.add.sprite(centerX, centerY, 'pd_wings_down_0').setDepth(9);
    wings.play(wingsAnimKey('down'));

    const name = gameState.self?.name ?? 'Recruit';
    this.add
      .text(centerX, centerY - 60, `Welcome to Oakhaven Sanctuary, ${name}`, {
        fontFamily: 'sans-serif',
        fontSize: '16px',
        color: '#ffffff',
        backgroundColor: '#00000080',
        padding: { x: 8, y: 4 },
      })
      .setOrigin(0.5)
      .setDepth(20);

    net.onClose(() => {
      this.add
        .text(centerX, height - 40, 'Disconnected from server.', { fontFamily: 'sans-serif', fontSize: '14px', color: '#e34a4a' })
        .setOrigin(0.5)
        .setDepth(30);
    });
  }
}
