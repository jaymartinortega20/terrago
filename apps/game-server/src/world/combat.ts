import { getClass, getItem, getJob, getMonster, getSkillDef } from '@terrago/game-data';

const RESOURCE_NAME = { mana: 'Mana', rage: 'Rage', energy: 'Energy' } as const;

/** How each companion fights: damage multiplier, attack interval, crit bonus, heals. */
const COMPANIONS: Record<string, { mult: number; everyMs: number; crit?: number; heal?: boolean }> = {
  dog: { mult: 0.5, everyMs: 2200 },
  cat: { mult: 0.7, everyMs: 1800 },
  fox: { mult: 0.75, everyMs: 1800, crit: 15 },
  slime: { mult: 0.3, everyMs: 2500, heal: true },
  dragonling: { mult: 1.05, everyMs: 2000 },
  hawk: { mult: 1.0, everyMs: 1600, crit: 10 },
};
import {
  PET_LOYALTY_LOW,
  PET_LOYALTY_SKILL,
  PET_SKILL2_LEVEL,
  archetypeOf,
  petStats,
  OUT_OF_COMBAT_MS,
  PLAYER_BODY,
  SIM,
  TILE_SIZE,
  WEAKNESS,
  WEAKNESS_MS,
  difficultyOf,
  effectMult,
  monsterStats,
  rollHit,
  stepMovement,
  tileCenter,
  type ActiveEffect,
  type CombatEvent,
  type Direction,
  type MonsterDef,
  type MonsterStats,
  type PublicMonster,
  type SpawnDef,
  effectSum,
} from '@terrago/shared';
import type { Player } from './player';
import type { MapRuntime } from './world';

/**
 * Real-time PvE combat, fully server-side: monster AI, attacks, skills,
 * effects (buffs, debuffs, damage over time), regeneration, death.
 * Clients only send "attack X" / "use skill Y on X"; the server checks
 * range, cooldowns, MP, and rolls every number.
 */

export class Monster {
  readonly kind = 'monster' as const;
  hp: number;
  dir: Direction = 'down';
  state: 'idle' | 'chase' | 'return' | 'dead' = 'idle';
  targetId: string | null = null;
  nextAttackAt = 0;
  nextThinkAt = 0;
  wander: { x: number; y: number } | null = null;
  respawnAt = 0;
  lastMovedAt = 0;
  effects: ActiveEffect[] = [];
  /** Damage dealt by each player (XP share, loot owner). */
  damageBy = new Map<string, number>();
  // --- Bosses ---------------------------------------------------------------
  /** Summoned add: removed for good when it dies. */
  temp = false;
  /** World event that spawned it (invasions). */
  eventTag: string | null = null;
  /** Next use time per timed ability, and HP thresholds already triggered. */
  abilityAt = new Map<string, number>();
  triggered = new Set<string>();
  casting: { ability: import('@terrago/shared').BossAbility; x: number; y: number; at: number } | null = null;
  enraged = 1;
  adds: Monster[] = [];
  /** Rare elite variant (more HP and damage, better loot). */
  elite = false;
  /** Exploders: blowing up at this time. Chargers: dashing until. */
  fuseAt = 0;
  chargeUntil = 0;

  constructor(
    readonly id: string,
    readonly def: MonsterDef,
    readonly level: number,
    public stats: MonsterStats,
    public x: number,
    public y: number,
    readonly spawn: SpawnDef,
  ) {
    this.hp = stats.maxHp;
  }

  get alive(): boolean {
    return this.state !== 'dead';
  }

  isMoving(now: number): boolean {
    return now - this.lastMovedAt < 150;
  }

  toPublic(): PublicMonster {
    return {
      kind: 'monster',
      id: this.id,
      monsterId: this.def.id,
      name: this.elite ? `Elite ${this.def.name}` : this.def.name,
      level: this.level,
      hp: this.hp,
      maxHp: this.stats.maxHp,
      x: this.x,
      y: this.y,
      dir: this.dir,
      ...(this.def.boss ? { boss: true } : {}),
      ...(this.elite ? { elite: true } : {}),
    };
  }
}

export interface KillReward {
  /** Dungeon difficulty the kill happened on. */
  difficulty?: string;
  player: Player;
  xp: number;
  gold: number;
  items: { itemId: string; quantity: number }[];
  monster: Monster;
}

export interface CombatHooks {
  /** A monster died: hand out rewards (async DB work). */
  onKill?: (rewards: KillReward[]) => void;
  /** A player died. */
  onDeath?: (p: Player) => void;
  /** Wear equipment (equip slot indices) after enough hits. */
  onWear?: (p: Player, slots: number[]) => void;
  /** Respawn: move the player somewhere. */
  respawn?: (p: Player) => void;
  /** A duel was won (loser is left at 1 HP). */
  onDuelEnd?: (winner: Player, loser: Player) => void;
  /** Party members (including the player) — they share kill XP and quest credit. */
  partyOf?: (p: Player) => Player[];
  /** Riding players get off when they fight. */
  dismount?: (p: Player) => void;
  /** A hit lands on a rider (or someone getting on): knock them off and slow them. */
  knockedOff?: (p: Player) => void;
  /** The player's companion changed and its saved growth isn't loaded yet. */
  loadCompanion?: (p: Player) => void;
  /** Tell everyone in a runtime something (boss shouts, telegraphs). */
  announce?: (rt: MapRuntime, text: string) => void;
  telegraph?: (rt: MapRuntime, t: { id: string; x: number; y: number; r: number; ms: number; name: string }) => void;
}

const TILE = TILE_SIZE;
const dist = (ax: number, ay: number, bx: number, by: number) => Math.hypot(ax - bx, ay - by);
const facing = (dx: number, dy: number): Direction => (Math.abs(dx) > Math.abs(dy) ? (dx < 0 ? 'left' : 'right') : dy < 0 ? 'up' : 'down');

function randomTileIn(rt: MapRuntime, area: SpawnDef['area'], rand: () => number): { x: number; y: number } | null {
  for (let i = 0; i < 40; i++) {
    const tx = area.x + Math.floor(rand() * area.w);
    const ty = area.y + Math.floor(rand() * area.h);
    const c = tileCenter(tx, ty);
    if (!rt.grid.bodyBlocked(c.x, c.y)) return c;
  }
  return null;
}

export class Combat {
  private seq = 0;
  /** Combat events per runtime, flushed every tick. */
  private pending = new Map<MapRuntime, CombatEvent[]>();

  constructor(
    private readonly hooks: CombatHooks,
    private readonly now: () => number,
    private readonly rand: () => number = Math.random,
  ) {}

