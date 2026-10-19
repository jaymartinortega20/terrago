/**
 * Simulation and networking constants shared by client and server.
 *
 * Balance and economy numbers (prices, XP curve, starting gold, fees...) do NOT
 * live here — they are data in @terrago/game-data so they can be tuned without
 * touching code. These values define how the simulation itself works, and the
 * client and server must agree on them exactly for prediction to line up.
 */

/** Bumped whenever the socket protocol changes incompatibly. */
export const PROTOCOL_VERSION = 1;

/** World tile size in pixels. Art is authored at 16px and drawn 2x. */
export const TILE_SIZE = 32;

export const SIM = {
  /** Authoritative server simulation rate (ticks per second). */
  tickRate: 20,
  /** One movement command covers exactly this much time (ms). Must equal 1000 / tickRate. */
  stepMs: 50,
  /** Snapshots are sent every N ticks (20 / 2 = 10 snapshots per second). */
  snapshotEveryTicks: 2,
  /** Remote entities are rendered this far in the past to interpolate smoothly. */
  interpolationDelayMs: 160,
} as const;

/** Player feet collision box, relative to the player's position (bottom-centre of the feet). */
export const PLAYER_BODY = {
  halfWidth: 9,
  height: 10,
} as const;

/** Walking speed in pixels per second (3.5 tiles/s). */
export const PLAYER_SPEED = 112;

/** Max perpendicular nudge (px) that helps players slide around corners and into doorways. */
export const CORNER_ASSIST_PX = 8;

/** Anti speed-hack: movement budget a player may bank while idle, and input queue cap. */
export const MOVEMENT_GUARD = {
  maxBudgetMs: 300,
  maxQueuedInputs: 20,
} as const;

/** How close (px) a player must be to talk to an NPC. Validated on the server. */
export const INTERACT_RANGE = 80;

/**
 * Area of interest (px, half-extents). Entities enter view inside the "enter"
 * box and leave beyond the larger "leave" box (hysteresis avoids flicker).
 */
export const AOI = {
  enterHalfWidth: 24 * TILE_SIZE,
  enterHalfHeight: 16 * TILE_SIZE,
  leaveHalfWidth: 28 * TILE_SIZE,
  leaveHalfHeight: 20 * TILE_SIZE,
} as const;

/**
 * The camera may never show more world than this (px). Larger screens zoom in
 * instead of seeing further, so nobody gains information by resizing.
 */
export const MAX_VIEW = { width: 1280, height: 800 } as const;

export const CHAT = {
  maxLength: 160,
  /** Local chat reaches players within this radius (px) on the same map. */
  localRadius: 22 * TILE_SIZE,
  /** Speech bubble lifetime on the client (ms). */
  bubbleMs: 6000,
  /** Token bucket: burst size and refill interval per token. */
  burst: 5,
  refillMs: 2000,
} as const;

/** Disconnect grace period: a dropped player lingers this long so a refresh can reattach. */
export const RECONNECT_GRACE_MS = 8000;

export const ACCOUNT = {
  maxCharacters: 3,
  passwordMinLength: 10,
  passwordMaxLength: 128,
} as const;

export const DIRECTIONS = ['down', 'left', 'right', 'up'] as const;
