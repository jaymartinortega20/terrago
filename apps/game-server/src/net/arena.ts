import { getMap } from '@terrago/game-data';
import { ARENA_MIN_LEVEL, ARENA_START_RATING, arenaDelta, arenaSeason, arenaTier, type ArenaView } from '@terrago/shared';
import { GameError, withTransaction } from '../db';
import { grantKillRewards } from '../services/equipment';
import type { Player } from '../world/player';
import { applyDelta, pushInventory, type GameplayDeps } from './gameplay';

/**
 * Ranked arena: queue up, get matched with someone of similar rating and
 * level, fight a 1v1 duel in a private ring (first to 1 HP loses, 3 minutes),
 * then go back to where you were. Elo ratings per monthly season.
 */

const MATCH_MS = 3 * 60_000;
const COUNTDOWN_MS = 3_000;
const RETURN_MS = 4_000;

interface Queued {
  p: Player;
  since: number;
  rating: number;
}

const queue = new Map<string, Queued>();

async function ratingOf(deps: GameplayDeps, id: string): Promise<{ rating: number; wins: number; losses: number }> {
  const { rows } = await deps.pool.query(`SELECT rating, wins, losses FROM arena_ratings WHERE character_id = $1 AND season = $2`, [id, arenaSeason(Date.now())]);
  return rows[0] ?? { rating: ARENA_START_RATING, wins: 0, losses: 0 };
}

export async function arenaView(deps: GameplayDeps, p: Player): Promise<ArenaView> {
  const season = arenaSeason(Date.now());
  const [me, top] = await Promise.all([
    ratingOf(deps, p.id),
    deps.pool.query(
      `SELECT c.name, c.class_id, c.level, r.rating, r.wins, r.losses FROM arena_ratings r JOIN characters c ON c.id = r.character_id
        WHERE r.season = $1 AND c.deleted_at IS NULL AND r.wins + r.losses > 0 ORDER BY r.rating DESC, r.wins DESC LIMIT 10`,
      [season],
    ),
  ]);
  const q = queue.get(p.id);
  return {
    season,
    ...me,
    queued: !!q,
    queuedSince: q?.since ?? null,
    inMatch: !!p.arena,
    top: top.rows.map((r) => ({ name: r.name, classId: r.class_id, level: r.level, rating: r.rating, wins: r.wins, losses: r.losses })),
  };
}

export const arena = {
  get: arenaView,
  async join(deps: GameplayDeps, p: Player): Promise<ArenaView> {
    if (p.rec.level < ARENA_MIN_LEVEL) throw new GameError(`The arena opens at level ${ARENA_MIN_LEVEL}.`);
    if (p.arena) throw new GameError("You're already in a match.");
    if (p.duel) throw new GameError('Finish your duel first.');
    if (p.dead) throw new GameError("You can't queue right now.");
    const def = getMap(p.mapId);
    if (def?.dungeon || p.mapId.startsWith('dg_')) throw new GameError('Leave the dungeon first.');
    const { rating } = await ratingOf(deps, p.id);
    queue.set(p.id, { p, since: Date.now(), rating });
    p.conn?.send('notice', { kind: 'info', text: '⚔ Looking for an arena opponent… you can keep playing while you wait.' });
    tryMatch(deps);
    return arenaView(deps, p);
  },
  async leave(deps: GameplayDeps, p: Player): Promise<ArenaView> {
    queue.delete(p.id);
    return arenaView(deps, p);
  },
};

/** Pair the longest-waiting players with someone close in rating and level (the window widens as they wait). */
export function tryMatch(deps: GameplayDeps): void {
  const now = Date.now();
  for (const [id, q] of queue) if (!deps.world.players.get(id)?.conn || q.p.arena || q.p.dead) queue.delete(id);
  const waiting = [...queue.values()].sort((a, b) => a.since - b.since);
  const used = new Set<string>();
  for (const a of waiting) {
    if (used.has(a.p.id)) continue;
    const wait = (now - a.since) / 1000;
    const ratingWindow = 100 + wait * 10;
    const levelWindow = Math.min(30, 10 + wait / 6);
    let best: Queued | null = null;
    for (const b of waiting) {
      if (b === a || used.has(b.p.id)) continue;
      if (Math.abs(a.rating - b.rating) > ratingWindow || Math.abs(a.p.rec.level - b.p.rec.level) > levelWindow) continue;
      if (a.p.blocked.get(b.p.id) === 'block' || b.p.blocked.get(a.p.id) === 'block') continue;
      if (!best || Math.abs(a.rating - b.rating) < Math.abs(a.rating - best.rating)) best = b;
    }
    if (!best) continue;
    used.add(a.p.id);
    used.add(best.p.id);
    queue.delete(a.p.id);
    queue.delete(best.p.id);
    void startMatch(deps, a, best).catch((err) => deps.log.error('arena_start_failed', { err }));
  }
}

function heal(p: Player): void {
  p.rec.hp = p.profile.maxHp;
  p.rec.mp = p.profile.maxMp;
  p.effects = p.effects.filter((e) => e.id.startsWith('food:'));
  p.conn?.send('self:update', { hp: p.rec.hp, mp: p.rec.mp });
}

