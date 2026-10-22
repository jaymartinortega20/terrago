import { randomUUID } from 'node:crypto';
import {
  CHAT,
  PARTY_MAX,
  TILE_SIZE,
  maskProfanity,
  sanitizeChatText,
  type ChatMessage,
  type FriendsView,
  type GuildRank,
  type GuildView,
  type InviteKind,
  type PartyView,
  type PlayerProfile,
} from '@terrago/shared';
import { GameError } from '../db';
import * as db from '../services/social';
import type { Player } from '../world/player';
import type { World } from '../world/world';
import { pushInventory, type GameplayDeps } from './gameplay';

/**
 * Social systems: parties (in memory), friends, mutes/blocks, guilds,
 * chat channels, profiles and reports.
 */

export interface Party {
  id: string;
  leaderId: string;
  members: Player[];
}

const parties = new Set<Party>();
const INVITE_MS = 60_000;
const GLOBAL_COOLDOWN_MS = 4_000;
let partyTimer: NodeJS.Timeout | null = null;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function online(world: World, nameOrId: unknown): Player | undefined {
  if (typeof nameOrId !== 'string' || !nameOrId.trim()) return undefined;
  const key = nameOrId.trim().toLowerCase();
  return world.players.get(nameOrId) ?? [...world.players.values()].find((x) => x.name.toLowerCase() === key);
}

function notice(p: Player, text: string, kind: 'info' | 'success' | 'error' = 'info'): void {
  p.conn?.send('notice', { kind, text });
}

function system(p: Player, text: string): void {
  p.conn?.send('chat', { id: randomUUID(), channel: 'system', fromId: null, fromName: 'System', text, ts: Date.now() });
}

function invite(world: World, from: Player, to: Player, kind: InviteKind, extra?: { guildId: number; detail: string }): void {
  if (to.blocked.get(from.id) === 'block') throw new GameError(`${to.name} isn't accepting invites.`);
  to.invites.set(`${kind}:${from.id}`, { kind, from: from.id, until: Date.now() + INVITE_MS, ...(extra ? { guildId: extra.guildId } : {}) });
  to.conn?.send('invite', { kind, fromId: from.id, fromName: from.name, ...(extra ? { detail: extra.detail } : {}) });
}

// ---------------------------------------------------------------------------
// Party
// ---------------------------------------------------------------------------

function partyView(party: Party): PartyView {
  return {
    leaderId: party.leaderId,
    members: party.members.map((m) => ({
      id: m.id,
      name: m.name,
      level: m.rec.level,
      classId: m.rec.classId,
      hp: m.rec.hp,
      maxHp: m.profile?.maxHp ?? m.rec.hp,
      mapId: m.mapId,
      online: !!m.conn,
    })),
  };
}

function pushParty(party: Party): void {
  const v = partyView(party);
  for (const m of party.members) m.conn?.send('party', v);
}

function ensurePartyTimer(): void {
  if (partyTimer) return;
  partyTimer = setInterval(() => {
    for (const party of parties) pushParty(party);
    if (!parties.size && partyTimer) {
      clearInterval(partyTimer);
      partyTimer = null;
    }
  }, 1000);
  partyTimer.unref();
}

/** Party members on the same map and nearby (for XP sharing and kill credit). */
export function partyOf(p: Player): Player[] {
  if (!p.party) return [p];
  return p.party.members.filter((m) => m === p || (m.conn && m.mapId === p.mapId && m.instanceOwner?.id === p.instanceOwner?.id && !m.dead));
}

export function partyInvite(deps: GameplayDeps, p: Player, target: unknown): { message: string } {
  const q = online(deps.world, target);
  if (!q || q === p) throw new GameError('That player is not online.');
  if (p.party && p.party.leaderId !== p.id) throw new GameError('Only the party leader can invite.');
  if (p.party && p.party.members.length >= PARTY_MAX) throw new GameError(`Parties hold up to ${PARTY_MAX} players.`);
  if (q.party) throw new GameError(`${q.name} is already in a party.`);
  invite(deps.world, p, q, 'party');
  return { message: `Party invite sent to ${q.name}.` };
}

