import { describe, expect, it } from 'vitest';
import { ANIM_FRAME_COUNTS, computePose } from './pose.js';

describe('ANIM_FRAME_COUNTS', () => {
  it('matches SPEC.md section 6 exactly', () => {
    expect(ANIM_FRAME_COUNTS).toEqual({
      idle: 4,
      walk: 6,
      attack: 4,
      cast: 4,
      hurt: 2,
      death: 4,
      wakeUp: 4,
      mounted: 1,
    });
  });
});

describe('computePose: determinism', () => {
  it('is a pure function of its inputs - same args, same result, every anim', () => {
    for (const [anim, count] of Object.entries(ANIM_FRAME_COUNTS)) {
      for (let i = 0; i < count; i++) {
        const a = computePose(anim as keyof typeof ANIM_FRAME_COUNTS, i, count);
        const b = computePose(anim as keyof typeof ANIM_FRAME_COUNTS, i, count);
        expect(a).toEqual(b);
      }
    }
  });
});

describe('computePose: idle', () => {
  it('bobs the head up and down with no limb swing, starting at rest', () => {
    const frame0 = computePose('idle', 0, 4);
    expect(frame0.headBobY).toBeCloseTo(0, 5);
    expect(frame0.armSwingL).toBe(0);
    expect(frame0.legSwingL).toBe(0);
    expect(frame0.opacity).toBe(1);

    for (let i = 0; i < 4; i++) {
      expect(Math.abs(computePose('idle', i, 4).headBobY)).toBeLessThanOrEqual(1.5 + 1e-9);
    }
  });
});

describe('computePose: walk', () => {
  it('swings the legs in exactly opposite phase at every frame', () => {
    for (let i = 0; i < 6; i++) {
      const pose = computePose('walk', i, 6);
      expect(pose.legSwingR).toBeCloseTo(-pose.legSwingL, 5);
    }
  });

  it('swings the arms opposite to the legs (counter-swing gait)', () => {
    for (let i = 0; i < 6; i++) {
      const pose = computePose('walk', i, 6);
      expect(pose.armSwingL).toBeCloseTo(-pose.legSwingL * 0.6, 5);
      expect(pose.armSwingR).toBeCloseTo(pose.legSwingL * 0.6, 5);
    }
  });

  it('never lifts a leg more than the swing amplitude', () => {
    for (let i = 0; i < 6; i++) {
      expect(Math.abs(computePose('walk', i, 6).legSwingL)).toBeLessThanOrEqual(22 + 1e-9);
    }
  });
});

describe('computePose: attack', () => {
  it('winds the weapon arm back on frame 0 and follows through forward on the last frame', () => {
    const first = computePose('attack', 0, 4);
    const last = computePose('attack', 3, 4);
    expect(first.armSwingR).toBeCloseTo(-50, 5);
    expect(last.armSwingR).toBeCloseTo(80, 5);
    expect(last.armSwingR).toBeGreaterThan(first.armSwingR);
  });

  it('keeps the weapon swing proportional to the arm swing', () => {
    for (let i = 0; i < 4; i++) {
      const pose = computePose('attack', i, 4);
      expect(pose.weaponSwingDeg).toBeCloseTo(pose.armSwingR * 1.4, 5);
    }
  });

  it('leans the body into the swing mid-attack, back to upright at both ends', () => {
    expect(computePose('attack', 0, 4).bodyTiltDeg).toBeCloseTo(0, 5);
    const midTilt = computePose('attack', 2, 4).bodyTiltDeg;
    expect(midTilt).toBeGreaterThan(0);
  });
});

describe('computePose: cast', () => {
  it('raises both arms symmetrically, more by the last frame than the first', () => {
    for (let i = 0; i < 4; i++) {
      const pose = computePose('cast', i, 4);
      expect(pose.armSwingL).toBe(pose.armSwingR);
    }
    expect(computePose('cast', 0, 4).armSwingL).toBeCloseTo(0, 5);
    expect(computePose('cast', 3, 4).armSwingL).toBeLessThan(0); // raised = negative per this rig's convention
  });
});

describe('computePose: hurt', () => {
  it('flinches back hardest on frame 0, settling partway toward neutral by the last frame', () => {
    const first = computePose('hurt', 0, 2);
    const last = computePose('hurt', 1, 2);
    expect(first.bodyTiltDeg).toBeLessThan(0);
    expect(Math.abs(last.bodyTiltDeg)).toBeLessThan(Math.abs(first.bodyTiltDeg));
  });
});

describe('computePose: death', () => {
  it('falls, sinks, and fades, but never below the "still visible" floor', () => {
    const first = computePose('death', 0, 4);
    const last = computePose('death', 3, 4);
    expect(first.bodyTiltDeg).toBeCloseTo(0, 5);
    expect(first.bodyScaleY).toBeCloseTo(1, 5);
    expect(first.opacity).toBeCloseTo(1, 5);

    expect(last.bodyTiltDeg).toBeCloseTo(80, 5);
    expect(last.bodyScaleY).toBeGreaterThan(0);
    expect(last.opacity).toBeGreaterThan(0);
    expect(last.bodyOffsetY).toBeGreaterThan(first.bodyOffsetY);
  });
});

describe('computePose: wakeUp', () => {
  it('starts lying down (mirrors death\'s end pose) and ends standing fully upright', () => {
    const deathEnd = computePose('death', 3, 4);
    const wakeStart = computePose('wakeUp', 0, 4);
    const wakeEnd = computePose('wakeUp', 3, 4);

    expect(wakeStart.bodyTiltDeg).toBeCloseTo(deathEnd.bodyTiltDeg, 5);
    expect(wakeStart.bodyScaleY).toBeCloseTo(deathEnd.bodyScaleY, 5);
    expect(wakeStart.opacity).toBeCloseTo(deathEnd.opacity, 5);

    expect(wakeEnd.bodyTiltDeg).toBeCloseTo(0, 5);
    expect(wakeEnd.bodyScaleY).toBeCloseTo(1, 5);
    expect(wakeEnd.opacity).toBeCloseTo(1, 5);
  });
});

describe('computePose: mounted', () => {
  it('holds one fixed seated pose, sitting slightly higher', () => {
    const pose = computePose('mounted', 0, 1);
    expect(pose.legSwingL).toBeGreaterThan(0);
    expect(pose.legSwingL).toBe(pose.legSwingR);
    expect(pose.bodyOffsetY).toBeLessThan(0);
  });
});