  spawnMonsters(rt: MapRuntime): void {
    const diff = rt.def.dungeon ? difficultyOf(rt.owner?.id) : null;
    for (const sp of rt.def.spawns ?? []) {
      const def = getMonster(sp.monster);
      if (!def) continue;
      for (let i = 0; i < sp.count; i++) {
        const pos = randomTileIn(rt, sp.area, this.rand);
        if (!pos) continue;
        const level = Math.min(100, sp.level[0] + Math.floor(this.rand() * (sp.level[1] - sp.level[0] + 1)) + (diff?.levels ?? 0));
        const base = monsterStats(def, level);
        const stats = diff ? { ...base, maxHp: Math.round(base.maxHp * diff.hp), atk: Math.round(base.atk * diff.atk), xp: Math.round(base.xp * (1 + (diff.lootRolls - 1) * 0.25)) } : base;
        const m = new Monster(`m${++this.seq}`, def, level, stats, pos.x, pos.y, sp);
        this.rollElite(rt, m, stats);
        rt.monsters.set(m.id, m);
      }
    }
  }

  /** 1 in 25 ordinary monsters (outside dungeons) spawns as an Elite: 3× HP, 1.5× damage, 4× EXP, extra loot. */
  private rollElite(rt: MapRuntime, m: Monster, base: MonsterStats): void {
    m.elite = !m.def.boss && !m.temp && !m.eventTag && !rt.def.dungeon && this.rand() < 0.04;
    m.stats = m.elite ? { ...base, maxHp: base.maxHp * 3, atk: Math.round(base.atk * 1.5), xp: base.xp * 4 } : base;
    m.hp = m.stats.maxHp;
  }

  private emit(rt: MapRuntime, e: CombatEvent): void {
    let list = this.pending.get(rt);
    if (!list) this.pending.set(rt, (list = []));
    list.push(e);
  }

  // ---------------------------------------------------------------------------
  // Tick
  // ---------------------------------------------------------------------------

  tick(rt: MapRuntime, dtMs: number): void {
    const now = this.now();
    for (const m of rt.monsters.values()) this.think(rt, m, dtMs, now);
    for (const p of rt.players) this.playerTick(rt, p, dtMs, now);
    const events = this.pending.get(rt);
    if (events?.length) {
      this.pending.delete(rt);
      for (const p of rt.players) if (p.conn && !p.changingMap) p.conn.send('combat', events);
    }
  }

  private think(rt: MapRuntime, m: Monster, dtMs: number, now: number): void {
    if (m.state === 'dead') {
      if (m.temp) {
        rt.monsters.delete(m.id);
        return;
      }
      if (now >= m.respawnAt) {
        const pos = randomTileIn(rt, m.spawn.area, this.rand);
        if (pos) {
          m.x = pos.x;
          m.y = pos.y;
        }
        this.rollElite(rt, m, monsterStats(m.def, m.level));
        m.state = 'idle';
        m.effects = [];
        m.damageBy.clear();
        m.targetId = null;
        m.fuseAt = 0;
        m.chargeUntil = 0;
        if (!m.def.abilities) m.abilityAt.clear();
        this.resetBoss(rt, m);
      }
      return;
    }
    // Effects: damage over time, expiry.
    if (m.effects.length) {
      for (const e of m.effects) {
        if (e.mods.dot && e.until > now && (e.nextTick ?? 0) <= now) {
          e.nextTick = now + 1000;
          const src = e.source ? [...rt.players].find((p) => p.id === e.source) : undefined;
          this.damageMonster(rt, m, Math.round(e.mods.dot), src ?? null, 'dot');
          if (!m.alive) return;
        }
      }
      m.effects = m.effects.filter((e) => e.until > now);
    }

    const target = m.targetId ? [...rt.players].find((p) => p.id === m.targetId) : undefined;
    const home = m.spawn.area;
    const homeX = (home.x + home.w / 2) * TILE;
    const homeY = (home.y + home.h / 2) * TILE;
    const leash = (Math.max(home.w, home.h) / 2 + 10) * TILE;

    if (m.state === 'chase') {
      if (!target || target.dead || target.changingMap || dist(m.x, m.y, homeX, homeY) > leash || dist(m.x, m.y, target.x, target.y) > 20 * TILE) {
        m.state = 'return';
        m.targetId = null;
      } else {
        if (m.def.abilities && this.bossTick(rt, m, target, now)) return;
        if (m.def.behavior && this.behaviorTick(rt, m, target, now)) return;
        const d = dist(m.x, m.y, target.x, target.y);
        if (d <= m.def.range * TILE && (m.def.range <= 2 || rt.grid.lineOfSight(m.x, m.y - 8, target.x, target.y - 12))) {
          m.dir = facing(target.x - m.x, target.y - m.y);
          if (now >= m.nextAttackAt) {
            m.nextAttackAt = now + m.def.cooldownMs;
            this.monsterAttack(rt, m, target, now);
          }
        } else this.moveToward(rt, m, target.x, target.y, dtMs, now, m.chargeUntil > now ? 3.2 : 1);
        return;
      }
    }
    if (m.state === 'return') {
      if (dist(m.x, m.y, homeX, homeY) < 2 * TILE) {
        m.state = 'idle';
        m.hp = m.stats.maxHp;
        m.damageBy.clear();
        this.resetBoss(rt, m);
      } else this.moveToward(rt, m, homeX, homeY, dtMs, now, 1.5);
      return;
    }
    // Idle: look for prey, otherwise wander.
    if (m.def.aggro > 0 && now >= m.nextThinkAt) {
      m.nextThinkAt = now + 400;
      let best: Player | null = null;
      let bestD = m.def.aggro * TILE;
      for (const p of rt.players) {
        if (p.dead || p.changingMap) continue;
        const d = dist(m.x, m.y, p.x, p.y);
        if (d < bestD) {
          best = p;
          bestD = d;
        }
      }
      if (best) {
        m.state = 'chase';
        m.targetId = best.id;
        return;
      }
    }
    if (!m.wander && this.rand() < dtMs / 4000) {
      const pos = randomTileIn(rt, { x: Math.max(home.x, Math.floor(m.x / TILE) - 3), y: Math.max(home.y, Math.floor(m.y / TILE) - 3), w: 7, h: 7 }, this.rand);
      if (pos) m.wander = pos;
    }
    if (m.wander) {
      if (dist(m.x, m.y, m.wander.x, m.wander.y) < 4 || !this.moveToward(rt, m, m.wander.x, m.wander.y, dtMs, now, 0.5)) m.wander = null;
    }
  }