function removeFromParty(p: Player, reason: string): void {
  const party = p.party;
  if (!party) return;
  p.party = null;
  party.members = party.members.filter((m) => m !== p);
  p.conn?.send('party', null);
  if (party.members.length <= 1) {
    for (const m of party.members) {
      m.party = null;
      m.conn?.send('party', null);
      system(m, 'Your party was disbanded.');
    }
    parties.delete(party);
    return;
  }
  if (party.leaderId === p.id) party.leaderId = party.members[0]!.id;
  for (const m of party.members) system(m, reason);
  pushParty(party);
}

export function partyLeave(p: Player): null {
  if (!p.party) throw new GameError("You're not in a party.");
  removeFromParty(p, `${p.name} left the party.`);
  return null;
}

export function partyKick(deps: GameplayDeps, p: Player, id: unknown): null {
  const party = p.party;
  if (!party || party.leaderId !== p.id) throw new GameError('Only the party leader can remove members.');
  const q = party.members.find((m) => m.id === id);
  if (!q || q === p) throw new GameError("They're not in your party.");
  removeFromParty(q, `${q.name} was removed from the party.`);
  system(q, 'You were removed from the party.');
  return null;
}

// ---------------------------------------------------------------------------
// Invites (party, friend, guild)
// ---------------------------------------------------------------------------

export async function respondInvite(deps: GameplayDeps, p: Player, req: unknown): Promise<{ message: string } | null> {
  const r = (req ?? {}) as { kind?: InviteKind; fromId?: string; accept?: boolean };
  const key = `${r.kind}:${r.fromId}`;
  const inv = p.invites.get(key);
  p.invites.delete(key);
  if (!inv || inv.until < Date.now()) throw new GameError('That invite expired.');
  const from = deps.world.players.get(inv.from);
  if (!r.accept) {
    if (from) notice(from, `${p.name} declined your ${inv.kind} invite.`);
    return null;
  }
  if (inv.kind === 'party') {
    if (!from) throw new GameError('They went offline.');
    if (p.party) throw new GameError("You're already in a party.");
    let party = from.party;
    if (!party) {
      party = { id: randomUUID(), leaderId: from.id, members: [from] };
      from.party = party;
      parties.add(party);
      ensurePartyTimer();
    }
    if (party.members.length >= PARTY_MAX) throw new GameError('That party is full.');
    party.members.push(p);
    p.party = party;
    for (const m of party.members) system(m, `${p.name} joined the party.`);
    pushParty(party);
    return { message: `You joined ${from.name}'s party.` };
  }
  if (inv.kind === 'friend') {
    await db.addFriendship(deps.pool, p.id, inv.from);
    p.friendIds.add(inv.from);
    from?.friendIds.add(p.id);
    await pushFriends(deps, p);
    if (from) {
      await pushFriends(deps, from);
      notice(from, `${p.name} is now your friend.`, 'success');
    }
    return { message: 'Friend added.' };
  }
  // Guild
  if (p.guild) throw new GameError("You're already in a guild.");
  const g = await db.joinGuild(deps.pool, inv.guildId!, p.id);
  setGuild(deps.world, p, g);
  await pushGuild(deps, g.id, `${p.name} joined the guild!`);
  return { message: `Welcome to ${g.name}!` };
}

// ---------------------------------------------------------------------------
// Friends, mutes, blocks
// ---------------------------------------------------------------------------

export async function friendsView(deps: GameplayDeps, p: Player): Promise<FriendsView> {
  const [rows, blocked] = await Promise.all([db.friendRows(deps.pool, p.id), db.blockedRows(deps.pool, p.id)]);
  return {
    friends: rows.map((f) => {
      const q = deps.world.players.get(f.id);
      return { ...f, online: !!q?.conn, mapId: q?.conn ? q.mapId : null };
    }),
    blocked,
  };
}

