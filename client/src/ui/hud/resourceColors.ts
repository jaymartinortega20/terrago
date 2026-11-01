/**
 * SPEC.md section 10: "class resource bar in the class color." Bar
 * colors are named per-resource there (Stamina amber, Momentum crimson,
 * Mana azure, Focus teal); M1's only playable job (Recruit) uses Stamina,
 * but the full map is filled in now since `self:state.resourceKind` is
 * already generic and the other three jobs arrive with no further HUD
 * work needed once they exist (M2).
 */
import type { ResourceKind } from '@terago/shared';

export const RESOURCE_BAR_COLORS: Record<ResourceKind, string> = {
  stamina: '#d9a441',
  momentum: '#c23b4f',
  mana: '#3b82c2',
  focus: '#2fb6a3',
};
