/**
 * TerraGo sound: everything is synthesized with the Web Audio API — effects,
 * per-area chiptune music and weather ambience — so there are no files to
 * download. Three volume channels (music, effects, ambient) plus mute.
 *
 * Browsers only allow sound after the player interacts with the page, so the
 * audio context starts on the first click or key press.
 */
export type AudioChannel = 'music' | 'effects' | 'ambient';

export interface AudioSettings {
  music: number;
  effects: number;
  ambient: number;
  muted: boolean;
}

const KEY = 'terrago:audio';
const DEFAULTS: AudioSettings = { music: 0.5, effects: 0.7, ambient: 0.5, muted: false };

export function loadAudioSettings(): AudioSettings {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? { ...DEFAULTS, ...(JSON.parse(raw) as Partial<AudioSettings>) } : DEFAULTS;
  } catch {
    return DEFAULTS;
  }
}

export function saveAudioSettings(s: AudioSettings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    // Storage may be unavailable (private mode); settings then last for the session only.
  }
}

export type Sfx =
  | 'hit'
  | 'crit'
  | 'miss'
  | 'hurt'
  | 'heal'
  | 'magic'
  | 'death'
  | 'coin'
  | 'levelup'
  | 'achievement'
  | 'quest'
  | 'harvest'
  | 'plant'
  | 'dig'
  | 'water'
  | 'mine'
  | 'chop'
  | 'pick'
  | 'splash'
  | 'bite'
  | 'catch'
  | 'click'
  | 'open'
  | 'portal'
  | 'telegraph'
  | 'boom'
  | 'craft'
  | 'trade'
  | 'chat'
  | 'error'
  | 'swing'
  | 'step'
  | 'spell'
  | 'pop';

// ---------------------------------------------------------------------------
// Music: a small generative sequencer. Each area has a key, scale, tempo and
// instruments; the tune is generated from a seed so it is the same every visit.
// ---------------------------------------------------------------------------

interface Track {
  bpm: number;
  root: number; // MIDI note of the key
  scale: number[];
  chords: number[]; // scale degrees, one per bar
  lead: OscillatorType;
  bass: OscillatorType;
  seed: number;
  /** 0..1: how busy the melody is. */
  density: number;
  drums: boolean;
  gain: number;
}

const MAJOR = [0, 2, 4, 5, 7, 9, 11];
const MINOR = [0, 2, 3, 5, 7, 8, 10];
const DORIAN = [0, 2, 3, 5, 7, 9, 10];
const PENTA = [0, 2, 4, 7, 9];

