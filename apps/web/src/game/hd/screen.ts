/** Device pixels per CSS pixel the game renders at (capped for speed). */
export function renderDpr(): number {
  if (typeof window === 'undefined') return 1;
  return Math.max(1, Math.min(2, window.devicePixelRatio || 1));
}

/** Resolution for canvas text so names stay sharp when zoomed in. */
export const TEXT_RES = 3;
