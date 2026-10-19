import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { CLASSES, MAPS } from '@terrago/game-data';
import type { CharacterSummary } from '@terrago/shared';
import { CharacterCreator } from '@/components/CharacterCreator';
import { CharacterPreview } from '@/components/CharacterPreview';
import GameView from '@/game/GameView';
import { GameClient } from '@/game/net/client';
import { clearSave, createLocalCharacter, loadSave, summaryOf } from './localSave';
import { LocalServer } from './localServer';

/**
 * TerraGo offline preview: the real game client and world rules running fully
 * in the browser. Multiplayer needs the TerraGo server; here the other
 * characters are labelled bots.
 */
const server = new LocalServer();

function Title() {
  return (
    <header className="text-center">
      <h1 className="text-outline text-5xl font-bold tracking-wider text-gold sm:text-6xl">TERRAGO</h1>
      <p className="text-outline mt-2 text-xl font-bold">Farm. Trade. Fight. Grow.</p>
      <p className="mx-auto mt-3 max-w-xl text-sm text-parchment/80">
        Offline preview of Version 0.1. Everything runs in this browser and your progress is saved here. Multiplayer arrives when the TerraGo server goes online; the
        other characters you meet in this preview are labelled bots.
      </p>
    </header>
  );
}

function Menu({ onPlay }: { onPlay: (c: CharacterSummary) => void }) {
  const [save, setSave] = useState(() => loadSave());
  const [creating, setCreating] = useState(!save);
  const [confirmReset, setConfirmReset] = useState(false);

  if (creating || !save) {
    return (
      <main className="mx-auto max-w-4xl px-4 py-8">
        <Title />
        <h2 className="text-outline mt-8 mb-4 text-2xl font-bold">Create your character</h2>
        <CharacterCreator
          create={async (input) => summaryOf(createLocalCharacter(input))}
          onCreated={(c) => {
            setSave(loadSave());
            setCreating(false);
            onPlay(c);
          }}
          onCancel={save ? () => setCreating(false) : undefined}
        />
      </main>
    );
  }

  const c = summaryOf(save);
  const cls = CLASSES.find((k) => k.id === c.classId);
  return (
    <main className="mx-auto flex min-h-dvh max-w-4xl flex-col items-center justify-center gap-8 px-4 py-8">
      <Title />
      <div className="px-panel flex w-full max-w-sm flex-col items-center p-5" data-testid="continue-card">
        <div className="flex h-36 w-full items-end justify-center border-4 border-ink bg-[#67a84a]" style={{ boxShadow: 'inset 0 -12px 0 #58953f' }}>
          <CharacterPreview appearance={c.appearance} scale={7} walk />
        </div>
        <p className="mt-3 text-2xl font-bold">{c.name}</p>
        <p className="text-sm">
          Lv {c.level} {cls?.name} · {MAPS[c.mapId]?.name}
        </p>
        <button className="px-btn green mt-4 w-full text-lg" onClick={() => onPlay(c)} data-testid="continue">
          ▶ Play
        </button>
        {confirmReset ? (
          <div className="mt-3 flex w-full flex-col items-center gap-2 text-center text-sm">
            <p>Delete {c.name} and start over? This can't be undone.</p>
            <div className="flex gap-2">
              <button
                className="px-btn small"
                onClick={() => {
                  clearSave();
                  setSave(null);
                  setConfirmReset(false);
                  setCreating(true);
                }}
              >
                Delete and start over
              </button>
              <button className="px-btn ghost small" onClick={() => setConfirmReset(false)}>
                Keep
              </button>
            </div>
          </div>
        ) : (
          <button className="px-btn ghost small mt-3" onClick={() => setConfirmReset(true)}>
            New character
          </button>
        )}
      </div>
      <p className="max-w-md text-center text-xs text-parchment/60">
        Move with WASD or the arrow keys (joystick on phones). Press E near someone to talk, Enter to chat, I for your bag.
      </p>
    </main>
  );
}

function App() {
  const [playing, setPlaying] = useState<CharacterSummary | null>(null);
  if (!playing) return <Menu onPlay={setPlaying} />;
  return (
    <GameView
      key={playing.id}
      characterId={playing.id}
      badge="Offline preview"
      createClient={(id) => new GameClient(id, { socketFactory: () => server.connect(id) })}
      onExit={() => setPlaying(null)}
    />
  );
}

createRoot(document.getElementById('terrago-root')!).render(<App />);
