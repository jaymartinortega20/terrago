/**
 * VERSION 0.2 SUCCESS TEST (farming) in a real browser.
 *
 *   Walk to your farm, till soil, plant a Carrot Seed, water it, leave the
 *   game, return later, see that it grew while offline, harvest it, receive
 *   the item and Farming XP, then sell it to Farmer Rowan.
 *
 * To keep the run short, the character is placed next to its farm through the
 * database and "later" is simulated by moving the plot's timestamps back.
 * Requires the web app, game server and DATABASE_URL. Run: node scripts/e2e-farming.mjs
 */
import { mkdirSync } from 'node:fs';
import pg from 'pg';
import { chromium } from 'playwright';

const WEB = process.env.WEB_URL ?? 'http://localhost:3000';
const OUT = process.env.OUT_DIR ?? 'test-results/e2e';
const DB = process.env.DATABASE_URL ?? 'postgres://terrago:terrago_dev_password@localhost:5432/terrago';
mkdirSync(OUT, { recursive: true });

const stamp = Date.now().toString(36);
const log = (...a) => console.log(`[farm ${((performance.now() / 1000) | 0).toString().padStart(3)}s]`, ...a);
const check = (name, ok, detail = '') => {
  log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) throw new Error(`Check failed: ${name} ${detail}`);
};
const db = new pg.Pool({ connectionString: DB, max: 2 });
const TILE = 32;
const place = (id, map, tx, ty, dir = 'up') =>
  db.query('UPDATE characters SET map_id = $2, pos_x = $3, pos_y = $4, direction = $5 WHERE id = $1', [id, map, tx * TILE + 16, ty * TILE + 22, dir]);

const browser = await chromium.launch({ headless: !process.env.HEADED });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 760 } });
const page = await ctx.newPage();
page.on('pageerror', (e) => log('pageerror:', e.message));
page.on('console', (m) => m.type() === 'error' && log('console:', m.text()));
const waitFor = (fn, arg, timeout = 15000) => page.waitForFunction(fn, arg, { timeout, polling: 50 });
const ui = () => page.evaluate(() => window.__terrago.client.ui.get());
const plot = (i) => page.evaluate((i) => window.__terrago.client.objects.get(`plot:${i}`), i);

