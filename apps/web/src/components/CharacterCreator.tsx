'use client';

import { useMemo, useState } from 'react';
import { CLASSES } from '@terrago/game-data';
import {
  DEFAULT_APPEARANCE,
  EYE_COLORS,
  HAIR_COLORS,
  HAIR_STYLES,
  OUTFITS,
  BASE_OUTFIT_COUNT,
  SKIN_TONES,
  checkCharacterName,
  type Appearance,
  type CharacterSummary,
  type ClassId,
  type CreateCharacterInput,
} from '@terrago/shared';
import { api, ApiError } from '@/lib/api';
import { CharacterPreview } from './CharacterPreview';

function Swatches({ colors, value, onChange, label }: { colors: readonly string[]; value: number; onChange: (i: number) => void; label: string }) {
  return (
    <div role="radiogroup" aria-label={label} className="flex flex-wrap gap-1.5">
      {colors.map((c, i) => (
        <button
          key={c}
          type="button"
          role="radio"
          aria-checked={value === i}
          aria-label={`${label} ${i + 1}`}
          onClick={() => onChange(i)}
          className={`h-8 w-8 rounded-full border-2 border-white/30 transition hover:scale-110 ${value === i ? 'scale-110 ring-2 ring-gold ring-offset-2 ring-offset-night' : ''}`}
          style={{ background: c, outlineStyle: value === i ? 'solid' : 'none', outlineWidth: 3, outlineColor: '#e8c24a' }}
        />
      ))}
    </div>
  );
}

function Cycler({ label, options, value, onChange }: { label: string; options: readonly string[]; value: number; onChange: (i: number) => void }) {
  return (
    <div className="flex items-center gap-2">
      <button type="button" className="px-btn ghost small" aria-label={`Previous ${label}`} onClick={() => onChange((value - 1 + options.length) % options.length)}>
        ◀
      </button>
      <span className="min-w-36 text-center font-bold">{options[value]}</span>
      <button type="button" className="px-btn ghost small" aria-label={`Next ${label}`} onClick={() => onChange((value + 1) % options.length)}>
        ▶
      </button>
    </div>
  );
}

