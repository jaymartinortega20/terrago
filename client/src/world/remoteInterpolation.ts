/**
 * Smooths a remote entity's position between two snapshot samples (SPEC.md
 * section 2: "Other entities are interpolated about 100ms behind"). Only
 * x/y are interpolated - categorical display fields (facing, anim,
 * equipment, mounted, hpPct) just take the latest sample's value directly
 * in WorldScene, since blending between two discrete animation states
 * isn't meaningful the way blending between two positions is.
 *
 * Framework-free on purpose (no Phaser) so the interpolation math itself
 * is unit-testable without a browser; WorldScene is the only thing that
 * knows these samples come from world:snapshot entries.
 */
export interface PositionSample {
  /** Client-clock receipt time in ms (e.g. `performance.now()`), not a
   * server tick number - the two clocks aren't synchronized in M1, and
   * interpolating by local receipt time is the simpler, sufficient
   * approach for smoothing out the gap between 20Hz snapshots arriving at
   * an uneven client frame rate. */
  atMs: number;
  x: number;
  y: number;
}

export class RemoteInterpolator {
  private older: PositionSample | null = null;
  private newer: PositionSample | null = null;

  push(sample: PositionSample): void {
    this.older = this.newer;
    this.newer = sample;
  }

  hasSample(): boolean {
    return this.newer !== null;
  }

  /**
   * The position to render at `nowMs`, holding `delayMs` behind the
   * latest sample. Returns null only if no sample has ever arrived (the
   * entity hasn't been seen yet). With a single sample (just entered the
   * area of interest) it's returned as-is - there's nothing older to
   * interpolate from yet. The render time is clamped to the buffered
   * range: never extrapolated past the newest sample, never before the
   * oldest.
   */
  positionAt(nowMs: number, delayMs: number): { x: number; y: number } | null {
    if (!this.newer) return null;
    if (!this.older) return { x: this.newer.x, y: this.newer.y };

    const renderMs = nowMs - delayMs;
    if (renderMs <= this.older.atMs) return { x: this.older.x, y: this.older.y };
    if (renderMs >= this.newer.atMs) return { x: this.newer.x, y: this.newer.y };

    const span = this.newer.atMs - this.older.atMs;
    const t = span <= 0 ? 1 : (renderMs - this.older.atMs) / span;
    return {
      x: this.older.x + (this.newer.x - this.older.x) * t,
      y: this.older.y + (this.newer.y - this.older.y) * t,
    };
  }
}
