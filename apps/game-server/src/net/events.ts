import { WORLD_EVENTS, currentEvent } from '@terrago/shared';
import type { GameplayDeps } from './gameplay';

/**
 * Runs world events on schedule: announces them, spawns invasions into maps
 * where players are, and cleans up when they end.
 */
export function startEventDirector(deps: GameplayDeps): () => void {
  let active: string | null = null;
  const spawned = new Set<string>();
  const tick = () => {
    const now = Date.now();
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
  tick();
  const timer = setInterval(tick, 5000);
  timer.unref();
  return () => clearInterval(timer);
}