  /** Step toward a point using the same collision rules as players. Returns false if stuck. */
  private moveToward(rt: MapRuntime, m: Monster, tx: number, ty: number, dtMs: number, now: number, speedMult = 1): boolean {
    const dx = tx - m.x;
    const dy = ty - m.y;
    const ax = Math.abs(dx) > 3 ? (Math.sign(dx) as -1 | 1) : 0;
    const ay = Math.abs(dy) > 3 ? (Math.sign(dy) as -1 | 1) : 0;
    if (!ax && !ay) return false;
    const speed = m.def.speed * speedMult * effectMult(m.effects, 'slow', now);
    let next = stepMovement({ x: m.x, y: m.y }, { dx: ax, dy: ay }, rt.grid, speed, dtMs);
    if (next.x === m.x && next.y === m.y && ax && ay) {
      next = stepMovement({ x: m.x, y: m.y }, { dx: ax, dy: 0 }, rt.grid, speed, dtMs);
      if (next.x === m.x) next = stepMovement({ x: m.x, y: m.y }, { dx: 0, dy: ay }, rt.grid, speed, dtMs);
    }
    if (next.x === m.x && next.y === m.y) return false;
    m.dir = facing(next.x - m.x, next.y - m.y);
    m.x = next.x;
    m.y = next.y;
    m.lastMovedAt = now;
    return true;
  }

  private monsterAttack(rt: MapRuntime, m: Monster, p: Player, now: number): void {
    const def = m.def.magic ? p.profile.derived.magicDefense : p.profile.derived.physicalDefense;
    const res = rollHit(
      { level: m.level, atk: m.stats.atk * m.enraged * effectMult(m.effects, 'dmg', now), accuracy: m.stats.accuracy * effectMult(m.effects, 'acc', now), critChance: 5, critDamage: 150 },
      { level: p.rec.level, def, evasion: p.profile.derived.evasion * effectMult(p.effects, 'eva', now) },
      1,
      this.rand,
    );
    p.lastCombatAt = now;
    // A companion defends its owner: it goes for whatever is attacking them.
    if (!p.fightTarget || !rt.monsters.get(p.fightTarget)?.alive) p.fightTarget = m.id;
    // LUK: perfect dodge (0.1% per point, up to 20%) ignores the hit entirely.
    const perfectDodge = Math.min(0.2, p.profile.stats.luck * 0.001);
    if (res.miss || this.rand() < perfectDodge) return this.emit(rt, { s: m.id, t: p.id, a: 0, k: 'miss' });
    const dmg = Math.round(res.damage * effectMult(p.effects, 'taken', now));
    // The pet draws some attacks onto itself (aggro draw); tanks take them better.
    if (this.petIntercept(rt, p, m, dmg, now)) return;
    this.damagePlayer(rt, p, dmg, m.id, res.crit ? 'crit' : 'hit');
  }

  /** The active companion's state, created with defaults (and loaded in the background) when it changed. */
  companion(p: Player): import('./player').PetState | null {
    const id = p.companionId();
    if (!id) return null;
    if (p.petState?.id === id) return p.petState;
    const kind = id === 'hawk' ? 'hawk' : (getItem(id)?.pet?.kind ?? 'dog');
    p.petState = { id, kind, level: 1, xp: 0, loyalty: 50, growth: {}, kills: 0, hp: petStats(kind, 1).maxHp, koUntil: 0, attacks: 0, tauntUntil: 0, stub: true };
    this.hooks.loadCompanion?.(p);
    return p.petState;
  }

  /** Aggro draw: the pet may take a monster's hit instead of its owner. */
  private petIntercept(rt: MapRuntime, p: Player, m: Monster, dmg: number, now: number): boolean {
    const st = this.companion(p);
    if (!st || st.koUntil > now) return false;
    const stats = petStats(st.kind, st.level);
    const chance = st.tauntUntil > now ? 100 : stats.aggro;
    if (this.rand() * 100 >= chance) return false;
    const taken = Math.max(1, Math.round(dmg * (archetypeOf(st.kind).role === 'tank' ? 0.6 : 1)));
    st.hp = Math.max(0, st.hp - taken);
    this.emit(rt, { s: m.id, t: p.id, a: taken, k: 'hit', sk: 'petguard' });
    if (st.hp <= 0) {
      st.koUntil = now + 20_000;
      st.tauntUntil = 0;
      p.conn?.send('notice', { kind: 'error', text: 'Your companion was knocked out! It will be back in 20 seconds.' });
    }
    this.sendPet(p, now, true);
    return true;
  }

  /** Push the pet's health to its owner (throttled unless forced). */
  private sendPet(p: Player, now: number, force = false): void {
    const st = p.petState;
    if (!st || !p.conn) return;
    if (!force && (st.hp === st.sentHp || now - (st.sentAt ?? 0) < 500)) return;
    st.sentHp = st.hp;
    st.sentAt = now;
    p.conn.send('pet:hp', { hp: st.hp, maxHp: petStats(st.kind, st.level).maxHp, koUntil: st.koUntil });
  }

  /**
   * Pets and the Beastmaster's hawk fight alongside their owner: every couple
   * of seconds they hit the monster the owner is fighting. Kill credit and loot
   * go to the owner. The slime pet heals instead of biting hard.
   */
  private companionTick(rt: MapRuntime, p: Player, now: number): void {
    const st = this.companion(p);
    if (!st) return;
    const maxHp = petStats(st.kind, st.level).maxHp;
    // Back on its feet after a knock-out; heals up out of combat.
    if (st.koUntil && now >= st.koUntil) {
      st.koUntil = 0;
      st.hp = Math.max(st.hp, Math.round(maxHp * 0.5));
      this.sendPet(p, now, true);
    }
    if (st.hp > maxHp) st.hp = maxHp;
    if (now - p.lastCombatAt > OUT_OF_COMBAT_MS && st.hp < maxHp && !st.koUntil) {
      st.hp = Math.min(maxHp, st.hp + Math.ceil(maxHp * 0.01));
      this.sendPet(p, now);
    }
    if (now < p.companionNextAt || rt.def.safeZone || st.koUntil > now) return;
    if (now - p.lastCombatAt > 8000) return;
    const m = p.fightTarget ? rt.monsters.get(p.fightTarget) : undefined;
    if (!m?.alive || dist(p.x, p.y, m.x, m.y) > 7 * TILE) return;
    const hawk = st.kind === 'hawk';
    const spec = COMPANIONS[st.kind] ?? COMPANIONS.dog!;
    p.companionNextAt = now + spec.everyMs;
    st.attacks++;
    // Skill tiers: tier 2 from pet level 20 (every 4th attack), tier 3 at loyalty 80+ (every 7th).
    const tier = st.loyalty >= PET_LOYALTY_SKILL && st.attacks % 7 === 0 ? 3 : st.level >= PET_SKILL2_LEVEL && st.attacks % 4 === 0 ? 2 : 1;
    const role = archetypeOf(st.kind).role;
    let mult = 1;
    let forceCrit = false;
    if (tier === 2) {
      if (st.kind === 'dog') st.tauntUntil = now + 3000;
      else if (st.kind === 'slime') this.shieldOwner(p, 0.05, now);
      else if (st.kind === 'fox' || hawk) forceCrit = true;
      else mult = 2;
    } else if (tier === 3) {
      if (st.kind === 'dog') this.shieldOwner(p, 0.08, now);
      else if (st.kind === 'cat') this.healOwner(rt, p, 0.06);
      else if (st.kind === 'slime') this.healOwner(rt, p, 0.12);
      else mult = 3;
    }
    const crit = forceCrit || this.rand() * 100 < 5 + (spec.crit ?? 0);
    const atk = petStats(st.kind, st.level).atk;
    const lowLoyalty = st.loyalty < PET_LOYALTY_LOW ? 0.5 : 1;
    const base = (6 + atk * 1.6) * spec.mult * mult * lowLoyalty * (crit ? 1.5 : 1) * (0.85 + this.rand() * 0.3);
    const dmg = Math.max(1, Math.round(base * effectMult(m.effects, 'taken', now)));
    this.damageMonster(rt, m, dmg, p, crit || tier > 1 ? 'crit' : 'hit', hawk ? 'hawk' : 'pet');
    const leech = st.growth.leech ?? 0;
    if (leech && !p.dead && p.rec.hp < p.profile.maxHp) {
      const amount = Math.max(1, Math.round(dmg * leech * 0.04));
      p.rec.hp = Math.min(p.profile.maxHp, p.rec.hp + amount);
      this.emit(rt, { s: p.id, t: p.id, a: amount, k: 'heal', sk: 'pet' });
    }
    if (spec.heal && !p.dead && role === 'support') this.healOwner(rt, p, 0.02);
  }

