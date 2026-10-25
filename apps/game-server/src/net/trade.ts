import { getItem } from '@terrago/game-data';
import { TILE_SIZE, type TradeOfferItem, type TradeSide, type TradeView } from '@terrago/shared';
import { GameError } from '../db';
import { executeTrade } from '../services/market';
import type { Player } from '../world/player';
import { antibot } from '../security/antibot';
import { pushInventory, type GameplayDeps } from './gameplay';

/**
 * Direct player-to-player trading: request → accept → both make offers →
 * both lock → both confirm → the server executes the whole swap in one
 * transaction (services/market.ts executeTrade). Any change to an offer
 * unlocks both sides, so nobody can swap an item out after the other
 * player agreed.
 */

interface Side extends TradeSide {
  player: Player;
}

interface Session {
  a: Side;
  b: Side;
  executing: boolean;
}

const sessions = new Map<string, Session>();
const invites = new Map<string, { from: Player; until: number }>();
const REACH = 10 * TILE_SIZE;

const near = (p: Player, q: Player) => p.mapId === q.mapId && p.instanceOwner?.id === q.instanceOwner?.id && Math.hypot(p.x - q.x, p.y - q.y) <= REACH;

function sides(s: Session, p: Player): { me: Side; them: Side } {
  return s.a.player === p ? { me: s.a, them: s.b } : { me: s.b, them: s.a };
}

function view(s: Session, p: Player): TradeView {
  const { me, them } = sides(s, p);
  const strip = (x: Side): TradeSide => ({ items: x.items, gold: x.gold, locked: x.locked, confirmed: x.confirmed });
  return { partner: { id: them.player.id, name: them.player.name }, mine: strip(me), theirs: strip(them) };
}

function push(s: Session): void {
  s.a.player.conn?.send('trade:update', view(s, s.a.player));
  s.b.player.conn?.send('trade:update', view(s, s.b.player));
}

function end(s: Session, reason?: string): void {
  for (const side of [s.a, s.b]) {
    sessions.delete(side.player.id);
    side.player.conn?.send('trade:update', null);
    if (reason) side.player.conn?.send('notice', { kind: 'info', text: reason });
  }
}

export function cancelTrade(p: Player, reason = 'Trade cancelled.'): void {
  const s = sessions.get(p.id);
  if (s && !s.executing) end(s, reason);
}

export function requestTrade(deps: GameplayDeps, p: Player, targetId: unknown): { message: string } {
  const q = typeof targetId === 'string' ? deps.world.players.get(targetId) : undefined;
  if (!q || q === p || !q.conn) throw new GameError('That player is not here.');
  if (!near(p, q)) throw new GameError(`${q.name} is too far away to trade.`);
  if (sessions.has(p.id) || sessions.has(q.id)) throw new GameError('Someone is already trading.');
  if (q.blocked.get(p.id) === 'block') throw new GameError(`${q.name} isn't accepting trades.`);
  invites.set(q.id, { from: p, until: Date.now() + 30_000 });
  q.conn.send('trade:invite', { id: p.id, name: p.name });
  return { message: `Trade request sent to ${q.name}.` };
}

export function respondTrade(deps: GameplayDeps, p: Player, req: unknown): null {
  const r = (req ?? {}) as { fromId?: unknown; accept?: unknown };
  const inv = invites.get(p.id);
  invites.delete(p.id);
  if (!inv || inv.from.id !== r.fromId || inv.until < Date.now()) throw new GameError('That trade request expired.');
  const q = inv.from;
  if (!r.accept) {
    q.conn?.send('notice', { kind: 'info', text: `${p.name} declined to trade.` });
    return null;
  }
  if (!deps.world.players.has(q.id) || !near(p, q)) throw new GameError(`${q.name} is too far away.`);
  if (sessions.has(p.id) || sessions.has(q.id)) throw new GameError('Someone is already trading.');
  const blank = (player: Player): Side => ({ player, items: [], gold: 0, locked: false, confirmed: false });
  const s: Session = { a: blank(q), b: blank(p), executing: false };
  sessions.set(p.id, s);
  sessions.set(q.id, s);
  push(s);
  return null;
}

export function setOffer(deps: GameplayDeps, p: Player, req: unknown): null {
  const s = sessions.get(p.id);
  if (!s || s.executing) throw new GameError("You're not trading.");
  const r = (req ?? {}) as { items?: unknown; gold?: unknown };
  if (!Array.isArray(r.items) || r.items.length > 12) throw new GameError('Up to 12 items per trade.');
  const gold = Number(r.gold ?? 0);
  if (!Number.isSafeInteger(gold) || gold < 0) throw new GameError('Invalid Gold amount.');
  if (gold > p.rec.gold) throw new GameError("You don't have that much Gold.");
  const inv = deps.world.inventoryCache.get(p.id);
  const used = new Set<number>();
  const items: TradeOfferItem[] = [];
  for (const raw of r.items as { slot?: unknown; quantity?: unknown }[]) {
    if (!Number.isInteger(raw?.slot) || !Number.isInteger(raw?.quantity) || (raw.quantity as number) < 1) throw new GameError('Invalid item.');
    const slot = raw.slot as number;
    if (used.has(slot)) throw new GameError('Each slot can only be offered once.');
    used.add(slot);
    const s2 = inv?.slots.find((x) => x.slot === slot);
    if (!s2 || s2.quantity < (raw.quantity as number)) throw new GameError("You don't have that.");
    const def = getItem(s2.itemId);
    if (!def?.tradable || s2.bound) throw new GameError(`${def?.name ?? 'That item'} can't be traded.`);
    items.push({ slot, itemId: s2.itemId, quantity: raw.quantity as number, quality: s2.quality, enhance: s2.enhance ?? 0, ...(s2.affixes?.length ? { affixes: s2.affixes } : {}) });
  }
  const { me } = sides(s, p);
  me.items = items;
  me.gold = gold;
  // Any change unlocks both sides.
  for (const side of [s.a, s.b]) {
    side.locked = false;
    side.confirmed = false;
  }
  push(s);
  return null;
}

export function lockTrade(p: Player): null {
  const s = sessions.get(p.id);
  if (!s || s.executing) throw new GameError("You're not trading.");
  sides(s, p).me.locked = true;
  push(s);
  return null;
}

export async function confirmTrade(deps: GameplayDeps, p: Player): Promise<{ message: string } | null> {
  const s = sessions.get(p.id);
  if (!s || s.executing) throw new GameError("You're not trading.");
  if (!s.a.locked || !s.b.locked) throw new GameError('Both of you must lock the trade first.');
  if (!near(s.a.player, s.b.player)) {
    end(s, 'Trade cancelled — you moved too far apart.');
    return null;
  }
  sides(s, p).me.confirmed = true;
  push(s);
  if (!s.a.confirmed || !s.b.confirmed) return null;
  s.executing = true;
  try {
    const res = await executeTrade(
      deps.pool,
      { characterId: s.a.player.id, items: s.a.items, gold: s.a.gold },
      { characterId: s.b.player.id, items: s.b.items, gold: s.b.gold },
    );
    void antibot?.trade(s.a.player.id, s.b.player.id).catch(() => {});
    pushInventory(deps.world, s.a.player, res.a);
    pushInventory(deps.world, s.b.player, res.b);
    s.executing = false;
    end(s, `Trade complete with ${s.a.player === p ? s.b.player.name : s.a.player.name}!`);
    return { message: 'Trade complete!' };
  } catch (err) {
    s.executing = false;
    for (const side of [s.a, s.b]) {
      side.locked = false;
      side.confirmed = false;
    }
    push(s);
    throw err;
  }
}
