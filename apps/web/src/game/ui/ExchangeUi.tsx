'use client';

import { useEffect, useState } from 'react';
import { getItem, getMap } from '@terrago/game-data';
import type { ExchangeId, ExchangeView } from '@terrago/shared';
import { PixelIcon } from '@/components/PixelIcon';
import type { GameClient } from '../net/client';
import { useStore } from '../store';
import { Window } from './Window';

/** An activity's exchange: spend Arena Tokens / Bounty Seals / Rift Shards. */
export function ExchangeShop({ client, which, npcId }: { client: GameClient; which: ExchangeId; npcId?: string | null }) {
  const [v, setV] = useState<ExchangeView | null>(null);
  const [busy, setBusy] = useState(false);
  const inv = useStore(client.ui, (s) => s.inventory);
  useEffect(() => {
    client.exchangeGet(which, npcId ?? undefined).then(setV, () => {});
  }, [client, which, npcId, inv]);
  if (!v) return null;
  const icon = getItem(v.def.currency)?.icon;
  return (
    <div className="mt-3" data-testid={`exchange-${which}`}>
      <h3 className="flex items-center gap-1 font-bold">
        {v.def.name}
        <span className="ml-auto flex items-center gap-1 text-sm">
          {icon && <PixelIcon icon={icon} size={18} />} {v.balance} {v.def.currencyName}
        </span>
      </h3>
      <ul className="mt-1 grid gap-1 sm:grid-cols-2">
        {v.def.offers.map((o) => {
          const owned = v.owned.includes(o.id);
          const giveIcon = o.give.kind === 'item' ? getItem(o.give.itemId)?.icon : null;
          return (
            <li key={o.id} className="flex items-center gap-2 border-2 border-parchment-3 bg-parchment-2 p-1.5 text-xs">
              {giveIcon ? <PixelIcon icon={giveIcon} size={24} /> : <span className="text-lg">{o.give.kind === 'outfit' ? '👘' : '🐎'}</span>}
              <span className="min-w-0 flex-1">
                <b className="block">{o.label}</b>
                <span className="text-wood-dark/80">{o.text}</span>
              </span>
              <button
                className="px-btn green small"
                disabled={busy || owned || v.balance < o.cost}
                onClick={async () => {
                  setBusy(true);
                  const r = await client.exchangeBuy(which, o.id, npcId ?? undefined);
                  if (r) setV(r);
                  setBusy(false);
                }}
                data-testid={`exchange-buy-${o.id}`}
              >
                {owned ? 'Owned' : o.cost}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** Rift Keeper: start a run at floor 1 or a checkpoint, and the shard exchange. */
export function RiftPanel({ client, onClose }: { client: GameClient; onClose: () => void }) {
  const npcId = useStore(client.ui, (s) => s.serviceNpc);
  const gold = useStore(client.ui, (s) => s.inventory?.gold ?? 0);
  const [v, setV] = useState<{ best: number; checkpoints: { floor: number; fee: number }[]; level: number } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    if (npcId) client.riftGet(npcId).then(setV, (e: Error) => setErr(e.message));
  }, [client, npcId]);
  return (
    <Window title="The Endless Rift" onClose={onClose} testId="rift-panel" wide>
      <p className="text-xs">
        Floor after floor of monsters, each a little stronger than the last. Every 5th floor has a boss and becomes a checkpoint you can start from. Floors pay EXP, Gold and
        Rift Shards; bring your party (they come along if they stand with you). Dying or leaving ends the run.
      </p>
      {err && <p className="mt-1 text-sm text-berry">{err}</p>}
      {v && (
        <>
          <p className="mt-2 text-sm">
            Your deepest floor: <b data-testid="rift-best">{v.best || '—'}</b>
          </p>
          <div className="mt-1 flex flex-wrap gap-1">
            {v.checkpoints.map((c) => (
              <button
                key={c.floor}
                className="px-btn green small"
                disabled={gold < c.fee || v.level < 10}
                onClick={async () => {
                  if (npcId && (await client.riftEnter(npcId, c.floor))) onClose();
                }}
                data-testid={`rift-start-${c.floor}`}
              >
                Floor {c.floor} · ◉ {c.fee.toLocaleString()}
              </button>
            ))}
          </div>
          {v.level < 10 && <p className="mt-1 text-xs">The Rift opens at level 10.</p>}
        </>
      )}
      <ExchangeShop client={client} which="rift" />
    </Window>
  );
}

/** While inside the Rift: which floor, and a way out. */
export function RiftHud({ client }: { client: GameClient }) {
  const mapId = useStore(client.ui, (s) => s.mapId);
  const next = useStore(client.ui, (s) => s.riftNext);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (mapId !== 'rift') return;
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, [mapId]);
  if (mapId !== 'rift') return null;
  const wait = next ? Math.ceil((next.startsAt - now) / 1000) : 0;
  return (
    <div className="pointer-events-auto fixed top-[252px] left-2 z-30 flex items-center gap-2 rounded-full bg-[#1a1030]/85 px-3 py-1 text-sm text-[#bff4ff] shadow" data-testid="rift-hud">
      🌀 {getMap('rift')?.name}
      {next && wait > 0 && <b>· Floor {next.floor} in {wait}…</b>}
      <button className="rounded-full bg-white/15 px-2 text-xs" onClick={() => void client.riftLeave()} data-testid="rift-leave">
        Leave
      </button>
    </div>
  );
}
