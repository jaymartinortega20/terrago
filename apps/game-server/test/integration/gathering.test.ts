import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import pg from 'pg';
import { getMap } from '@terrago/game-data';
import { buildCollisionGrid, fishingStart, fishingStep, simulateFishing, tileCenter, type FishingRound, type InventoryState } from '@terrago/shared';
import type { GameServer } from '../../src/app';
import { TEST_DB, ack, enterWorld, leaveWorld, newPlayer, once, resetDatabase, startTestServer } from './helpers';

let server: GameServer;
let base: string;
let db: pg.Pool;

before(async () => {
  await resetDatabase();
  server = await startTestServer();
  base = `http://127.0.0.1:${server.port()}`;
  db = new pg.Pool({ connectionString: TEST_DB, max: 2 });
});

after(async () => {
  await server?.stop();
  await db?.end();
});

async function place(id: string, mapId: string, tx: number, ty: number, dir = 'up') {
  const c = tileCenter(tx, ty);
  await db.query('UPDATE characters SET map_id = $2, pos_x = $3, pos_y = $4, direction = $5 WHERE id = $1', [id, mapId, c.x, c.y, dir]);
}

/** A walkable tile directly below a target tile. */
function standUnder(mapId: string, x: number, y: number): [number, number] {
  const map = getMap(mapId)!;
  const grid = buildCollisionGrid(map, []);
  for (const [dx, dy] of [[0, 1], [1, 0], [-1, 0], [0, -1]] as const) if (!grid.isSolidTile(x + dx, y + dy)) return [x + dx, y + dy];
  throw new Error('no free neighbour');
}

async function give(id: string, slot: number, itemId: string, qty: number, durability: number | null = null) {
  await db.query(`INSERT INTO inventory_items (character_id, container, slot, item_id, quantity, durability) VALUES ($1, 'bag', $2, $3, $4, $5)`, [id, slot, itemId, qty, durability]);
}

