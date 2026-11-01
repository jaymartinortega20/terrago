/**
 * Pure procedural pose math for the paper-doll rig (SPEC.md section 6).
 * Every layer (body/hair/weapon/helmet/chest/boots/wings) draws from the
 * SAME Pose for a given (anim, frameIndex) so they stay visually in sync
 * without each layer re-deriving its own timing - deliberately kept
 * framework-free (no Phaser, no canvas) so it's cheap to unit test and the
 * draw functions in paperDoll.ts stay pure "numbers in, pixels out".
 *
 * Units: angles in degrees (converted to radians only at draw time, since
 * degrees are easier to reason about and test against), offsets in pixels
 * on the 64x64 frame.
 */

export type AnimName = 'idle' | 'walk' | 'attack' | 'cast' | 'hurt' | 'death' | 'wakeUp' | 'mounted';

/** SPEC.md section 6: "idle (4 frames), walk (6), attack (4), cast (4),
 * hurt (2), death (4), wake-up (4), plus a mounted pose." Mounted isn't
 * described as a counted animation, so it's a single held frame. */
export const ANIM_FRAME_COUNTS: Record<AnimName, number> = {
  idle: 4,
  walk: 6,
  attack: 4,
  cast: 4,
  hurt: 2,
  death: 4,
  wakeUp: 4,
  mounted: 1,
};

export interface Pose {
  /** Vertical bob of the whole upper body/head, px (negative = up). */
  headBobY: number;
  /** Degrees, positive = swings forward. */
  armSwingL: number;
  armSwingR: number;
  /** Degrees, positive = steps forward. */
  legSwingL: number;
  legSwingR: number;
  /** Degrees of whole-body lean, positive = forward/into the action. */
  bodyTiltDeg: number;
  /** 1 = normal height; death squashes this down toward the ground. */
  bodyScaleY: number;
  /** Extra vertical offset, px (positive = lower on the frame) - death
   * sinking down, wakeUp rising up out of it. */
  bodyOffsetY: number;
  /** Degrees the weapon swings beyond the hand's own armSwingR, for the
   * attack arc's follow-through. */
  weaponSwingDeg: number;
  /** 0-1. Death fades out partway (not to fully invisible - a "defeated,
   * still there" read); wakeUp fades back in. Every other anim is 1. */
  opacity: number;
}

const NEUTRAL: Pose = {
  headBobY: 0,
  armSwingL: 0,
  armSwingR: 0,
  legSwingL: 0,
  legSwingR: 0,
  bodyTiltDeg: 0,
  bodyScaleY: 1,
  bodyOffsetY: 0,
  weaponSwingDeg: 0,
  opacity: 1,
};

function phase(frameIndex: number, frameCount: number): number {
  return frameCount <= 1 ? 0 : frameIndex / frameCount;
}

/** Linear 0..1 progress through the animation (distinct from `phase`,
 * which wraps for looping anims) - used by one-shot anims like attack,
 * hurt, death and wakeUp where frame 0 and the last frame are meaningfully
 * different endpoints, not two points on a loop. */
function progress(frameIndex: number, frameCount: number): number {
  return frameCount <= 1 ? 0 : frameIndex / (frameCount - 1);
}

export function computePose(anim: AnimName, frameIndex: number, frameCount: number = ANIM_FRAME_COUNTS[anim]): Pose {
  switch (anim) {
    case 'idle': {
      // A slow, gentle breathing bob - one full cycle over the loop.
      const t = phase(frameIndex, frameCount);
      return { ...NEUTRAL, headBobY: -Math.sin(t * Math.PI * 2) * 1.5 };
    }

    case 'walk': {
      // Legs swing in opposite phase (a stride), arms counter-swing
      // opposite the legs (natural gait), body bobs twice per stride
      // (once per footfall).
      const t = phase(frameIndex, frameCount);
      const theta = t * Math.PI * 2;
      const legSwing = Math.sin(theta) * 22;
      return {
        ...NEUTRAL,
        legSwingL: legSwing,
        legSwingR: -legSwing,
        armSwingL: -legSwing * 0.6,
        armSwingR: legSwing * 0.6,
        headBobY: -Math.abs(Math.sin(theta)) * 1.5,
      };
    }

    case 'attack': {
      // A single wind-up-to-strike arc: the weapon arm (right) winds back,
      // then whips forward past neutral on the follow-through, with the
      // body leaning into the swing.
      const t = progress(frameIndex, frameCount);
      const swing = -50 + 130 * t; // -50deg (wound back) -> +80deg (follow-through)
      return {
        ...NEUTRAL,
        armSwingR: swing,
        weaponSwingDeg: swing * 1.4,
        armSwingL: -15 * t, // off-arm braces forward slightly
        bodyTiltDeg: 10 * Math.sin(t * Math.PI), // leans in mid-swing, back out by the end
      };
    }

    case 'cast': {
      // Both arms gradually raise to chest height, holding by the last frame.
      const t = progress(frameIndex, frameCount);
      const raise = -55 * t;
      return { ...NEUTRAL, armSwingL: raise, armSwingR: raise, headBobY: -2 * t };
    }

    case 'hurt': {
      // A quick flinch back on frame 0, settling partway toward neutral by
      // the last frame (2 frames total per SPEC.md - this never fully
      // resets within the anim; the next anim picked after `hurt` ends
      // takes it back to neutral).
      const t = progress(frameIndex, frameCount);
      const flinch = 14 * (1 - t);
      return { ...NEUTRAL, bodyTiltDeg: -flinch, headBobY: flinch * 0.5 };
    }

    case 'death': {
      // Falls over and sinks, fading most but not all of the way out.
      const t = progress(frameIndex, frameCount);
      return {
        ...NEUTRAL,
        bodyTiltDeg: 80 * t,
        bodyScaleY: 1 - 0.65 * t,
        bodyOffsetY: 10 * t,
        opacity: 1 - 0.6 * t,
      };
    }

    case 'wakeUp': {
      // The reverse of death: starts lying down, rises to a normal stand.
      const t = progress(frameIndex, frameCount);
      const lying = 1 - t;
      return {
        ...NEUTRAL,
        bodyTiltDeg: 80 * lying,
        bodyScaleY: 1 - 0.65 * lying,
        bodyOffsetY: 10 * lying,
        opacity: 1 - 0.6 * lying,
      };
    }

    case 'mounted': {
      // A fixed seated pose: legs bent forward and up, sitting a little
      // higher off the ground.
      return { ...NEUTRAL, legSwingL: 35, legSwingR: 35, bodyOffsetY: -3 };
    }
  }
}
