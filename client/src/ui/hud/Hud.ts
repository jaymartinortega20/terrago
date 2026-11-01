/**
 * Orchestrates every DOM HUD panel (task #81, SPEC.md section 7): a
 * singleton main.ts creates once (alongside NetClient/GameState) and
 * registers on the Phaser registry - WorldScene just show()s it, so a
 * portal crossing's `scene.restart()` doesn't tear the whole HUD down and
 * rebuild it. Subscribes directly to GameState's signals rather than
 * being driven by WorldScene's per-frame update loop, matching this
 * client's "neither side owns the data, both just subscribe" state
 * architecture (GameState.ts).
 */
import type { NetClient } from '../../net/NetClient.js';
import { GameState } from '../../state/GameState.js';
import { isTextInputFocused } from '../../util/domFocus.js';
import { MAPS } from '@terago/shared';
import { StatusBlock } from './statusBlock.js';
import { Hotbar } from './hotbar.js';
import { QuestTracker } from './questTracker.js';
import { ChatLog } from './chatLog.js';
import { Minimap } from './minimap.js';
import { AutoPanel } from './autoPanel.js';
import { InventoryPanel } from './inventoryPanel.js';

export class Hud {
  private readonly wrapper: HTMLDivElement;
  private readonly statusBlock: StatusBlock;
  private readonly hotbar: Hotbar;
  private readonly questTracker: QuestTracker;
  private readonly chatLog: ChatLog;
  private readonly minimap: Minimap;
  private readonly autoPanel: AutoPanel;
  private readonly inventoryPanel: InventoryPanel;

  constructor(net: NetClient, gameState: GameState) {
    this.wrapper = document.createElement('div');
    this.wrapper.className = 'terago-hud';
    document.getElementById('ui-root')!.appendChild(this.wrapper);

    this.statusBlock = new StatusBlock(this.wrapper);
    this.hotbar = new Hotbar(this.wrapper, net);
    this.questTracker = new QuestTracker(this.wrapper);
    this.chatLog = new ChatLog(this.wrapper, net);
    this.minimap = new Minimap(this.wrapper);
    this.autoPanel = new AutoPanel(this.wrapper, net);
    this.inventoryPanel = new InventoryPanel(this.wrapper, net);

    gameState.onSelfState.on((self) => {
      this.statusBlock.update(self);
      this.hotbar.update(self);
      this.autoPanel.update(self);
      this.inventoryPanel.update(self);
      this.updateMinimap(gameState);
      // self:state (unlike quest:update) always fires on join, so this is
      // also the one reliable moment to apply the tracker's hide-when-
      // nothing-is-active state for a character with no quest underway
      // yet - otherwise it would show a bare, empty "Quests" panel until
      // the first real quest:update ever arrives.
      this.questTracker.update(gameState.quests);
    });
    gameState.onQuestUpdate.on(() => this.questTracker.update(gameState.quests));
    gameState.onChatMessage.on(() => this.chatLog.update(gameState.chatLog));
    gameState.onEntityEntered.on(() => this.updateMinimap(gameState));
    gameState.onEntityUpdated.on(() => this.updateMinimap(gameState));
    gameState.onEntityLeft.on(() => this.updateMinimap(gameState));

    document.addEventListener('keydown', (e) => this.handleKeydown(e, net));
  }

  private updateMinimap(gameState: GameState): void {
    const map = gameState.mapId ? MAPS[gameState.mapId] : undefined;
    const local = gameState.localEntity();
    if (!map || !local) return;
    const others = [...gameState.entities.values()].filter((e) => e.kind === 'player' && e.id !== gameState.self?.characterId);
    this.minimap.update(map, local, others);
  }

  private handleKeydown(e: KeyboardEvent, net: NetClient): void {
    if (!this.wrapper.classList.contains('is-visible')) return;

    if (e.key === 'Escape') {
      // SPEC.md control table: "close the top-most window". No system
      // menu exists yet (out of scope for #81 - nothing in SPEC.md
      // names what it contains beyond this one line), so Esc with
      // nothing open is a no-op rather than guessing at one.
      if (this.inventoryPanel.isOpen()) this.inventoryPanel.close();
      else if (this.autoPanel.isSettingsOpen()) this.autoPanel.closeSettings();
      return;
    }

    if (isTextInputFocused()) return;

    if (e.key >= '1' && e.key <= '8') {
      net.send({ t: 'hotbar:use', slot: Number(e.key) });
      return;
    }
    if (e.key === 'i' || e.key === 'I') {
      this.inventoryPanel.toggle();
      return;
    }
    if (e.key === 'CapsLock') {
      this.autoPanel.toggle();
    }
  }

  show(): void {
    this.wrapper.classList.add('is-visible');
  }

  hide(): void {
    this.wrapper.classList.remove('is-visible');
  }
}
