import { getClass, getMonster, getSkillDef } from '@terrago/game-data';
import {
  OUT_OF_COMBAT_MS,
  PLAYER_BODY,
  SIM,
  TILE_SIZE,
  WEAKNESS,
  WEAKNESS_MS,
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

  constructor(
    readonly id: string,
    readonly def: MonsterDef,
    readonly level: number,
    readonly stats: MonsterStats,
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
      name: this.def.name,
      level: this.level,
      hp: this.hp,
      maxHp: this.stats.maxHp,
      x: this.x,
      y: this.y,
      dir: this.dir,
      ...(this.def.boss ? { boss: true } : {}),
    };
  }
}

export interface KillReward {
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
    for (const sp of rt.def.spawns ?? []) {
      const def = getMonster(sp.monster);
      if (!def) continue;
      for (let i = 0; i < sp.count; i++) {
        const pos = randomTileIn(rt, sp.area, this.rand);
        if (!pos) continue;
        const level = sp.level[0] + Math.floor(this.rand() * (sp.level[1] - sp.level[0] + 1));
        const m = new Monster(`m${++this.seq}`, def, level, monsterStats(def, level), pos.x, pos.y, sp);
        rt.monsters.set(m.id, m);
      }
    }
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
      if (now >= m.respawnAt) {
        const pos = randomTileIn(rt, m.spawn.area, this.rand);
        if (pos) {
          m.x = pos.x;
          m.y = pos.y;
        }
        m.hp = m.stats.maxHp;
        m.state = 'idle';
        m.effects = [];
        m.damageBy.clear();
        m.targetId = null;
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
        const d = dist(m.x, m.y, target.x, target.y);
        if (d <= m.def.range * TILE) {
          m.dir = facing(target.x - m.x, target.y - m.y);
          if (now >= m.nextAttackAt) {
            m.nextAttackAt = now + m.def.cooldownMs;
            this.monsterAttack(rt, m, target, now);
          }
        } else this.moveToward(rt, m, target.x, target.y, dtMs, now);
        return;
      }
    }
    if (m.state === 'return') {
      if (dist(m.x, m.y, homeX, homeY) < 2 * TILE) {
        m.state = 'idle';
        m.hp = m.stats.maxHp;
        m.damageBy.clear();
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
      { level: m.level, atk: m.stats.atk * effectMult(m.effects, 'dmg', now), accuracy: m.stats.accuracy, critChance: 5, critDamage: 150 },
      { level: p.rec.level, def, evasion: p.profile.derived.evasion * effectMult(p.effects, 'eva', now) },
      1,
      this.rand,
    );
    p.lastCombatAt = now;
    if (res.miss) return this.emit(rt, { s: m.id, t: p.id, a: 0, k: 'miss' });
    this.damagePlayer(rt, p, Math.round(res.damage * effectMult(p.effects, 'taken', now)), m.id, res.crit ? 'crit' : 'hit');
  }

  damagePlayer(rt: MapRuntime, p: Player, amount: number, source: string, kind: CombatEvent['k']): void {
    const now = this.now();
    let dmg = amount;
    for (const e of p.effects) {
      if (dmg <= 0) break;
      if (e.until > now && e.mods.shield && e.mods.shield > 0) {
        const absorbed = Math.min(e.mods.shield, dmg);
        e.mods.shield -= absorbed;
        dmg -= absorbed;
      }
    }
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
    // Regeneration: fast out of combat, slow in it; Blessing adds more.
    const ooc = now - p.lastCombatAt > OUT_OF_COMBAT_MS;
    const sec = dtMs / 1000;
    let hpRegen = p.profile.maxHp * (ooc ? 0.03 : 0.004) * sec;
    for (const e of p.effects) if (e.mods.regen) hpRegen += e.mods.regen * sec;
    const mpRegen = p.profile.maxMp * (ooc ? 0.03 : 0.008) * sec;
    p.regenCarry += hpRegen;
    const whole = Math.floor(p.regenCarry);
    p.regenCarry -= whole;
    p.rec.hp = Math.min(p.profile.maxHp, p.rec.hp + whole);
    p.mpCarry = (p.mpCarry ?? 0) + mpRegen;
    const mpWhole = Math.floor(p.mpCarry);
    p.mpCarry -= mpWhole;
    p.rec.mp = Math.min(p.profile.maxMp, p.rec.mp + mpWhole);
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
      critChance: d.criticalChance,
      critDamage: d.criticalDamage,
    };
  }

  private inReach(p: Player, m: Monster, rangeTiles: number): boolean {
    // Half a tile of slack for latency (the client sees monsters slightly in the past).
    return dist(p.x, p.y - PLAYER_BODY.height / 2, m.x, m.y - 6) <= (rangeTiles + 0.6) * TILE;
  }

  /** A basic weapon attack. Returns the cooldown to show, or an error message. */
  attack(rt: MapRuntime, p: Player, targetId: unknown): { cooldownMs: number } | string {
    const now = this.now();
    if (p.dead) return "You can't fight right now.";
    if (rt.def.safeZone) return 'No fighting here.';
    const m = typeof targetId === 'string' ? rt.monsters.get(targetId) : undefined;
    if (!m || !m.alive) return 'No target.';
    const w = p.profile.weapon;
    if (!this.inReach(p, m, w.range)) return 'Too far away.';
    if (now < p.nextAttackAt) return 'cooldown';
    p.nextAttackAt = now + w.speedMs - 60;
    p.lastCombatAt = now;
    this.strike(rt, p, m, w.magic, 1, undefined, now);
    if (++p.hitsDealt >= 10) {
      p.hitsDealt = 0;
      this.hooks.onWear?.(p, [0]);
    }
    return { cooldownMs: w.speedMs };
  }

  private strike(rt: MapRuntime, p: Player, m: Monster, magic: boolean, mult: number, skill: string | undefined, now: number): void {
    const res = rollHit(this.attackerOf(p, magic, now), { level: m.level, def: magic ? m.stats.def * 0.8 : m.stats.def, evasion: m.stats.evasion }, mult, this.rand);
    if (m.state === 'idle' || m.state === 'return') {
      m.state = 'chase';
      m.targetId = p.id;
    }
    if (res.miss) return this.emit(rt, { s: p.id, t: m.id, a: 0, k: 'miss', ...(skill ? { sk: skill } : {}) });
    const dmg = Math.round(res.damage * effectMult(m.effects, 'taken', now));
    this.damageMonster(rt, m, dmg, p, res.crit ? 'crit' : 'hit', skill);
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
    m.respawnAt = this.now() + m.def.respawnMs;
    this.emit(rt, { s: m.id, t: m.id, a: 0, k: 'death' });
    const total = [...m.damageBy.values()].reduce((a, b) => a + b, 0);
    if (total <= 0) return;
    const contributors = [...m.damageBy.entries()]
      .map(([id, d]) => ({ p: [...rt.players].find((x) => x.id === id), d }))
      .filter((c): c is { p: Player; d: number } => !!c.p && !c.p.dead && dist(c.p.x, c.p.y, m.x, m.y) < 25 * TILE);
    if (!contributors.length) return;
    const group = contributors.length > 1 ? 1.15 : 1;
    const top = contributors.reduce((a, b) => (b.d > a.d ? b : a));
    const rewards: KillReward[] = contributors.map(({ p, d }) => {
      // Monsters far below your level are worth little ("grey" monsters).
      const below = p.rec.level - m.level;
      const lf = below > 5 ? Math.max(0.1, 1 - 0.15 * (below - 5)) : 1;
      return { player: p, xp: Math.max(1, Math.round(m.stats.xp * (d / total) * group * lf)), gold: 0, items: [], monster: m };
    });
    const loot = rewards.find((r) => r.player === top.p)!;
    const [g0, g1] = m.def.gold;
    loot.gold = Math.round((g0 + this.rand() * (g1 - g0)) * (1 + m.level * 0.08));
    for (const d of m.def.drops) if (this.rand() < d.chance) loot.items.push({ itemId: d.itemId, quantity: d.min + Math.floor(this.rand() * (d.max - d.min + 1)) });
    this.hooks.onKill?.(rewards);
  }

  /** Use a class skill. */
  useSkill(rt: MapRuntime, p: Player, skillId: unknown, targetId: unknown, findPlayer: (id: string) => Player | undefined): { cooldownMs: number } | string {
    const now = this.now();
    const sk = typeof skillId === 'string' ? getSkillDef(skillId) : undefined;
    if (!sk || sk.classId !== p.rec.classId) return "You don't know that skill.";
    if (p.rec.level < sk.level) return `${sk.name} unlocks at level ${sk.level}.`;
    if (p.dead) return "You can't do that right now.";
    if ((p.cooldowns.get(sk.id) ?? 0) > now) return 'cooldown';
    if (p.rec.mp < sk.mp) return 'Not enough MP.';
    const intel = p.profile.stats.intelligence;
    const scale = (v: number, by?: 'int' | 'str') => (by === 'int' ? Math.round(v * intel) : by === 'str' ? Math.round(v * Math.max(4, p.profile.derived.physicalAttack * 0.25)) : v);
    const monster = typeof targetId === 'string' ? rt.monsters.get(targetId) : undefined;
    const fighting = sk.kind === 'attack' || sk.kind === 'aoe' || sk.kind === 'debuff';
    if (fighting && rt.def.safeZone) return 'No fighting here.';

    switch (sk.kind) {
      case 'attack':
      case 'debuff': {
        if (!monster?.alive) return 'Pick a target first.';
        if (!this.inReach(p, monster, Math.max(sk.range, p.profile.weapon.range))) return 'Too far away.';
        if (sk.kind === 'attack') this.strike(rt, p, monster, sk.magic, sk.mult, sk.id, now);
        else if (monster.state !== 'chase') {
          monster.state = 'chase';
          monster.targetId = p.id;
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
        break;
      }
      case 'heal': {
        const ally = typeof targetId === 'string' ? findPlayer(targetId) : undefined;
        const who = ally && ally !== p && !ally.dead && ally.mapId === p.mapId && dist(ally.x, ally.y, p.x, p.y) <= sk.range * TILE ? ally : p;
        const amount = 40 + intel * 3;
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
