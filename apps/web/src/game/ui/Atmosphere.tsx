'use client';

import { useEffect, useState } from 'react';
import { getMap } from '@terrago/game-data';
import { currentEvent, currentWorldBoss, formatDuration, nextEvent, nextWorldBoss, WEATHER_ICON, WEATHER_LABEL, clockText, seasonAt, seasonEndsAt, weatherAt, weatherRegion, type Weather } from '@terrago/shared';
import type { GameClient } from '../net/client';
import { useStore } from '../store';

function useNow(client: GameClient, ms: number): number {
  const [now, setNow] = useState(() => client.serverNow());
  useEffect(() => {
    const t = setInterval(() => setNow(client.serverNow()), ms);
    return () => clearInterval(t);
  }, [client, ms]);
  return now;
}

const SEASON_ICON = { spring: '🌸', summer: '🌻', autumn: '🍂', winter: '⛄' } as const;

/** Rain, snow, fog and lightning over the game view (outdoor maps only). */
export function WeatherLayer({ client }: { client: GameClient }) {
  useStore(client.ui, (s) => s.mapId);
  const now = useNow(client, 5000);
  const theme = client.map?.theme;
  if (!weatherRegion(theme)) return null;
  const w: Weather = weatherAt(theme, now);
  if (w === 'clear' || w === 'cloudy') return w === 'cloudy' ? <div className="tg-weather tg-cloudy" /> : null;
  return (
    <div className={`tg-weather tg-${w}`} data-testid={`weather-${w}`}>
      <style>{CSS}</style>
      {(w === 'rain' || w === 'storm') && <div className="tg-rain" />}
      {w === 'storm' && <div className="tg-flash" />}
      {w === 'snow' && <div className="tg-snow" />}
      {w === 'fog' && <div className="tg-fog" />}
    </div>
  );
}

/** "🌙 21:40 · 🌧 Rain · 🍂 Autumn" for the location box. */
export function EnvBadge({ client, compact }: { client: GameClient; compact?: boolean }) {
  useStore(client.ui, (s) => s.mapId);
  const now = useNow(client, 2000);
  const theme = client.map?.theme;
  const season = seasonAt(now);
  const days = Math.max(1, Math.ceil((seasonEndsAt(now) - now) / 86_400_000));
  const clock = clockText(now);
  const hour = Number(clock.slice(0, 2));
  const outdoor = !!weatherRegion(theme);
  const w = weatherAt(theme, now);
  return (
    <span className="ml-2 text-parchment/80" data-testid="env" title={`${season[0]!.toUpperCase() + season.slice(1)} — ${days} day${days === 1 ? '' : 's'} left. In-season crops grow 25% faster. Rain waters your farm and makes fish bite sooner.`}>
      {hour >= 20 || hour < 6 ? '🌙' : '☀'} {clock}
      {outdoor && ` · ${WEATHER_ICON[w]}${compact ? '' : ` ${WEATHER_LABEL[w]}`}`} · {SEASON_ICON[season]}
    </span>
  );
}

const CSS = `
.tg-weather{position:absolute;inset:0;pointer-events:none;overflow:hidden}
.tg-cloudy{background:rgba(40,50,70,.12)}
.tg-storm{background:rgba(10,15,35,.28)}
.tg-rain{position:absolute;inset:-50% -10%;background-image:repeating-linear-gradient(105deg,rgba(170,200,255,.0) 0 14px,rgba(170,200,255,.35) 14px 15px,rgba(170,200,255,0) 15px 38px);background-size:120px 120px;animation:tg-rain .35s linear infinite;opacity:.8}
@keyframes tg-rain{to{transform:translate(-30px,120px)}}
.tg-snow{position:absolute;inset:-20% 0;background-image:radial-gradient(2px 2px at 20px 30px,#fff,transparent),radial-gradient(2px 2px at 80px 120px,#fff,transparent),radial-gradient(3px 3px at 150px 60px,#fff,transparent),radial-gradient(2px 2px at 200px 170px,#fff,transparent),radial-gradient(2px 2px at 120px 200px,#fff,transparent);background-size:240px 240px;animation:tg-snow 6s linear infinite;opacity:.85}
@keyframes tg-snow{to{transform:translate(40px,240px)}}
.tg-fog{position:absolute;inset:0;background:radial-gradient(ellipse at 30% 40%,rgba(220,225,235,.35),transparent 60%),radial-gradient(ellipse at 70% 70%,rgba(220,225,235,.3),transparent 60%),rgba(200,205,215,.18);animation:tg-fog 14s ease-in-out infinite alternate}
@keyframes tg-fog{to{transform:translateX(-6%)}}
.tg-flash{position:absolute;inset:0;background:#fff;opacity:0;animation:tg-flash 9s infinite}
@keyframes tg-flash{0%,91%,95%,100%{opacity:0}92%{opacity:.55}93%{opacity:.1}94%{opacity:.4}}
`;

