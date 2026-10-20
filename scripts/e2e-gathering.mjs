/**
 * v0.3 in a real browser: mine a rock, craft at a workbench, fish with the
 * minigame, and visit the new regions (screenshots). Needs the web app, the
 * game server and DATABASE_URL. Run: node scripts/e2e-gathering.mjs
 */
import { mkdirSync } from 'node:fs';
import pg from 'pg';
import { chromium } from 'playwright';
import { getMap } from '../packages/game-data/src/index.ts';

const WEB = process.env.WEB_URL ?? 'http://localhost:3000';
const OUT = process.env.OUT_DIR ?? 'test-results/e2e';
const DB = process.env.DATABASE_URL ?? 'postgres://terrago:terrago_dev_password@localhost:5432/terrago';
mkdirSync(OUT, { recursive: true });
const db = new pg.Pool({ connectionString: DB, max: 2 });
const log = (...a) => console.log('[gather]', ...a);
const check = (name, ok, detail = '') => {
  log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) throw new Error(`Check failed: ${name}`);
};
const stamp = Date.now().toString(36).replace(/[0-9]/g, (d) => 'abcdefghij'[d]);
const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 1280, height: 760 } })).newPage();
page.on('pageerror', (e) => log('pageerror:', e.message));
const ui = () => page.evaluate(() => window.__terrago.client.ui.get());
const online = () => page.waitForFunction(() => window.__terrago?.client.ui.get().status === 'online', null, { timeout: 15000 });
let id;
async function goto(map, x, y, dir = 'up') {
  if (await page.evaluate(() => !!window.__terrago)) await page.evaluate(() => window.__terrago.client.logout());
  await page.waitForTimeout(300);
  await db.query('UPDATE characters SET map_id=$2,pos_x=$3,pos_y=$4,direction=$5 WHERE id=$1', [id, map, x * 32 + 16, y * 32 + 22, dir]);
  await page.goto(`${WEB}/play?c=${id}`);
  await online();
  await page.waitForTimeout(700);
}
try {
  await page.goto(`${WEB}/register`);
  await page.fill('#email', `gather-${stamp}@example.com`);
  await page.fill('#password', 'pickaxe and patience');
  await page.fill('#confirm', 'pickaxe and patience');
  await page.click('button[type=submit]');
  await page.waitForURL('**/characters');
  const name = `Gath${stamp}`.slice(0, 16);
  await page.fill('#char-name', name);
  await page.click('button:has-text("Create character")');
  await page.locator('[data-testid=character-card]').first().waitFor();
  id = (await db.query('SELECT id FROM characters WHERE name=$1', [name])).rows[0].id;
  await db.query(`INSERT INTO inventory_items (character_id, container, slot, item_id, quantity, durability) VALUES
     ($1,'bag',10,'worn_pickaxe',1,150), ($1,'bag',11,'worn_axe',1,150), ($1,'bag',12,'bamboo_rod',1,200), ($1,'bag',13,'softwood_log',4,null)`, [id]);

  // Mine a stone rock in Sunfield.
  const rock = getMap('sunfield_plains').nodes.find((n) => n.type === 'rock_stone');
  await goto('sunfield_plains', rock.x, rock.y + 1, 'up');
  check('Hint offers mining', /^Mine Stone Rock/.test((await ui()).actionHint ?? ''), (await ui()).actionHint);
  for (let i = 0; i < 12; i++) {
    await page.keyboard.press('e');
    await page.waitForTimeout(260);
  }
  const stone = (await ui()).inventory.slots.filter((s) => s.itemId === 'stone').reduce((n, s) => n + s.quantity, 0);
  check('Mined stone', stone >= 1, `${stone} stone`);
  check('Mining XP', (await ui()).self.skills.mining.xp > 0);
  await page.screenshot({ path: `${OUT}/v03-01-mining.png` });

  // Craft planks at the Greenhaven workbench.
  await goto('greenhaven', 4, 15, 'up');
  check('Hint offers the workbench', (await ui()).actionHint === 'Use Workbench', (await ui()).actionHint);
  await page.keyboard.press('e');
  await page.locator('[data-testid=craft-panel]').waitFor();
  await page.screenshot({ path: `${OUT}/v03-02-crafting.png` });
  await page.locator('[data-testid=recipe-saw_softwood] button:has-text("Make")').click();
  await page.waitForFunction(() => window.__terrago.client.ui.get().inventory.slots.some((s) => s.itemId === 'softwood_plank'));
  check('Crafted a softwood plank', true);
  await page.keyboard.press('Escape');

  // Fish in the Greenhaven pond.
  const gh = getMap('greenhaven');
  let spot;
  for (let y = 0; y < gh.height && !spot; y++) for (let x = 30; x < gh.width - 1 && !spot; x++) if (gh.tiles[y][x] === 'b' && gh.tiles[y][x + 1] === '~') spot = [x, y];
  await goto('greenhaven', spot[0], spot[1], 'right');
  check('Hint offers fishing', (await ui()).actionHint === 'Fish', (await ui()).actionHint);
  await page.keyboard.press('e');
  await page.waitForFunction(() => window.__terrago.client.ui.get().fishing?.phase === 'bite', null, { timeout: 10000 });
  await page.screenshot({ path: `${OUT}/v03-03-bite.png` });
  await page.keyboard.press('e');
  await page.locator('[data-testid=fishing-game]').waitFor();
  // Play: hold when the fish is above the zone's middle.
  const result = await page.evaluate(async () => {
    const c = window.__terrago.client;
    const msgs = [];
    const unsub = c.ui.subscribe(() => c.ui.get().notices.forEach((n) => msgs.push(n.text)));
    while (c.ui.get().fishing) {
      const bar = document.querySelector('[data-testid=fishing-game]');
      if (bar) {
        const zone = bar.children[0].children[0].getBoundingClientRect();
        const fish = bar.children[0].children[1].getBoundingClientRect();
        const want = fish.top + fish.height / 2 < zone.top + zone.height / 2;
        window.dispatchEvent(new KeyboardEvent(want ? 'keydown' : 'keyup', { key: ' ' }));
      }
      await new Promise((r) => setTimeout(r, 30));
    }
    window.dispatchEvent(new KeyboardEvent('keyup', { key: ' ' }));
    await new Promise((r) => setTimeout(r, 300));
    unsub();
    return [...new Set(msgs)].join(' | ');
  });
  check('Fishing round finished with a server verdict', /caught|got away/i.test(result), result);
  await page.screenshot({ path: `${OUT}/v03-04-fished.png` });

  // Tour the new regions.
  for (const [map, x, y, file] of [['whisperwood', 50, 22, 'v03-05-whisperwood'], ['crystal_lake', 14, 22, 'v03-06-crystal-lake'], ['irondeep_entrance', 20, 12, 'v03-07-irondeep'], ['irondeep_6', 4, null, 'v03-08-mine-floor-6']]) {
    const m = getMap(map);
    await goto(map, x, y ?? m.spawn.y, 'right');
    check(`Entered ${m.name}`, (await ui()).mapId === map);
    await page.screenshot({ path: `${OUT}/${file}.png` });
  }
  log('ALL v0.3 BROWSER CHECKS PASSED');
} catch (e) {
  await page.screenshot({ path: `${OUT}/v03-failure.png` }).catch(() => {});
  console.error(e);
  process.exitCode = 1;
} finally {
  await browser.close();
  await db.end();
}
