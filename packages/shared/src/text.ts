/** Characters that can be used to spoof or break chat rendering. */
const INVISIBLE_OR_BIDI = /[\u0000-\u001f\u007f-\u009f­؜ᅟᅠ឴឵᠎​-‏‪-‮⁠-⁯ㅤ︀-️﻿ﾠ]/g;

/**
 * Normalise user text for chat. Rendering is always done as plain text (never
 * HTML), so this is about stripping invisible/bidi tricks and bounding length.
 */
export function sanitizeChatText(input: unknown, maxLength: number): string {
  if (typeof input !== 'string') return '';
  const cleaned = input.normalize('NFC').replace(INVISIBLE_OR_BIDI, '').replace(/\s+/g, ' ').trim();
  // Limit by code points so we never cut a surrogate pair in half.
  return Array.from(cleaned).slice(0, maxLength).join('');
}
