'use client';

import { useEffect, useState } from 'react';
import { getItem, getMap } from '@terrago/game-data';
import { GUILD_INVEST_GOLD_PER_XP, GUILD_LEVEL_XP, GUILD_QUEST_XP, guildLevel, guildPerks, PARTY_ACTIVITIES, PARTY_MAX, type GuildQuestsView, type GuildRank, type PartyListing } from '@terrago/shared';
import type { GameClient } from '../net/client';
import { useStore } from '../store';
import { Window } from './Window';

const CLASS_NAME: Record<string, string> = { warrior: 'Warrior', mage: 'Mage', archer: 'Archer', acolyte: 'Acolyte' };
const mapName = (id: string | null) => (id ? (getMap(id.split(':')[0]!)?.name ?? id) : '');
const Dot = ({ on }: { on: boolean }) => <span className={`inline-block h-2 w-2 shrink-0 rounded-full ${on ? 'bg-leaf' : 'bg-wood-dark/30'}`} aria-label={on ? 'online' : 'offline'} />;

/** Party members with HP bars, under the HUD. */
export function PartyFrame({ client }: { client: GameClient }) {
  const party = useStore(client.ui, (s) => s.party);
  const me = useStore(client.ui, (s) => s.self?.characterId);
  if (!party) return null;
  const lead = party.leaderId === me;
  return (
    <div className="px-panel-dark pointer-events-auto w-44 space-y-1 p-1.5 text-[11px]" data-testid="party-frame">
      <div className="flex items-center font-bold text-sky">
        Party {party.members.length}/{PARTY_MAX}
        <button className="ml-auto text-parchment/60 hover:text-parchment" onClick={() => void client.partyLeave()} title="Leave party" data-testid="party-leave">
          Leave
        </button>
      </div>
      {party.members
        .filter((m) => m.id !== me)
        .map((m) => (
          <div key={m.id} className={m.online ? '' : 'opacity-50'}>
            <div className="flex items-center gap-1">
              {m.id === party.leaderId && <span title="Leader">👑</span>}
              <span className="truncate font-bold">{m.name}</span>
              <span className="text-parchment/60">Lv{m.level}</span>
              {lead && (
                <button className="ml-auto text-parchment/50 hover:text-[#ff8a7a]" onClick={() => void client.partyKick(m.id)} title="Remove from party">
                  ✕
                </button>
              )}
            </div>
            <div className="h-1.5 w-full bg-night">
              <div className="h-full bg-[#d0503c]" style={{ width: `${Math.max(0, Math.min(100, (m.hp / Math.max(1, m.maxHp)) * 100))}%` }} />
            </div>
            {m.mapId !== client.ui.get().mapId && <div className="text-[10px] text-parchment/50">{mapName(m.mapId)}</div>}
          </div>
        ))}
    </div>
  );
}

/** Party / friend / guild invitations. */
export function InvitePopups({ client }: { client: GameClient }) {
  const invites = useStore(client.ui, (s) => s.invites);
  useEffect(() => {
    if (!invites.length) return;
    const t = setTimeout(() => client.ui.set((s) => ({ invites: s.invites.slice(1) })), 55_000);
    return () => clearTimeout(t);
  }, [invites, client]);
  const what = { party: 'invites you to their party', friend: 'wants to be your friend', guild: 'invites you to join' };
  return (
    <>
      {invites.map((inv) => (
        <div key={`${inv.kind}:${inv.fromId}`} className="px-panel p-2 text-sm" data-testid={`invite-${inv.kind}`}>
          <p>
            <b>{inv.fromName}</b> {what[inv.kind]}
            {inv.detail ? <b> {inv.detail}</b> : ''}.
          </p>
          <div className="mt-1 flex gap-1">
            <button className="px-btn green small" onClick={() => void client.respondInvite(inv, true)} data-testid={`invite-accept-${inv.kind}`}>
              Accept
            </button>
            <button className="px-btn ghost small" onClick={() => void client.respondInvite(inv, false)}>
              Decline
            </button>
          </div>
        </div>
      ))}
    </>
  );
}

