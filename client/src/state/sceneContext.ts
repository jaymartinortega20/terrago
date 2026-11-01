import type Phaser from 'phaser';
import type { NetClient } from '../net/NetClient.js';
import { GameState } from './GameState.js';
import { REGISTRY_KEYS } from './registryKeys.js';
import type { Hud } from '../ui/hud/Hud.js';

/** Typed access to the registry values main.ts seeds every scene with -
 * every scene calls this once in create() rather than casting
 * `this.registry.get(...)` by hand. `hud` is the one DOM overlay that
 * outlives any single scene (main.ts creates it once, WorldScene just
 * show()s/hide()s it) so a portal crossing's `scene.restart()` doesn't
 * tear down and rebuild the whole HUD. */
export function sceneContext(scene: Phaser.Scene): { net: NetClient; gameState: GameState; hud: Hud } {
  const net = scene.registry.get(REGISTRY_KEYS.net) as NetClient | undefined;
  const gameState = scene.registry.get(REGISTRY_KEYS.gameState) as GameState | undefined;
  const hud = scene.registry.get(REGISTRY_KEYS.hud) as Hud | undefined;
  if (!net || !(gameState instanceof GameState) || !hud) {
    throw new Error('sceneContext: main.ts must seed the registry with net/gameState/hud before any scene starts');
  }
  return { net, gameState, hud };
}
