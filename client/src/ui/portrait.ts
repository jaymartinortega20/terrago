/**
 * The HUD status block's "chibi portrait rendered live from the
 * character's paper-doll layers" (SPEC.md section 7) - a static "idle,
 * facing down, frame 0" composite of the SAME pure canvas-2D drawers
 * in-game sprites use (`generators/paperDoll.ts` via
 * `paperDollManifest.ts`'s `LAYER_DRAWERS`), drawn straight into a real
 * DOM `<canvas>` rather than going through Phaser's texture manager - the
 * HUD is a plain DOM overlay with no Phaser dependency of its own.
 * Re-drawn only when equipment actually changes (the caller's job), since
 * a static idle frame never needs a per-frame redraw.
 */
import type { EquipmentSlot } from '@terago/shared';
import { computePose } from '../assets/generators/pose.js';
import { LAYER_DRAWERS, PAPER_DOLL_COMPOSITE_ORDER, type PaperDollLayer } from '../assets/paperDollManifest.js';

/** Mirrors EntityView.update()'s equip-gating: body/head/hair always draw
 * (there's no "unequip your face"); weapon/helmet/chest/boots only draw
 * when that slot actually has something equipped. Wings are drawn
 * separately by in-game sprites but have no portrait presence here -
 * SPEC.md's status block description names only the character, not a
 * wings flourish, so the portrait stays a plain bust shot. */
const GATED_SLOTS: ReadonlySet<PaperDollLayer> = new Set(['weapon', 'helmet', 'chest', 'boots']);

export function drawPortrait(canvas: HTMLCanvasElement, equipment: Partial<Record<EquipmentSlot, string | null>>): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  const pose = computePose('idle', 0);
  for (const layer of PAPER_DOLL_COMPOSITE_ORDER) {
    if (GATED_SLOTS.has(layer) && !equipment[layer as EquipmentSlot]) continue;
    LAYER_DRAWERS[layer](ctx, 'down', pose);
  }
}