const TRACKS: Record<string, Track> = {
  town: { bpm: 112, root: 60, scale: MAJOR, chords: [0, 3, 4, 0, 5, 3, 4, 4], lead: 'square', bass: 'triangle', seed: 11, density: 0.7, drums: true, gain: 0.8 },
  field: { bpm: 104, root: 62, scale: MAJOR, chords: [0, 4, 5, 3], lead: 'triangle', bass: 'triangle', seed: 23, density: 0.55, drums: true, gain: 0.8 },
  homestead: { bpm: 92, root: 65, scale: PENTA, chords: [0, 3, 4, 0], lead: 'triangle', bass: 'sine', seed: 31, density: 0.45, drums: false, gain: 0.8 },
  forest: { bpm: 96, root: 57, scale: DORIAN, chords: [0, 6, 3, 4], lead: 'triangle', bass: 'triangle', seed: 47, density: 0.5, drums: true, gain: 0.8 },
  lake: { bpm: 84, root: 64, scale: PENTA, chords: [0, 2, 3, 1], lead: 'sine', bass: 'sine', seed: 59, density: 0.4, drums: false, gain: 0.9 },
  mountain: { bpm: 100, root: 55, scale: MAJOR, chords: [0, 4, 3, 4], lead: 'square', bass: 'triangle', seed: 61, density: 0.5, drums: true, gain: 0.75 },
  cave: { bpm: 76, root: 50, scale: MINOR, chords: [0, 5, 3, 4], lead: 'triangle', bass: 'sine', seed: 73, density: 0.3, drums: false, gain: 0.9 },
  dungeon: { bpm: 120, root: 48, scale: MINOR, chords: [0, 5, 6, 4], lead: 'sawtooth', bass: 'square', seed: 89, density: 0.6, drums: true, gain: 0.6 },
  snow: { bpm: 80, root: 62, scale: [0, 2, 4, 7, 11], chords: [0, 3, 1, 4], lead: 'sine', bass: 'triangle', seed: 97, density: 0.35, drums: false, gain: 0.9 },
  swamp: { bpm: 88, root: 52, scale: DORIAN, chords: [0, 3, 6, 4], lead: 'triangle', bass: 'square', seed: 101, density: 0.45, drums: true, gain: 0.7 },
  desert: { bpm: 96, root: 52, scale: [0, 1, 4, 5, 7, 8, 10], chords: [0, 1, 0, 6], lead: 'square', bass: 'triangle', seed: 131, density: 0.5, drums: true, gain: 0.7 },
  volcano: { bpm: 108, root: 45, scale: MINOR, chords: [0, 6, 5, 4], lead: 'sawtooth', bass: 'square', seed: 137, density: 0.55, drums: true, gain: 0.55 },
  ruins: { bpm: 72, root: 57, scale: [0, 2, 3, 6, 7, 8, 11], chords: [0, 3, 5, 4], lead: 'triangle', bass: 'sine', seed: 149, density: 0.35, drums: false, gain: 0.85 },
  dragon: { bpm: 126, root: 50, scale: MINOR, chords: [0, 5, 3, 6], lead: 'sawtooth', bass: 'sawtooth', seed: 151, density: 0.7, drums: true, gain: 0.5 },
  boss: { bpm: 140, root: 45, scale: MINOR, chords: [0, 0, 5, 4], lead: 'sawtooth', bass: 'sawtooth', seed: 113, density: 0.8, drums: true, gain: 0.55 },
};

/** Map `music` values from map data to a track. */
export function trackFor(music: string | null | undefined, theme?: string): string | null {
  const m = (music ?? '').toLowerCase();
  if (!m && !theme) return null;
  if (m.includes('dungeon')) return 'dungeon';
  if (m.includes('desert')) return 'desert';
  if (m.includes('volcano')) return 'volcano';
  if (m.includes('ruins')) return 'ruins';
  if (m.includes('dragon')) return 'dragon';
  if (m.includes('cave')) return 'cave';
  if (m.includes('snow')) return 'snow';
  if (m.includes('swamp')) return 'swamp';
  if (m.includes('forest')) return 'forest';
  if (m.includes('lake')) return 'lake';
  if (m.includes('mountain')) return 'mountain';
  if (m.includes('home')) return 'homestead';
  if (m.includes('field') || m.includes('sunfield')) return 'field';
  if (m.includes('town') || m.includes('green')) return 'town';
  return theme === 'cave' ? 'cave' : 'town';
}

function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const freq = (midi: number) => 440 * 2 ** ((midi - 69) / 12);

class AudioManager {
  settings: AudioSettings = DEFAULTS;
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private bus: Partial<Record<AudioChannel, GainNode>> = {};
  private noise: AudioBuffer | null = null;
  private wanted: string | null = null;
  private playing: { name: string; timer: ReturnType<typeof setInterval>; out: GainNode } | null = null;
  private ambient: { kind: string; nodes: AudioNode[]; out: GainNode } | null = null;
  private lastSfx = new Map<Sfx, number>();
  private unlockBound = () => this.unlock();

  init(): void {
    this.settings = loadAudioSettings();
    if (typeof window === 'undefined') return;
    window.addEventListener('pointerdown', this.unlockBound);
    window.addEventListener('keydown', this.unlockBound);
  }

