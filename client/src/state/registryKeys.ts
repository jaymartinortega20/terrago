/**
 * Keys into Phaser's cross-scene registry (`game.registry`), where
 * main.ts puts the single shared NetClient and GameState so every scene
 * reads the same instances instead of each owning its own - split into
 * its own module (rather than living in main.ts) so scene files can
 * import it without a circular dependency back on main.ts, which has
 * top-level side effects (creating the Phaser.Game instance).
 */
export const REGISTRY_KEYS = {
  net: 'net',
  gameState: 'gameState',
} as const;