  private healOwner(rt: MapRuntime, p: Player, pct: number): void {
    if (p.dead) return;
    const amount = Math.max(1, Math.round(p.profile.maxHp * pct));
    p.rec.hp = Math.min(p.profile.maxHp, p.rec.hp + amount);
    this.emit(rt, { s: p.id, t: p.id, a: amount, k: 'heal', sk: 'pet' });
  }

  private shieldOwner(p: Player, pct: number, now: number): void {
    const amount = Math.max(1, Math.round(p.profile.maxHp * pct));
    p.effects = [...p.effects.filter((e) => e.id !== 'pet_shield'), { id: 'pet_shield', name: 'Pet Shield', until: now + 8000, mods: { shield: amount } }];
    this.pushEffects(p);
  }

  damagePlayer(rt: MapRuntime, p: Player, amount: number, source: string, kind: CombatEvent['k']): void {
    const now = this.now();
    if (kind === 'hit' || kind === 'crit') this.gainRage(p, 4);
    let dmg = amount;
    for (const e of p.effects) {
      if (dmg <= 0) break;
      if (e.until > now && e.mods.shield && e.mods.shield > 0) {
        const absorbed = Math.min(e.mods.shield, dmg);
        e.mods.shield -= absorbed;
        dmg -= absorbed;
      }
    }
    if (dmg > 0 && (p.mount || p.mountChannel)) this.hooks.knockedOff?.(p);
    p.rec.hp = Math.max(0, p.rec.hp - dmg);
    this.emit(rt, { s: source, t: p.id, a: dmg, k: kind });
    if (++p.hitsTaken >= 12) {
      p.hitsTaken = 0;
      this.hooks.onWear?.(p, [2 + Math.floor(this.rand() * 4)]); // head/chest/gloves/boots
    }
    if (p.rec.hp <= 0) this.killPlayer(rt, p, now);
  }

  private killPlayer(rt: MapRuntime, p: Player, now: number): void {
    p.dead = true;
    p.respawnAt = now + 3000;
    p.inputs = [];
    p.effects = [];
    this.emit(rt, { s: p.id, t: p.id, a: 0, k: 'death' });
    for (const m of rt.monsters.values()) if (m.targetId === p.id) {
      m.state = 'return';
      m.targetId = null;
    }
    p.conn?.send('notice', { kind: 'error', text: 'You were defeated. Your gear took some damage.' });
    this.hooks.onDeath?.(p);
  }

  private playerTick(rt: MapRuntime, p: Player, dtMs: number, now: number): void {
    if (p.dead) {
      if (now >= p.respawnAt) {
        p.dead = false;
        p.rec.hp = Math.round(p.profile.maxHp * 0.5);
        p.rec.mp = Math.round(p.profile.maxMp * 0.5);
        p.effects = [{ ...WEAKNESS, mods: { ...WEAKNESS.mods }, until: now + WEAKNESS_MS }];
        this.hooks.respawn?.(p);
        this.pushEffects(p);
      }
      return;
    }
    const before = p.effects.length;
    p.effects = p.effects.filter((e) => e.until > now);
    if (p.effects.length !== before) this.pushEffects(p);
    this.companionTick(rt, p, now);
    // Regeneration: fast out of combat, slow in it; Blessing adds more.
    const ooc = now - p.lastCombatAt > OUT_OF_COMBAT_MS;
    const sec = dtMs / 1000;
    let hpRegen = p.profile.maxHp * (ooc ? 0.03 * (p.pet === 'pet_slime' ? 1.2 : 1) : 0.004) * sec * (1 + (getJob(p.rec.job)?.passive.regenPct ?? 0) / 100);
    for (const e of p.effects) if (e.mods.regen) hpRegen += e.mods.regen * sec;
    // Mana regenerates; Energy refills quickly; Rage drains away once the fight is over.
    const resource = getClass(p.rec.classId).resource;
    const mpRegen = resource === 'energy' ? 12 * sec : resource === 'rage' ? (ooc ? -6 * sec : 0) : p.profile.maxMp * (ooc ? 0.03 : 0.008) * sec;
    p.regenCarry += hpRegen;
    const whole = Math.floor(p.regenCarry);
    p.regenCarry -= whole;
    p.rec.hp = Math.min(p.profile.maxHp, p.rec.hp + whole);
    p.mpCarry = (p.mpCarry ?? 0) + mpRegen;
    const mpWhole = Math.floor(p.mpCarry);
    p.mpCarry -= mpWhole;
    p.rec.mp = Math.max(0, Math.min(p.profile.maxMp, p.rec.mp + mpWhole));
    if ((p.rec.hp !== p.sentHp || p.rec.mp !== p.sentMp) && now - (p.lastVitalsAt ?? 0) > 200) {
      p.sentHp = p.rec.hp;
      p.sentMp = p.rec.mp;
      p.lastVitalsAt = now;
      p.conn?.send('self:update', { hp: p.rec.hp, mp: p.rec.mp });
    }
  }

  pushEffects(p: Player): void {
    const now = this.now();
    const cooldowns: Record<string, number> = {};
    for (const [k, v] of p.cooldowns) if (v > now) cooldowns[k] = v;
    p.conn?.send('effects', { effects: p.effects.filter((e) => e.until > now).map((e) => ({ id: e.id, name: e.name, until: e.until })), cooldowns });
  }

