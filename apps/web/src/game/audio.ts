/**
 * Audio architecture: three independently controlled channels. v0.1 ships no
 * sound files yet; when they arrive, register them here and call play().
 */
export type AudioChannel = 'music' | 'effects' | 'ambient';

export interface AudioSettings {
  music: number;
  effects: number;
  ambient: number;
  muted: boolean;
}

const KEY = 'terrago:audio';
const DEFAULTS: AudioSettings = { music: 0.6, effects: 0.8, ambient: 0.5, muted: false };

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

class AudioManager {
  settings: AudioSettings = DEFAULTS;
  private sounds = new Map<string, { el: HTMLAudioElement; channel: AudioChannel }>();
  private music: { el: HTMLAudioElement; key: string } | null = null;

  init(): void {
    this.settings = loadAudioSettings();
  }

  register(key: string, url: string, channel: AudioChannel): void {
    const el = new Audio(url);
    el.preload = 'auto';
    this.sounds.set(key, { el, channel });
  }

  volumeFor(channel: AudioChannel): number {
    return this.settings.muted ? 0 : this.settings[channel];
  }

  play(key: string): void {
    const s = this.sounds.get(key);
    if (!s) return;
    const el = s.el.cloneNode(true) as HTMLAudioElement;
    el.volume = this.volumeFor(s.channel);
    void el.play().catch(() => {});
  }

  playMusic(key: string | null): void {
    if (this.music?.key === key) return;
    this.music?.el.pause();
    this.music = null;
    const s = key ? this.sounds.get(key) : undefined;
    if (!s || !key) return;
    s.el.loop = true;
    s.el.volume = this.volumeFor('music');
    void s.el.play().catch(() => {});
    this.music = { el: s.el, key };
  }

  update(settings: AudioSettings): void {
    this.settings = settings;
    saveAudioSettings(settings);
    if (this.music) this.music.el.volume = this.volumeFor('music');
  }
}

export const audio = new AudioManager();
