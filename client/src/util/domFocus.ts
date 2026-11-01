/**
 * SPEC.md section 7: "Game keys are ignored while the chat box has
 * focus." Shared by WorldScene (WASD/click) and the HUD (1-8, I, Caps
 * Lock, R, Esc) so both agree on what counts as "typing somewhere" - any
 * real text input, not just the one chat box, in case Settings ever adds
 * more (username/keybind fields, etc).
 */
export function isTextInputFocused(): boolean {
  const el = document.activeElement;
  return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA');
}
