/**
 * Endless Rift, guild level and the grouped menu in a real browser.
 * Run: npx tsx scripts/e2e-rift.mjs
 */
import { mkdirSync } from 'node:fs';
import pg from 'pg';
import { chromium } from 'playwright';

const WEB = process.env.WEB_URL ?? 'http://localhost:3000';
const OUT = process.env.OUT_DIR ?? 'test-results/e2e';
const DB = process.env.DATABASE_URL ?? 'postgres://terrago:terrago_dev_password@localhost:5432/terrago';
mkdirSync(OUT, { recursive: true });
const db = new pg.Pool({ connectionString: DB, max: 2 });
const log = (...a) => console.log('[rift]', ...a);
const check = (name, ok, detail = '') => {
  log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) throw new Error(`Check failed: ${name}`);
};
const stamp = Date.now().toString(36).replace(/[0-9]/g, (d) => 'abcdefghij'[d]);
const browser = await chromium.launch();
const errors = [];
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${WEB}/register`);
  await page.fill('#email', `rift-${stamp}@example.com`);
  await page.fill('#password', 'deeper and deeper');
  await page.fill('#confirm', 'deeper and deeper');
  await page.click('button[type=submit]');
  await page.waitForURL('**/characters');
  await page.locator('#char-name').waitFor();
  const name = `Rf${stamp}`.slice(0, 12);
  await page.fill('#char-name', name);
  await page.click('button:has-text("Create character")');
  await page.locator('[data-testid=character-card]').first().waitFor();
  const id = (await db.query('SELECT id FROM characters WHERE name=$1', [name])).rows[0].id;
  await db.query(`UPDATE characters SET level = 30, gold = 20000, map_id = 'greenhaven', pos_x = 38*32+16, pos_y = 13*32+22 WHERE id = $1`, [id]);
  await db.query(`INSERT INTO inventory_items (character_id, container, slot, item_id, quantity) VALUES ($1, 'bag', 30, 'rift_shard', 12)`, [id]);
  await page.locator('[data-testid=character-card]').first().click();
  await page.waitForFunction(() => window.__terrago?.client.ui.get().status === 'online', null, { timeout: 90000 });
  await page.waitForTimeout(1500);
  // Grouped menu.
  await page.hover('[data-testid=menu-group-world]');
  await page.locator('[data-testid=menu-pop-world]').waitFor();
  await page.screenshot({ path: `${OUT}/rift-01-menu.png` });
  check('World group shows its buttons', (await page.locator('[data-testid=menu-pop-world] button').count()) >= 4);
  await page.mouse.move(600, 600);
  // Rift Keeper.
  await page.evaluate(() => window.__terrago.client.ui.set({ serviceNpc: 'rift_keeper_sera', panel: 'rift' }));
  await page.locator('[data-testid=rift-start-1]').waitFor({ timeout: 8000 });
  await page.screenshot({ path: `${OUT}/rift-02-keeper.png` });
  await page.click('[data-testid=rift-start-1]');
  await page.waitForFunction(() => window.__terrago.client.ui.get().mapId === 'rift', null, { timeout: 15000 });
  await page.waitForTimeout(2500);
  await page.screenshot({ path: `${OUT}/rift-03-floor.png` });
  check('Inside the Rift with monsters', await page.evaluate(() => window.__terrago.client.monsters.size >= 4));
  check('Rift HUD with a Leave button', (await page.locator('[data-testid=rift-leave]').count()) === 1);
  await page.click('[data-testid=rift-leave]');
  await page.waitForFunction(() => window.__terrago.client.ui.get().mapId === 'greenhaven', null, { timeout: 15000 });
  check('Left the Rift', true);
  check('No page errors', errors.length === 0, errors.join(' | '));
  log('ALL RIFT CHECKS PASSED');
} catch (e) {
  console.error(e, errors);
  process.exitCode = 1;
} finally {
  await browser.close();
  await db.end();
}
