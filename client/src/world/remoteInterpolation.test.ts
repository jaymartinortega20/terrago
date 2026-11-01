import { describe, expect, it } from 'vitest';
import { RemoteInterpolator } from './remoteInterpolation.js';

describe('RemoteInterpolator', () => {
  it('has no position before any sample arrives', () => {
    const interp = new RemoteInterpolator();
    expect(interp.hasSample()).toBe(false);
    expect(interp.positionAt(1000, 100)).toBeNull();
  });

  it('snaps to the single known sample when only one has arrived', () => {
    const interp = new RemoteInterpolator();
    interp.push({ atMs: 1000, x: 5, y: 5 });

    expect(interp.positionAt(2000, 100)).toEqual({ x: 5, y: 5 });
  });

  it('interpolates between the two most recent samples at the delayed render time', () => {
    const interp = new RemoteInterpolator();
    interp.push({ atMs: 0, x: 0, y: 0 });
    interp.push({ atMs: 100, x: 10, y: 20 });

    // Render 50ms behind "now" = 100ms -> renderMs = 50, exactly the
    // midpoint between the two samples.
    const pos = interp.positionAt(100, 50);

    expect(pos).toEqual({ x: 5, y: 10 });
  });

  it('clamps to the newest sample when the render time has caught up past it', () => {
    const interp = new RemoteInterpolator();
    interp.push({ atMs: 0, x: 0, y: 0 });
    interp.push({ atMs: 100, x: 10, y: 20 });

    const pos = interp.positionAt(100, 0); // renderMs = 100, exactly at newer

    expect(pos).toEqual({ x: 10, y: 20 });
  });

  it('clamps to the oldest sample when the render time is behind both samples', () => {
    const interp = new RemoteInterpolator();
    interp.push({ atMs: 500, x: 0, y: 0 });
    interp.push({ atMs: 600, x: 10, y: 20 });

    const pos = interp.positionAt(550, 100); // renderMs = 450, before older

    expect(pos).toEqual({ x: 0, y: 0 });
  });

  it('only ever keeps the two most recent samples', () => {
    const interp = new RemoteInterpolator();
    interp.push({ atMs: 0, x: 0, y: 0 });
    interp.push({ atMs: 100, x: 10, y: 0 });
    interp.push({ atMs: 200, x: 20, y: 0 });

    // Midpoint between the second and third sample (100..200), not the first.
    const pos = interp.positionAt(200, 50);

    expect(pos).toEqual({ x: 15, y: 0 });
  });
});
