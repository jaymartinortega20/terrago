import { getMap } from '@terrago/game-data';
import { WORLD_EVENTS, currentEvent, currentWorldBoss, nextWorldBoss } from '@terrago/shared';

import type { GameplayDeps } from './gameplay';

const getMapName = (id: string) => getMap(id)?.name ?? id;

/**
 * Runs world events on schedule: announces them, spawns invasions into maps
 * where players are, and cleans up when they end.
 */
export function startEventDirector(deps: GameplayDeps): () => void {
  let active: string | null = null;
  const spawned = new Set<string>();
  let boss: string | null = null;
  let bossSpawned = false;
  let warned: number | null = null;
  const bossTick = (now: number) => {
    const wb = currentWorldBoss(now);
    const key = wb ? `wb:${wb.def.monster}@${wb.start}` : null;
    if (key !== boss) {
      if (boss) {
        // Window over: if it's still standing, it leaves.
        let escaped = false;
        for (const rt of deps.world.runtimes()) {
          if (rt.owner) continue;
          for (const m of rt.monsters.values()) if (m.eventTag === boss && m.alive) escaped = true;
          deps.world.combat.despawnEvent(rt, boss);
        }
        if (escaped) deps.world.announce('The world boss has retreated… until next time.');
      }
      boss = key;
      bossSpawned = false;
      if (wb) deps.world.announce(`👑 World boss: ${wb.def.name} has appeared in ${getMapName(wb.def.map)}! Everyone who fights it gets loot. (30 min)`);
    }
    if (wb && key && !bossSpawned) {
      for (const rt of deps.world.runtimes()) {
        if (rt.def.id !== wb.def.map || rt.owner) continue;
        bossSpawned = deps.world.combat.spawnEvent(rt, key, wb.def.monster, [wb.def.level, wb.def.level], 1, wb.def.area) > 0;
        if (bossSpawned) deps.log.info('world_boss_spawned', { boss: wb.def.monster, map: rt.def.id });
      }
    }
    // A five-minute warning.
    const next = nextWorldBoss(now);
    if (!wb && next.start - now <= 5 * 60_000 && warned !== next.start) {
      warned = next.start;
      deps.world.announce(`👑 ${next.def.name} will appear in ${getMapName(next.def.map)} in 5 minutes!`);
    }
  };
  const tick = () => {
    const now = Date.now();
    bossTick(now);
    const ev = currentEvent(now);
    const key = ev ? `${ev.def.id}@${ev.start}` : null;
    if (key !== active) {
      if (active) {
        const old = WORLD_EVENTS.find((e) => active!.startsWith(`${e.id}@`));
        if (old?.map) for (const rt of deps.world.runtimes()) if (rt.def.id === old.map && !rt.owner) deps.world.combat.despawnEvent(rt, active);
        deps.world.announce(`${old?.name ?? 'The event'} is over. Thanks for joining in!`);
      }
      active = key;
      spawned.clear();
      if (ev) {
        const mins = Math.round((ev.end - now) / 60_000);
        deps.world.announce(`🎉 World event: ${ev.def.name}! ${ev.def.description} (${mins} min)`);
      }
    }
    // Invasions arrive once the map is loaded (someone is there).
    if (ev && key && ev.def.kind === 'invasion' && ev.def.map && !spawned.has(key)) {
      for (const rt of deps.world.runtimes()) {
        if (rt.def.id !== ev.def.map || rt.owner) continue;
        spawned.add(key);
        for (const g of ev.def.monsters ?? []) deps.world.combat.spawnEvent(rt, key, g.monster, g.level, g.count, ev.def.area!);
        if (ev.def.boss) deps.world.combat.spawnEvent(rt, key, ev.def.boss.monster, [ev.def.boss.level, ev.def.boss.level], 1, ev.def.area!);
        deps.log.info('event_invasion', { event: ev.def.id, map: rt.def.id });
      }
    }
  };
  // A bug in events must never take the game down.
  const safe = () => {
    try {
      tick();
    } catch (err) {
      deps.log.error('event_tick_failed', { err });
    }
  };
  safe();
  const timer = setInterval(safe, 5000);
  timer.unref();
  return () => clearInterval(timer);
}