  /** Start (or resume) the audio context after a user gesture. */
  private unlock(): void {
    if (typeof window === 'undefined') return;
    if (!this.ctx) {
      const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctx) return;
      this.ctx = new Ctx();
      this.master = this.ctx.createGain();
      this.master.connect(this.ctx.destination);
      this.analyser = this.ctx.createAnalyser();
      this.master.connect(this.analyser);
      for (const ch of ['music', 'effects', 'ambient'] as const) {
        const g = this.ctx.createGain();
        g.connect(this.master);
        this.bus[ch] = g;
      }
      // A soft hall reverb that every effect and the music can send into.
      const sr = this.ctx.sampleRate;
      const irLen = Math.floor(sr * 2.2);
      const ir = this.ctx.createBuffer(2, irLen, sr);
      for (let ch = 0; ch < 2; ch++) {
        const d = ir.getChannelData(ch);
        for (let i = 0; i < irLen; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / irLen, 3.2);
      }
      this.reverb = this.ctx.createConvolver();
      this.reverb.buffer = ir;
      const wet = this.ctx.createGain();
      wet.gain.value = 0.9;
      this.reverb.connect(wet).connect(this.master);
      const len = this.ctx.sampleRate * 2;
      this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = this.noise.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      this.applyVolumes();
      if (this.wanted) this.startMusic(this.wanted);
      if (this.ambientWanted) this.setAmbient(this.ambientWanted);
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
  }

  private analyser: AnalyserNode | null = null;
  private reverb: ConvolverNode | null = null;

  /** Send a node into the reverb (scaled by the effects volume via `bus`). */
  private wet(node: AudioNode, amount: number, bus: AudioChannel = 'effects'): void {
    if (!this.ctx || !this.reverb || amount <= 0) return;
    const g = this.ctx.createGain();
    g.gain.value = amount * (this.volumeFor(bus) ** 1.5);
    node.connect(g).connect(this.reverb);
  }

  /** Debug/test helper: what's playing and how loud the output is right now (RMS 0..1). */
  state(): { ready: boolean; music: string | null; ambient: string | null; level: number } {
    let level = 0;
    if (this.analyser) {
      const buf = new Float32Array(this.analyser.fftSize);
      this.analyser.getFloatTimeDomainData(buf);
      level = Math.sqrt(buf.reduce((a, v) => a + v * v, 0) / buf.length);
    }
    return { ready: this.ready, music: this.playing?.name ?? null, ambient: this.ambient?.kind ?? null, level };
  }

  get ready(): boolean {
    return !!this.ctx && this.ctx.state === 'running';
  }

  volumeFor(channel: AudioChannel): number {
    return this.settings.muted ? 0 : this.settings[channel];
  }

