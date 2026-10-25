import { MAPS, MONSTERS, NPCS, QUESTS, SHOPS, allMapIds, getMap } from '@terrago/game-data';

/** Map number in travel order (1 = Oakhaven Sanctuary ... 6 = Infernal Caldera). */
const WORLD_ORDER = ['greenhaven', 'sunfield_plains', 'desolate_crags', 'glacial_depths', 'dragonspire', 'infernal_caldera'];

function mapOfMonster(monsterId: string): string | null {
  for (const id of allMapIds()) {
    const m = getMap(id) ?? MAPS[id];
    if (m?.spawns?.some((s) => s.monster === monsterId)) return id;
  }
  return null;
}

/** Where an item comes from, in a few words ("Drops from Pyraxis (Map 6 World Boss)"). */
export function itemSources(itemId: string): string[] {
  const out: string[] = [];
  for (const s of SHOPS) {
    const e = s.sells.find((x) => x.itemId === itemId);
    if (e) out.push(`Sold by ${NPCS.find((n) => n.id === s.npcId)?.name ?? s.name} (${e.price.toLocaleString()} gold)`);
  }
  for (const m of MONSTERS) {
    if (!m.drops.some((d) => d.itemId === itemId)) continue;
    const map = mapOfMonster(m.id);
    const n = map ? WORLD_ORDER.indexOf(map) + 1 : 0;
    const where = map ? `${n ? `Map ${n} ` : ''}${m.boss ? 'World Boss' : getMap(map)?.name ?? ''}`.trim() : 'a dungeon';
    out.push(`Drops from ${m.name} (${where})`);
  }
  for (const q of QUESTS) if (q.rewards.items?.some((i) => i.itemId === itemId)) out.push(`Reward from the quest “${q.name}”`);
  return out.length ? out : ['Found somewhere in the world…'];
}
