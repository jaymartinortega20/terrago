'use client';

import { actionForKey } from './keybinds';
import { Minimap } from './ui/Minimap';
import { fxSettings, onFxSettings } from './fx/settings';
import { HudIcon } from './ui/HudIcons';
import { StablePanel } from './ui/StableUi';
import { PetPanel } from './ui/PetUi';
import { ArenaBanner, ArenaPanel } from './ui/ArenaUi';
import { GemShopPanel } from './ui/GemShop';
import { DeathScreen } from './ui/DeathScreen';
import { RiftHud, RiftPanel } from './ui/ExchangeUi';
import Phaser from 'phaser';
import { useEffect, useRef, useState } from 'react';
import { getItem } from '@terrago/game-data';
import { audio } from './audio';
import { isTyping } from './input';
import { GameClient } from './net/client';
import { renderDpr } from './hd/screen';
import { WorldScene } from './scenes/WorldScene';
import { useStore, type Panel } from './store';
import { EmoteMenu } from './ui/EmoteMenu';
import { ChatBox } from './ui/ChatBox';
import { DialogueBox } from './ui/DialogueBox';
import { Hud } from './ui/Hud';
import { ItemSlot } from './ui/ItemSlot';
import { MobileControls } from './ui/MobileControls';
import { CharacterPanel, InventoryPanel, JobPanel, MapPanel, MENU, MENU_GROUPS, markMenuSeen, menuSeen, menuUnlocked, SettingsPanel } from './ui/Panels';
import { FarmPanel, PlotMenu, RepairPanel, ShopPanel, SkillsPanel } from './ui/ServicePanels';
import { CraftPanel, FishingOverlay, LiftPanel, RecipeBook } from './ui/GatherPanels';
import { BossBar, EffectsBar, EnhancePanel, SkillBar, TargetFrame } from './ui/CombatUi';
import { EnvBadge, PhoneBossButton, TimersBadge, WeatherLayer } from './ui/Atmosphere';
import { JournalPanel, ProgressToasts } from './ui/JournalUi';
import { AnimalsPanel, BankPanel, DungeonPanel, StallBrowseWindow, StallSetupPanel, TravelPanel } from './ui/EconomyUi';
import { FriendsPanel, GuildPanel, PartyFrame, ProfileWindow } from './ui/SocialUi';
import { MarketPanel, SocialPopups, TradeWindow } from './ui/TradeUi';
import { BountyPanel, QuestOfferWindow, QuestRewardWindow, QuestTracker, QuestsPanel } from './ui/QuestUi';

declare global {
  interface Window {
    /** Read-only debug handle used by automated tests. */
    __terrago?: { client: GameClient; game?: Phaser.Game; audio?: typeof audio };
  }
}

export type ExitTarget = '/' | '/characters';

