/**
 * The fixed-rate driver loop (SPEC.md tech-stack table: "fixed 20Hz tick").
 * Everything about *what* a tick does lives in `World.tick()` - this module
 * is only responsible for calling it at a steady interval and not letting
 * one bad tick (a thrown error) silently stop the whole server.
 */
import { BALANCE } from '@terago/shared';
import type { World } from './world.js';

export interface TickLoopOptions {
  /** Overrides `BALANCE.tickRateHz` - tests use this to drive a handful of
   * fast ticks without waiting on real wall-clock time. */
  tickRateHz?: number;
  /** Swappable for `vi.useFakeTimers()` in tests; defaults to the real
   * `setInterval`/`clearInterval` pair. */
  setIntervalFn?: typeof setInterval;
  clearIntervalFn?: typeof clearInterval;
  onError?: (error: unknown) => void;
}

export interface TickLoopHandle {
  readonly dtSeconds: number;
  stop(): void;
}

/** Starts calling `world.tick(dtSeconds)` every `1000/tickRateHz` ms. A
 * tick that throws is caught and reported via `onError` (default:
 * `console.error`) rather than crashing the interval - one bad tick should
 * degrade, not kill, a server with other players connected. */
export function startTickLoop(world: World, options: TickLoopOptions = {}): TickLoopHandle {
  const tickRateHz = options.tickRateHz ?? BALANCE.tickRateHz;
  const intervalMs = 1000 / tickRateHz;
  const dtSeconds = intervalMs / 1000;
  const setIntervalFn = options.setIntervalFn ?? setInterval;
  const clearIntervalFn = options.clearIntervalFn ?? clearInterval;
  const onError = options.onError ?? ((error: unknown) => console.error('World.tick() threw:', error));

  const timer = setIntervalFn(() => {
    try {
      world.tick(dtSeconds);
    } catch (error) {
      onError(error);
    }
  }, intervalMs);

  return {
    dtSeconds,
    stop: () => clearIntervalFn(timer),
  };
}