  // ---------------------------------------------------------------------------
  // Player actions
  // ---------------------------------------------------------------------------

  private attackerOf(p: Player, magic: boolean, now: number) {
    const d = p.profile.derived;
    return {
      level: p.rec.level,
      atk: (magic ? d.magicAttack : d.physicalAttack) * effectMult(p.effects, 'dmg', now),
      accuracy: d.accuracy,
      critChance: d.criticalChance + (p.petState && p.petState.id === p.companionId() ? (p.petState.growth.crit ?? 0) : 0),
      critDamage: d.criticalDamage,
    };
  }

  private inReach(p: Player, m: { x: number; y: number }, rangeTiles: number): boolean {
    // Half a tile of slack for latency (the client sees monsters slightly in the past).
    return dist(p.x, p.y - PLAYER_BODY.height / 2, m.x, m.y - 6) <= (rangeTiles + 0.6) * TILE;
  }

  /** Ranged attacks need a clear line: trees, rocks and walls block arrows and spells. */
  private canSee(rt: MapRuntime, p: { x: number; y: number }, t: { x: number; y: number }, rangeTiles: number): boolean {
    if (rangeTiles <= 2) return true;
    return rt.grid.lineOfSight(p.x, p.y - 12, t.x, t.y - 8);
  }

  /** Heavy blows shove monsters back a little (never through walls; bosses don't budge). */
  private knockback(rt: MapRuntime, from: { x: number; y: number }, m: Monster): void {
    if (m.def.boss || !m.alive) return;
    const d = dist(from.x, from.y, m.x, m.y) || 1;
    const nx = m.x + ((m.x - from.x) / d) * 14;
    const ny = m.y + ((m.y - from.y) / d) * 14;
    if (!rt.grid.bodyBlocked(nx, ny)) {
      m.x = nx;
      m.y = ny;
      m.lastMovedAt = this.now();
    }
  }

  /** The current duel opponent, if `id` is one. */
  private duelTarget(rt: MapRuntime, p: Player, id: unknown): Player | undefined {
    if (typeof id !== 'string' || !p.duel || p.duel.with.id !== id) return undefined;
    const q = p.duel.with;
    return rt.players.has(q) && !q.dead ? q : undefined;
  }

  private strikePlayer(rt: MapRuntime, p: Player, q: Player, magic: boolean, mult: number, skill: string | undefined, now: number): void {
    const qd = q.profile.derived;
    const res = rollHit(this.attackerOf(p, magic, now), { level: q.rec.level, def: magic ? qd.magicDefense : qd.physicalDefense, evasion: qd.evasion * effectMult(q.effects, 'eva', now) }, mult, this.rand);
    p.lastCombatAt = now;
    q.lastCombatAt = now;
    if (res.miss) return this.emit(rt, { s: p.id, t: q.id, a: 0, k: 'miss', ...(skill ? { sk: skill } : {}) });
    const dmg = Math.min(q.rec.hp - 1, Math.round(res.damage * effectMult(q.effects, 'taken', now)));
    q.rec.hp -= Math.max(0, dmg);
    this.emit(rt, { s: p.id, t: q.id, a: Math.max(0, dmg), k: res.crit ? 'crit' : 'hit', ...(skill ? { sk: skill } : {}) });
    if (q.rec.hp <= 1) this.hooks.onDuelEnd?.(p, q);
  }

  /** A basic weapon attack. Returns the cooldown to show, or an error message. */
  attack(rt: MapRuntime, p: Player, targetId: unknown): { cooldownMs: number } | string {
    const now = this.now();
    if (p.dead) return "You can't fight right now.";
    const w = p.profile.weapon;
    const foe = this.duelTarget(rt, p, targetId);
    if (foe) {
      if (!this.inReach(p, foe, w.range)) return 'Too far away.';
      if (!this.canSee(rt, p, foe, w.range)) return 'No line of sight.';
      if (now < p.nextAttackAt) return 'cooldown';
      p.nextAttackAt = now + w.speedMs - 60;
      this.hooks.dismount?.(p);
      this.strikePlayer(rt, p, foe, w.magic, 1, undefined, now);
      return { cooldownMs: w.speedMs };
    }
    if (rt.def.safeZone) return 'No fighting here.';
    const m = typeof targetId === 'string' ? rt.monsters.get(targetId) : undefined;
    if (!m || !m.alive) return 'No target.';
    if (!this.inReach(p, m, w.range)) return 'Too far away.';
    if (!this.canSee(rt, p, m, w.range)) return 'No line of sight.';
    if (now < p.nextAttackAt) return 'cooldown';
    p.nextAttackAt = now + w.speedMs - 60;
    p.lastCombatAt = now;
    this.hooks.dismount?.(p);
    this.strike(rt, p, m, w.magic, 1, undefined, now);
    if (++p.hitsDealt >= 10) {
      p.hitsDealt = 0;
      this.hooks.onWear?.(p, [0]);
    }
    return { cooldownMs: w.speedMs };
  }

  /** Warriors build Rage by fighting (out of 100). */
  private gainRage(p: Player, n: number): void {
    if (getClass(p.rec.classId).resource !== 'rage') return;
    p.rec.mp = Math.min(p.profile.maxMp, p.rec.mp + n);
  }

  private strike(rt: MapRuntime, p: Player, m: Monster, magic: boolean, mult: number, skill: string | undefined, now: number): void {
    const atk = this.attackerOf(p, magic, now);
    atk.critChance += effectSum(m.effects, 'critTaken', now);
    const res = rollHit(atk, { level: m.level, def: magic ? m.stats.def * 0.8 : m.stats.def, evasion: m.stats.evasion }, mult, this.rand);
    p.fightTarget = m.id;
    if (!res.miss && !skill) this.gainRage(p, res.crit ? 10 : 6);
    if (m.state === 'idle' || m.state === 'return') {
      m.state = 'chase';
      m.targetId = p.id;
    }
    if (res.miss) return this.emit(rt, { s: p.id, t: m.id, a: 0, k: 'miss', ...(skill ? { sk: skill } : {}) });
    const dmg = Math.round(res.damage * effectMult(m.effects, 'taken', now));
    this.damageMonster(rt, m, dmg, p, res.crit ? 'crit' : 'hit', skill);
    if ((res.crit && p.profile.weapon.range <= 2) || (skill && KNOCKBACK_SKILLS.has(skill))) this.knockback(rt, p, m);
  }

  private damageMonster(rt: MapRuntime, m: Monster, dmg: number, by: Player | null, kind: CombatEvent['k'], skill?: string): void {
    const real = Math.min(m.hp, dmg);
    m.hp -= real;
    if (by) m.damageBy.set(by.id, (m.damageBy.get(by.id) ?? 0) + real);
    this.emit(rt, { s: by?.id ?? m.id, t: m.id, a: dmg, k: kind, ...(skill ? { sk: skill } : {}) });
    if (m.hp <= 0) this.killMonster(rt, m);
  }