async function pushFriends(deps: GameplayDeps, p: Player): Promise<void> {
  if (p.conn) p.conn.send('friends', await friendsView(deps, p));
}

export async function friendAdd(deps: GameplayDeps, p: Player, nameOrId: unknown): Promise<{ message: string }> {
  const q = online(deps.world, nameOrId);
  if (!q) throw new GameError('That player is not online. Friend requests need both of you online.');
  if (q === p) throw new GameError("You can't befriend yourself (but we like the spirit).");
  if (p.friendIds.has(q.id)) throw new GameError(`${q.name} is already your friend.`);
  invite(deps.world, p, q, 'friend');
  return { message: `Friend request sent to ${q.name}.` };
}

export async function friendRemove(deps: GameplayDeps, p: Player, id: unknown): Promise<null> {
  if (typeof id !== 'string') throw new GameError('Who?');
  await db.removeFriendship(deps.pool, p.id, id);
  p.friendIds.delete(id);
  const q = deps.world.players.get(id);
  q?.friendIds.delete(p.id);
  await pushFriends(deps, p);
  if (q) await pushFriends(deps, q);
  return null;
}

export async function blockSet(deps: GameplayDeps, p: Player, req: unknown): Promise<{ message: string }> {
  const r = (req ?? {}) as { targetId?: unknown; kind?: unknown };
  const kind = r.kind === 'mute' || r.kind === 'block' ? r.kind : null;
  const target = typeof r.targetId === 'string' ? await db.findCharacter(deps.pool, r.targetId) : null;
  if (!target) throw new GameError('That player does not exist.');
  await db.setBlock(deps.pool, p.id, target.id, kind);
  if (kind) p.blocked.set(target.id, kind);
  else p.blocked.delete(target.id);
  if (kind === 'block') {
    p.friendIds.delete(target.id);
    const q = deps.world.players.get(target.id);
    q?.friendIds.delete(p.id);
    if (q) await pushFriends(deps, q);
  }
  await pushFriends(deps, p);
  const text = { mute: `Muted ${target.name}: you won't see their messages.`, block: `Blocked ${target.name}.`, none: `${target.name} is no longer muted or blocked.` };
  return { message: text[kind ?? 'none'] };
}

export async function report(deps: GameplayDeps, p: Player, req: unknown): Promise<{ message: string }> {
  const r = (req ?? {}) as { targetId?: unknown; reason?: unknown };
  const target = typeof r.targetId === 'string' ? await db.findCharacter(deps.pool, r.targetId) : null;
  if (!target || target.id === p.id) throw new GameError('That player does not exist.');
  const reason = sanitizeChatText(r.reason, 300) ?? '';
  if (reason.length < 3) throw new GameError('Please say briefly what happened.');
  const live = deps.world.players.get(target.id);
  await db.fileReport(deps.pool, p.id, target.id, reason, live?.said ?? []);
  deps.log.info('player_reported', { reporter: p.id, target: target.id });
  return { message: `Thanks — your report about ${target.name} was sent to the moderators.` };
}

export async function profile(deps: GameplayDeps, p: Player, idOrName: unknown): Promise<PlayerProfile> {
  if (typeof idOrName !== 'string') throw new GameError('Who?');
  const c = await db.findCharacter(deps.pool, idOrName);
  const row = c && (await db.profileRow(deps.pool, c.id));
  if (!row) throw new GameError('That player does not exist.');
  const q = deps.world.players.get(row.id);
  return { ...row, online: !!q?.conn, mapId: q?.conn ? q.mapId : null, friend: p.friendIds.has(row.id), blocked: p.blocked.get(row.id) ?? null };
}