export function CharacterCreator({
  onCreated,
  onCancel,
  create = async (input) => (await api.createCharacter(input)).character,
}: {
  onCreated: (c: CharacterSummary) => void;
  onCancel?: () => void;
  create?: (input: CreateCharacterInput) => Promise<CharacterSummary>;
}) {
  const [name, setName] = useState('');
  const [classId, setClassId] = useState<ClassId>('warrior');
  const [look, setLook] = useState<Appearance>(DEFAULT_APPEARANCE);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = <K extends keyof Appearance>(k: K, v: Appearance[K]) => setLook((l) => ({ ...l, [k]: v }));
  const nameCheck = useMemo(() => (name ? checkCharacterName(name) : null), [name]);
  const cls = CLASSES.find((c) => c.id === classId)!;

  function randomize() {
    const r = (n: number) => Math.floor(Math.random() * n);
    setLook({
      bodyType: r(2) ? 'a' : 'b',
      skinTone: r(SKIN_TONES.length),
      hairStyle: r(HAIR_STYLES.length),
      hairColor: r(HAIR_COLORS.length),
      eyeColor: r(EYE_COLORS.length),
      outfit: r(BASE_OUTFIT_COUNT),
    });
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const check = checkCharacterName(name);
    if (!check.ok) return setError(check.reason);
    setBusy(true);
    setError(null);
    try {
      onCreated(await create({ name: check.name, classId, appearance: look }));
    } catch (err) {
      setError(err instanceof ApiError || err instanceof Error ? err.message : 'Could not create character.');
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="px-panel grid gap-6 p-6 md:grid-cols-[240px_1fr]">
      <div className="flex flex-col items-center gap-3">
        <div className="relative flex h-64 w-full items-end justify-center overflow-hidden rounded-2xl pb-5" style={{ background: 'radial-gradient(circle at 50% 85%, rgba(120,220,255,0.6), rgba(70,60,190,0.35) 45%, rgba(10,14,40,0.15) 75%)' }}>
          <div className="absolute bottom-4 h-4 w-32 rounded-[50%] bg-black/35 blur-sm" />
          <CharacterPreview appearance={look} scale={8} spin walk />
        </div>
        <button type="button" className="px-btn ghost small" onClick={randomize}>
          🎲 Randomize
        </button>
      </div>

      <div className="space-y-4">
        <div>
          <label htmlFor="char-name" className="block text-sm font-bold">
            Name
          </label>
          <input
            id="char-name"
            className="px-input mt-1"
            maxLength={16}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="3–16 letters, numbers or _"
            autoComplete="off"
          />
          {nameCheck && !nameCheck.ok && <p className="mt-1 text-sm font-bold text-berry">{nameCheck.reason}</p>}
        </div>

        <div>
          <span className="block text-sm font-bold">Class</span>
          <div className="mt-1 grid grid-cols-2 gap-2 sm:grid-cols-5">
            {CLASSES.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => setClassId(c.id)}
                aria-pressed={classId === c.id}
                className={`rounded-xl border px-2 py-2 text-sm font-bold transition ${classId === c.id ? 'border-gold bg-gold/90 text-[#2a1a02] shadow-[0_0_16px_rgba(255,200,80,0.5)]' : 'border-white/15 bg-white/5 hover:bg-white/10'}`}
                style={{ borderWidth: 3 }}
              >
                {c.name}
              </button>
            ))}
          </div>
          <p className="mt-2 text-sm">{cls.summary}</p>
          <p className="mt-1 text-xs text-wood-dark">
            STR {cls.baseStats.strength} · AGI {cls.baseStats.agility} · INT {cls.baseStats.intelligence} · VIT {cls.baseStats.vitality} · LUK {cls.baseStats.luck} ·
            Weapons: {cls.weapons.join(', ')}
          </p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <span className="block text-sm font-bold">Body type</span>
            <div className="mt-1 flex gap-2">
              {(['a', 'b'] as const).map((b) => (
                <button
                  key={b}
                  type="button"
                  aria-pressed={look.bodyType === b}
                  onClick={() => set('bodyType', b)}
                  className={`rounded-xl border px-3 py-1 font-bold transition ${look.bodyType === b ? 'border-gold bg-gold/90 text-[#2a1a02]' : 'border-white/15 bg-white/5 hover:bg-white/10'}`}
                  style={{ borderWidth: 3 }}
                >
                  Type {b.toUpperCase()}
                </button>
              ))}
            </div>
          </div>
          <div>
            <span className="block text-sm font-bold">Skin tone</span>
            <div className="mt-1">
              <Swatches label="Skin tone" colors={SKIN_TONES} value={look.skinTone} onChange={(i) => set('skinTone', i)} />
            </div>
          </div>
          <div>
            <span className="block text-sm font-bold">Hair style</span>
            <div className="mt-1">
              <Cycler label="hair style" options={HAIR_STYLES} value={look.hairStyle} onChange={(i) => set('hairStyle', i)} />
            </div>
          </div>
          <div>
            <span className="block text-sm font-bold">Hair color</span>
            <div className="mt-1">
              <Swatches label="Hair color" colors={HAIR_COLORS} value={look.hairColor} onChange={(i) => set('hairColor', i)} />
            </div>
          </div>
          <div>
            <span className="block text-sm font-bold">Eyes</span>
            <div className="mt-1">
              <Swatches label="Eye color" colors={EYE_COLORS} value={look.eyeColor} onChange={(i) => set('eyeColor', i)} />
            </div>
          </div>
          <div>
            <span className="block text-sm font-bold">Starter clothing</span>
            <div className="mt-1">
              <Cycler label="outfit" options={OUTFITS.slice(0, BASE_OUTFIT_COUNT).map((o) => o.name)} value={look.outfit} onChange={(i) => set('outfit', i)} />
            </div>
          </div>
        </div>

        {error && (
          <p role="alert" className="rounded-xl border border-berry/60 bg-berry/15 px-3 py-2 text-sm font-bold text-berry">
            {error}
          </p>
        )}

        <div className="flex flex-wrap gap-3">
          <button type="submit" className="px-btn green" disabled={busy || !nameCheck?.ok}>
            {busy ? 'Creating…' : 'Create character'}
          </button>
          {onCancel && (
            <button type="button" className="px-btn ghost" onClick={onCancel}>
              Cancel
            </button>
          )}
        </div>
      </div>
    </form>
  );
}
