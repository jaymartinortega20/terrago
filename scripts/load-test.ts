/**
 * TerraGo load test: N bot players connect, walk around, change maps, chat
 * occasionally and request their inventory, while the server's own metrics
 * (CPU, memory, event-loop delay, tick time, DB pool) are sampled.
 *
 *   npm run loadtest -- --bots 100 --duration 120
 *
 * The target server must run with DISABLE_RATE_LIMITS=true (non-production)
 * so 100 bot accounts can register from one IP.
 */
import { writeFileSync } from 'node:fs';
import { io, type Socket } from 'socket.io-client';
import { PROTOCOL_VERSION, type ClientToServerEvents, type EnterWorldPayload, type ServerToClientEvents } from '@terrago/shared';

const arg = (name: string, def: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1]! : (process.env[name.toUpperCase()] ?? def);
};

const SERVER = arg('server', 'http://127.0.0.1:4000');
const ORIGIN = arg('origin', 'http://localhost:3000');
const BOTS = Number(arg('bots', '100'));
const DURATION_S = Number(arg('duration', '120'));
const RAMP_MS = Number(arg('ramp', '50'));
const OUT = arg('out', '');

type Sock = Socket<ServerToClientEvents, ClientToServerEvents>;

interface BotStats {
  rtts: number[];
  snaps: number;
  mapChanges: number;
  chats: number;
  chatsReceived: number;
  inventoryOk: number;
  errors: number;
  disconnects: number;
}

const botCpuStart = process.cpuUsage();
const stats: BotStats = { rtts: [], snaps: 0, mapChanges: 0, chats: 0, chatsReceived: 0, inventoryOk: 0, errors: 0, disconnects: 0 };
const serverSamples: any[] = [];

async function post(path: string, body: unknown, cookie = '') {
  const res = await fetch(`${SERVER}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: ORIGIN, ...(cookie ? { cookie } : {}) },
    body: JSON.stringify(body),
  });
  const setCookie = res.headers.get('set-cookie');
  return { status: res.status, data: (await res.json().catch(() => ({}))) as any, cookie: setCookie?.split(';')[0] ?? cookie };
}

async function get(path: string, cookie: string) {
  const res = await fetch(`${SERVER}${path}`, { headers: { origin: ORIGIN, cookie } });
  return (await res.json()) as any;
}

/** Register (or log in) a bot and make sure it has a character. */
async function prepareBot(i: number): Promise<{ cookie: string; characterId: string }> {
  const email = `loadbot${i}@terrago.test`;
  const password = 'load test bot password';
  let r = await post('/api/auth/register', { email, password });
  if (r.status === 409) r = await post('/api/auth/login', { email, password });
  if (r.status !== 200) throw new Error(`bot ${i} auth failed: ${r.status} ${JSON.stringify(r.data)}`);
  const cookie = r.cookie;
  const list = await get('/api/characters', cookie);
  if (list.characters?.length) return { cookie, characterId: list.characters[0].id };
  const c = await post(
    '/api/characters',
    {
      name: `Bot${String(i).padStart(3, '0')}x`,
      classId: ['warrior', 'ranger', 'mage', 'priest', 'rogue'][i % 5],
      appearance: { bodyType: i % 2 ? 'a' : 'b', skinTone: i % 7, hairStyle: i % 7, hairColor: i % 10, eyeColor: i % 6, outfit: i % 6 },
    },
    cookie,
  );
  if (c.status !== 200) throw new Error(`bot ${i} character failed: ${JSON.stringify(c.data)}`);
  return { cookie, characterId: c.data.character.id };
}

function runBot(i: number, cookie: string, characterId: string, until: number): Promise<void> {
  return new Promise((resolve) => {
    const s: Sock = io(SERVER, {
      transports: ['websocket'],
      forceNew: true,
      extraHeaders: { cookie, origin: ORIGIN },
      auth: { characterId, protocol: PROTOCOL_VERSION },
    });
    const traveler = i % 5 === 0; // 20% walk between maps
    let seq = 0;
    let dir: [-1 | 0 | 1, -1 | 0 | 1] = [0, 0];
    let map = '';
    let travelDir: -1 | 1 = 1;
    // Travelers walk through a gate, keep going for a while, then turn back.
    let turnAt = Number.POSITIVE_INFINITY;
    const timers: NodeJS.Timeout[] = [];
    const every = (ms: number, fn: () => void) => timers.push(setInterval(fn, ms));

    s.on('world:enter', (p: EnterWorldPayload) => {
      if (map && p.map.id !== map) {
        stats.mapChanges++;
        turnAt = Date.now() + 6000;
      }
      map = p.map.id;
      seq = Math.max(seq, p.ack);
    });
    s.on('snap', () => stats.snaps++);
    s.on('chat', () => stats.chatsReceived++);
    s.on('disconnect', () => stats.disconnects++);
    s.on('connect_error', () => stats.errors++);

    // Movement: one command per 50ms step, like a real client.
    every(50, () => {
      if (!s.connected || !map) return;
      if (traveler) {
        if (Date.now() > turnAt) {
          travelDir = (travelDir * -1) as -1 | 1;
          turnAt = Number.POSITIVE_INFINITY;
        }
        dir = [0, travelDir];
      }
      else if (Math.random() < 0.02) {
        const options: [-1 | 0 | 1, -1 | 0 | 1][] = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [0, 0], [0, 0]];
        dir = options[Math.floor(Math.random() * options.length)]!;
      }
      if (dir[0] !== 0 || dir[1] !== 0) s.emit('move', [++seq, dir[0], dir[1]]);
    });
    every(2000, () => {
      const t0 = performance.now();
      s.emit('ping:check', Date.now(), () => stats.rtts.push(performance.now() - t0));
    });
    every(10_000 + Math.random() * 5000, () =>
      s.emit('inventory:get', (r) => {
        if (r.ok) stats.inventoryOk++;
        else stats.errors++;
      }),
    );
    every(20_000 + Math.random() * 20_000, () => {
      stats.chats++;
      s.emit('chat:send', `Bot ${i} says hi #${stats.chats}`, (r) => {
        if (!r.ok) stats.errors++;
      });
    });

    setTimeout(() => {
      timers.forEach(clearInterval);
      s.disconnect();
      resolve();
    }, Math.max(0, until - Date.now()));
  });
}

