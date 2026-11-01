/**
 * A tiny procedurally-synthesized chime (SPEC.md section 4: "Then a soft
 * chime plays" at the end of the story intro) via the Web Audio API - no
 * sound asset needed, consistent with this project's placeholder-art
 * approach of generating content in code rather than shipping binary
 * files for M1 (docs/DECISIONS.md covers the equivalent choice for the
 * visual placeholder art; the same reasoning applies here).
 */

let sharedContext: AudioContext | null = null;

function getContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  const Ctor =
    window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  if (!sharedContext) sharedContext = new Ctor();
  return sharedContext;
}

/**
 * Plays two soft, detuned sine tones with a slow fade-in/fade-out
 * envelope - a gentle "arrival" sound rather than a sharp notification
 * beep. Silently does nothing if Web Audio is unavailable, since this is
 * atmosphere, not a message the player must receive.
 */
export function playSoftChime(): void {
  const ctx = getContext();
  if (!ctx) return;
  if (ctx.state === 'suspended') void ctx.resume();

  const now = ctx.currentTime;
  const frequencies = [660, 880]; // a soft perfect-fifth-ish pair
  for (const freq of frequencies) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(0.08, now + 0.4);
    gain.gain.linearRampToValueAtTime(0, now + 2.2);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 2.3);
  }
}
