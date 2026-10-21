'use client';

import { useEffect, useRef, useState } from 'react';
import { CHAT } from '@terrago/shared';
import type { GameClient } from '../net/client';
import { useStore } from '../store';

const CHANNEL_STYLE: Record<string, { tag: string; color: string }> = {
  local: { tag: '', color: 'text-parchment' },
  global: { tag: '[World] ', color: 'text-[#f0b860]' },
  party: { tag: '[Party] ', color: 'text-[#7fc8ff]' },
  guild: { tag: '[Guild] ', color: 'text-[#8ee08a]' },
  whisper: { tag: '', color: 'text-[#e79bf0]' },
};
const SEND_AS = [
  { id: '', label: 'Say' },
  { id: '/g ', label: 'World' },
  { id: '/p ', label: 'Party' },
  { id: '/gu ', label: 'Guild' },
];

/** Chat log + input. Enter focuses, Enter sends, Escape returns to the game. */
export function ChatBox({ client, compact }: { client: GameClient; compact?: boolean }) {
  const chat = useStore(client.ui, (s) => s.chat);
  const myId = useStore(client.ui, (s) => s.self?.characterId);
  const [text, setText] = useState('');
  const [sendAs, setSendAs] = useState('');
  const draft = useStore(client.ui, (s) => s.chatDraft);
  useEffect(() => {
    if (draft === null) return;
    setText(draft);
    client.ui.set({ chatDraft: null });
  }, [draft, client]);
  const [inputOpen, setInputOpen] = useState(!compact);
  const inputRef = useRef<HTMLInputElement>(null);
  const logRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [chat]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Enter' && document.activeElement !== inputRef.current && !client.ui.get().dialogue) {
        e.preventDefault();
        inputRef.current?.focus();
      }
    };
    const focus = () => {
      setInputOpen(true);
      setTimeout(() => inputRef.current?.focus(), 0);
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('terrago:focus-chat', focus);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('terrago:focus-chat', focus);
    };
  }, [client]);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    const t = text.trim();
    if (!t) {
      inputRef.current?.blur();
      return;
    }
    setText('');
    // Enter sends and returns control to the game (like most MMOs); Enter again reopens chat.
    inputRef.current?.blur();
    await client.sendChat(t.startsWith('/') ? t : sendAs + t);
  }

  const shown = compact ? chat.slice(-3) : chat;

  return (
    <div
      className={`px-panel-dark flex flex-col ${compact ? 'pointer-events-none w-60' : 'pointer-events-auto w-80 sm:w-96'}`}
      style={{ background: compact ? 'rgba(18, 20, 31, 0.5)' : 'rgba(18, 20, 31, 0.72)', borderWidth: compact ? 0 : undefined }}
      data-testid="chat"
    >
      <div
        ref={logRef}
        className={`${compact ? 'max-h-14 text-[11px]' : 'h-32 text-[13px]'} space-y-0.5 overflow-y-auto px-2 py-1 leading-snug`}
        aria-live="polite"
      >
        {chat.length === 0 && !compact && <p className="text-parchment/50">Press Enter to talk. /g world · /p party · /gu guild · /w name whisper</p>}
        {shown.map((m) => (
          <p key={m.id} className="break-words" data-testid="chat-line">
            {m.channel === 'system' ? (
              <span className="text-sky">{m.text}</span>
            ) : (
              <>
                <span className={CHANNEL_STYLE[m.channel]?.color}>{CHANNEL_STYLE[m.channel]?.tag}</span>
                <span className={`font-bold ${m.channel === 'whisper' ? 'text-[#e79bf0]' : m.fromId === myId ? 'text-gold' : 'text-leaf'}`}>
                  {m.channel === 'whisper' ? (m.fromId === myId ? `To ${m.toName}` : `${m.fromName} whispers`) : m.fromName}:
                </span>{' '}
                <span className={m.channel === 'local' ? 'text-parchment' : CHANNEL_STYLE[m.channel]?.color}>{m.text}</span>
              </>
            )}
          </p>
        ))}
      </div>
      <form
        onSubmit={send}
        className={`flex gap-1 ${compact ? (inputOpen ? 'pointer-events-auto fixed top-2 left-1/2 z-50 w-[min(90vw,420px)] -translate-x-1/2 bg-night p-1 shadow-lg' : 'hidden') : 'border-t-2 border-night-3 p-1'}`}
      >
        <select
          value={sendAs}
          onChange={(e) => setSendAs(e.target.value)}
          className="bg-night-3 px-0.5 text-[11px] text-parchment"
          aria-label="Chat channel"
          data-testid="chat-channel"
        >
          {SEND_AS.map((c) => (
            <option key={c.id} value={c.id}>
              {c.label}
            </option>
          ))}
        </select>
        <input
          ref={inputRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onFocus={() => client.ui.set({ chatFocused: true })}
          onBlur={() => {
            client.ui.set({ chatFocused: false });
            if (compact) setInputOpen(false);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              setText('');
              inputRef.current?.blur();
            }
            e.stopPropagation();
          }}
          maxLength={CHAT.maxLength}
          placeholder={sendAs ? `Message ${SEND_AS.find((c) => c.id === sendAs)?.label}…` : 'Say something… (Enter)'}
          className="min-w-0 flex-1 bg-night px-2 py-1 text-[13px] text-parchment outline-none placeholder:text-parchment/40 focus:ring-2 focus:ring-gold"
          aria-label="Chat message"
          data-testid="chat-input"
        />
      </form>
    </div>
  );
}
