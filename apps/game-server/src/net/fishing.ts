import { randomInt, randomUUID } from 'node:crypto';
import { fishFor, getItem } from '@terrago/game-data';
import { FISHING_STEP_MS, fishingZone, rollQuality, simulateFishing, timeOfDay, type FishDef, type FishingParams, type FishingRound } from '@terrago/shared';
import { GameError } from '../db';
import { castLine, landFish } from '../services/gathering';
import type { Player } from '../world/player';
import { applyDelta, pushInventory, type GameplayDeps } from './gameplay';

/**
 * Fishing: cast → wait for a bite → hook in time → reel (minigame).
 * The minigame is deterministic: the server hands out the seed, the client
 * plays it and sends back its input timeline, and the server replays it to
 * decide whether the fish was really caught. The client never decides.
 */

interface Session {
  id: string;
  fish: FishDef;
  params: FishingParams;
  biteAt: number;
  hookedAt: number | null;
  state: 'waiting' | 'bite' | 'reeling';
  timer: NodeJS.Timeout | null;
  expires: number;
}

const HOOK_WINDOW_MS = 1600;
const sessions = new Map<string, Session>();

function end(p: Player): void {
  const s = sessions.get(p.id);
  if (s?.timer) clearTimeout(s.timer);
  sessions.delete(p.id);
}

function pickFish(table: string, fishingLevel: number): FishDef | null {
  const pool = fishFor(table, timeOfDay(Date.now()));
  if (pool.length === 0) return null;
  // Fish far above your level still bite, but rarely.
  const weights = pool.map((f) => f.weight * (f.level <= fishingLevel ? 1 : f.level <= fishingLevel + 10 ? 0.25 : 0.05));
  let r = Math.random() * weights.reduce((a, b) => a + b, 0);
  for (let i = 0; i < pool.length; i++) if ((r -= weights[i]!) < 0) return pool[i]!;
  return pool[0]!;
}

export async function cast(deps: GameplayDeps, p: Player, table: string, prefer?: number): Promise<{ id: string }> {
  end(p);
  const paid = await castLine(deps.pool, p.id, prefer);
  pushInventory(deps.world, p, paid.inventory);
  applyDelta(deps.world, p, paid.delta);
  const fish = pickFish(table, paid.fishing);
  if (!fish) throw new GameError('Nothing seems to live in this water.');
  const now = Date.now();
  const s: Session = {
    id: randomUUID(),
    fish,
    params: { seed: randomInt(1, 2_000_000_000), difficulty: fish.difficulty, zone: fishingZone(paid.rodTier, paid.fishing), maxSteps: 600 },
    biteAt: now + 1800 + randomInt(0, 4500),
    hookedAt: null,
    state: 'waiting',
    timer: null,
    expires: now + 60_000,
  };
  s.timer = setTimeout(() => {
    if (sessions.get(p.id) !== s) return;
    s.state = 'bite';
    s.biteAt = Date.now();
    p.conn?.send('fish:bite', { id: s.id });
  }, s.biteAt - now);
  s.timer.unref?.();
  sessions.set(p.id, s);
  if (paid.broke) p.conn?.send('notice', { kind: 'error', text: `Your ${paid.broke} broke!` });
  return { id: s.id };
}

export function hook(p: Player, id: unknown): FishingRound {
  const s = sessions.get(p.id);
  if (!s || s.id !== id) throw new GameError('Your line is not in the water.');
  if (s.state === 'waiting') {
    end(p);
    throw new GameError('Too early — you scared it off.');
  }
  if (s.state !== 'bite' || Date.now() - s.biteAt > HOOK_WINDOW_MS) {
    end(p);
    throw new GameError('Too slow — it got away.');
  }
  s.state = 'reeling';
  s.hookedAt = Date.now();
  return { id: s.id, ...s.params };
}

export async function reel(deps: GameplayDeps, p: Player, req: unknown): Promise<{ caught: boolean; message: string }> {
  const r = (req ?? {}) as { id?: unknown; toggles?: unknown; steps?: unknown };
  const s = sessions.get(p.id);
  if (!s || s.id !== r.id || s.state !== 'reeling') throw new GameError('Your line is not in the water.');
  end(p);
  const toggles = r.toggles;
  const steps = r.steps;
  if (!Array.isArray(toggles) || toggles.length > 600 || !Number.isInteger(steps) || (steps as number) < 1 || (steps as number) > s.params.maxSteps) {
    deps.world.badPacket(p, 'fish_reel');
    throw new GameError('The line snapped.');
  }
  let prev = -1;
  for (const t of toggles) {
    if (!Number.isInteger(t) || t < prev || t > (steps as number)) throw new GameError('The line snapped.');
    prev = t;
  }
  // A round can't be played faster than real time (small allowance for latency).
  const elapsed = Date.now() - (s.hookedAt ?? 0);
  if (elapsed + 1500 < (steps as number) * FISHING_STEP_MS) {
    deps.world.badPacket(p, 'fish_too_fast');
    throw new GameError('The line snapped.');
  }
  const result = simulateFishing(s.params, toggles as number[], steps as number);
  if (result.done !== 'caught') return { caught: false, message: `The ${getItem(s.fish.itemId)?.name ?? 'fish'} got away!` };
  const level = p.rec.skills.fishing.level;
  const quality = rollQuality([0.86, 0.1, 0.03, 0.009, 0.001], level, s.fish.level, 0, Math.random);
  const res = await landFish(deps.pool, p.id, s.fish.itemId, quality, s.fish.xp);
  pushInventory(deps.world, p, res.inventory);
  applyDelta(deps.world, p, res.delta);
  return { caught: true, message: res.message };
}

export function cancelFishing(p: Player): void {
  end(p);
}