  private applyVolumes(): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    for (const ch of ['music', 'effects', 'ambient'] as const) this.bus[ch]?.gain.setTargetAtTime(this.volumeFor(ch) ** 1.5, t, 0.05);
  }

  update(settings: AudioSettings): void {
    this.settings = settings;
    saveAudioSettings(settings);
    this.applyVolumes();
  }

  // --- Effects ---------------------------------------------------------------

  private tone(opts: { type?: OscillatorType; f: number; f2?: number; at?: number; dur: number; vol?: number; attack?: number; bus?: AudioChannel; detune?: number; rev?: number }) {
    const ctx = this.ctx!;
    const t = ctx.currentTime + (opts.at ?? 0);
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = opts.type ?? 'square';
    o.frequency.setValueAtTime(opts.f, t);
    if (opts.f2) o.frequency.exponentialRampToValueAtTime(Math.max(20, opts.f2), t + opts.dur);
    if (opts.detune) o.detune.value = opts.detune;
    const v = opts.vol ?? 0.2;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(v, t + (opts.attack ?? 0.005));
    g.gain.exponentialRampToValueAtTime(0.0001, t + opts.dur);
    o.connect(g).connect(this.bus[opts.bus ?? 'effects']!);
    if (opts.rev) this.wet(g, opts.rev, opts.bus);
    o.start(t);
    o.stop(t + opts.dur + 0.05);
  }

  /** A soft bell / chime (FM synthesis), with reverb. */
  private bell(f: number, at = 0, dur = 0.9, vol = 0.12, rev = 0.35): void {
    const ctx = this.ctx!;
    const t = ctx.currentTime + at;
    const car = ctx.createOscillator();
    const mod = ctx.createOscillator();
    const mg = ctx.createGain();
    const g = ctx.createGain();
    car.type = 'sine';
    mod.type = 'sine';
    car.frequency.value = f;
    mod.frequency.value = f * 3.51;
    mg.gain.setValueAtTime(f * 2.2, t);
    mg.gain.exponentialRampToValueAtTime(f * 0.05, t + dur * 0.6);
    mod.connect(mg).connect(car.frequency);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    car.connect(g).connect(this.bus.effects!);
    this.wet(g, rev);
    car.start(t);
    mod.start(t);
    car.stop(t + dur + 0.05);
    mod.stop(t + dur + 0.05);
  }

  /** A body thump: a quick pitch-dropping sine. */
  private thump(f: number, at = 0, dur = 0.14, vol = 0.4): void {
    this.tone({ type: 'sine', f, f2: f * 0.35, at, dur, vol, attack: 0.002 });
  }

  private hiss(opts: { at?: number; dur: number; vol?: number; type?: BiquadFilterType; f: number; f2?: number; q?: number; bus?: AudioChannel; rev?: number; attack?: number }) {
    const ctx = this.ctx!;
    const t = ctx.currentTime + (opts.at ?? 0);
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const filt = ctx.createBiquadFilter();
    filt.type = opts.type ?? 'bandpass';
    filt.frequency.setValueAtTime(opts.f, t);
    if (opts.f2) filt.frequency.exponentialRampToValueAtTime(opts.f2, t + opts.dur);
    filt.Q.value = opts.q ?? 1;
    const g = ctx.createGain();
    if (opts.attack) {
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(opts.vol ?? 0.3, t + opts.attack);
    } else g.gain.setValueAtTime(opts.vol ?? 0.3, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + opts.dur);
    src.connect(filt).connect(g).connect(this.bus[opts.bus ?? 'effects']!);
    if (opts.rev) this.wet(g, opts.rev, opts.bus);
    src.start(t, Math.random());
    src.stop(t + opts.dur + 0.05);
  }

  /** Play a sound effect (ignored before the first interaction, and rate-limited per sound). */
  sfx(name: Sfx): void {
    if (!this.ready || this.settings.muted || this.settings.effects <= 0) return;
    const now = performance.now();
    if (now - (this.lastSfx.get(name) ?? 0) < 45) return;
    this.lastSfx.set(name, now);
    const notes = (list: number[], step: number, type: OscillatorType = 'square', vol = 0.12, dur = 0.12) =>
      list.forEach((m, i) => this.tone({ type, f: freq(m), at: i * step, dur, vol }));
    const chime = (list: number[], step: number, vol = 0.1, dur = 0.9) => list.forEach((m, i) => this.bell(freq(m), i * step, dur, vol));
    switch (name) {
      case 'hit':
        // Meaty impact: body thump + crunchy noise + a short click.
        this.thump(150, 0, 0.13, 0.45);
        this.hiss({ dur: 0.11, type: 'lowpass', f: 2600, f2: 500, vol: 0.45, rev: 0.12 });
        this.hiss({ dur: 0.03, type: 'highpass', f: 3500, vol: 0.2 });
        break;
      case 'crit':
        this.thump(170, 0, 0.2, 0.6);
        this.hiss({ dur: 0.18, type: 'lowpass', f: 3500, f2: 400, vol: 0.55, rev: 0.25 });
        this.bell(freq(91), 0.01, 0.5, 0.08, 0.3);
        this.bell(freq(98), 0.03, 0.4, 0.05, 0.3);
        break;
      case 'miss':
        this.hiss({ dur: 0.22, type: 'bandpass', f: 600, f2: 2600, q: 1.4, vol: 0.18, attack: 0.04 });
        break;
      case 'swing':
        this.hiss({ dur: 0.2, type: 'bandpass', f: 500, f2: 2200, q: 1.8, vol: 0.22, attack: 0.03 });
        break;
      case 'step':
        this.hiss({ dur: 0.05, type: 'lowpass', f: 900 + Math.random() * 400, vol: 0.09 });
        break;
      case 'pop':
        this.tone({ type: 'sine', f: 500, f2: 1100, dur: 0.07, vol: 0.12 });
        break;
      case 'hurt':
        this.thump(110, 0, 0.18, 0.5);
        this.hiss({ dur: 0.14, type: 'lowpass', f: 1200, f2: 300, vol: 0.4 });
        this.tone({ type: 'triangle', f: 320, f2: 140, dur: 0.16, vol: 0.08 });
        break;
      case 'heal':
        chime([79, 83, 86, 91], 0.07, 0.08, 1.1);
        this.hiss({ dur: 0.6, type: 'highpass', f: 6000, vol: 0.05, attack: 0.15, rev: 0.4 });
        break;
      case 'magic':
      case 'spell':
        this.tone({ type: 'sine', f: 400, f2: 1600, dur: 0.35, vol: 0.12, attack: 0.03, rev: 0.45 });
        this.tone({ type: 'triangle', f: 803, f2: 3200, dur: 0.3, vol: 0.05, rev: 0.45 });
        this.hiss({ dur: 0.4, type: 'bandpass', f: 1500, f2: 7000, q: 2, vol: 0.12, attack: 0.05, rev: 0.4 });
        break;
      case 'death':
        // A soft "poof" and a falling sparkle.
        this.thump(220, 0, 0.18, 0.3);
        this.hiss({ dur: 0.45, type: 'lowpass', f: 3000, f2: 200, vol: 0.4, rev: 0.3 });
        chime([84, 79, 74], 0.06, 0.05, 0.6);
        break;
      case 'coin':
        this.bell(freq(93), 0, 0.4, 0.08, 0.2);
        this.bell(freq(100), 0.07, 0.6, 0.08, 0.25);
        break;
      case 'levelup':
        chime([72, 76, 79, 84, 88, 91], 0.07, 0.1, 1.4);
        this.tone({ type: 'sine', f: freq(48), dur: 1.4, vol: 0.18, attack: 0.05, rev: 0.4 });
        this.hiss({ dur: 1.2, type: 'highpass', f: 5000, vol: 0.06, attack: 0.3, rev: 0.5 });
        break;
      case 'achievement':
        chime([67, 72, 76, 79], 0.1, 0.1, 1.2);
        this.tone({ type: 'sine', f: freq(55), at: 0.3, dur: 0.9, vol: 0.14, rev: 0.4 });
        break;
      case 'quest':
        chime([72, 79, 84], 0.09, 0.1, 1);
        break;
      case 'harvest':
        this.tone({ type: 'triangle', f: 500, f2: 1100, dur: 0.12, vol: 0.18 });
        this.hiss({ dur: 0.08, f: 1200, vol: 0.15 });
        break;
      case 'plant':
        this.tone({ type: 'triangle', f: 320, f2: 520, dur: 0.1, vol: 0.15 });
        break;
      case 'dig':
        this.hiss({ dur: 0.14, type: 'lowpass', f: 700, vol: 0.5 });
        this.tone({ type: 'sine', f: 120, f2: 60, dur: 0.12, vol: 0.2 });
        break;
      case 'water':
        for (let i = 0; i < 5; i++) this.tone({ type: 'sine', f: 900 + Math.random() * 900, f2: 400, at: i * 0.05, dur: 0.07, vol: 0.06 });
        this.hiss({ dur: 0.35, f: 2500, vol: 0.08, q: 2 });
        break;
      case 'mine':
        this.tone({ type: 'triangle', f: 2200, f2: 1700, dur: 0.18, vol: 0.12 });
        this.tone({ type: 'square', f: 3300, dur: 0.05, vol: 0.05 });
        this.hiss({ dur: 0.06, f: 3000, vol: 0.2 });
        break;
      case 'chop':
        this.tone({ type: 'square', f: 260, f2: 140, dur: 0.08, vol: 0.18 });
        this.hiss({ dur: 0.08, f: 900, vol: 0.25, q: 3 });
        break;
      case 'pick':
        this.tone({ type: 'triangle', f: 700, f2: 1000, dur: 0.08, vol: 0.12 });
        break;
      case 'splash':
        this.hiss({ dur: 0.35, type: 'lowpass', f: 2200, f2: 400, vol: 0.35 });
        break;
      case 'bite':
        this.bell(freq(88), 0, 0.2, 0.07, 0.1);
        this.bell(freq(88), 0.09, 0.2, 0.07, 0.1);
        break;
      case 'catch':
        chime([76, 79, 84, 88], 0.06, 0.09, 0.8);
        this.hiss({ dur: 0.3, type: 'lowpass', f: 2000, f2: 500, vol: 0.2 });
        break;
      case 'click':
        this.thump(900, 0, 0.04, 0.12);
        this.hiss({ dur: 0.02, type: 'highpass', f: 4000, vol: 0.06 });
        break;
      case 'open':
        this.tone({ type: 'sine', f: 420, f2: 760, dur: 0.09, vol: 0.12 });
        this.hiss({ dur: 0.12, type: 'bandpass', f: 1200, f2: 3000, q: 2, vol: 0.05, attack: 0.03 });
        break;
      case 'portal':
        this.tone({ type: 'sine', f: 200, f2: 1200, dur: 0.6, vol: 0.14, attack: 0.08, rev: 0.6 });
        this.hiss({ dur: 0.6, type: 'bandpass', f: 400, f2: 5000, q: 2, vol: 0.14, attack: 0.1, rev: 0.6 });
        chime([84, 91], 0.25, 0.06, 1);
        break;
      case 'telegraph':
        this.tone({ type: 'sawtooth', f: 70, f2: 110, dur: 0.9, vol: 0.15, attack: 0.2 });
        break;
      case 'boom':
        this.hiss({ dur: 0.9, type: 'lowpass', f: 1400, f2: 60, vol: 0.8, rev: 0.4 });
        this.tone({ type: 'sine', f: 90, f2: 30, dur: 0.7, vol: 0.55 });
        break;
      case 'craft':
        chime([79, 84], 0.08, 0.09, 0.7);
        this.thump(400, 0, 0.05, 0.15);
        break;
      case 'trade':
        chime([76, 81, 85], 0.07, 0.08, 0.8);
        break;
      case 'chat':
        this.tone({ type: 'sine', f: 1400, dur: 0.04, vol: 0.04 });
        break;
      case 'error':
        this.tone({ type: 'triangle', f: 220, f2: 160, dur: 0.18, vol: 0.12 });
        break;
    }
  }

  // --- Music -----------------------------------------------------------------

  /** Switch the background music (null = silence). Fades between tracks. */
  playMusic(track: string | null): void {
    this.wanted = track;
    if (!this.ctx) return;
    if (this.playing?.name === track) return;
    this.stopMusic();
    if (track) this.startMusic(track);
  }

  private stopMusic(): void {
    const p = this.playing;
    if (!p || !this.ctx) return;
    clearInterval(p.timer);
    p.out.gain.setTargetAtTime(0, this.ctx.currentTime, 0.4);
    setTimeout(() => p.out.disconnect(), 2500);
    this.playing = null;
  }

  private startMusic(name: string): void {
    const tr = TRACKS[name];
    const ctx = this.ctx;
    if (!tr || !ctx) return;
    const out = ctx.createGain();
    out.gain.value = 0;
    out.gain.setTargetAtTime(0.35 * tr.gain, ctx.currentTime, 0.8);
    // Warm the synths: gentle lowpass and a hall reverb send.
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 2600;
    lp.Q.value = 0.5;
    out.connect(lp).connect(this.bus.music!);
    this.wet(lp, 0.5, 'music');
    const beat = 60 / tr.bpm;
    const r = rng(tr.seed);
    // Pre-compose 8 bars of melody (8 eighth-notes per bar), reused with small variations.
    const bars = Math.max(8, tr.chords.length);
    const melody: (number | null)[][] = [];
    let deg = 4;
    for (let b = 0; b < bars; b++) {
      const bar: (number | null)[] = [];
      for (let s = 0; s < 8; s++) {
        if (r() > tr.density && s % 2 === 1) {
          bar.push(null);
          continue;
        }
        deg = Math.max(0, Math.min(tr.scale.length * 2, deg + Math.round((r() - 0.5) * 4)));
        bar.push(deg);
      }
      melody.push(bar);
    }
    const note = (degree: number, octave: number) => tr.root + 12 * (octave + Math.floor(degree / tr.scale.length)) + tr.scale[degree % tr.scale.length]!;
    let step = 0;
    let next = ctx.currentTime + 0.1;
    const play = (type: OscillatorType, midi: number, at: number, dur: number, vol: number, attack = 0.01) => {
      // Harsh waveforms become a soft two-voice blend (less chiptune, more instrument).
      const soft: OscillatorType = type === 'square' || type === 'sawtooth' ? 'triangle' : type;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, at);
      g.gain.exponentialRampToValueAtTime(vol, at + attack);
      g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
      g.connect(out);
      for (const [t, det, lvl] of [
        [soft, -6, 1],
        ['sine', 6, 0.6],
      ] as const) {
        const o = ctx.createOscillator();
        const og = ctx.createGain();
        o.type = t;
        o.frequency.value = freq(midi);
        o.detune.value = det;
        og.gain.value = lvl;
        o.connect(og).connect(g);
        o.start(at);
        o.stop(at + dur + 0.05);
      }
    };
    const drum = (at: number, kind: 'kick' | 'hat' | 'snare') => {
      if (kind === 'kick') {
        const o = ctx.createOscillator();
        const g = ctx.createGain();
        o.frequency.setValueAtTime(140, at);
        o.frequency.exponentialRampToValueAtTime(45, at + 0.12);
        g.gain.setValueAtTime(0.5, at);
        g.gain.exponentialRampToValueAtTime(0.0001, at + 0.15);
        o.connect(g).connect(out);
        o.start(at);
        o.stop(at + 0.2);
        return;
      }
      const src = ctx.createBufferSource();
      src.buffer = this.noise;
      const f = ctx.createBiquadFilter();
      f.type = kind === 'hat' ? 'highpass' : 'bandpass';
      f.frequency.value = kind === 'hat' ? 7000 : 1800;
      const g = ctx.createGain();
      g.gain.setValueAtTime(kind === 'hat' ? 0.03 : 0.12, at);
      g.gain.exponentialRampToValueAtTime(0.0001, at + (kind === 'hat' ? 0.04 : 0.12));
      src.connect(f).connect(g).connect(out);
      src.start(at, Math.random());
      src.stop(at + 0.15);
    };
    const schedule = () => {
      // A hidden tab throttles this timer but the audio clock keeps running. Without this
      // jump the loop would try to "catch up" every missed note at once (a burst of
      // thousands of sounds that freezes the page).
      if (next < ctx.currentTime) {
        const missed = Math.ceil((ctx.currentTime - next) / (beat / 2));
        step += missed;
        next += missed * (beat / 2);
      }
      while (next < ctx.currentTime + 0.4) {
        const bar = Math.floor(step / 8) % bars;
        const s = step % 8;
        const chord = tr.chords[bar % tr.chords.length]!;
        const at = next;
        // Bass on beats, chord pad at bar start, melody on eighths.
        if (s % 2 === 0) play(tr.bass, note(chord, -1) + (s === 4 ? 7 : 0), at, beat * 0.9, 0.16);
        if (s === 0) for (const k of [0, 2, 4]) play('sine', note(chord + k, 0), at, beat * 3.8, 0.04, beat * 0.8);
        const m = melody[bar]![s];
        if (m !== null && m !== undefined) play(tr.lead, note(m, 1), at, beat * 0.7, 0.05);
        if (tr.drums) {
          if (s === 0 || s === 4) drum(at, 'kick');
          if (s === 2 || s === 6) drum(at, 'snare');
          drum(at, 'hat');
        }
        step++;
        next += beat / 2;
      }
    };
    schedule();
    this.playing = { name, timer: setInterval(schedule, 100), out };
  }

  // --- Ambience (weather, night) ----------------------------------------------

  private ambientWanted: string | null = null;

  /** 'rain' | 'storm' | 'wind' | 'night' | null. */
  setAmbient(kind: string | null): void {
    this.ambientWanted = kind;
    if (!this.ctx || this.ambient?.kind === kind) return;
    const ctx = this.ctx;
    const old = this.ambient;
    if (old) {
      old.out.gain.setTargetAtTime(0, ctx.currentTime, 0.6);
      setTimeout(() => {
        old.nodes.forEach((n) => (n as AudioScheduledSourceNode).stop?.());
        old.out.disconnect();
      }, 3000);
    }
    this.ambient = null;
    if (!kind) return;
    const out = ctx.createGain();
    out.gain.value = 0;
    out.gain.setTargetAtTime(kind === 'night' ? 0.25 : 0.5, ctx.currentTime, 1.2);
    out.connect(this.bus.ambient!);
    const nodes: AudioNode[] = [];
    const loopNoise = (type: BiquadFilterType, f: number, q: number, vol: number) => {
      const src = ctx.createBufferSource();
      src.buffer = this.noise;
      src.loop = true;
      const filt = ctx.createBiquadFilter();
      filt.type = type;
      filt.frequency.value = f;
      filt.Q.value = q;
      const g = ctx.createGain();
      g.gain.value = vol;
      src.connect(filt).connect(g).connect(out);
      src.start();
      nodes.push(src);
      return { filt, g };
    };
    if (kind === 'rain' || kind === 'storm') {
      loopNoise('highpass', 1200, 0.5, kind === 'storm' ? 0.35 : 0.22);
      loopNoise('lowpass', 500, 0.7, kind === 'storm' ? 0.3 : 0.12);
    } else if (kind === 'wind') {
      const w = loopNoise('bandpass', 400, 0.8, 0.35);
      const lfo = ctx.createOscillator();
      const lg = ctx.createGain();
      lfo.frequency.value = 0.12;
      lg.gain.value = 250;
      lfo.connect(lg).connect(w.filt.frequency);
      lfo.start();
      nodes.push(lfo);
    } else if (kind === 'night') {
      // Crickets: a high, pulsing chirp.
      const o = ctx.createOscillator();
      o.frequency.value = 4400;
      const g = ctx.createGain();
      g.gain.value = 0;
      const lfo = ctx.createOscillator();
      lfo.type = 'square';
      lfo.frequency.value = 14;
      const lg = ctx.createGain();
      lg.gain.value = 0.02;
      lfo.connect(lg).connect(g.gain);
      o.connect(g).connect(out);
      o.start();
      lfo.start();
      nodes.push(o, lfo);
    }
    this.ambient = { kind, nodes, out };
  }

  /** Distant thunder (storms). */
  thunder(): void {
    if (!this.ready) return;
    this.hiss({ dur: 2.5, type: 'lowpass', f: 300, f2: 60, vol: 0.6, bus: 'ambient' });
  }
}

export const audio = new AudioManager();
