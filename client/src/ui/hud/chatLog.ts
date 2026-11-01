/**
 * SPEC.md section 7: "Chat log (bottom left, tabs: All, Map, System)."
 * Enter focuses the box (control table); pressing it again while focused
 * sends and blurs, so the player lands straight back in WASD control
 * rather than having to click away - Escape blurs without sending.
 * "All" and "Map" are real send channels; "System" is announcements-only
 * from the player's side, so sending while that tab is active still goes
 * out as 'global' rather than silently failing or being blocked.
 */
import type { NetClient } from '../../net/NetClient.js';
import type { ChatMessage } from '../../state/GameState.js';
import { CHAT_CHANNELS, type ChatTab } from '../../config.js';

const TAB_LABEL: Record<ChatTab, string> = { all: 'All', map: 'Map', system: 'System' };

const CHANNEL_CLASS: Record<ChatMessage['channel'], string> = {
  global: 'terago-chat-global',
  map: 'terago-chat-map',
  system: 'terago-chat-system',
  monster: 'terago-chat-monster',
  pet: 'terago-chat-pet',
  npc: 'terago-chat-npc',
};

function escapeHtml(text: string): string {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

export class ChatLog {
  private readonly root: HTMLDivElement;
  private readonly messagesEl: HTMLDivElement;
  private readonly inputEl: HTMLInputElement;
  private activeTab: ChatTab = 'all';
  private log: readonly ChatMessage[] = [];
  private readonly onDocumentKeydown: (e: KeyboardEvent) => void;

  constructor(parent: HTMLElement, private readonly net: NetClient) {
    this.root = document.createElement('div');
    this.root.className = 'interactive terago-glass terago-hud-chat';
    this.root.innerHTML = `
      <div class="terago-chat-tabs">
        ${CHAT_CHANNELS.map((tab) => `<button type="button" data-tab="${tab}" class="${tab === 'all' ? 'is-active' : ''}">${TAB_LABEL[tab]}</button>`).join('')}
      </div>
      <div class="terago-chat-messages"></div>
      <input type="text" class="terago-chat-input" maxlength="200" placeholder="Press Enter to chat..." />
    `;
    parent.appendChild(this.root);

    this.messagesEl = this.root.querySelector('.terago-chat-messages')!;
    this.inputEl = this.root.querySelector('.terago-chat-input')!;

    for (const button of this.root.querySelectorAll<HTMLButtonElement>('.terago-chat-tabs button')) {
      button.addEventListener('click', () => this.setTab(button.dataset.tab as ChatTab));
    }

    this.inputEl.addEventListener('keydown', (e) => {
      e.stopPropagation(); // never let 1-8/I/etc. fire while typing
      if (e.key === 'Enter') this.submit();
      else if (e.key === 'Escape') this.blur();
    });

    this.onDocumentKeydown = (e) => {
      if (e.key !== 'Enter') return;
      if (document.activeElement === this.inputEl) return; // handled above instead
      if (document.activeElement?.tagName === 'INPUT' || document.activeElement?.tagName === 'TEXTAREA') return;
      e.preventDefault();
      this.inputEl.focus();
    };
    document.addEventListener('keydown', this.onDocumentKeydown);
  }

  private setTab(tab: ChatTab): void {
    this.activeTab = tab;
    for (const button of this.root.querySelectorAll<HTMLButtonElement>('.terago-chat-tabs button')) {
      button.classList.toggle('is-active', button.dataset.tab === tab);
    }
    this.render();
  }

  private submit(): void {
    const text = this.inputEl.value.trim();
    if (text) {
      const channel = this.activeTab === 'map' ? 'map' : 'global';
      this.net.send({ t: 'chat:send', channel, text });
    }
    this.blur();
  }

  private blur(): void {
    this.inputEl.value = '';
    this.inputEl.blur();
  }

  /** Called whenever GameState.chatLog grows (Hud wires this to
   * onChatMessage) - re-renders from the full log rather than appending a
   * single line, since switching tabs needs the whole filtered history
   * anyway and M1's chat volume never makes that a real cost. */
  update(log: readonly ChatMessage[]): void {
    this.log = log;
    this.render();
  }

  private render(): void {
    const visible = this.log.filter((m) => this.activeTab === 'all' || m.channel === this.activeTab);
    this.messagesEl.innerHTML = visible
      .map((m) => `<div class="terago-chat-line ${CHANNEL_CLASS[m.channel]}"><b>${escapeHtml(m.speaker)}:</b> ${escapeHtml(m.text)}</div>`)
      .join('');
    this.messagesEl.scrollTop = this.messagesEl.scrollHeight;
  }

  destroy(): void {
    document.removeEventListener('keydown', this.onDocumentKeydown);
    this.root.remove();
  }
}