  private killMonster(rt: MapRuntime, m: Monster): void {
    m.state = 'dead';
    m.respawnAt = rt.def.dungeon ? Infinity : this.now() + m.def.respawnMs;
    m.casting = null;
    if (m.def.boss || m.def.behavior === 'summoner') for (const a of m.adds) if (a.alive) this.killQuietly(rt, a);
    this.emit(rt, { s: m.id, t: m.id, a: 0, k: 'death' });
    const total = [...m.damageBy.values()].reduce((a, b) => a + b, 0);
    if (total <= 0) return;
    const contributors = [...m.damageBy.entries()]
      .map(([id, d]) => ({ p: [...rt.players].find((x) => x.id === id), d }))
      .filter((c): c is { p: Player; d: number } => !!c.p && !c.p.dead && dist(c.p.x, c.p.y, m.x, m.y) < 25 * TILE);
    if (!contributors.length) return;
    const top = contributors.reduce((a, b) => (b.d > a.d ? b : a));
    // Group contributors into units: a party (with its nearby members) or a solo player.
    // Each unit earns XP for its share of the damage; a party splits it evenly with a bonus.
    const units = new Map<string, { members: Set<Player>; d: number }>();
    for (const c of contributors) {
      const party = this.hooks.partyOf?.(c.p) ?? [c.p];
      const key = party.length > 1 ? `party:${[...party].map((x) => x.id).sort()[0]}` : c.p.id;
      const u = units.get(key) ?? { members: new Set<Player>(), d: 0 };
      u.d += c.d;
      for (const x of party) if (x === c.p || (rt.players.has(x) && !x.dead && dist(x.x, x.y, m.x, m.y) < 25 * TILE)) u.members.add(x);
      units.set(key, u);
    }
    const strangers = units.size > 1 ? 1.15 : 1;
    const rewards: KillReward[] = [];
    for (const u of units.values()) {
      const n = u.members.size;
      const bonus = n > 1 ? 1 + 0.12 * (n - 1) : 1;
      const each = (m.stats.xp * (u.d / total) * bonus * strangers) / n;
      for (const p of u.members) {
        // Monsters far below your level are worth little ("grey" monsters).
        const below = p.rec.level - m.level;
        const lf = below > 5 ? Math.max(0.1, 1 - 0.15 * (below - 5)) : 1;
        rewards.push({ player: p, xp: Math.max(1, Math.round(each * lf)), gold: 0, items: [], monster: m });
      }
    }
    // Bosses give everyone their own loot roll; other monsters reward the top damage dealer.
    const looters = m.def.boss ? rewards : [rewards.find((r) => r.player === top.p)!];
    const [g0, g1] = m.def.gold;
    // Harder dungeon modes roll the loot table more than once.
    const rolls = rt.def.dungeon ? difficultyOf(rt.owner?.id).lootRolls : 1;
    for (const loot of looters) {
      loot.gold = Math.round((g0 + this.rand() * (g1 - g0)) * (1 + m.level * 0.08) * rolls);
      // LUK slightly raises drop chances (+0.2% of the base chance per point, at most +40%).
      const luck = 1 + Math.min(0.4, (loot.player.profile.stats.luck ?? 0) * 0.002);
      const eliteRolls = m.elite ? 3 : 1;
      for (let k = 0; k < rolls * eliteRolls; k++)
        for (const d of m.def.drops) if (this.rand() < d.chance * luck) loot.items.push({ itemId: d.itemId, quantity: d.min + Math.floor(this.rand() * (d.max - d.min + 1)) });
      if (m.elite) {
        loot.gold *= 3;
        loot.items.push({ itemId: 'enhancement_stone', quantity: 1 + Math.floor(this.rand() * 2) });
      }
    }
    if (rt.def.dungeon) for (const r of rewards) r.difficulty = difficultyOf(rt.owner?.id).id;
    this.hooks.onKill?.(rewards);
  }

  // ---------------------------------------------------------------------------
  // Monster behaviours
  // ---------------------------------------------------------------------------

  /** Healers, summoners, exploders and chargers. Returns true when it used its turn. */
  private behaviorTick(rt: MapRuntime, m: Monster, target: Player, now: number): boolean {
    const d = dist(m.x, m.y, target.x, target.y);
    switch (m.def.behavior) {
      case 'healer': {
        if (now < (m.abilityAt.get('heal') ?? 0)) return false;
        let best: Monster | null = null;
        for (const o of rt.monsters.values()) {
          if (!o.alive || o.hp >= o.stats.maxHp * 0.8 || dist(o.x, o.y, m.x, m.y) > 5 * TILE) continue;
          if (!best || o.hp / o.stats.maxHp < best.hp / best.stats.maxHp) best = o;
        }
        if (!best) return false;
        m.abilityAt.set('heal', now + 4000);
        const amount = Math.round(best.stats.maxHp * 0.12);
        best.hp = Math.min(best.stats.maxHp, best.hp + amount);
        this.emit(rt, { s: m.id, t: best.id, a: amount, k: 'heal', sk: 'monster_heal' });
        return true;
      }
      case 'summoner': {
        const next = m.abilityAt.get('summon');
        if (next === undefined) {
          m.abilityAt.set('summon', now + 3000); // first call a few seconds into the fight
          return false;
        }
        if (now < next) return false;
        m.adds = m.adds.filter((a) => a.alive);
        m.abilityAt.set('summon', now + 10_000);
        if (m.adds.length >= 2 || !m.def.summon) return false;
        this.summonAdds(rt, m, { id: 'summon', name: 'Summon', kind: 'summon', monster: m.def.summon, count: 2, level: Math.max(1, m.level - 4) });
        this.emit(rt, { s: m.id, t: m.id, a: 0, k: 'cast', sk: 'monster_summon' });
        return true;
      }
      case 'exploder': {
        if (m.fuseAt) {
          if (now < m.fuseAt) return true; // standing still, fizzing
          m.fuseAt = 0;
          const r = 2 * TILE;
          this.emit(rt, { s: m.id, t: m.id, a: 0, k: 'cast', sk: 'monster_explode' });
          for (const p of [...rt.players]) {
            if (p.dead || dist(p.x, p.y, m.x, m.y) > r) continue;
            this.damagePlayer(rt, p, Math.max(1, Math.round(m.stats.atk * 2.5 * effectMult(p.effects, 'taken', now))), m.id, 'crit');
          }
          if (m.alive) this.damageMonster(rt, m, m.hp, null, 'hit');
          return true;
        }
        if (d <= 1.6 * TILE) {
          m.fuseAt = now + 900;
          this.hooks.telegraph?.(rt, { id: `fuse:${m.id}`, x: m.x, y: m.y, r: 2, ms: 900, name: `${m.def.name} is about to explode!` });
          return true;
        }
        return false;
      }
      case 'charger': {
        if (d > 3 * TILE && d < 7 * TILE && now >= (m.abilityAt.get('charge') ?? 0)) {
          m.abilityAt.set('charge', now + 6000);
          m.chargeUntil = now + 700;
          this.emit(rt, { s: m.id, t: target.id, a: 0, k: 'cast', sk: 'monster_charge' });
        }
        return false;
      }
    }
    return false;
  }

