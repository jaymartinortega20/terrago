/**
 * AUTO mode's own scan/target/attack loop (SPEC.md section 8, task #82).
 * Runs entirely client-side and sends the exact same intents a manual
 * player would (target:set, hotbar:use) - the server validates and
 * executes them identically either way.
 *
 * Important scope note: once a target is set, Room.tickPlayerCombatAndInteraction
 * (server-authoritative) already chases into range and auto-attacks every
 * tick for as long as that target stays set - that's not new, it's the
 * same code path a manual click into combat already uses (confirmed live
 * - clicking a monster fights it to the death with no further input).
 * So this module's job is narrower than "fight the monster": decide
 * WHICH monster to target (and when to re-target), and separately,
 * whether to drink a potion - not reimplement combat itself.
 *
 * No server protocol change was needed to track "do I currently have a
 * target" - self:state doesn't carry targetId, so this tracks its own
 * belief instead (set whenever it - or a manual click relayed via
 * setTarget - sends target:set; cleared once that entity's snapshot
 * disappears from GameState.entities, which already happens exactly on
 * death/leave/a map change via WorldScene's scene.restart()).
 */
import {
  BALANCE,
  createTileGrid,
  distanceTiles,
  findPath,
  ITEMS,
  type ClientMessage,
  type MapDef,
  type TileGrid,
} from '@terago/shared';
import type { CombatResult, GameState, SelfState } from '../state/GameState.js';

/** Throttles how often a full re-scan (incl. pathfinding) runs - no need
 * to redo this every single frame when nothing has changed. */
const RETARGET_SCAN_INTERVAL_MS = 400;
/** How long a monster counts as "currently attacking the player" after
 * its last hit on them, for SPEC.md's target-priority rule. Reuses
 * combatStateDurationMs (the same "still in combat" window the server
 * itself uses) rather than inventing a separate number. */
const ATTACKING_ME_WINDOW_MS = BALANCE.combatStateDurationMs;
/** How long a monster counts as "another player is already fighting it"
 * after an observed hit from someone else, for the same rule's skip
 * clause. Shorter than the above - this is just "don't pile onto a fight
 * that only just happened", not a long-lived claim. */
const FOUGHT_BY_OTHER_WINDOW_MS = 4000;

interface NetLike {
  send(message: ClientMessage): void;
}

export class AutoLoop {
  private readonly grid: TileGrid;
  private currentTargetId: string | null = null;
  private lastManualInputAt = -Infinity;
  private lastScanAt = -Infinity;
  private lastPotionUseAt = -Infinity;
  private readonly monsterLastHitMeAt = new Map<string, number>();
  private readonly monsterLastHitByOtherAt = new Map<string, number>();
  private readonly unsubscribe: () => void;

  constructor(
    private readonly net: NetLike,
    private readonly gameState: GameState,
    map: MapDef
  ) {
    this.grid = createTileGrid(map);
    this.unsubscribe = gameState.onCombatResult.on((r) => this.trackCombatResult(r));
  }

  /** WorldScene calls this from every manual move/target action (clicks,
   * WASD). SPEC.md: "any manual move or target command takes over
   * immediately; AUTO resumes 2 seconds after the last manual input."
   * `nowMs` defaults to the real clock for WorldScene's call sites; tests
   * inject a controlled value so this stays comparable to the `nowMs`
   * passed into `update()`. */
  noteManualInput(nowMs: number = performance.now()): void {
    this.lastManualInputAt = nowMs;
  }

  /** WorldScene calls this when the PLAYER manually targets something
   * (not AUTO's own pick), so AUTO recognizes it as the active target
   * instead of immediately trying to retarget over it. */
  setManualTarget(entityId: string, nowMs: number = performance.now()): void {
    this.currentTargetId = entityId;
    this.noteManualInput(nowMs);
  }

  /** Call once every frame (WorldScene.update) with performance.now(). */
  update(nowMs: number): void {
    const self = this.gameState.self;
    if (!self || !self.autoOn) return;

    // Potion use isn't a targeting decision - it keeps running through a
    // manual-override window too (SPEC.md's Auto-Use Potions bullet makes
    // no mention of pausing for manual input, unlike the targeting rule).
    this.maybeUsePotion(nowMs, self);

    if (nowMs - this.lastManualInputAt < BALANCE.autoResumeDelayMs) return;
    if (self.autoConfig.autoTargetMobs) this.maybeRetarget(nowMs, self);
  }

  destroy(): void {
    this.unsubscribe();
  }

  // ------------------------------------------------------------ targeting