async function startMatch(deps: GameplayDeps, a: Queued, b: Queued): Promise<void> {
  const owner = { id: a.p.id, name: 'Arena' };
  const def = getMap('arena')!;
  const now = Date.now();
  for (const [me, foe] of [
    [a, b],
    [b, a],
  ] as const) {
    me.p.arena = { foe: foe.p, back: { mapId: me.p.mapId, x: me.p.x, y: me.p.y, owner: me.p.instanceOwner }, done: false };
    deps.world.cancelMountChannel(me.p, null);
    if (me.p.mount) deps.world.setMount(me.p, null, 1);
    me.p.conn?.send('arena', {
      kind: 'found',
      foe: { name: foe.p.name, level: foe.p.rec.level, classId: foe.p.rec.classId, rating: foe.rating },
      startsAt: now + COUNTDOWN_MS,
      until: now + COUNTDOWN_MS + MATCH_MS,
    });
  }
  await deps.world.moveTo(a.p, def.id, owner, 5, 9, 'right');
  await deps.world.moveTo(b.p, def.id, owner, 20, 9, 'left');
  heal(a.p);
  heal(b.p);
  deps.log.info('arena_match', { a: a.p.id, b: b.p.id, ra: a.rating, rb: b.rating });
  setTimeout(() => {
    if (a.p.arena?.foe !== b.p || b.p.arena?.foe !== a.p || a.p.arena.done) return;
    deps.world.startDuel(a.p, b.p, MATCH_MS);
  }, COUNTDOWN_MS).unref();
}

/** A duel ended: if it was an arena match, rate it, pay the winner and send both home. */
export function onArenaDuelEnd(deps: GameplayDeps, a: Player, b: Player, winner: Player | null): void {
  if (!a.arena || a.arena.foe !== b || a.arena.done) return;
  a.arena.done = true;
  if (b.arena) b.arena.done = true;
  void settle(deps, a, b, winner).catch((err) => deps.log.error('arena_settle_failed', { err }));
}

async function settle(deps: GameplayDeps, a: Player, b: Player, winner: Player | null): Promise<void> {
  const season = arenaSeason(Date.now());
  const results = await withTransaction(deps.pool, async (tx) => {
    for (const id of [a.id, b.id].sort())
      await tx.query(`INSERT INTO arena_ratings (character_id, season) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [id, season]);
    const { rows } = await tx.query(`SELECT character_id, rating FROM arena_ratings WHERE season = $1 AND character_id = ANY($2) ORDER BY character_id FOR UPDATE`, [season, [a.id, b.id]]);
    const r = new Map(rows.map((x) => [x.character_id as string, x.rating as number]));
    if (!winner) return new Map([[a.id, { delta: 0, rating: r.get(a.id)! }], [b.id, { delta: 0, rating: r.get(b.id)! }]]);
    const loser = winner === a ? b : a;
    const d = arenaDelta(r.get(winner.id)!, r.get(loser.id)!);
    // Never drop below 0; the winner's gain stays the same.
    const lost = Math.min(d, r.get(loser.id)!);
    await tx.query(`UPDATE arena_ratings SET rating = rating + $3, wins = wins + 1 WHERE character_id = $1 AND season = $2`, [winner.id, season, d]);
    await tx.query(`UPDATE arena_ratings SET rating = rating - $3, losses = losses + 1 WHERE character_id = $1 AND season = $2`, [loser.id, season, lost]);
    await tx.query(`INSERT INTO arena_matches (season, winner_id, loser_id, winner_delta, loser_delta) VALUES ($1, $2, $3, $4, $5)`, [season, winner.id, loser.id, d, -lost]);
    return new Map([
      [winner.id, { delta: d, rating: r.get(winner.id)! + d }],
      [loser.id, { delta: -lost, rating: r.get(loser.id)! - lost }],
    ]);
  });
  for (const p of [a, b]) {
    const res = results.get(p.id)!;
    const won = winner ? winner === p : null;
    const gold = won ? 50 + p.rec.level * 10 : 0;
    if (gold && deps.world.players.get(p.id) === p) {
      const g = await grantKillRewards(deps.pool, p.id, { xp: 0, gold, items: [], monster: 'arena' }, 'achievement');
      pushInventory(deps.world, p, g.inventory);
      applyDelta(deps.world, p, g.delta);
    }
    p.conn?.send('arena', { kind: 'result', won, delta: res.delta, rating: res.rating, gold });
    p.conn?.send('notice', {
      kind: won ? 'success' : 'info',
      text: won === null ? `Arena: a draw. Rating ${res.rating}.` : `Arena: ${won ? 'Victory' : 'Defeat'}! ${res.delta >= 0 ? '+' : ''}${res.delta} rating (${res.rating}, ${arenaTier(res.rating).name}).`,
    });
  }
  // Back to where they came from after a moment.
  setTimeout(() => {
    for (const p of [a, b]) void sendBack(deps, p).catch((err) => deps.log.error('arena_return_failed', { err }));
  }, RETURN_MS).unref();
}

async function sendBack(deps: GameplayDeps, p: Player): Promise<void> {
  const s = p.arena;
  p.arena = null;
  if (!s || deps.world.players.get(p.id) !== p || p.mapId !== 'arena') return;
  heal(p);
  const map = getMap(s.back.mapId);
  const tx = Math.floor(s.back.x / 32);
  const ty = Math.floor(s.back.y / 32);
  if (!map) return deps.world.moveTo(p, 'greenhaven', null, getMap('greenhaven')!.spawn.x, getMap('greenhaven')!.spawn.y, 'down');
  await deps.world.moveTo(p, map.id, s.back.owner, tx, ty, 'down');
}

/** Disconnected or gone: drop out of the queue; leaving before the fight forfeits. */
export function arenaOnLeave(deps: GameplayDeps, p: Player): void {
  queue.delete(p.id);
  const s = p.arena;
  if (s && !s.done && s.foe.arena?.foe === p) onArenaDuelEnd(deps, s.foe, p, s.foe);
}

export function startArena(deps: GameplayDeps): () => void {
  const t = setInterval(() => {
    try {
      tryMatch(deps);
    } catch (err) {
      deps.log.error('arena_tick_failed', { err });
    }
  }, 2000);
  t.unref();
  return () => clearInterval(t);
}