  // ---------------------------------------------------------------------------
  // Bosses
  // ---------------------------------------------------------------------------

  private resetBoss(rt: MapRuntime, m: Monster): void {
    if (!m.def.abilities) return;
    m.abilityAt.clear();
    m.triggered.clear();
    m.casting = null;
    m.enraged = 1;
    for (const a of m.adds) if (a.alive) this.killQuietly(rt, a);
    m.adds = [];
  }

  /** Remove a monster without rewards (boss adds when the fight resets). */
  private killQuietly(rt: MapRuntime, a: Monster): void {
    a.state = 'dead';
    a.respawnAt = Infinity;
    this.emit(rt, { s: a.id, t: a.id, a: 0, k: 'death' });
    if (a.temp) rt.monsters.delete(a.id);
  }

  /** Run boss mechanics. Returns true while the boss is busy (winding up), so it doesn't move or attack. */
  private bossTick(rt: MapRuntime, m: Monster, target: Player, now: number): boolean {
    if (m.casting) {
      if (now < m.casting.at) return true;
      const { ability: a, x, y } = m.casting;
      m.casting = null;
      const r = (a.radius ?? 2) * TILE;
      for (const p of rt.players) {
        if (p.dead || p.changingMap || dist(p.x, p.y - 10, x, y) > r) continue;
        const def = p.profile.derived.physicalDefense;
        const raw = m.stats.atk * m.enraged * (a.dmgMult ?? 1.5) * (100 / (100 + def * 1.5));
        p.lastCombatAt = now;
        this.damagePlayer(rt, p, Math.max(1, Math.round(raw * effectMult(p.effects, 'taken', now) * (0.9 + this.rand() * 0.2))), m.id, 'crit');
      }
      return true;
    }
    const frac = m.hp / m.stats.maxHp;
    for (const a of m.def.abilities ?? []) {
      // Threshold abilities (summons, enrage) fire once each.
      for (const t of a.atHp ?? []) {
        const key = `${a.id}@${t}`;
        if (frac > t || m.triggered.has(key)) continue;
        m.triggered.add(key);
        if (a.kind === 'summon') this.summonAdds(rt, m, a);
        if (a.kind === 'enrage') m.enraged = a.dmg ?? 1.5;
        this.hooks.announce?.(rt, a.kind === 'enrage' ? `${m.def.name} flies into a rage!` : `${m.def.name}: ${a.name}!`);
      }
      if (a.kind === 'harden' && a.everyMs) {
        if (frac > (a.belowHp ?? 1)) continue;
        const nextH = m.abilityAt.get(a.id) ?? 0;
        if (now < nextH) continue;
        m.abilityAt.set(a.id, now + a.everyMs);
        m.effects.push({ id: a.id, name: a.name, until: now + (a.durationMs ?? 8000), mods: { taken: a.taken ?? 0.3 } });
        this.hooks.announce?.(rt, `${m.def.name}: ${a.name}! Damage barely scratches it — survive until it fades.`);
        continue;
      }
      if (!a.everyMs || (a.kind !== 'slam' && a.kind !== 'nova')) continue;
      const next = m.abilityAt.get(a.id);
      if (next === undefined) {
        m.abilityAt.set(a.id, now + a.everyMs * (0.4 + this.rand() * 0.3));
        continue;
      }
      if (now < next) continue;
      m.abilityAt.set(a.id, now + a.everyMs);
      const at = a.kind === 'slam' ? { x: target.x, y: target.y - 10 } : { x: m.x, y: m.y - 10 };
      const ms = a.windupMs ?? 1500;
      m.casting = { ability: a, x: at.x, y: at.y, at: now + ms };
      this.hooks.telegraph?.(rt, { id: m.id, x: at.x, y: at.y, r: (a.radius ?? 2) * TILE, ms, name: a.name });
      return true;
    }
    return false;
  }

  /** Spawn event monsters (invasions). They never respawn. */
  spawnEvent(rt: MapRuntime, tag: string, monsterId: string, level: [number, number], count: number, area: SpawnDef['area']): number {
    const def = getMonster(monsterId);
    if (!def) return 0;
    let n = 0;
    for (let i = 0; i < count; i++) {
      const pos = randomTileIn(rt, area, this.rand);
      if (!pos) continue;
      const lv = level[0] + Math.floor(this.rand() * (level[1] - level[0] + 1));
      const m = new Monster(`m${++this.seq}`, def, lv, monsterStats(def, lv), pos.x, pos.y, { monster: def.id, level, count: 1, area });
      m.temp = true;
      m.eventTag = tag;
      rt.monsters.set(m.id, m);
      n++;
    }
    return n;
  }

  /** Remove what's left of an event's monsters. */
  despawnEvent(rt: MapRuntime, tag: string): void {
    for (const m of [...rt.monsters.values()]) if (m.eventTag === tag && m.alive) this.killQuietly(rt, m);
  }

  private summonAdds(rt: MapRuntime, boss: Monster, a: import('@terrago/shared').BossAbility): void {
    const def = getMonster(a.monster ?? '');
    if (!def) return;
    const level = a.level ?? boss.level - 3;
    for (let i = 0; i < (a.count ?? 2); i++) {
      const area = { x: Math.floor(boss.x / TILE) - 3, y: Math.floor(boss.y / TILE) - 3, w: 7, h: 7 };
      const pos = randomTileIn(rt, area, this.rand);
      if (!pos) continue;
      const add = new Monster(`m${++this.seq}`, def, level, monsterStats(def, level), pos.x, pos.y, { monster: def.id, level: [level, level], count: 1, area });
      add.temp = true;
      add.state = 'chase';
      add.targetId = boss.targetId;
      rt.monsters.set(add.id, add);
      boss.adds.push(add);
    }
  }

