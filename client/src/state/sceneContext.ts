import type Phaser from 'phaser';
import type { NetClient } from '../net/NetClient.js';
import { GameState } from './GameState.js';
import { REGISTRY_KEYS } from './registryKeys.js';

/** Typed access to the registry values main.ts seeds every scene with -
 * every scene calls this once in create() rather than casting
 * `this.registry.get(...)` by hand. */
export function sceneContext(scene: Phaser.Scene): { net: NetClient; gameState: GameState } {
  const net = scene.registry.get(REGISTRY_KEYS.net) as NetClient | undefined;
  const gameState = scene.registry.get(REGISTRY_KEYS.gameState) as GameState | undefined;
  if (!net || !(gameState instanceof GameState)) {
    throw new Error('sceneContext: main.ts must seed the registry with net/gameState before any scene starts');
  }
  return { net, gameState };
}
