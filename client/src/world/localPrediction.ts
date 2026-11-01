/**
 * Client-side prediction for the LOCAL player only (SPEC.md section 2:
 * "Client-side prediction with server reconciliation for the local
 * player's movement"). Remote entities never predict - they're purely
 * interpolated from snapshots (see remoteInterpolation.ts).
 *
 * This wraps the exact same stepping primitives the server uses
 * (shared/src/movement.ts, moved there in a prior commit specifically so
 * this could import them instead of re-deriving the math by hand) - the
 * only client-specific addition is `reconcile`, which the server has no
 * need for since it never predicts anything.
 */
import {
  BALANCE,
  distanceTiles,
  facingFromVector,
  setMoveDir,
  setMoveTo,
  stepMovement,
  stopMovement,
  type Facing,
  type MapDef,
  type MovingEntity,
  type TileCoord,
} from '@terago/shared';
import { RECONCILE_SNAP_THRESHOLD_TILES } from '../config.js';

export interface LocalPredictionState extends MovingEntity {
  mounted: boolean;
}

export function createLocalPrediction(x: number, y: number, facing: Facing = 'down'): LocalPredictionState {
  return { x, y, facing, path: null, heldDirection: null, mounted: false };
}

/** Mirrors Room.handleMoveTo: computes (and locally applies) an A* path to
 * `target`. Returns false - leaving the state untouched - if the tile is
 * unreachable, so the caller knows not to bother sending the intent or
 * showing a destination marker for a click that the server would reject
 * too (both sides run the identical shared pathfinder/grid). */
export function predictMoveTo(state: LocalPredictionState, map: MapDef, target: TileCoord): boolean {
  return setMoveTo(state, map, target);
}

/** Mirrors Room.handleMoveDir. */
export function predictMoveDir(state: LocalPredictionState, dx: number, dy: number): void {
  setMoveDir(state, dx, dy);
}

export function predictStop(state: LocalPredictionState): void {
  stopMovement(state);
}

/** Advances the predicted position by one render frame, exactly like the
 * server's tickPlayerMovement - same speed formula (mount's +50% arrives
 * with R in M2; `mounted` is threaded through now so nothing has to
 * change here when it does). */
export function stepLocalPrediction(state: LocalPredictionState, map: MapDef, dtSeconds: number): void {
  const speed = BALANCE.playerBaseMoveSpeedTilesPerSec * (state.mounted ? BALANCE.mountSpeedMultiplier : 1);
  stepMovement(state, map, speed, dtSeconds);
}

/**
 * Server reconciliation: the local player's own entity also arrives in
 * every world:snapshot (GameState.localEntity()), since a player is
 * always inside their own area of interest. Small drift between the
 * predicted and authoritative position is expected and left alone (the
 * server is still converging toward the same path); only a large enough
 * gap - a missed prediction, a reconnect, a server-applied teleport like
 * a portal/death respawn - snaps the predicted state directly onto the
 * authoritative one.
 */
export function reconcile(
  state: LocalPredictionState,
  authoritative: { x: number; y: number },
  snapThresholdTiles: number = RECONCILE_SNAP_THRESHOLD_TILES
): boolean {
  const drift = distanceTiles(state, authoritative);
  if (drift <= snapThresholdTiles) return false;
  state.x = authoritative.x;
  state.y = authoritative.y;
  return true;
}

export { facingFromVector };