function pct(arr: number[], p: number) {
  if (!arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b);
  return Math.round(s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))]! * 10) / 10;
}

async function main() {
  console.log(`TerraGo load test → ${SERVER}: ${BOTS} bots for ${DURATION_S}s`);
  const prepared: { cookie: string; characterId: string }[] = [];
  for (let i = 0; i < BOTS; i += 10) {
    prepared.push(...(await Promise.all(Array.from({ length: Math.min(10, BOTS - i) }, (_, k) => prepareBot(i + k)))));
  }
  console.log(`prepared ${prepared.length} bot accounts`);

  const metricsTimer = setInterval(async () => {
    try {
      const m = (await (await fetch(`${SERVER}/metrics`)).json()) as any;
      serverSamples.push(m.metrics);
      const x = m.metrics;
      console.log(
        `[server] players=${x.world.players} cpu=${x.cpuPercent}% rss=${x.memoryMb.rss}MB heap=${x.memoryMb.heapUsed}MB ` +
          `tick p99=${x.tickMs.p99.toFixed(2)}ms eld p99=${x.eventLoopDelayMs.p99}ms db=${x.db.total}/${x.db.waiting}w maps=${JSON.stringify(x.world.maps)}`,
      );
    } catch (err) {
      console.log('[server] metrics unavailable', (err as Error).message);
    }
  }, 5000);

  const start = Date.now();
  const until = start + RAMP_MS * BOTS + DURATION_S * 1000;
  const runs: Promise<void>[] = [];
  for (let i = 0; i < prepared.length; i++) {
    runs.push(runBot(i, prepared[i]!.cookie, prepared[i]!.characterId, until));
    await new Promise((r) => setTimeout(r, RAMP_MS));
  }
  await Promise.all(runs);
  clearInterval(metricsTimer);

  const steady = serverSamples.filter((m) => m.world.players >= BOTS * 0.95);
  const max = (f: (m: any) => number) => (steady.length ? Math.max(...steady.map(f)) : 0);
  const avg = (f: (m: any) => number) => (steady.length ? Math.round((steady.map(f).reduce((a, b) => a + b, 0) / steady.length) * 10) / 10 : 0);
  const summary = {
    bots: BOTS,
    durationSec: DURATION_S,
    socketRttMs: { p50: pct(stats.rtts, 50), p95: pct(stats.rtts, 95), p99: pct(stats.rtts, 99), max: pct(stats.rtts, 100), samples: stats.rtts.length },
    snapshotsReceived: stats.snaps,
    snapshotsPerBotPerSec: Math.round((stats.snaps / BOTS / (DURATION_S + (RAMP_MS * BOTS) / 1000)) * 10) / 10,
    mapChanges: stats.mapChanges,
    chatsSent: stats.chats,
    chatsDelivered: stats.chatsReceived,
    inventoryRequestsOk: stats.inventoryOk,
    errors: stats.errors,
    unexpectedDisconnects: Math.max(0, stats.disconnects - BOTS),
    botProcessCpuSec: Math.round((process.cpuUsage(botCpuStart).user + process.cpuUsage(botCpuStart).system) / 1e5) / 10,
    serverSnapshots: serverSamples.at(-1)?.snapshots,
    server: {
      samplesAtFullLoad: steady.length,
      cpuPercent: { avg: avg((m) => m.cpuPercent), max: max((m) => m.cpuPercent) },
      rssMb: { avg: avg((m) => m.memoryMb.rss), max: max((m) => m.memoryMb.rss) },
      heapMb: { max: max((m) => m.memoryMb.heapUsed) },
      tickMs: { avgP99: avg((m) => m.tickMs.p99), max: max((m) => m.tickMs.max) },
      eventLoopDelayMs: { avgP99: avg((m) => m.eventLoopDelayMs.p99), max: max((m) => m.eventLoopDelayMs.max) },
      dbPool: { maxTotal: max((m) => m.db.total), maxWaiting: max((m) => m.db.waiting) },
    },
  };
  console.log(JSON.stringify(summary, null, 2));
  if (OUT) writeFileSync(OUT, JSON.stringify({ summary, samples: serverSamples }, null, 2));
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
