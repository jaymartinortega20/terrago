/** Geometric-ish EXP curve: level 1->2 costs `first`, each later step scales by `growth`. */
function buildExpCurve(levels: number, first: number, growth: number): number[] {
  const curve: number[] = [];
  let need = first;
  for (let i = 0; i < levels; i++) {
    curve.push(Math.round(need));
    need *= growth;
  }
  return curve;
}

export const BALANCE = {
  // ---- progression (SPEC.md section 9) ----
  startingStatPoints: 10,
  statPointsPerLevel: 5,
  maxManualStatPoints: 100,
  maxBaseLevel: 100,
  maxJobLevelRecruit: 10,
  maxJobLevelAdvanced: 50,

  // EXP curves - index 0 = exp needed to go from level 1 to 2, etc.
  // Tuned toward the "Base Lv 10 in about 30 minutes" pacing target in SPEC.md section 5;
  // revisit with real playtest data in the M5 balance pass.
  baseExpCurve: buildExpCurve(100, 35, 1.09),
  jobExpCurveRecruit: buildExpCurve(10, 40, 1.12),
  jobExpCurveAdvanced: buildExpCurve(50, 50, 1.07),

  // ---- combat (SPEC.md section 9) ----
  critDamageMultiplier: 1.4,
  minHitChancePct: 5,
  maxHitChancePct: 95,
  damageVarianceMin: 0.95,
  damageVarianceMax: 1.05,
  minAttackIntervalMs: 300,
  combatStateDurationMs: 6000,

  // ---- fast casting (SPEC.md section 9) ----
  castFixedPortion: 0.2,
  castVariablePortion: 0.8,
  fastCastDexThreshold: 50,

  // ---- AUTO mode (SPEC.md section 8) ----
  autoScanRadiusTiles: 20,
  autoResumeDelayMs: 2000,
  autoPotionCooldownMs: 1000,

  // ---- mount (SPEC.md section 7) ----
  mountSpeedMultiplier: 1.5,

  // ---- server (SPEC.md section 2) ----
  tickRateHz: 20,
  autosaveIntervalMs: 60_000,
  areaOfInterestMarginTiles: 4,

  // ---- refining (SPEC.md section 11): index 0 = +1 ... index 9 = +10 ----
  refineSuccessChancePct: [100, 100, 100, 100, 80, 65, 50, 35, 20, 10],
} as const;