describe('gathering, fishing and crafting (v0.3)', () => {
  test('mining a rock gives stone and Mining XP until it depletes', async () => {
    const A = await newPlayer(base);
    const rock = getMap('sunfield_plains')!.nodes!.find((n) => n.type === 'rock_stone')!;
    const [sx, sy] = standUnder('sunfield_plains', rock.x, rock.y);
    await place(A.character.id, 'sunfield_plains', sx, sy);
    await give(A.character.id, 10, 'worn_pickaxe', 1, 150);
    const a = await enterWorld(base, A.browser.cookie, A.character.id);
    assert.ok(a.enter.objects.some((o) => o.kind === 'node' && o.id === `node:${rock.id}`));
    let gathered = 0;
    let depleted = false;
    for (let i = 0; i < 40 && !depleted; i++) {
      await new Promise((r) => setTimeout(r, 200));
      const res = await ack(a.socket, 'act', { tx: rock.x, ty: rock.y });
      if (!res.ok) {
        assert.match(res.error, /used up/);
        depleted = true;
      } else if (res.data.effect === 'gathered') gathered++;
    }
    assert.equal(gathered, 4, 'a stone rock yields 4 times');
    assert.ok(depleted);
    const stone = await db.query(`SELECT coalesce(sum(quantity),0)::int AS n FROM inventory_items WHERE character_id = $1 AND item_id = 'stone'`, [A.character.id]);
    assert.ok(stone.rows[0].n >= 4);
    const xp = await db.query(`SELECT xp FROM character_skills WHERE character_id = $1 AND skill = 'mining'`, [A.character.id]);
    assert.equal(Number(xp.rows[0].xp), 16);
    const pick = await db.query(`SELECT durability FROM inventory_items WHERE character_id = $1 AND item_id = 'worn_pickaxe'`, [A.character.id]);
    assert.ok(pick.rows[0].durability < 150, 'pickaxe wears down');
    await leaveWorld(a.socket);
  });

  test('a higher-tier node needs the skill level and a strong enough tool', async () => {
    const A = await newPlayer(base);
    const map = getMap('desolate_crags')!;
    const iron = map.nodes!.find((n) => n.type === 'rock_iron')!;
    const [sx, sy] = standUnder('desolate_crags', iron.x, iron.y);
    await place(A.character.id, 'desolate_crags', sx, sy);
    await give(A.character.id, 10, 'worn_pickaxe', 1, 150);
    const a = await enterWorld(base, A.browser.cookie, A.character.id);
    const low = await ack(a.socket, 'act', { tx: iron.x, ty: iron.y });
    assert.equal(low.ok, false);
    assert.match(low.error, /mining level 10/i);
    await leaveWorld(a.socket);
    await db.query(`INSERT INTO character_skills (character_id, skill, level, xp) VALUES ($1, 'mining', 12, 0)`, [A.character.id]);
    const b = await enterWorld(base, A.browser.cookie, A.character.id);
    const weak = await ack(b.socket, 'act', { tx: iron.x, ty: iron.y });
    assert.equal(weak.ok, false);
    assert.match(weak.error, /isn't strong enough/);
    await leaveWorld(b.socket);
  });

  test('crafting at a station consumes inputs and fee atomically', async () => {
    const A = await newPlayer(base);
    // Greenhaven workbench is at (4,14) — stand below it.
    await place(A.character.id, 'greenhaven', 4, 15);
    await give(A.character.id, 10, 'softwood_log', 5);
    const a = await enterWorld(base, A.browser.cookie, A.character.id);
    const ok = await ack(a.socket, 'craft', { recipeId: 'saw_softwood', times: 2 });
    assert.equal(ok.ok, true, JSON.stringify(ok));
    const rows = await db.query(`SELECT item_id, quantity FROM inventory_items WHERE character_id = $1 AND item_id IN ('softwood_log','softwood_plank') ORDER BY item_id`, [A.character.id]);
    assert.deepEqual(rows.rows, [{ item_id: 'softwood_log', quantity: 1 }, { item_id: 'softwood_plank', quantity: 2 }]);
    const notEnough = await ack(a.socket, 'craft', { recipeId: 'saw_softwood', times: 1 });
    assert.equal(notEnough.ok, false);
    const wrongStation = await ack(a.socket, 'craft', { recipeId: 'smelt_copper', times: 1 });
    assert.equal(wrongStation.ok, false);
    assert.match(wrongStation.error, /station/);
    const xp = await db.query(`SELECT xp FROM character_skills WHERE character_id = $1 AND skill = 'crafting'`, [A.character.id]);
    assert.equal(Number(xp.rows[0].xp), 8);
    await leaveWorld(a.socket);
  });

  test('fishing: cast, bite, hook, reel — the server replays the minigame', async () => {
    const A = await newPlayer(base);
    // Greenhaven pond: the dock at (44..48, 40) points into water at (49, 40)?  Use the end of the dock facing east.
    const map = getMap('greenhaven')!;
    let spot: [number, number, number, number] | null = null;
    const grid = buildCollisionGrid(map, []);
    for (let y = 0; y < map.height && !spot; y++)
      for (let x = 0; x < map.width - 1 && !spot; x++)
        if (!grid.isSolidTile(x, y) && map.tiles[y]![x + 1] === '~') spot = [x, y, x + 1, y];
    assert.ok(spot);
    await place(A.character.id, 'greenhaven', spot[0], spot[1], 'right');
    await give(A.character.id, 10, 'bamboo_rod', 1, 200);
    const a = await enterWorld(base, A.browser.cookie, A.character.id);
    const castRes = await ack(a.socket, 'act', { tx: spot[2], ty: spot[3] });
    assert.equal(castRes.ok, true, JSON.stringify(castRes));
    const id = castRes.data.fishing.id;
    // Hooking before the bite scares the fish.
    const bite = await once<{ id: string }>(a.socket, 'fish:bite', 9000);
    assert.equal(bite.id, id);
    const round = await ack<{ ok: boolean; data: FishingRound }>(a.socket, 'fish:hook', id);
    assert.equal(round.ok, true, JSON.stringify(round));
    // Play the minigame like a decent player (a simple controller).
    const p = round.data;
    const s = fishingStart(p);
    const toggles: number[] = [];
    let holding = false;
    while (!s.done) {
      const want = s.fishPos > s.zonePos + p.zone / 2 + s.zoneVel * 4;
      if (want !== holding) {
        holding = want;
        toggles.push(s.step);
      }
      fishingStep(p, s, holding);
    }
    const expected = simulateFishing(p, toggles, s.step);
    await new Promise((r) => setTimeout(r, s.step * 50));
    const inv = new Promise<InventoryState | null>((resolve) => {
      a.socket.once('inventory:update', resolve);
      setTimeout(() => resolve(null), 3000);
    });
    const reel = await ack(a.socket, 'fish:reel', { id, toggles, steps: s.step });
    assert.equal(reel.ok, true, JSON.stringify(reel));
    assert.equal(reel.data.caught, expected.done === 'caught');
    if (reel.data.caught) {
      const got = await inv;
      assert.ok(got?.slots.some((x) => ['minnow', 'carp', 'perch', 'sunfish', 'catfish', 'golden_koi'].includes(x.itemId)));
    }
    // Replaying the same round is refused.
    const again = await ack(a.socket, 'fish:reel', { id, toggles, steps: s.step });
    assert.equal(again.ok, false);
    await leaveWorld(a.socket);
  });

  test('a claimed catch that was played impossibly fast is refused', async () => {
    const A = await newPlayer(base);
    const map = getMap('greenhaven')!;
    const grid = buildCollisionGrid(map, []);
    let spot: [number, number] | null = null;
    for (let y = 0; y < map.height && !spot; y++) for (let x = 0; x < map.width - 1 && !spot; x++) if (!grid.isSolidTile(x, y) && map.tiles[y]![x + 1] === '~') spot = [x, y];
    await place(A.character.id, 'greenhaven', spot![0], spot![1], 'right');
    await give(A.character.id, 10, 'bamboo_rod', 1, 200);
    const a = await enterWorld(base, A.browser.cookie, A.character.id);
    const c = await ack(a.socket, 'act', { tx: spot![0] + 1, ty: spot![1] });
    const id = c.data.fishing.id;
    await once(a.socket, 'fish:bite', 9000);
    await ack(a.socket, 'fish:hook', id);
    const cheat = await ack(a.socket, 'fish:reel', { id, toggles: [], steps: 400 });
    assert.equal(cheat.ok, false);
    await leaveWorld(a.socket);
  });
});
