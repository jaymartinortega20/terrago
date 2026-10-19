import type { Axis, MoveInput } from '@terrago/shared';

/**
 * Shared input state. Keyboard is read by the Phaser scene; the on-screen
 * joystick (mobile) writes here from React.
 */
export const touchInput = {
  joyX: 0,
  joyY: 0,
  active: false,
};

/** Convert an analogue joystick vector into an 8-way movement input. */
export function joystickToInput(x: number, y: number): MoveInput {
  const len = Math.hypot(x, y);
  if (len < 0.3) return { dx: 0, dy: 0 };
  const angle = Math.atan2(y, x);
  const octant = Math.round(angle / (Math.PI / 4));
  const dirs: [Axis, Axis][] = [
    [1, 0],
    [1, 1],
    [0, 1],
    [-1, 1],
    [-1, 0],
    [-1, -1],
    [0, -1],
    [1, -1],
  ];
  const [dx, dy] = dirs[(octant + 8) % 8]!;
  return { dx, dy };
}

/** True while the user is typing in a text field (game keys must be ignored). */
export function isTyping(): boolean {
  const el = document.activeElement;
  return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || (el as HTMLElement).isContentEditable);
}
