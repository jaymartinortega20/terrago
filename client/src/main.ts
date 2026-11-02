/**
 * Game bootstrap: creates the Phaser.Game instance and registers every
 * scene. NetClient and GameState are created once here and shared across
 * every scene through Phaser's registry (`this.registry.get(...)`) rather
 * than each scene owning its own - a fresh NetClient per scene would drop
 * the WebSocket connection on every scene transition.
 */
import Phaser from 'phaser';
import './ui/styles.css';
import { NetClient } from './net/NetClient.js';
import { GameState } from './state/GameState.js';
import { REGISTRY_KEYS } from './state/registryKeys.js';
import { BootScene } from './scenes/BootScene.js';
import { LoginScene } from './scenes/LoginScene.js';
import { IntroScene } from './scenes/IntroScene.js';
import { WorldScene } from './scenes/WorldScene.js';
import { Hud } from './ui/hud/Hud.js';

const netClient = new NetClient();
const gameState = new GameState();
netClient.onMessage((message) => gameState.handleServerMessage(message));
// Created once, alongside net/gameState, rather than per-scene - a scene
// restart (e.g. WorldScene's on a portal crossing) must not tear down and
// rebuild the whole DOM HUD (docs/DECISIONS.md, task #81).
const hud = new Hud(netClient, gameState);

const game = new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'app',
  backgroundColor: '#0a0710',
  scale: {
    mode: Phaser.Scale.RESIZE,
    autoCenter: Phaser.Scale.CENTER_BOTH,
    width: '100%',
    height: '100%',
  },
  render: {
    pixelArt: false,
    antialias: true,
  },
  scene: [BootScene, LoginScene, IntroScene, WorldScene],
});

hud.setGame(game);
game.registry.set(REGISTRY_KEYS.net, netClient);
game.registry.set(REGISTRY_KEYS.gameState, gameState);
game.registry.set(REGISTRY_KEYS.hud, hud);
