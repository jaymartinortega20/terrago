import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { openDatabase } from '../db/database.js';
import { createSqliteRepository } from '../db/repository.js';
import { World } from './world.js';
import { startTickLoop } from './tick.js';

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

function makeWorld() {
  const repo = createSqliteRepository(openDatabase(':memory:'));
  return new World(repo);
}

describe('startTickLoop', () => {
  it('calls World.tick with a dt matching the requested rate, on schedule', () => {
    const world = makeWorld();
    const tickSpy = vi.spyOn(world, 'tick');

    const handle = startTickLoop(world, { tickRateHz: 20 });
    expect(handle.dtSeconds).toBeCloseTo(0.05, 10);

    vi.advanceTimersByTime(50 * 5); // 5 ticks at 20Hz (50ms each)

    expect(tickSpy).toHaveBeenCalledTimes(5);
    expect(tickSpy).toHaveBeenCalledWith(0.05);

    handle.stop();
  });

  it('stop() halts further ticks', () => {
    const world = makeWorld();
    const tickSpy = vi.spyOn(world, 'tick');
    const handle = startTickLoop(world, { tickRateHz: 20 });

    vi.advanceTimersByTime(50);
    expect(tickSpy).toHaveBeenCalledTimes(1);

    handle.stop();
    vi.advanceTimersByTime(500);
    expect(tickSpy).toHaveBeenCalledTimes(1);
  });

  it('reports a thrown tick via onError instead of stopping the loop', () => {
    const world = makeWorld();
    let calls = 0;
    vi.spyOn(world, 'tick').mockImplementation(() => {
      calls += 1;
      if (calls === 2) throw new Error('boom');
    });
    const errors: unknown[] = [];

    const handle = startTickLoop(world, { tickRateHz: 20, onError: (e) => errors.push(e) });
    vi.advanceTimersByTime(50 * 4); // 4 ticks, the 2nd throws

    expect(calls).toBe(4); // the loop kept going after the throw
    expect(errors).toHaveLength(1);
    expect((errors[0] as Error).message).toBe('boom');

    handle.stop();
  });

  it('defaults to BALANCE.tickRateHz (20Hz) when no rate is given', () => {
    const world = makeWorld();
    const tickSpy = vi.spyOn(world, 'tick');

    const handle = startTickLoop(world);
    expect(handle.dtSeconds).toBeCloseTo(0.05, 10);

    vi.advanceTimersByTime(1000); // 1s at 20Hz = 20 ticks
    expect(tickSpy).toHaveBeenCalledTimes(20);

    handle.stop();
  });
});
