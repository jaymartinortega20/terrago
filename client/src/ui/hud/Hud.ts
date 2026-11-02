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
import { SystemMenu } from './systemMenu.js';

/** Just enough of Phaser.Game's surface to replay the intro scene -
 * avoids a hard Phaser import here, keeping the DOM HUD's existing
 * "no Phaser dependency" boundary (docs/DECISIONS.md, task #81).
 * Deliberately exposes both stop() and start(): every other scene
 * transition in this client (LoginScene, IntroScene, WorldScene's portal
 * restart) calls `this.scene.start(...)` *from within* a Scene, whose
 * ScenePlugin stops the calling scene for you automatically. This menu
 * callback runs outside any Scene (it's driven by a DOM click), so it's
 * really calling the global SceneManager, not a ScenePlugin - and the
 * SceneManager's own start() does NOT stop whatever's currently running.
 * Skipping stop() here left WorldScene (map, HUD, chat) fully running
 * underneath, and starting Intro only made it run invisibly behind that -
 * a real bug caught in task #76's own live verification pass. */
interface SceneStarter {
  scene: { start(key: string): void; stop(key: string): void };
}

export class Hud {
  private readonly wrapper: HTMLDivElement;
  private readonly statusBlock: StatusBlock;
  private readonly hotbar: Hotbar;
  private readonly questTracker: QuestTracker;
  private readonly chatLog: ChatLog;
  private readonly minimap: Minimap;
  private readonly autoPanel: AutoPanel;
  private readonly inventoryPanel: InventoryPanel;
  private readonly systemMenu: SystemMenu;
  private game: SceneStarter | null = null;

  constructor(net: NetClient, gameState: GameState) {
    this.wrapper = document.createElement('div');
    this.wrapper.className = 'terago-hud';
    document.getElementById('ui-root')!.appendChild(this.wrapper);

    this.statusBlock = new StatusBlock(this.wrapper, net);
    this.hotbar = new Hotbar(this.wrapper, net);
    this.questTracker = new QuestTracker(this.wrapper);
    this.chatLog = new ChatLog(this.wrapper, net);
    this.minimap = new Minimap(this.wrapper);
    this.autoPanel = new AutoPanel(this.wrapper, net);
    this.inventoryPanel = new InventoryPanel(this.wrapper, net);
    this.systemMenu = new SystemMenu(this.wrapper, () => {
      // See the SceneStarter comment above: this menu is only ever
      // reachable from WorldScene today (the Esc handler below only
      // fires once `hud.show()` has run, which only WorldScene does),
      // so it's always the scene to stop before starting Intro.
      // IntroScene never calls hud.hide() itself - on a normal first
      // playthrough that's fine (hud.show() hasn't run yet, so the HUD
      // is already hidden), but on a *replay* the HUD is already
      // .is-visible from WorldScene and nothing else would ever hide it,
      // leaving the gameplay HUD rendered on top of the intro scrolls.
      // Also a real bug caught in task #76's live verification pass.
      this.hide();
      this.game?.scene.stop('World');
      this.game?.scene.start('Intro');
    });

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
      // SPEC.md control table: "Close the top-most window, or open the
      // system menu" - close whatever's open; with nothing open, open
      // the system menu (task #76: closes the M1 acceptance bullet
      // "...can be replayed from Settings" - see systemMenu.ts).
      if (this.inventoryPanel.isOpen()) this.inventoryPanel.close();
      else if (this.autoPanel.isSettingsOpen()) this.autoPanel.closeSettings();
      else if (this.systemMenu.isOpen()) this.systemMenu.close();
      else this.systemMenu.toggle();
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

  /** Called once from main.ts right after the Phaser.Game is constructed
   * (Hud itself is built slightly earlier - see main.ts). */
  setGame(game: SceneStarter): void {
    this.game = game;
  }

  show(): void {
    this.wrapper.classList.add('is-visible');
  }

  hide(): void {
    this.wrapper.classList.remove('is-visible');
  }
}
