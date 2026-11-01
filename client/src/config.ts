/**
 * Client-only constants. Gameplay constants that the server also needs
 * live in `shared/config/balance.ts` instead - this file is strictly
 * presentation/connection config.
 */

/** SPEC.md section 2: "orthogonal grid of 48x48 px tiles". */
export const TILE_SIZE_PX = 48;

/** SPEC.md section 6: paper-doll frames are 64x64 px (taller than a tile,
 * since the chibi style's oversized head means the sprite visually
 * overhangs the tile above the character's feet). */
export const SPRITE_FRAME_SIZE_PX = 64;

/** Vite env override for local dev against a non-default port; falls back
 * to the server's own default port (server/src/index.ts's `PORT`). */
const DEFAULT_WS_URL = 'ws://localhost:8080';
export const WS_URL = (import.meta.env.VITE_WS_URL as string | undefined) ?? DEFAULT_WS_URL;

/** How far ahead of the authoritative snapshot the LOCAL player's own
 * movement is allowed to drift before being snapped back, in tiles,
 * rather than smoothly corrected (docs/DECISIONS.md: client prediction). */
export const RECONCILE_SNAP_THRESHOLD_TILES = 1.5;

/** Remote entities (every entity that isn't the local player) are
 * interpolated this far behind the latest snapshot (SPEC.md section 2:
 * "interpolated about 100ms behind"), smoothing over the gap between
 * 20Hz server snapshots arriving at an uneven client frame rate. */
export const REMOTE_INTERPOLATION_DELAY_MS = 100;

export const CHAT_CHANNELS = ['all', 'map', 'system'] as const;
export type ChatTab = (typeof CHAT_CHANNELS)[number];

export const LOCAL_STORAGE_KEYS = {
  keybinds: 'terago.keybinds.v1',
  settings: 'terago.settings.v1',
} as const;
