import { monitorEventLoopDelay } from 'node:perf_hooks';
import type { Pool } from './db';
import type { World } from './world/world';

/**
 * Live server health numbers for load testing and monitoring: tick cost,
 * event-loop delay, CPU, memory, DB pool and connection counts.
 */
export class Metrics {
  private readonly eld = monitorEventLoopDelay({ resolution: 10 });
  private readonly ticks = new Float64Array(400);
  private tickIdx = 0;
  private tickCount = 0;
  private lastCpu = process.cpuUsage();
  private lastCpuAt = process.hrtime.bigint();
  readonly startedAt = Date.now();
  sockets = 0;
  eventsIn = 0;
  snapshotsSent = 0;
  snapshotsDropped = 0;

  constructor(
    private readonly world: World,
    private readonly pool: Pool,
  ) {
    this.eld.enable();
  }

  recordTick(ms: number): void {
    this.ticks[this.tickIdx] = ms;
    this.tickIdx = (this.tickIdx + 1) % this.ticks.length;
    this.tickCount++;
  }

  snapshot() {
    const n = Math.min(this.tickCount, this.ticks.length);
    const sorted = Array.from(this.ticks.subarray(0, n)).sort((a, b) => a - b);
    const pct = (p: number) => (n ? sorted[Math.min(n - 1, Math.floor((p / 100) * n))]! : 0);
    const avg = n ? sorted.reduce((a, b) => a + b, 0) / n : 0;

    const cpu = process.cpuUsage(this.lastCpu);
    const now = process.hrtime.bigint();
    const elapsedUs = Number(now - this.lastCpuAt) / 1000;
    this.lastCpu = process.cpuUsage();
    this.lastCpuAt = now;

    const mem = process.memoryUsage();
    const ms = (ns: number) => Math.round((ns / 1e6) * 100) / 100;
    const snap = {
      uptimeSec: Math.round((Date.now() - this.startedAt) / 1000),
      world: this.world.stats(),
      sockets: this.sockets,
      tickMs: { avg: Math.round(avg * 1000) / 1000, p50: pct(50), p99: pct(99), max: sorted[n - 1] ?? 0 },
      eventLoopDelayMs: { mean: ms(this.eld.mean), p50: ms(this.eld.percentile(50)), p99: ms(this.eld.percentile(99)), max: ms(this.eld.max) },
      cpuPercent: elapsedUs > 0 ? Math.round(((cpu.user + cpu.system) / elapsedUs) * 1000) / 10 : 0,
      memoryMb: { rss: Math.round(mem.rss / 1048576), heapUsed: Math.round(mem.heapUsed / 1048576) },
      db: { total: this.pool.totalCount, idle: this.pool.idleCount, waiting: this.pool.waitingCount },
      eventsIn: this.eventsIn,
      snapshots: { sent: this.snapshotsSent, droppedCongested: this.snapshotsDropped },
    };
    this.eld.reset();
    return snap;
  }
}