export function FriendsPanel({ client, onClose }: { client: GameClient; onClose: () => void }) {
  const fv = useStore(client.ui, (s) => s.friends);
  const [name, setName] = useState('');
  const [tab, setTab] = useState<'friends' | 'finder'>('friends');
  useEffect(() => void client.loadFriends(), [client]);
  const online = fv?.friends.filter((f) => f.online).length ?? 0;
  const tabs = (
    <div className="mb-2 flex gap-1">
      <button className={`px-btn small ${tab === 'friends' ? 'green' : 'ghost'}`} onClick={() => setTab('friends')}>
        Friends
      </button>
      <button className={`px-btn small ${tab === 'finder' ? 'green' : 'ghost'}`} onClick={() => setTab('finder')} data-testid="tab-party-finder">
        Party finder
      </button>
    </div>
  );
  if (tab === 'finder') {
    return (
      <Window title="Party finder" onClose={onClose} testId="friends-panel">
        {tabs}
        <PartyFinder client={client} />
      </Window>
    );
  }
  return (
    <Window title="Friends" onClose={onClose} testId="friends-panel">
      {tabs}
      <form
        className="mb-2 flex gap-1"
        onSubmit={async (e) => {
          e.preventDefault();
          if (name.trim() && (await client.friendAdd(name.trim()))) setName('');
        }}
      >
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Character name"
          className="min-w-0 flex-1 border-2 border-ink bg-parchment px-1 text-sm"
          onKeyDown={(e) => e.stopPropagation()}
          data-testid="friend-name"
        />
        <button className="px-btn small green" data-testid="friend-add">
          Add friend
        </button>
      </form>
      <p className="mb-1 text-xs text-wood-dark/70">
        {fv ? `${online} of ${fv.friends.length} online` : 'Loading…'}
      </p>
      <ul className="space-y-1" data-testid="friends-list">
        {fv?.friends.length === 0 && <li className="text-sm text-wood-dark/70">No friends yet. Click a player in the world, or add someone by name.</li>}
        {fv?.friends.map((f) => (
          <li key={f.id} className="flex items-center gap-1.5 border-2 border-ink/20 px-1.5 py-1 text-sm">
            <Dot on={f.online} />
            <button className="truncate font-bold hover:underline" onClick={() => void client.openProfile(f.id)}>
              {f.name}
            </button>
            <span className="text-xs text-wood-dark/70">
              Lv{f.level} {CLASS_NAME[f.classId]}
              {f.online && f.mapId ? ` · ${mapName(f.mapId)}` : ''}
            </span>
            <span className="ml-auto flex gap-1">
              {f.online && (
                <>
                  <button className="px-btn ghost small" onClick={() => client.draftChat(`/w ${f.name} `)} title="Whisper">
                    ✉
                  </button>
                  <button className="px-btn ghost small" onClick={() => void client.partyInvite(f.id)} title="Invite to party">
                    +P
                  </button>
                </>
              )}
              <button className="px-btn ghost small" onClick={() => void client.friendRemove(f.id)} title="Remove friend">
                ✕
              </button>
            </span>
          </li>
        ))}
      </ul>
      {!!fv?.blocked.length && (
        <>
          <h3 className="mt-3 font-bold">Muted & blocked</h3>
          <ul className="space-y-1">
            {fv.blocked.map((b) => (
              <li key={b.id} className="flex items-center gap-2 text-sm">
                {b.name} <span className="text-xs text-wood-dark/60">({b.kind === 'mute' ? 'muted' : 'blocked'})</span>
                <button className="px-btn ghost small ml-auto" onClick={() => void client.setBlock(b.id, null).then(() => client.loadFriends())}>
                  Undo
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </Window>
  );
}

const RANK_LABEL: Record<GuildRank, string> = { leader: '👑 Leader', officer: '★ Officer', member: 'Member' };

export function GuildPanel({ client, onClose }: { client: GameClient; onClose: () => void }) {
  const g = useStore(client.ui, (s) => s.guild);
  const gold = useStore(client.ui, (s) => s.inventory?.gold ?? 0);
  const me = useStore(client.ui, (s) => s.self?.characterId);
  const [name, setName] = useState('');
  const [tag, setTag] = useState('');
  const [invite, setInvite] = useState('');
  const [amount, setAmount] = useState(100);
  const [motd, setMotd] = useState<string | null>(null);
  useEffect(() => void client.loadGuild(), [client]);
  const stop = (e: React.KeyboardEvent) => e.stopPropagation();

  if (!g) {
    return (
      <Window title="Guild" onClose={onClose} testId="guild-panel">
        <p className="text-sm">You're not in a guild. Found your own for 500 Gold, or ask a guild officer for an invite.</p>
        <form
          className="mt-2 space-y-1 text-sm"
          onSubmit={async (e) => {
            e.preventDefault();
            await client.guildCreate(name, tag);
          }}
        >
          <input value={name} onChange={(e) => setName(e.target.value)} onKeyDown={stop} placeholder="Guild name (3–20)" maxLength={20} className="w-full border-2 border-ink bg-parchment px-1" data-testid="guild-name" />
          <input value={tag} onChange={(e) => setTag(e.target.value.toUpperCase())} onKeyDown={stop} placeholder="Tag (2–4, e.g. IRT)" maxLength={4} className="w-32 border-2 border-ink bg-parchment px-1" data-testid="guild-tag" />
          <button className="px-btn green small block" disabled={gold < 500} data-testid="guild-create">
            Found guild (◉ 500)
          </button>
        </form>
      </Window>
    );
  }
  const officer = g.myRank !== 'member';
  const leader = g.myRank === 'leader';
  return (
    <Window title={`${g.name} [${g.tag}]`} onClose={onClose} testId="guild-panel" wide>
      <div className="mb-2 border-2 border-ink/30 bg-parchment-2/40 p-1.5 text-sm">
        {motd === null ? (
          <p className="italic">
            {g.motd || 'No message of the day.'}
            {officer && (
              <button className="ml-2 text-xs underline" onClick={() => setMotd(g.motd)}>
                edit
              </button>
            )}
          </p>
        ) : (
          <form
            className="flex gap-1"
            onSubmit={async (e) => {
              e.preventDefault();
              await client.guildMotd(motd);
              setMotd(null);
            }}
          >
            <input value={motd} onChange={(e) => setMotd(e.target.value)} onKeyDown={stop} maxLength={200} className="min-w-0 flex-1 border-2 border-ink bg-parchment px-1" autoFocus />
            <button className="px-btn small">Save</button>
          </form>
        )}
      </div>
      <div className="mb-2 flex flex-wrap items-center gap-1 text-sm">
        <span className="font-bold text-gold-dark">Treasury ◉ {g.treasury.toLocaleString()}</span>
        <input type="number" min={1} value={amount} onChange={(e) => setAmount(Math.max(1, Math.floor(Number(e.target.value) || 1)))} onKeyDown={stop} className="ml-auto w-20 border-2 border-ink bg-parchment px-1" data-testid="guild-amount" />
        <button className="px-btn small" disabled={gold < amount} onClick={() => void client.guildTreasury(amount)} data-testid="guild-deposit">
          Deposit
        </button>
        {leader && (
          <button className="px-btn ghost small" disabled={g.treasury < amount} onClick={() => void client.guildTreasury(-amount)}>
            Withdraw
          </button>
        )}
      </div>
      {officer && (
        <form
          className="mb-2 flex gap-1"
          onSubmit={async (e) => {
            e.preventDefault();
            if (invite.trim() && (await client.guildInvite(invite.trim()))) setInvite('');
          }}
        >
          <input value={invite} onChange={(e) => setInvite(e.target.value)} onKeyDown={stop} placeholder="Invite by name" className="min-w-0 flex-1 border-2 border-ink bg-parchment px-1 text-sm" data-testid="guild-invite-name" />
          <button className="px-btn small green">Invite</button>
        </form>
      )}
      <p className="mb-1 text-xs text-wood-dark/70">
        {g.members.filter((m) => m.online).length} of {g.members.length} online · guild chat: /gu message
      </p>
      <ul className="space-y-1" data-testid="guild-members">
        {g.members.map((m) => (
          <li key={m.id} className="flex items-center gap-1.5 border-2 border-ink/20 px-1.5 py-0.5 text-sm">
            <Dot on={m.online} />
            <button className="truncate font-bold hover:underline" onClick={() => void client.openProfile(m.id)}>
              {m.name}
            </button>
            <span className="text-xs text-wood-dark/70">Lv{m.level}</span>
            <span className="ml-auto text-xs">{RANK_LABEL[m.rank]}</span>
            {leader && m.id !== me && (
              <select
                className="border border-ink bg-parchment text-xs"
                value=""
                onChange={(e) => {
                  const v = e.target.value;
                  if (v === 'kick') void client.guildKick(m.id);
                  else if (v === 'leader' && !confirm(`Make ${m.name} the guild leader? You'll become an officer.`)) return;
                  else if (v) void client.guildRank(m.id, v as GuildRank);
                }}
                aria-label={`Manage ${m.name}`}
              >
                <option value="">⋯</option>
                {m.rank === 'member' && <option value="officer">Promote to officer</option>}
                {m.rank === 'officer' && <option value="member">Demote to member</option>}
                <option value="leader">Make leader</option>
                <option value="kick">Remove from guild</option>
              </select>
            )}
            {!leader && officer && m.rank === 'member' && (
              <button className="text-xs text-wood-dark/60 hover:text-[#b8402f]" onClick={() => void client.guildKick(m.id)} title="Remove from guild">
                ✕
              </button>
            )}
          </li>
        ))}
      </ul>
      <GuildLevel client={client} />
      <GuildQuests client={client} />
      <button
        className="px-btn ghost small mt-3"
        onClick={() => {
          if (confirm(g.members.length === 1 ? 'You are the last member — leaving disbands the guild. Continue?' : `Leave ${g.name}?`)) void client.guildLeave();
        }}
        data-testid="guild-leave"
      >
        Leave guild
      </button>
    </Window>
  );
}

/** Another player's profile with social actions. */
export function ProfileWindow({ client }: { client: GameClient }) {
  const p = useStore(client.ui, (s) => s.profile);
  const me = useStore(client.ui, (s) => s.self?.characterId);
  const [reporting, setReporting] = useState(false);
  const [reason, setReason] = useState('');
  useEffect(() => {
    setReporting(false);
    setReason('');
  }, [p?.id]);
  if (!p) return null;
  const close = () => client.ui.set({ profile: null });
  const self = p.id === me;
  return (
    <div className="pointer-events-auto fixed inset-0 z-40 flex items-center justify-center bg-night/40 p-2" onClick={(e) => e.target === e.currentTarget && close()}>
      <Window title={p.name} onClose={close} testId="profile-window">
        <p className="text-sm">
          Level {p.level} {CLASS_NAME[p.classId]}
          {p.guild ? ` · ${p.guild}` : ''}
        </p>
        <p className="text-xs text-wood-dark/70">
          <Dot on={p.online} /> {p.online ? `Online · ${mapName(p.mapId)}` : 'Offline'} · adventuring since {new Date(p.createdAt).toLocaleDateString()}
        </p>
        {p.equipment.length > 0 && (
          <p className="mt-2 text-xs">
            <b>Wearing:</b> {p.equipment.map((id) => getItem(id)?.name ?? id).join(', ')}
          </p>
        )}
        {!self && (
          <div className="mt-3 flex flex-wrap gap-1">
            {!p.friend && p.blocked !== 'block' && (
              <button className="px-btn small green" onClick={() => void client.friendAdd(p.id)} data-testid="profile-friend">
                Add friend
              </button>
            )}
            {p.online && (
              <>
                <button className="px-btn small" onClick={() => client.draftChat(`/w ${p.name} `)}>
                  Whisper
                </button>
                <button className="px-btn small" onClick={() => void client.partyInvite(p.id)}>
                  Invite to party
                </button>
              </>
            )}
            {client.ui.get().guild && client.ui.get().guild!.myRank !== 'member' && !p.guild && p.online && (
              <button className="px-btn small" onClick={() => void client.guildInvite(p.id)}>
                Guild invite
              </button>
            )}
          </div>
        )}
        {!self && (
          <div className="mt-2 flex flex-wrap gap-1 border-t-2 border-ink/20 pt-2">
            <button className="px-btn ghost small" onClick={() => void client.setBlock(p.id, p.blocked === 'mute' ? null : 'mute')} data-testid="profile-mute">
              {p.blocked === 'mute' ? 'Unmute' : 'Mute'}
            </button>
            <button className="px-btn ghost small" onClick={() => void client.setBlock(p.id, p.blocked === 'block' ? null : 'block')} data-testid="profile-block">
              {p.blocked === 'block' ? 'Unblock' : 'Block'}
            </button>
            <button className="px-btn ghost small" onClick={() => setReporting((v) => !v)}>
              Report
            </button>
          </div>
        )}
        {reporting && (
          <form
            className="mt-2 space-y-1"
            onSubmit={async (e) => {
              e.preventDefault();
              if (await client.report(p.id, reason)) setReporting(false);
            }}
          >
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              onKeyDown={(e) => e.stopPropagation()}
              maxLength={300}
              rows={3}
              placeholder="What happened? (Their recent messages are attached automatically.)"
              className="w-full border-2 border-ink bg-parchment px-1 text-sm"
            />
            <button className="px-btn small" disabled={reason.trim().length < 3}>
              Send report
            </button>
          </form>
        )}
      </Window>
    </div>
  );
}

/** Find a group: open posts you can join with one click, and your own post. */
function PartyFinder({ client }: { client: GameClient }) {
  const level = useStore(client.ui, (s) => s.self?.level ?? 1);
  const party = useStore(client.ui, (s) => s.party);
  const me = useStore(client.ui, (s) => s.self?.characterId);
  const [data, setData] = useState<{ listings: PartyListing[]; mine: PartyListing | null } | null>(null);
  const [activity, setActivity] = useState<string>(PARTY_ACTIVITIES[0]);
  const [note, setNote] = useState('');
  const [minLevel, setMinLevel] = useState(1);
  const load = () => client.partyListings().then(setData, () => {});
  useEffect(() => {
    void load();
    const t = setInterval(load, 8000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client]);
  const leading = !party || party.leaderId === me;
  return (
    <div data-testid="party-finder">
      {data?.mine ? (
        <div className="mb-2 border-2 border-leaf/60 bg-parchment-2/60 p-1.5 text-sm">
          <b>Your post:</b> {data.mine.activity}
          {data.mine.note ? ` — ${data.mine.note}` : ''} · {data.mine.members}/{PARTY_MAX}
          <button className="px-btn ghost small ml-2" onClick={() => void client.partyUnpost().then(load)} data-testid="party-unpost">
            Take down
          </button>
        </div>
      ) : leading ? (
        <form
          className="mb-2 flex flex-wrap items-center gap-1 text-sm"
          onSubmit={async (e) => {
            e.preventDefault();
            if (await client.partyPost(activity, note, minLevel)) void load();
          }}
        >
          <select value={activity} onChange={(e) => setActivity(e.target.value)} className="border-2 border-ink bg-parchment px-1" data-testid="party-activity">
            {PARTY_ACTIVITIES.map((a) => (
              <option key={a}>{a}</option>
            ))}
          </select>
          <input value={note} onChange={(e) => setNote(e.target.value)} onKeyDown={(e) => e.stopPropagation()} maxLength={80} placeholder="Note (e.g. need a healer)" className="min-w-0 flex-1 border-2 border-ink bg-parchment px-1" />
          <label className="text-xs">
            Lv
            <input type="number" min={1} max={100} value={minLevel} onChange={(e) => setMinLevel(Math.max(1, Math.min(100, Math.floor(Number(e.target.value) || 1))))} onKeyDown={(e) => e.stopPropagation()} className="ml-1 w-12 border-2 border-ink bg-parchment px-1" />+
          </label>
          <button className="px-btn green small" data-testid="party-post">
            Post
          </button>
        </form>
      ) : (
        <p className="mb-2 text-xs text-wood-dark/70">Only your party leader can post.</p>
      )}
      <ul className="space-y-1" data-testid="party-listings">
        {data && !data.listings.length && <li className="text-sm text-wood-dark/70">No open parties right now. Post one and others can join you.</li>}
        {data?.listings.map((l) => (
          <li key={l.leaderId} className="flex items-center gap-1.5 border-2 border-ink/20 px-1.5 py-1 text-sm">
            <span className="min-w-0 flex-1">
              <b>{l.activity}</b> · {l.leaderName} Lv{l.level} {CLASS_NAME[l.classId] ?? ''}
              <span className="block truncate text-xs text-wood-dark/70">
                {l.members}/{PARTY_MAX} · {mapName(l.mapId)}
                {l.minLevel > 1 ? ` · Lv${l.minLevel}+` : ''}
                {l.note ? ` · ${l.note}` : ''}
              </span>
            </span>
            <button className="px-btn green small" disabled={!!party || level < l.minLevel} onClick={() => void client.partyJoin(l.leaderId).then(load)} data-testid={`party-join-${l.leaderName}`}>
              Join
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** This week's shared guild goals. */
function GuildQuests({ client }: { client: GameClient }) {
  const [v, setV] = useState<GuildQuestsView | null>(null);
  useEffect(() => {
    client.guildQuests().then(setV, () => {});
  }, [client]);
  if (!v) return null;
  const days = Math.max(0, Math.ceil((v.resetsAt - Date.now()) / 86_400_000));
  return (
    <div className="mt-3" data-testid="guild-quests">
      <h3 className="font-bold">Weekly guild quests</h3>
      <p className="text-xs text-wood-dark/70">Everyone's play counts. New goals in {days} day{days === 1 ? '' : 's'}. Help out to earn a share.</p>
      <ul className="mt-1 space-y-1.5">
        {v.quests.map((q) => (
          <li key={q.id} className="border-2 border-ink/20 px-1.5 py-1 text-sm">
            <div className="flex items-center gap-2">
              <span className="flex-1 font-bold">
                {q.completed ? '✓ ' : ''}
                {q.text}
              </span>
              <span className="text-xs">
                {q.progress.toLocaleString()}/{q.goal.toLocaleString()}
              </span>
            </div>
            <div className="mt-0.5 h-2 overflow-hidden rounded bg-parchment-3">
              <div className="h-full bg-leaf" style={{ width: `${(100 * q.progress) / q.goal}%` }} />
            </div>
            <div className="mt-0.5 flex items-center gap-2 text-xs text-wood-dark/80">
              <span className="flex-1">
                You: {q.mine.toLocaleString()} · Reward ◉ {q.reward.gold.toLocaleString()} + {q.reward.xp.toLocaleString()} XP
              </span>
              {q.completed && q.mine > 0 && !q.claimed && (
                <button className="px-btn gold-btn small" onClick={async () => setV((await client.guildQuestClaim(q.id)) ?? v)} data-testid={`guild-claim-${q.id}`}>
                  Collect
                </button>
              )}
              {q.claimed && <span className="font-bold text-leaf-dark">Collected</span>}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Guild level, perks for every member, and investing treasury Gold into guild XP. */
function GuildLevel({ client }: { client: GameClient }) {
  const g = useStore(client.ui, (s) => s.guild);
  const [gold, setGold] = useState(1000);
  if (!g) return null;
  const xp = g.xp ?? 0;
  const level = guildLevel(xp);
  const cur = GUILD_LEVEL_XP[level - 1] ?? 0;
  const next = GUILD_LEVEL_XP[level];
  const perks = guildPerks(level);
  const officer = g.myRank !== 'member';
  return (
    <div className="mt-3" data-testid="guild-level">
      <h3 className="flex font-bold">
        Guild level {level}
        <span className="ml-auto text-xs font-normal">{next !== undefined ? `${(xp - cur).toLocaleString()} / ${(next - cur).toLocaleString()} XP` : 'Max level'}</span>
      </h3>
      <div className="mt-0.5 h-2 overflow-hidden rounded bg-parchment-3">
        <div className="h-full bg-[#3f7fd0]" style={{ width: `${next !== undefined ? (100 * (xp - cur)) / (next - cur) : 100}%` }} />
      </div>
      <p className="mt-0.5 text-xs text-wood-dark/80">
        Every member: +{perks.xpPct}% EXP{perks.goldPct ? `, +${perks.goldPct}% Gold` : ''} from monsters. Guild XP comes from guild quests (+{GUILD_QUEST_XP} each) and from investing the treasury.
      </p>
      {officer && next !== undefined && (
        <div className="mt-1 flex items-center gap-1 text-xs">
          Invest
          <input type="number" min={GUILD_INVEST_GOLD_PER_XP} step={GUILD_INVEST_GOLD_PER_XP} value={gold} onChange={(e) => setGold(Math.max(GUILD_INVEST_GOLD_PER_XP, Math.floor(Number(e.target.value) || 0)))} onKeyDown={(e) => e.stopPropagation()} className="w-24 border-2 border-ink bg-parchment px-1" />
          Gold from the treasury → {Math.floor(gold / GUILD_INVEST_GOLD_PER_XP).toLocaleString()} XP
          <button className="px-btn green small" disabled={g.treasury < gold} onClick={() => void client.guildInvest(gold)} data-testid="guild-invest">
            Invest
          </button>
        </div>
      )}
    </div>
  );
}