try {
  const name = `Farm${stamp.replace(/[0-9]/g, (d) => 'abcdefghij'[d])}`.slice(0, 16);
  await page.goto(`${WEB}/register`);
  await page.fill('#email', `farm-${stamp}@example.com`);
  await page.fill('#password', 'patience and carrots');
  await page.fill('#confirm', 'patience and carrots');
  await page.click('button[type=submit]');
  await page.waitForURL('**/characters');
  await page.fill('#char-name', name);
  await page.click('button:has-text("Create character")');
  await page.locator('[data-testid=character-card]').first().waitFor();
  const { rows } = await db.query('SELECT id FROM characters WHERE name = $1', [name]);
  const id = rows[0].id;
  // Plot 0 is tile (12, 9): stand just south of it.
  await place(id, 'homestead', 12, 10);

  await page.locator('[data-testid=character-card]').first().click();
  await page.waitForURL('**/play?c=*');
  await waitFor(() => window.__terrago?.client.ui.get().status === 'online');
  await page.waitForTimeout(600);
  const u = await ui();
  check('Enters own homestead', u.mapId === 'homestead' && u.mapName.includes(name), u.mapName);
  const plots = await page.evaluate(() => [...window.__terrago.client.objects.values()].filter((o) => o.kind === 'plot'));
  check('12 farm plots (+12 locked)', plots.filter((p) => !p.locked).length === 12 && plots.filter((p) => p.locked).length === 12);
  await page.screenshot({ path: `${OUT}/farm-01-homestead.png` });

  check('Action hint says Till', (await ui()).actionHint === 'Till soil', (await ui()).actionHint);
  await page.keyboard.press('e');
  await waitFor(() => window.__terrago.client.objects.get('plot:0').tilled);
  check('Tilled the soil', true);
  await page.waitForTimeout(300);
  await page.keyboard.press('e');
  await waitFor(() => window.__terrago.client.objects.get('plot:0').crop?.cropId === 'carrot');
  check('Planted a Carrot Seed', true);
  await page.waitForTimeout(300);
  check('Hint says Water Carrot', (await ui()).actionHint === 'Water Carrot', (await ui()).actionHint);
  await page.keyboard.press('e');
  await waitFor(() => window.__terrago.client.objects.get('plot:0').wetUntil > Date.now());
  check('Watered it', true);

  // Click the neighbouring plot (13, 9) with the mouse: till it.
  const click = async (tx, ty) => {
    const p = await page.evaluate(([tx, ty]) => {
      const cam = window.__terrago.game.scene.getScene('world').cameras.main;
      const x = (tx * 32 + 16 - cam.worldView.x) * cam.zoom;
      const y = (ty * 32 + 16 - cam.worldView.y) * cam.zoom;
      return { x, y };
    }, [tx, ty]);
    await page.mouse.click(p.x, p.y);
  };
  await page.waitForTimeout(300);
  await click(13, 9);
  await waitFor(() => window.__terrago.client.objects.get('plot:1').tilled);
  check('Click-to-use tills a neighbouring plot', true);
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${OUT}/farm-02-planted.png` });

  // Leave the game. Five minutes pass.
  await page.evaluate(() => window.__terrago.client.logout());
  await page.waitForTimeout(300);
  await db.query(
    `UPDATE farm_plots SET progress_at = progress_at - interval '5 min', water_until = water_until - interval '5 min' WHERE character_id = $1`,
    [id],
  );
  await page.reload();
  await waitFor(() => window.__terrago?.client.ui.get().status === 'online');
  await page.waitForTimeout(800);
  check('Crop grew while offline (Harvest hint)', (await ui()).actionHint === 'Harvest Carrot', (await ui()).actionHint);
  await page.screenshot({ path: `${OUT}/farm-03-ready.png` });
  await page.keyboard.press('e');
  await waitFor(() => window.__terrago.client.ui.get().inventory.slots.some((s) => s.itemId === 'carrot'));
  const after = await ui();
  check('Harvested a Carrot', true);
  check('Gained Farming XP', after.self.skills.farming.xp === 6, JSON.stringify(after.self.skills.farming));
  check('Soil stays tilled', (await plot(0)).tilled && !(await plot(0)).crop);

  // Skills panel
  await page.keyboard.press('k');
  await page.locator('[data-testid=skills-panel]').waitFor();
  await page.screenshot({ path: `${OUT}/farm-04-skills.png` });
  await page.keyboard.press('k');

  // Sell it to Farmer Rowan in Greenhaven.
  await page.evaluate(() => window.__terrago.client.logout());
  await page.waitForTimeout(300);
  await place(id, 'greenhaven', 12, 35, 'up');
  await page.reload();
  await waitFor(() => window.__terrago?.client.ui.get().status === 'online');
  await page.waitForTimeout(500);
  const gold0 = (await ui()).inventory.gold;
  await page.keyboard.press('e');
  await page.locator('[data-testid=dialogue]').waitFor();
  for (let i = 0; i < 8 && !(await page.locator('[data-testid=dialogue-action-shop]').isVisible()); i++) {
    await page.click('[data-testid=dialogue-next]');
    await page.waitForTimeout(250);
  }
  await page.click('[data-testid=dialogue-action-shop]');
  await page.locator('[data-testid=shop-panel]').waitFor();
  await page.screenshot({ path: `${OUT}/farm-05-shop.png` });
  await page.click('[data-testid=shop-tab-sell]');
  const carrotSlot = (await ui()).inventory.slots.find((s) => s.itemId === 'carrot').slot;
  await page.click(`[data-testid=sell-${carrotSlot}]`);
  await waitFor((g) => window.__terrago.client.ui.get().inventory.gold > g, gold0);
  const gold1 = (await ui()).inventory.gold;
  check('Sold the carrot to Rowan', gold1 >= gold0 + 10, `${gold0} → ${gold1}`);
  await page.click('[data-testid=shop-tab-buy]');
  await page.click('[data-testid=buy-carrot_seed]');
  await waitFor((g) => window.__terrago.client.ui.get().inventory.gold === g - 8, gold1);
  check('Bought a carrot seed', true);

  // All of it persisted.
  const ledger = await db.query(`SELECT reason FROM currency_transactions WHERE character_id = $1 ORDER BY id`, [id]);
  check('Ledger has creation, sale, purchase', ledger.rows.map((r) => r.reason).join(',') === 'character_creation,npc_sale,npc_purchase');
  log('ALL FARMING CHECKS PASSED');
} catch (err) {
  await page.screenshot({ path: `${OUT}/farm-failure.png` }).catch(() => {});
  console.error(err);
  process.exitCode = 1;
} finally {
  await browser.close();
  await db.end();
}
