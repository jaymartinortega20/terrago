'use client';

import { useEffect, useRef, useState } from 'react';
import { CHAT } from '@terrago/shared';
import type { GameClient } from '../net/client';
import { useStore } from '../store';

/** Local chat log + input. Enter focuses, Enter sends, Escape returns to the game. */
export function ChatBox({ client, compact }: { client: GameClient; compact?: boolean }) {
  const chat = useStore(client.ui, (s) => s.chat);
  const myId = useStore(client.ui, (s) => s.self?.characterId);
  const [text, setText] = useState('');
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
    await client.sendChat(t);
    if (compact) inputRef.current?.blur();
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
        {chat.length === 0 && !compact && <p className="text-parchment/50">Local chat — press Enter to talk to people nearby.</p>}
        {shown.map((m) => (
          <p key={m.id} className="break-words" data-testid="chat-line">
            {m.channel === 'system' ? (
              <span className="text-sky">{m.text}</span>
            ) : (
              <>
                <span className={`font-bold ${m.fromId === myId ? 'text-gold' : 'text-leaf'}`}>{m.fromName}:</span>{' '}
                <span className="text-parchment">{m.text}</span>
              </>
            )}
          </p>
        ))}
      </div>
      <form
        onSubmit={send}
        className={compact ? (inputOpen ? 'pointer-events-auto fixed top-2 left-1/2 z-50 w-[min(90vw,420px)] -translate-x-1/2 bg-night p-1 shadow-lg' : 'hidden') : 'border-t-2 border-night-3 p-1'}
      >
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
          placeholder="Say something… (Enter)"
          className="w-full bg-night px-2 py-1 text-[13px] text-parchment outline-none placeholder:text-parchment/40 focus:ring-2 focus:ring-gold"
          aria-label="Chat message"
          data-testid="chat-input"
        />
      </form>
    </div>
  );
}