// ---------------------------------------------------------------------------
// Guilds
// ---------------------------------------------------------------------------

function setGuild(world: World, p: Player, g: db.GuildMembership | null): void {
  p.guild = g;
  world.broadcastLook(p, { guild: g?.tag ?? null });
  if (!g) p.conn?.send('guild', null);
}

async function guildViewFor(deps: GameplayDeps, guildId: number, me: string): Promise<GuildView> {
  const v = await db.guildView(deps.pool, guildId, me);
  return { ...v, members: v.members.map((m) => ({ ...m, online: !!deps.world.players.get(m.id)?.conn })) };
}

/** Refresh every online member's guild window (and ranks); optionally announce something. */
async function pushGuild(deps: GameplayDeps, guildId: number, announce?: string): Promise<void> {
  const members = [...deps.world.players.values()].filter((x) => x.guild?.id === guildId);
  if (!members.length) return;
  const base = await db.guildView(deps.pool, guildId, '');
  for (const m of members) {
    const mine = base.members.find((x) => x.id === m.id);
    if (!mine) continue;
    m.guild = { id: base.id, name: base.name, tag: base.tag, rank: mine.rank };
    m.conn?.send('guild', {
      ...base,
      myRank: mine.rank,
      members: base.members.map((x) => ({ ...x, online: !!deps.world.players.get(x.id)?.conn })),
    });
    if (announce) m.conn?.send('chat', { id: randomUUID(), channel: 'guild', fromId: null, fromName: base.tag, text: announce, ts: Date.now() });
  }
}

function myGuild(p: Player): db.GuildMembership {
  if (!p.guild) throw new GameError("You're not in a guild.");
  return p.guild;
}

export const guild = {
  async get(deps: GameplayDeps, p: Player): Promise<GuildView | null> {
    return p.guild ? guildViewFor(deps, p.guild.id, p.id) : null;
  },
  async create(deps: GameplayDeps, p: Player, req: unknown): Promise<{ message: string }> {
    const r = (req ?? {}) as { name?: string; tag?: string };
    const g = await db.createGuild(deps.pool, p.id, r.name ?? '', r.tag ?? '');
    const inv = deps.world.inventoryCache.get(p.id);
    if (inv) pushInventory(deps.world, p, { ...inv, gold: g.gold });
    setGuild(deps.world, p, { id: g.id, name: g.name, tag: g.tag, rank: 'leader' });
    await pushGuild(deps, g.id);
    return { message: `You founded ${g.name} [${g.tag}]!` };
  },
  async invite(deps: GameplayDeps, p: Player, nameOrId: unknown): Promise<{ message: string }> {
    const g = myGuild(p);
    if (g.rank === 'member') throw new GameError('Only officers and the leader can invite.');
    const q = online(deps.world, nameOrId);
    if (!q || q === p) throw new GameError('That player is not online.');
    if (q.guild) throw new GameError(`${q.name} is already in a guild.`);
    invite(deps.world, p, q, 'guild', { guildId: g.id, detail: `${g.name} [${g.tag}]` });
    return { message: `Guild invite sent to ${q.name}.` };
  },
  async leave(deps: GameplayDeps, p: Player): Promise<{ message: string }> {
    const g = myGuild(p);
    const res = await db.leaveGuild(deps.pool, g.id, p.id);
    setGuild(deps.world, p, null);
    if (!res.disbanded) {
      const heir = res.newLeader ? deps.world.players.get(res.newLeader) : null;
      await pushGuild(deps, g.id, `${p.name} left the guild.${res.newLeader ? ` ${heir?.name ?? 'A new leader'} now leads.` : ''}`);
    }
    return { message: res.disbanded ? `${g.name} was disbanded.` : `You left ${g.name}.` };
  },
  async kick(deps: GameplayDeps, p: Player, id: unknown): Promise<{ message: string }> {
    const g = myGuild(p);
    if (typeof id !== 'string') throw new GameError('Who?');
    await db.kickMember(deps.pool, g.id, p.id, id);
    const q = deps.world.players.get(id);
    if (q) {
      setGuild(deps.world, q, null);
      system(q, `You were removed from ${g.name}.`);
    }
    await pushGuild(deps, g.id, `${q?.name ?? 'A member'} was removed from the guild.`);
    return { message: 'Member removed.' };
  },
  async rank(deps: GameplayDeps, p: Player, req: unknown): Promise<{ message: string }> {
    const g = myGuild(p);
    const r = (req ?? {}) as { id?: string; rank?: GuildRank };
    if (typeof r.id !== 'string' || !r.rank) throw new GameError('Who?');
    await db.setRank(deps.pool, g.id, p.id, r.id, r.rank);
    const name = deps.world.players.get(r.id)?.name ?? 'A member';
    await pushGuild(deps, g.id, r.rank === 'leader' ? `${name} is the new guild leader!` : `${name} is now ${r.rank === 'officer' ? 'an officer' : 'a member'}.`);
    return { message: 'Rank changed.' };
  },
  async treasury(deps: GameplayDeps, p: Player, req: unknown): Promise<{ message: string }> {
    const g = myGuild(p);
    const amount = Number((req as { amount?: unknown } | null)?.amount);
    const res = await db.treasury(deps.pool, g.id, p.id, amount);
    const inv = deps.world.inventoryCache.get(p.id);
    if (inv) pushInventory(deps.world, p, { ...inv, gold: res.gold });
    await pushGuild(deps, g.id, amount > 0 ? `${p.name} deposited ${amount.toLocaleString()} Gold.` : `${p.name} withdrew ${(-amount).toLocaleString()} Gold.`);
    return { message: `Treasury: ${res.treasury.toLocaleString()} Gold.` };
  },
  async motd(deps: GameplayDeps, p: Player, text: unknown): Promise<null> {
    const g = myGuild(p);
    await db.setMotd(deps.pool, g.id, p.id, maskProfanity(sanitizeChatText(text, 200) ?? ''));
    await pushGuild(deps, g.id);
    return null;
  },
};