/** The world event running now (or the next one), under the location box. */
export function EventBadge({ client }: { client: GameClient }) {
  const now = useNow(client, 5000);
  const ev = currentEvent(now);
  if (!ev) {
    const n = nextEvent(now);
    return (
      <div className="px-panel-dark pointer-events-auto px-2 py-0.5 text-[11px] text-parchment/70" title={n.def.description} data-testid="event-next">
        Next event: {n.def.name} in {formatDuration(n.start - now)}
      </div>
    );
  }
  return (
    <div className="px-panel-dark pointer-events-auto px-2 py-0.5 text-xs font-bold text-gold" title={ev.def.description} data-testid="event-now">
      🎉 {ev.def.name} · {formatDuration(ev.end - now)} left
    </div>
  );
}

/** The world boss that's up now (with a Go button), or when the next one comes. */
export function WorldBossBadge({ client }: { client: GameClient }) {
  const now = useNow(client, 5000);
  const wb = currentWorldBoss(now);
  if (!wb) {
    const n = nextWorldBoss(now);
    return (
      <div className="px-panel-dark pointer-events-auto px-2 py-0.5 text-[11px] text-parchment/70" title={`Appears in ${getMap(n.def.map)?.name}`} data-testid="worldboss-next">
        👑 {n.def.name} in {formatDuration(n.start - now)}
      </div>
    );
  }
  const where = { map: wb.def.map, x: wb.def.area.x + Math.floor(wb.def.area.w / 2), y: wb.def.area.y + Math.floor(wb.def.area.h / 2), label: wb.def.name };
  return (
    <button
      className="px-panel-dark pointer-events-auto px-2 py-0.5 text-left text-xs font-bold text-[#ff9a6a]"
      onClick={() => client.autoWalkTo(where)}
      title="Walk there"
      data-testid="worldboss-now"
    >
      👑 {wb.def.name} · {getMap(wb.def.map)?.name} · {formatDuration(wb.end - now)} left <span className="text-gold">Go ▶</span>
    </button>
  );
}

/** One badge for timed things: a live world boss wins; otherwise event and boss timers take turns. */
export function TimersBadge({ client }: { client: GameClient }) {
  const now = useNow(client, 2000);
  const live = !!currentWorldBoss(now);
  const turn = Math.floor(now / 6000) % 2;
  if (live) return <WorldBossBadge client={client} />;
  return turn ? <WorldBossBadge client={client} /> : <EventBadge client={client} />;
}

/** Phones: a small crown button while a world boss is up (tap to walk there). */
export function PhoneBossButton({ client }: { client: GameClient }) {
  const now = useNow(client, 5000);
  const wb = currentWorldBoss(now);
  if (!wb) return null;
  const where = { map: wb.def.map, x: wb.def.area.x + Math.floor(wb.def.area.w / 2), y: wb.def.area.y + Math.floor(wb.def.area.h / 2), label: wb.def.name };
  return (
    <button
      className="orb pointer-events-auto h-11 w-11 text-lg"
      onClick={() => client.autoWalkTo(where)}
      title={`${wb.def.name} is up in ${getMap(wb.def.map)?.name} — tap to go`}
      aria-label={`World boss ${wb.def.name}: walk there`}
      data-testid="phone-boss"
    >
      👑
    </button>
  );
}