export default function GameView({
  characterId,
  onExit,
  createClient = (id) => new GameClient(id),
  badge,
}: {
  characterId: string;
  /** Leave the game: '/' logs out of the account, '/characters' returns to character select. */
  onExit: (to: ExitTarget) => void;
  createClient?: (characterId: string) => GameClient;
  /** Small label shown at the top of the screen (e.g. "Offline preview"). */
  badge?: string;
}) {
  const host = useRef<HTMLDivElement>(null);
  const [client, setClient] = useState<GameClient | null>(null);
  const [touch, setTouch] = useState(false);

  useEffect(() => {
    setTouch(window.matchMedia('(pointer: coarse)').matches);
    audio.init();
    const c = createClient(characterId);
    c.connect();
    window.__terrago = { client: c, audio };
    let game: Phaser.Game | null = null;
    let ro: ResizeObserver | null = null;
    let cancelled = false;
    const start = async () => {
      // Pixel font must be ready before Phaser rasterises any text.
      await Promise.all([document.fonts.load('600 12px "Fredoka"'), document.fonts.load('bold 12px "Fredoka"')]).catch(() => {});
      // React StrictMode mounts effects twice in dev: never start a game for a torn-down mount.
      if (cancelled || !host.current) return;
      // HD: render at the screen's real pixel density, smooth filtering.
      const dpr = renderDpr();
      const el = host.current;
      game = new Phaser.Game({
        type: Phaser.AUTO,
        parent: el,
        backgroundColor: '#12141f',
        pixelArt: false,
        antialias: true,
        roundPixels: false,
        disableContextMenu: true,
        scale: { mode: Phaser.Scale.NONE, width: Math.round(el.clientWidth * dpr), height: Math.round(el.clientHeight * dpr), zoom: 1 / dpr },
        fps: { target: 60 },
        banner: false,
        audio: { noAudio: true },
      });
      game.scene.add('world', WorldScene, true, { client: c });
      const g = game;
      ro = new ResizeObserver(() => {
        const d = renderDpr();
        g.scale.setZoom(1 / d);
        g.scale.resize(Math.round(el.clientWidth * d), Math.round(el.clientHeight * d));
      });
      ro.observe(el);
      if (window.__terrago?.client === c) window.__terrago.game = game;
    };
    void start();
    setClient(c);
    return () => {
      cancelled = true;
      ro?.disconnect();
      audio.playMusic(null);
      audio.setAmbient(null);
      game?.destroy(true);
      game = null;
      c.disconnect();
      if (window.__terrago?.client === c) delete window.__terrago;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [characterId]);

  return (
    <div className="fixed inset-0 overflow-hidden bg-night no-select">
      <div ref={host} className="absolute inset-0" data-testid="game-canvas" />
      <DepthHaze />
      {client && <WeatherLayer client={client} />}
      {client && <Overlay client={client} touch={touch} onExit={onExit} badge={badge} />}
    </div>
  );
}

function Overlay({ client, touch, onExit, badge }: { client: GameClient; touch: boolean; onExit: (to: ExitTarget) => void; badge?: string }) {
  const ui = client.ui;
  const status = useStore(ui, (s) => s.status);
  const statusMessage = useStore(ui, (s) => s.statusMessage);
  const panel = useStore(ui, (s) => s.panel);
  const mapName = useStore(ui, (s) => s.mapName);
  const tile = useStore(ui, (s) => s.tile);
  const nearby = useStore(ui, (s) => s.nearby);
  const ping = useStore(ui, (s) => s.ping);
  const notices = useStore(ui, (s) => s.notices);
  const inv = useStore(ui, (s) => s.inventory);
  const selected = useStore(ui, (s) => s.selectedSlot);
  const actionHint = useStore(ui, (s) => s.actionHint);
  const interactHint = useStore(ui, (s) => s.interactHint);

  const open = (p: Panel) => {
    audio.sfx('open');
    ui.set((s) => ({ panel: s.panel === p ? null : p }));
  };
  /** Hotbar: first press selects the slot, pressing a selected food eats it. */
  const pressSlot = (slot: number) => {
    const item = ui.get().inventory?.slots.find((s) => s.slot === slot);
    if (ui.get().selectedSlot === slot && item && (getItem(item.itemId)?.consumable || getItem(item.itemId)?.unlock)) client.useItem(slot);
    else client.selectSlot(slot);
  };
  const [menuOpen, setMenuOpen] = useState(false);
  const [group, setGroup] = useState<string | null>(null);
  const level = useStore(ui, (s) => s.self?.level ?? 1);
  const questsDone = useStore(ui, (s) => s.quests.filter((q) => q.done).length);
  const [seen, setSeen] = useState<Set<string>>(() => new Set());
  useEffect(() => setSeen(menuSeen()), []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTyping()) return;
      const k = e.key.toLowerCase();
      if (k === 'escape') {
        if (ui.get().dialogue) return;
        ui.set((s) => ({ panel: s.panel ? null : 'settings' }));
      } else if (ui.get().dialogue) return;
      else if (k === 'b' && e.shiftKey) open('arena');
      else if (k === 'g' && e.shiftKey) open('gems');
      else if (k === 'b') open('inventory');
      else if (k === 'z' && e.shiftKey) open('stable');
      else if (actionForKey(k)) {
        const act = actionForKey(k)!;
        if (act === 'attack') client.attackKey();
        else if (act === 'mount') client.toggleMount();
        else if (act === 'emotes') ui.set((s) => ({ emoteMenu: !s.emoteMenu }));
        else if (act.startsWith('skill')) client.useSkill(Number(act.slice(5)) - 1);
        else open(act as Panel);
      }
      else if (k === 'tab') {
        e.preventDefault();
        const ids = [...client.monsters.values()].sort((a, b) => Math.hypot(a.x - client.pos.x, a.y - client.pos.y) - Math.hypot(b.x - client.pos.x, b.y - client.pos.y)).map((m) => m.info.id);
        if (ids.length) client.setTarget(ids[(ids.indexOf(ui.get().targetId ?? '') + 1) % ids.length]!, false);
      }
      else if (/^[1-9]$/.test(k)) pressSlot(Number(k) - 1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client]);

  const leave = async (to: ExitTarget) => {
    await client.logout();
    onExit(to);
  };

  const bySlot = new Map((inv?.slots ?? []).map((s) => [s.slot, s]));

  return (
    <div className="pointer-events-none absolute inset-0 text-parchment">
      {/* A soft vignette frames the scene (decoration only). */}
      <div className="absolute inset-0" style={{ background: 'radial-gradient(ellipse at 50% 50%, transparent 55%, rgba(2,8,16,0.35) 85%, rgba(2,6,12,0.6) 100%)' }} aria-hidden />
      {/* Top-left: status */}
      <div className="absolute top-2 left-2 flex flex-col items-start gap-1">
        <Hud client={client} compact={touch} />
        <EffectsBar client={client} />
        <PartyFrame client={client} />
        {!touch && <Minimap client={client} onOpen={() => open('map')} />}
      </div>
      <div className="absolute top-2 left-1/2 flex -translate-x-1/2 flex-col items-center gap-1">
        <BossBar client={client} />
        <TargetFrame client={client} />
      </div>

      {/* Top-right: location + menu */}
      <div className="absolute top-2 right-2 z-30 flex flex-col items-end gap-2">
        <div className={`hud-pill pointer-events-auto px-3 py-1 text-right text-xs ${touch ? "max-w-[44vw] truncate px-2" : ""}`} data-testid="location">
          <span className="font-bold text-gold">{mapName}</span>
          {!touch && (
            <span className="ml-2 text-parchment/70">
              ({tile.x}, {tile.y})
            </span>
          )}
          <EnvBadge client={client} compact={touch} />
          <span className="ml-2 text-parchment/70">👥 {nearby}</span>
          <span className="ml-2 text-parchment/70">{ping === null ? '' : `${ping}ms`}</span>
        </div>
        {!touch && <TimersBadge client={client} />}
        {touch && <PhoneBossButton client={client} />}
        {touch && (
          <button className="orb studs pointer-events-auto h-11 w-11" onClick={() => setMenuOpen((v) => !v)} aria-expanded={menuOpen} aria-label="Menu" data-testid="menu-toggle">
            <HudIcon name="menu" size={22} />
          </button>
        )}
        <nav
          className={`pointer-events-auto flex justify-end gap-x-3.5 gap-y-4 pt-1.5 pr-1.5 ${touch ? (menuOpen ? 'max-w-[56vw] flex-wrap' : 'hidden') : 'max-w-[64vw] flex-wrap'}`}
          aria-label="Game menu"
        >
          {(() => {
            const unlocked = MENU.filter((m) => (!touch || !m.version) && menuUnlocked(m, level, questsDone));
            const button = (m: (typeof MENU)[number]) => (
              <button
                key={m.id}
                disabled={!!m.version}
                title={m.version ? `${m.label} — arrives in ${m.version}` : `${m.label} (${m.key})`}
                aria-label={m.label}
                onClick={() => {
                  open(m.id as Panel);
                  setMenuOpen(false);
                  setGroup(null);
                  if (!seen.has(m.id)) {
                    markMenuSeen(m.id);
                    setSeen(menuSeen());
                  }
                }}
                className={`orb pointer-events-auto relative ${touch ? 'h-10 w-10' : 'h-11 w-11'} ${m.version ? 'orb-disabled' : panel === m.id ? 'orb-on' : ''}`}
                data-testid={`menu-${m.id}`}
              >
                <HudIcon name={m.id} size={touch ? 20 : 22} />
                {(m.minLevel || m.afterFirstQuest) && !seen.has(m.id) && (
                  <span className="absolute -top-1 -right-1 rounded-full bg-[#ff5a4a] px-1 text-[8px] leading-tight font-bold text-white shadow" data-testid={`new-${m.id}`}>
                    NEW
                  </span>
                )}
              </button>
            );
            // Phones: everything in one sheet behind the menu button.
            if (touch) return unlocked.map(button);
            // Desktop: four groups; a group with one button is the button itself.
            return MENU_GROUPS.map((gr) => {
              const items = unlocked.filter((m) => gr.ids.includes(m.id));
              if (!items.length) return null;
              if (items.length === 1) return button(items[0]!);
              const fresh = items.some((m) => (m.minLevel || m.afterFirstQuest) && !seen.has(m.id));
              const on = items.some((m) => m.id === panel);
              return (
                <div key={gr.id} className="relative" onMouseLeave={() => setGroup((g) => (g === gr.id ? null : g))}>
                  <button
                    className={`orb pointer-events-auto relative h-11 w-11 ${on || group === gr.id ? 'orb-on' : ''}`}
                    title={`${gr.label}: ${items.map((m) => m.label).join(', ')}`}
                    aria-label={gr.label}
                    aria-expanded={group === gr.id}
                    onClick={() => setGroup(gr.id)}
                    onMouseEnter={() => setGroup(gr.id)}
                    data-testid={`menu-group-${gr.id}`}
                  >
                    <HudIcon name={gr.icon} size={22} />
                    {fresh && <span className="absolute -top-1 -right-1 h-3 w-3 rounded-full bg-[#ff5a4a] shadow" />}
                  </button>
                  {group === gr.id && (
                    <div className="absolute top-12 right-0 z-30 flex gap-2 rounded-2xl bg-[#141a2c]/90 p-2 shadow-xl" data-testid={`menu-pop-${gr.id}`}>
                      {items.map((m) => (
                        <div key={m.id} className="flex flex-col items-center gap-0.5">
                          {button(m)}
                          <span className="text-[10px] whitespace-nowrap text-parchment/80">{m.label}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            });
          })()}
        </nav>
        {!panel && <QuestTracker client={client} compact={touch} />}
        <div
          className={touch && panel ? 'pointer-events-auto fixed inset-0 z-50 flex items-center justify-center bg-night/50 p-2' : 'mt-1'}
          onClick={(e) => touch && e.target === e.currentTarget && open(null)}
        >
          {panel === 'inventory' && <InventoryPanel client={client} onClose={() => open(null)} />}
          {panel === 'character' && <CharacterPanel client={client} onClose={() => open(null)} />}
          {panel === 'map' && <MapPanel client={client} onClose={() => open(null)} />}
          {panel === 'skills' && <SkillsPanel client={client} onClose={() => open(null)} />}
          {panel === 'quests' && <QuestsPanel client={client} onClose={() => open(null)} />}
          {panel === 'shop' && <ShopPanel client={client} onClose={() => open(null)} />}
          {panel === 'farm' && <FarmPanel client={client} onClose={() => open(null)} />}
          {panel === 'repair' && <RepairPanel client={client} onClose={() => open(null)} />}
          {panel === 'craft' && <CraftPanel client={client} onClose={() => open(null)} />}
          {panel === 'lift' && <LiftPanel client={client} onClose={() => open(null)} />}
          {panel === 'dungeon' && <DungeonPanel client={client} onClose={() => open(null)} />}
          {panel === 'animals' && <AnimalsPanel client={client} onClose={() => open(null)} />}
          {panel === 'bank' && <BankPanel client={client} onClose={() => open(null)} />}
          {panel === 'job' && <JobPanel client={client} onClose={() => open(null)} />}
          {panel === 'bounty' && <BountyPanel client={client} onClose={() => open(null)} />}
          {panel === 'travel' && <TravelPanel client={client} onClose={() => open(null)} />}
          {panel === 'stall' && <StallSetupPanel client={client} onClose={() => open(null)} />}
          {panel === 'crafting' && <RecipeBook client={client} onClose={() => open(null)} />}
          {panel === 'journal' && <JournalPanel client={client} onClose={() => open(null)} />}
          {panel === 'friends' && <FriendsPanel client={client} onClose={() => open(null)} />}
          {panel === 'guild' && <GuildPanel client={client} onClose={() => open(null)} />}
          {panel === 'market' && <MarketPanel client={client} onClose={() => open(null)} />}
          {panel === 'enhance' && <EnhancePanel client={client} onClose={() => open(null)} />}
          {panel === 'stable' && <StablePanel client={client} onClose={() => open(null)} />}
          {panel === 'pets' && <PetPanel client={client} onClose={() => open(null)} />}
          {panel === 'arena' && <ArenaPanel client={client} onClose={() => open(null)} />}
          {panel === 'gems' && <GemShopPanel client={client} onClose={() => open(null)} />}
          {panel === 'rift' && <RiftPanel client={client} onClose={() => open(null)} />}
          {panel === 'settings' && (
            <SettingsPanel client={client} onClose={() => open(null)} onLogout={() => void leave('/')} onSwitch={() => void leave('/characters')} />
          )}
        </div>
      </div>

      {badge && (
        <div className="absolute top-2 left-1/2 -translate-x-1/2 border-2 border-ink bg-gold px-2 py-0.5 text-[11px] font-bold text-ink" data-testid="badge">
          {badge}
        </div>
      )}

      {/* Notices: important ones centre-top, small; routine rewards in a side feed. */}
      <div className="absolute top-28 left-1/2 z-20 flex -translate-x-1/2 flex-col items-center gap-1">
        {notices.map((n) => (
          <div
            key={n.id}
            className={`hud-pill max-w-[80vw] px-3 py-1 text-xs font-bold ${n.kind === 'error' ? 'text-[#ff8a7a]' : n.kind === 'success' ? 'text-leaf' : 'text-gold'}`}
            role="status"
          >
            {n.text}
          </div>
        ))}
      </div>
      <LootFeed client={client} touch={touch} />

      {/* Bottom: dialogue, hotbar, chat */}
      <div className="absolute bottom-24 left-1/2 flex -translate-x-1/2 flex-col items-center gap-2 sm:bottom-20">
        <PlotMenu client={client} />
        <FishingOverlay client={client} />
        <DialogueBox client={client} />
        {!touch && (actionHint || interactHint) && (
          <div className="px-panel-dark px-2 py-0.5 text-xs font-bold text-gold" data-testid="action-hint">
            [E] {interactHint ? `Talk to ${interactHint}` : actionHint}
          </div>
        )}
      </div>
      <div
        className={`hud-pill pointer-events-auto absolute left-1/2 flex -translate-x-1/2 gap-1 p-1 ${touch ? 'bottom-2 max-[560px]:hidden' : 'bottom-2'}`}
        data-testid="hotbar"
      >
        {Array.from({ length: touch ? 5 : 9 }, (_, i) => (
          <ItemSlot key={i} slot={i} item={bySlot.get(i)} hotkey={touch ? undefined : String(i + 1)} size={touch ? 34 : 40} selected={selected === i} onClick={() => pressSlot(i)} />
        ))}
      </div>
      {!touch && (
        <div className="absolute right-3 bottom-2 flex items-end gap-2.5">
          <SkillBar client={client} />
          <DesktopCombatOrbs client={client} />
        </div>
      )}
      <div className={`absolute left-2 ${touch ? 'top-[112px]' : 'bottom-2'}`}>
        <ChatBox client={client} compact={touch} />
        <EmoteMenu client={client} />
      </div>

      {touch && <MobileControls client={client} openPanel={open} />}
      <QuestOfferWindow client={client} />
      <QuestRewardWindow client={client} />
      <SocialPopups client={client} />
      <ProgressToasts client={client} openJournal={() => open('journal')} touch={touch} />
      <ArenaBanner client={client} />
      <DeathScreen client={client} />
      <RiftHud client={client} />
      <TradeWindow client={client} />
      <ProfileWindow client={client} />
      <StallBrowseWindow client={client} />

      {/* Connection state */}
      {status !== 'online' && (
        <div className="pointer-events-auto absolute inset-0 flex items-center justify-center bg-night/70" data-testid="status-overlay">
          <div className="px-panel max-w-sm p-5 text-center">
            <p className="text-lg font-bold text-wood-dark">
              {status === 'connecting' && 'Entering TerraGo…'}
              {status === 'reconnecting' && 'Reconnecting…'}
              {status === 'ended' && 'Disconnected'}
              {status === 'error' && 'Could not connect'}
            </p>
            {statusMessage && <p className="mt-2 text-sm">{statusMessage}</p>}
            {(status === 'ended' || status === 'error') && (
              <div className="mt-4 flex justify-center gap-2">
                <button className="px-btn green small" onClick={() => location.reload()}>
                  Reconnect
                </button>
                <button className="px-btn ghost small" onClick={() => onExit('/characters')}>
                  Characters
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/** Desktop: AUTO toggle and the attack button next to the skill bar. */
function DesktopCombatOrbs({ client }: { client: GameClient }) {
  const auto = useStore(client.ui, (s) => s.autoHunt);
  return (
    <div className="pointer-events-auto flex items-end gap-3 pb-1">
      <button className={`orb studs h-11 w-11 ${auto ? 'orb-on' : 'orb-dark'}`} onClick={() => client.setAutoHunt(!auto)} title="AUTO: keep fighting monsters in reach" aria-label="Auto attack" aria-pressed={auto} data-testid="auto-button">
        <HudIcon name="auto" size={22} />
        <span className="orb-label -bottom-[16px] text-[9px]" style={{ color: auto ? '#8ff6ff' : '#fff' }}>
          AUTO
        </span>
      </button>
      <button className="orb orb-red studs h-14 w-14" onClick={() => client.attackKey()} title="Attack (F)" aria-label="Attack" data-testid="attack-button">
        <HudIcon name="attack" size={30} />
        <span className="orb-key">F</span>
      </button>
    </div>
  );
}

/** Kill rewards and loot scroll by quietly at the side, then fade. */
function LootFeed({ client, touch }: { client: GameClient; touch: boolean }) {
  const feed = useStore(client.ui, (s) => s.feed);
  if (!feed.length) return null;
  return (
    <div className={`absolute flex flex-col gap-0.5 ${touch ? 'bottom-[54px] left-1/2 max-w-[46vw] -translate-x-1/2 items-center' : 'right-3 bottom-[76px] max-w-[340px] items-end'}`} data-testid="loot-feed" role="log" aria-live="polite">
      {feed.map((n, i) => (
        <div
          key={n.id}
          className="rounded-md bg-night/60 px-2 py-0.5 text-right text-[11px] leading-tight text-parchment/90"
          style={{ opacity: 0.55 + (0.45 * (i + 1)) / feed.length, animation: 'feed-in 0.2s ease-out' }}
        >
          {n.text.replace(/ defeated:/, ':')}
        </div>
      ))}
    </div>
  );
}

/**
 * HD-2D depth haze: a pale sky haze along the top of the screen and a darker
 * band along the bottom, like the soft focus of a diorama. Plain CSS gradients:
 * free on any graphics chip.
 */
function DepthHaze() {
  const [mode, setMode] = useState(() => fxSettings().graphics);
  useEffect(() => onFxSettings((st) => setMode(st.graphics)), []);
  if (mode !== 'hd' && mode !== 'ultra') return null;
  return (
    <div
      className="pointer-events-none absolute inset-0"
      style={{
        background:
          'radial-gradient(ellipse 75% 70% at 50% 52%, rgba(0,0,0,0) 60%, rgba(6,8,24,0.42) 100%), linear-gradient(180deg, rgba(196,222,255,0.14) 0%, rgba(196,222,255,0) 18%, rgba(0,0,0,0) 82%, rgba(8,10,28,0.18) 100%)',
      }}
      aria-hidden
    />
  );
}
