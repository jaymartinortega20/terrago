import { describe, expect, it } from 'vitest';
import { BALANCE, MAP_OAKHAVEN } from '@terago/shared';
import {
  createLocalPrediction,
  predictMoveDir,
  predictMoveTo,
  predictStop,
  reconcile,
  stepLocalPrediction,
} from './localPrediction.js';

describe('localPrediction: predictMoveTo', () => {
  it('installs a path toward a reachable tile and reports success', () => {
    const state = createLocalPrediction(MAP_OAKHAVEN.spawnPoint.x, MAP_OAKHAVEN.spawnPoint.y);

    const ok = predictMoveTo(state, MAP_OAKHAVEN, { x: MAP_OAKHAVEN.spawnPoint.x + 2, y: MAP_OAKHAVEN.spawnPoint.y });

    expect(ok).toBe(true);
    expect(state.path).not.toBeNull();
    expect(state.heldDirection).toBeNull();
  });

  it('leaves the state untouched for an unreachable (off-grid) tile', () => {
    const state = createLocalPrediction(MAP_OAKHAVEN.spawnPoint.x, MAP_OAKHAVEN.spawnPoint.y);

    const ok = predictMoveTo(state, MAP_OAKHAVEN, { x: -5, y: -5 });

    expect(ok).toBe(false);
    expect(state.path).toBeNull();
  });
});

describe('localPrediction: predictMoveDir / predictStop', () => {
  it('sets a held direction and cancels any path', () => {
    const state = createLocalPrediction(MAP_OAKHAVEN.spawnPoint.x, MAP_OAKHAVEN.spawnPoint.y);
    predictMoveTo(state, MAP_OAKHAVEN, { x: MAP_OAKHAVEN.spawnPoint.x + 2, y: MAP_OAKHAVEN.spawnPoint.y });

    predictMoveDir(state, 1, 0);

    expect(state.path).toBeNull();
    expect(state.heldDirection).toEqual({ dx: 1, dy: 0 });
  });

  it('predictStop clears both path and held direction', () => {
    const state = createLocalPrediction(MAP_OAKHAVEN.spawnPoint.x, MAP_OAKHAVEN.spawnPoint.y);
    predictMoveDir(state, 1, 1);

    predictStop(state);

    expect(state.path).toBeNull();
    expect(state.heldDirection).toBeNull();
  });
});

describe('localPrediction: stepLocalPrediction', () => {
  it('advances position toward the path target at the base move speed', () => {
    const state = createLocalPrediction(MAP_OAKHAVEN.spawnPoint.x, MAP_OAKHAVEN.spawnPoint.y);
    predictMoveTo(state, MAP_OAKHAVEN, { x: MAP_OAKHAVEN.spawnPoint.x + 2, y: MAP_OAKHAVEN.spawnPoint.y });

    stepLocalPrediction(state, MAP_OAKHAVEN, 0.1);

    const expectedDistance = BALANCE.playerBaseMoveSpeedTilesPerSec * 0.1;
    expect(state.x).toBeCloseTo(MAP_OAKHAVEN.spawnPoint.x + expectedDistance, 5);
    expect(state.y).toBeCloseTo(MAP_OAKHAVEN.spawnPoint.y, 5);
  });

  it('moves faster while mounted, matching the server speed formula', () => {
    const unmounted = createLocalPrediction(MAP_OAKHAVEN.spawnPoint.x, MAP_OAKHAVEN.spawnPoint.y);
    const mounted = createLocalPrediction(MAP_OAKHAVEN.spawnPoint.x, MAP_OAKHAVEN.spawnPoint.y);
    mounted.mounted = true;
    predictMoveTo(unmounted, MAP_OAKHAVEN, { x: MAP_OAKHAVEN.spawnPoint.x + 3, y: MAP_OAKHAVEN.spawnPoint.y });
    predictMoveTo(mounted, MAP_OAKHAVEN, { x: MAP_OAKHAVEN.spawnPoint.x + 3, y: MAP_OAKHAVEN.spawnPoint.y });

    stepLocalPrediction(unmounted, MAP_OAKHAVEN, 0.1);
    stepLocalPrediction(mounted, MAP_OAKHAVEN, 0.1);

    const unmountedDistance = unmounted.x - MAP_OAKHAVEN.spawnPoint.x;
    const mountedDistance = mounted.x - MAP_OAKHAVEN.spawnPoint.x;
    expect(mountedDistance).toBeCloseTo(unmountedDistance * BALANCE.mountSpeedMultiplier, 5);
  });
});

describe('localPrediction: reconcile', () => {
  it('leaves the predicted position alone when drift is within the snap threshold', () => {
    const state = createLocalPrediction(10, 10);

    const snapped = reconcile(state, { x: 10.5, y: 10 }, 1.5);

    expect(snapped).toBe(false);
    expect(state.x).toBe(10);
    expect(state.y).toBe(10);
  });

  it('snaps directly onto the authoritative position once drift exceeds the threshold', () => {
    const state = createLocalPrediction(10, 10);

    const snapped = reconcile(state, { x: 15, y: 10 }, 1.5);

    expect(snapped).toBe(true);
    expect(state.x).toBe(15);
    expect(state.y).toBe(10);
  });
});