  private trackCombatResult(result: CombatResult): void {
    const self = this.gameState.self;
    if (!self || result.outcome === 'miss' || result.outcome === 'perfectDodge') return;
    const now = performance.now();
    const attacker = this.gameState.entities.get(result.attackerId);
    const defender = this.gameState.entities.get(result.defenderId);

    if (result.defenderId === self.characterId && attacker?.kind === 'monster') {
      this.monsterLastHitMeAt.set(result.attackerId, now);
    }
    if (result.attackerId !== self.characterId && attacker?.kind === 'player' && defender?.kind === 'monster') {
      this.monsterLastHitByOtherAt.set(result.defenderId, now);
    }
  }

  private maybeRetarget(nowMs: number, self: SelfState): void {
    // Still have a live target (whether AUTO's own pick or a manual one) -
    // Room.tickPlayerCombatAndInteraction keeps fighting it on its own.
    if (this.currentTargetId && this.gameState.entities.has(this.currentTargetId)) return;
    this.currentTargetId = null;

    if (nowMs - this.lastScanAt < RETARGET_SCAN_INTERVAL_MS) return;
    this.lastScanAt = nowMs;

    const local = this.gameState.localEntity();
    if (!local) return;

    let best: { id: string; pathLen: number; attackingMe: boolean } | null = null;
    for (const [id, snapshot] of this.gameState.entities) {
      if (snapshot.kind !== 'monster' || snapshot.hpPct <= 0) continue;
      if (distanceTiles(local, snapshot) > BALANCE.autoScanRadiusTiles) continue;

      const foughtByOther = (this.monsterLastHitByOtherAt.get(id) ?? -Infinity) > nowMs - FOUGHT_BY_OTHER_WINDOW_MS;
      if (foughtByOther) continue; // "skip monsters another player is already fighting"

      const path = findPath(this.grid, { x: Math.round(local.x), y: Math.round(local.y) }, { x: Math.round(snapshot.x), y: Math.round(snapshot.y) });
      if (!path) continue; // unreachable

      const attackingMe = (this.monsterLastHitMeAt.get(id) ?? -Infinity) > nowMs - ATTACKING_ME_WINDOW_MS;
      // Priority tier first (attacking-me beats not), path distance breaks ties within a tier.
      if (
        !best ||
        (attackingMe && !best.attackingMe) ||
        (attackingMe === best.attackingMe && path.length < best.pathLen)
      ) {
        best = { id, pathLen: path.length, attackingMe };
      }
    }

    if (best) {
      this.currentTargetId = best.id;
      this.net.send({ t: 'target:set', entityId: best.id });
    }
  }

  // ------------------------------------------------------------ potions

  private maybeUsePotion(nowMs: number, self: SelfState): void {
    if (nowMs - this.lastPotionUseAt < BALANCE.autoPotionCooldownMs) return;

    const hpPct = self.maxHp > 0 ? (self.hp / self.maxHp) * 100 : 100;
    const resourcePct = self.maxResource > 0 ? (self.resource / self.maxResource) * 100 : 100;
    const needsHp = self.autoConfig.autoUsePotionsHpPct !== null && hpPct < self.autoConfig.autoUsePotionsHpPct;
    const needsResource =
      self.autoConfig.autoUsePotionsResourcePct !== null && resourcePct < self.autoConfig.autoUsePotionsResourcePct;
    if (!needsHp && !needsResource) return;

    const slot = this.findPotionSlot(self, needsHp, needsResource);
    if (slot === null) return;

    this.lastPotionUseAt = nowMs;
    this.net.send({ t: 'hotbar:use', slot });
  }

  /** "Use the first matching consumable on the hotbar" (SPEC.md section 8),
   * scanned in slot order (1-8). Only an HP need can currently be matched -
   * shared/config/items.ts has no resource-restoring consumable yet (only
   * `potion_hp_small` exists in M1), so a resource-only need simply finds
   * nothing to use, same as hitting an empty hotbar: a real gap to close
   * once such an item exists, not a bug in this logic. */
  private findPotionSlot(self: SelfState, needsHp: boolean, needsResource: boolean): number | null {
    for (let i = 0; i < self.hotbar.length; i++) {
      const binding = self.hotbar[i];
      if (!binding || binding.type !== 'item' || binding.qty <= 0) continue;
      const def = ITEMS[binding.id];
      if (!def) continue;
      if (needsHp && def.healHp) return i + 1;
      // No resource-restoring consumable exists in ItemDef/items.ts yet, so
      // a resource-only need (needsResource with needsHp false) can never
      // match anything here - intentional, not a missed case.
    }
    return null;
  }
}