  /** Use a class skill. */
  useSkill(rt: MapRuntime, p: Player, skillId: unknown, targetId: unknown, findPlayer: (id: string) => Player | undefined): { cooldownMs: number } | string {
    const now = this.now();
    const sk = typeof skillId === 'string' ? getSkillDef(skillId) : undefined;
    if (!sk || sk.classId !== p.rec.classId) return "You don't know that skill.";
    if (p.rec.level < sk.level) return `${sk.name} unlocks at level ${sk.level}.`;
    if (sk.job && p.rec.job !== sk.job) return `${sk.name} is a ${getJob(sk.job)?.name ?? sk.job} skill.`;
    if (p.dead) return "You can't do that right now.";
    if ((p.cooldowns.get(sk.id) ?? 0) > now) return 'cooldown';
    if (p.rec.mp < sk.mp) return `Not enough ${RESOURCE_NAME[getClass(p.rec.classId).resource]}.`;
    const intel = p.profile.stats.intelligence;
    const scale = (v: number, by?: 'int' | 'str') => (by === 'int' ? Math.round(v * intel) : by === 'str' ? Math.round(v * Math.max(4, p.profile.derived.physicalAttack * 0.25)) : v);
    const monster = typeof targetId === 'string' ? rt.monsters.get(targetId) : undefined;
    const foe = this.duelTarget(rt, p, targetId);
    const fighting = sk.kind === 'attack' || sk.kind === 'aoe' || sk.kind === 'debuff';
    if (fighting && rt.def.safeZone && !foe) return 'No fighting here.';
    if (fighting) this.hooks.dismount?.(p);
    if (foe && (sk.kind === 'attack' || sk.kind === 'debuff')) {
      const reach = Math.max(sk.range, p.profile.weapon.range);
      if (!this.inReach(p, foe, reach)) return 'Too far away.';
      if (!this.canSee(rt, p, foe, reach)) return 'No line of sight.';
      if (sk.kind === 'attack') this.strikePlayer(rt, p, foe, sk.magic, sk.mult, sk.id, now);
      else if (sk.effect) this.emit(rt, { s: p.id, t: foe.id, a: 0, k: 'cast', sk: sk.id });
      if (sk.kind !== 'attack' && sk.effect) foe.effects = [...foe.effects.filter((e) => e.id !== sk.effect!.id), { id: sk.effect.id, name: sk.effect.name, until: now + sk.effect.durationMs, mods: { ...sk.effect.mods } }];
      p.rec.mp -= sk.mp;
      p.cooldowns.set(sk.id, now + sk.cooldownMs);
      this.pushEffects(p);
      this.pushEffects(foe);
      return { cooldownMs: sk.cooldownMs };
    }

    switch (sk.kind) {
      case 'attack':
      case 'debuff': {
        if (!monster?.alive) return 'Pick a target first.';
        if (!this.inReach(p, monster, Math.max(sk.range, p.profile.weapon.range))) return 'Too far away.';
        if (!this.canSee(rt, p, monster, Math.max(sk.range, p.profile.weapon.range))) return 'No line of sight.';
        if (sk.kind === 'attack') this.strike(rt, p, monster, sk.magic, sk.mult, sk.id, now);
        else {
          this.emit(rt, { s: p.id, t: monster.id, a: 0, k: 'cast', sk: sk.id });
          if (monster.state !== 'chase') {
            monster.state = 'chase';
            monster.targetId = p.id;
          }
        }
        if (sk.effect && monster.alive) {
          monster.effects = monster.effects.filter((e) => e.id !== sk.effect!.id);
          const mods = { ...sk.effect.mods };
          if (mods.dot) mods.dot = scale(mods.dot, sk.effect.scale);
          monster.effects.push({ id: sk.effect.id, name: sk.effect.name, until: now + sk.effect.durationMs, mods, source: p.id, nextTick: now + 1000 });
        }
        break;
      }
      case 'aoe': {
        const cx = sk.range > 0 && monster?.alive ? monster.x : p.x;
        const cy = sk.range > 0 && monster?.alive ? monster.y : p.y;
        if (sk.range > 0 && (!monster?.alive || !this.inReach(p, monster, sk.range))) return monster ? 'Too far away.' : 'Pick a target first.';
        if (sk.range > 0 && monster && !this.canSee(rt, p, monster, sk.range)) return 'No line of sight.';
        this.emit(rt, { s: p.id, t: sk.range > 0 && monster ? monster.id : p.id, a: 0, k: 'cast', sk: sk.id });
        const hits = [...rt.monsters.values()]
          .filter((m) => m.alive && dist(m.x, m.y, cx, cy) <= (sk.radius ?? 2) * TILE)
          .sort((a, b) => dist(a.x, a.y, cx, cy) - dist(b.x, b.y, cx, cy))
          .slice(0, sk.maxTargets ?? 5);
        for (const m of hits) {
          this.strike(rt, p, m, sk.magic, sk.mult, sk.id, now);
          if (sk.effect && m.alive) m.effects = [...m.effects.filter((e) => e.id !== sk.effect!.id), { id: sk.effect.id, name: sk.effect.name, until: now + sk.effect.durationMs, mods: { ...sk.effect.mods }, source: p.id }];
        }
        break;
      }
      case 'buff': {
        const mods = { ...sk.effect!.mods };
        if (mods.shield) mods.shield = scale(mods.shield, sk.effect!.scale);
        if (mods.regen) mods.regen = scale(mods.regen, sk.effect!.scale);
        p.effects = [...p.effects.filter((e) => e.id !== sk.effect!.id), { id: sk.effect!.id, name: sk.effect!.name, until: now + sk.effect!.durationMs, mods }];
        this.emit(rt, { s: p.id, t: p.id, a: 0, k: 'cast', sk: sk.id });
        break;
      }
      case 'heal': {
        const ally = typeof targetId === 'string' ? findPlayer(targetId) : undefined;
        const who = ally && ally !== p && !ally.dead && ally.mapId === p.mapId && dist(ally.x, ally.y, p.x, p.y) <= sk.range * TILE ? ally : p;
        const amount = Math.round((40 + intel * 3) * (1 + (getJob(p.rec.job)?.passive.healPct ?? 0) / 100));
        who.rec.hp = Math.min(who.profile.maxHp, who.rec.hp + amount);
        this.emit(rt, { s: p.id, t: who.id, a: amount, k: 'heal', sk: sk.id });
        break;
      }
    }
    p.rec.mp -= sk.mp;
    if (fighting) p.lastCombatAt = now;
    p.cooldowns.set(sk.id, now + sk.cooldownMs);
    this.pushEffects(p);
    return { cooldownMs: sk.cooldownMs };
  }

  /** Respawn location for a map (falls back to Greenhaven). */
  static respawnPoint(rt: MapRuntime): { mapId: string; x: number; y: number } {
    return rt.def.respawn ?? { mapId: 'greenhaven', x: 31, y: 26 };
  }

  static classOf(p: Player) {
    return getClass(p.rec.classId);
  }
}

export const STEP = SIM.stepMs;

const KNOCKBACK_SKILLS = new Set(['power_strike', 'whirlwind', 'aimed_shot', 'smite']);