// ---------------------------------------------------------------------------
// Chat channels
// ---------------------------------------------------------------------------

function deliver(world: World, from: Player, to: Iterable<Player>, msg: ChatMessage): void {
  for (const q of to) if (q.conn && (q === from || !q.ignores(from))) q.conn.send('chat', msg);
}

/** Slash commands for channels and social actions; '' = handled silently, undefined = unknown. */
export function chatCommand(deps: GameplayDeps, p: Player, cmd: string, rest: string): string | undefined {
  const world = deps.world;
  const text = () => {
    const t = maskProfanity(sanitizeChatText(rest, CHAT.maxLength) ?? '');
    if (!t) throw new GameError('Say something after the command.');
    return t;
  };
  const msg = (channel: ChatMessage['channel'], body: string, toName?: string): ChatMessage => ({
    id: randomUUID(),
    channel,
    fromId: p.id,
    fromName: p.name,
    text: body,
    ts: Date.now(),
    ...(toName ? { toName } : {}),
  });
  try {
    switch (cmd) {
      case 'g':
      case 'global':
      case 'world': {
        const now = Date.now();
        if (now < p.nextGlobalAt) return `World chat: wait ${Math.ceil((p.nextGlobalAt - now) / 1000)}s.`;
        if (p.rec.level < 2) return 'Reach level 2 to use world chat.';
        p.nextGlobalAt = now + GLOBAL_COOLDOWN_MS;
        const m = msg('global', text());
        deliver(world, p, world.players.values(), m);
        p.remember('global', m.text);
        world.logChat({ channel: 'global', mapId: p.mapId, senderId: p.id, body: m.text });
        return '';
      }
      case 'p':
      case 'party': {
        if (!p.party) return "You're not in a party.";
        const m = msg('party', text());
        deliver(world, p, p.party.members, m);
        p.remember('party', m.text);
        world.logChat({ channel: 'party', mapId: p.mapId, senderId: p.id, body: m.text });
        return '';
      }
      case 'gu':
      case 'guild': {
        if (!p.guild) return "You're not in a guild.";
        const id = p.guild.id;
        const m = msg('guild', text());
        deliver(world, p, [...world.players.values()].filter((x) => x.guild?.id === id), m);
        p.remember('guild', m.text);
        world.logChat({ channel: 'guild', mapId: p.mapId, senderId: p.id, body: m.text });
        return '';
      }
      case 'w':
      case 'whisper':
      case 'tell':
      case 'r':
      case 'reply': {
        let name: string;
        let body: string;
        if (cmd === 'r' || cmd === 'reply') {
          if (!p.replyTo) return 'Nobody to reply to yet.';
          name = p.replyTo;
          body = rest;
        } else {
          const sp = rest.indexOf(' ');
          if (sp < 1) return 'Usage: /w name message';
          name = rest.slice(0, sp);
          body = rest.slice(sp + 1);
        }
        const q = online(world, name);
        if (!q || !q.conn) return `${name} is not online.`;
        if (q === p) return 'Talking to yourself?';
        if (q.ignores(p)) return `${q.name} isn't accepting whispers.`;
        const t = maskProfanity(sanitizeChatText(body, CHAT.maxLength) ?? '');
        if (!t) return 'Say something after the name.';
        const m = msg('whisper', t, q.name);
        q.conn.send('chat', m);
        p.conn?.send('chat', m);
        q.replyTo = p.name;
        p.replyTo = q.name;
        p.remember(`whisper:${q.name}`, t);
        world.logChat({ channel: 'whisper', mapId: p.mapId, senderId: p.id, recipientId: q.id, body: t });
        return '';
      }
      case 'invite':
        return partyInvite(deps, p, rest).message;
      case 'leave':
        partyLeave(p);
        return 'You left the party.';
      default:
        return undefined;
    }
  } catch (err) {
    if (err instanceof GameError) return err.message;
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

/** After joining the world: load mutes, guild, friends; tell friends you're online. */
export async function onJoin(deps: GameplayDeps, p: Player, fresh: boolean): Promise<void> {
  if (fresh) {
    const s = await db.loadSocial(deps.pool, p.id);
    p.blocked = s.blocked;
    p.friendIds = new Set(await db.friendIds(deps.pool, p.id));
    if (s.guild) setGuild(deps.world, p, s.guild);
    const m = await deps.pool.query(`SELECT chat_muted_until, pet FROM characters WHERE id = $1`, [p.id]);
    p.mutedUntil = m.rows[0]?.chat_muted_until ? new Date(m.rows[0].chat_muted_until).getTime() : 0;
    if (m.rows[0]?.pet) {
      p.pet = m.rows[0].pet;
      deps.world.broadcastLook(p, { pet: p.pet });
    }
    for (const id of p.friendIds) {
      const q = deps.world.players.get(id);
      if (q?.conn) {
        notice(q, `${p.name} is now online.`);
        void pushFriends(deps, q).catch(() => {});
      }
    }
  }
  if (p.guild) await pushGuild(deps, p.guild.id);
  if (p.party) pushParty(p.party);
}

/** Leaving the world for good: leave the party, tell friends. */
export function onLeave(deps: GameplayDeps, p: Player): void {
  p.stall = null;
  if (p.party) removeFromParty(p, `${p.name} went offline and left the party.`);
  for (const id of p.friendIds) {
    const q = deps.world.players.get(id);
    if (q?.conn) void pushFriends(deps, q).catch(() => {});
  }
  if (p.guild) void pushGuild(deps, p.guild.id).catch(() => {});
}

export const SOCIAL_RANGE = 25 * TILE_SIZE;
