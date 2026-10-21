'use client';

import Phaser from 'phaser';
import { useEffect, useRef, useState } from 'react';
import { getItem } from '@terrago/game-data';
import { audio } from './audio';
import { isTyping } from './input';
import { GameClient } from './net/client';
import { WorldScene } from './scenes/WorldScene';
import { useStore, type Panel } from './store';
import { ChatBox } from './ui/ChatBox';
import { DialogueBox } from './ui/DialogueBox';
import { Hud } from './ui/Hud';
import { ItemSlot } from './ui/ItemSlot';
import { MobileControls } from './ui/MobileControls';
import { CharacterPanel, InventoryPanel, MapPanel, MENU, SettingsPanel } from './ui/Panels';
import { FarmPanel, PlotMenu, RepairPanel, ShopPanel, SkillsPanel } from './ui/ServicePanels';
import { CraftPanel, FishingOverlay, LiftPanel } from './ui/GatherPanels';
import { BossBar, EffectsBar, EnhancePanel, SkillBar, TargetFrame } from './ui/CombatUi';
import { EnvBadge, WeatherLayer } from './ui/Atmosphere';
import { JournalPanel, ProgressToasts } from './ui/JournalUi';
import { FriendsPanel, GuildPanel, PartyFrame, ProfileWindow } from './ui/SocialUi';
import { MarketPanel, SocialPopups, TradeWindow } from './ui/TradeUi';
import { QuestOfferWindow, QuestRewardWindow, QuestTracker, QuestsPanel } from './ui/QuestUi';

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
    let cancelled = false;
    const start = async () => {
      // Pixel font must be ready before Phaser rasterises any text.
      await document.fonts.load('12px "Pixelify Sans"').catch(() => {});
      // React StrictMode mounts effects twice in dev: never start a game for a torn-down mount.
      if (cancelled || !host.current) return;
      game = new Phaser.Game({
        type: Phaser.AUTO,
        parent: host.current,
        backgroundColor: '#12141f',
        pixelArt: true,
        roundPixels: true,
        disableContextMenu: true,
        scale: { mode: Phaser.Scale.RESIZE, width: '100%', height: '100%' },
        fps: { target: 60 },
        banner: false,
        audio: { noAudio: true },
      });
      game.scene.add('world', WorldScene, true, { client: c });
      if (window.__terrago?.client === c) window.__terrago.game = game;
    };
    void start();
    setClient(c);
    return () => {
      cancelled = true;
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
    if (ui.get().selectedSlot === slot && item && getItem(item.itemId)?.consumable) client.useItem(slot);
    else client.selectSlot(slot);
  };
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTyping()) return;
      const k = e.key.toLowerCase();
      if (k === 'escape') {
        if (ui.get().dialogue) return;
        ui.set((s) => ({ panel: s.panel ? null : 'settings' }));
      } else if (ui.get().dialogue) return;
      else if (k === 'i' || k === 'b') open('inventory');
      else if (k === 'c') open('character');
      else if (k === 'm') open('map');
      else if (k === 'k') open('skills');
      else if (k === 'f') client.attackKey();
      else if (k === 'z') client.toggleMount();
      else if (k === 'j') open('quests');
      else if (k === 'p') open('market');
      else if (k === 'o') open('friends');
      else if (k === 'l') open('journal');
      else if (k === 'g') open('guild');
      else if (k === 'q') client.useSkill(0);
      else if (k === 'r') client.useSkill(1);
      else if (k === 't') client.useSkill(2);
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
      {/* Top-left: status */}
      <div className="absolute top-2 left-2 flex flex-col items-start gap-1">
        <Hud client={client} compact={touch} />
        <EffectsBar client={client} />
        <PartyFrame client={client} />
      </div>
      <div className="absolute top-2 left-1/2 flex -translate-x-1/2 flex-col items-center gap-1">
        <BossBar client={client} />
        <TargetFrame client={client} />
      </div>

      {/* Top-right: location + menu */}
      <div className="absolute top-2 right-2 flex flex-col items-end gap-2">
        <div className="px-panel-dark pointer-events-auto px-3 py-1 text-right text-xs" data-testid="location">
          <span className="font-bold text-gold">{mapName}</span>
          <span className="ml-2 text-parchment/70">
            ({tile.x}, {tile.y})
          </span>
          <EnvBadge client={client} />
          <span className="ml-2 text-parchment/70">👥 {nearby}</span>
          <span className="ml-2 text-parchment/70">{ping === null ? '' : `${ping}ms`}</span>
        </div>
        {touch && (
          <button className="px-btn ghost small pointer-events-auto" onClick={() => setMenuOpen((v) => !v)} aria-expanded={menuOpen} data-testid="menu-toggle">
            ☰ Menu
          </button>
        )}
        <nav
          className={`pointer-events-auto flex justify-end gap-1 ${touch ? (menuOpen ? 'max-w-[45vw] flex-wrap' : 'hidden') : 'max-w-[60vw] flex-wrap'}`}
          aria-label="Game menu"
        >
          {MENU.filter((m) => !touch || !m.version).map((m) => (
            <button
              key={m.id}
              disabled={!!m.version}
              title={m.version ? `${m.label} — arrives in ${m.version}` : `${m.label} (${m.key})`}
              onClick={() => {
                open(m.id as Panel);
                setMenuOpen(false);
              }}
              className={`border-2 border-ink px-1.5 py-0.5 text-[11px] font-bold ${
                m.version ? 'cursor-not-allowed bg-night-2/80 text-parchment/35' : panel === m.id ? 'bg-gold text-ink' : 'bg-night-3/90 text-parchment hover:bg-wood'
              }`}
              data-testid={`menu-${m.id}`}
            >
              {m.label}
            </button>
          ))}
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
          {panel === 'journal' && <JournalPanel client={client} onClose={() => open(null)} />}
          {panel === 'friends' && <FriendsPanel client={client} onClose={() => open(null)} />}
          {panel === 'guild' && <GuildPanel client={client} onClose={() => open(null)} />}
          {panel === 'market' && <MarketPanel client={client} onClose={() => open(null)} />}
          {panel === 'enhance' && <EnhancePanel client={client} onClose={() => open(null)} />}
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

      {/* Notices */}
      <div className="absolute top-20 left-1/2 flex -translate-x-1/2 flex-col items-center gap-1">
        {notices.map((n) => (
          <div
            key={n.id}
            className={`px-panel-dark px-3 py-1 text-sm font-bold ${n.kind === 'error' ? 'text-[#ff8a7a]' : n.kind === 'success' ? 'text-leaf' : 'text-gold'}`}
            role="status"
          >
            {n.text}
          </div>
        ))}
      </div>

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
        className={`px-panel-dark pointer-events-auto absolute left-1/2 flex -translate-x-1/2 gap-1 p-1 ${touch ? 'bottom-2 max-[560px]:hidden' : 'bottom-2'}`}
        data-testid="hotbar"
      >
        {Array.from({ length: touch ? 5 : 9 }, (_, i) => (
          <ItemSlot key={i} slot={i} item={bySlot.get(i)} hotkey={touch ? undefined : String(i + 1)} size={touch ? 34 : 40} selected={selected === i} onClick={() => pressSlot(i)} />
        ))}
      </div>
      {!touch && (
        <div className="absolute bottom-2 left-1/2 ml-[214px]">
          <SkillBar client={client} />
        </div>
      )}
      <div className={`absolute left-2 ${touch ? 'top-[82px]' : 'bottom-2'}`}>
        <ChatBox client={client} compact={touch} />
      </div>

      {touch && <MobileControls client={client} openPanel={open} />}
      <QuestOfferWindow client={client} />
      <QuestRewardWindow client={client} />
      <SocialPopups client={client} />
      <ProgressToasts client={client} openJournal={() => open('journal')} />
      <TradeWindow client={client} />
      <ProfileWindow client={client} />

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
