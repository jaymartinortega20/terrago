/**
 * New-player screen and the bigger bag in a real browser.
 * Run: npx tsx scripts/e2e-bags.mjs
 */
import { mkdirSync } from 'node:fs';
import pg from 'pg';
import { chromium } from 'playwright';

const WEB = process.env.WEB_URL ?? 'http://localhost:3000';
const OUT = process.env.OUT_DIR ?? 'test-results/e2e';
const DB = process.env.DATABASE_URL ?? 'postgres://terrago:terrago_dev_password@localhost:5432/terrago';
mkdirSync(OUT, { recursive: true });
const db = new pg.Pool({ connectionString: DB, max: 2 });
const log = (...a) => console.log('[bags]', ...a);
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
  await page.fill('#email', `bag-${stamp}@example.com`);
  await page.fill('#password', 'room for more');
  await page.fill('#confirm', 'room for more');
  await page.click('button[type=submit]');
  await page.waitForURL('**/characters');
  await page.locator('#char-name').waitFor();
  const name = `Bg${stamp}`.slice(0, 12);
  await page.fill('#char-name', name);
  await page.click('button:has-text("Create character")');
  await page.locator('[data-testid=character-card]').first().waitFor();
  await page.locator('[data-testid=character-card]').first().click();
  await page.waitForFunction(() => window.__terrago?.client.ui.get().status === 'online', null, { timeout: 90000 });
  await page.waitForTimeout(2500);
  check('First goal shown', (await page.locator('[data-testid=quest-tracker]').innerText()).includes('first goal'));
  check('No daily-reward nudge for a brand-new player', (await page.locator('[data-testid=daily-ready]').count()) === 0);
  await page.screenshot({ path: `${OUT}/bags-01-new-player.png` });
  const id = (await db.query('SELECT id FROM characters WHERE name=$1', [name])).rows[0].id;
  await page.keyboard.press('i');
  await page.locator('[data-testid=inventory-panel]').waitFor();
  check('Bag has 50 slots', (await page.locator('[data-testid=bag-capacity]').innerText()).includes('/50'));
  await page.click('[data-testid=slot-3]');
  await page.click('[data-testid=discard-item]');
  await page.locator('[data-testid=discard-confirm]').waitFor();
  await page.screenshot({ path: `${OUT}/bags-02-delete.png` });
  await page.click('[data-testid=discard-yes]');
  await page.waitForTimeout(600);
  const left = await db.query(`SELECT count(*)::int AS n FROM inventory_items WHERE character_id=$1 AND container='bag' AND slot=3`, [id]);
  check('Deleted', left.rows[0].n === 0);
  check('Weight shown', (await page.locator('[data-testid=bag-weight]').count()) === 1);
  await page.click('[data-testid=inventory-panel] button[aria-label=Close]');
  check('Minimap on desktop', (await page.locator('[data-testid=minimap]').count()) === 1);
  await page.screenshot({ path: `${OUT}/bags-03-minimap.png` });
  // Rebind Inventory from I to B... then press it.
  await page.keyboard.press('Escape');
  await page.locator('[data-testid=keybinds]').waitFor();
  await page.click('[data-testid=key-pets]');
  await page.keyboard.press('KeyO');
  check('Rebinding swaps clashing keys', (await page.locator('[data-testid=key-pets]').innerText()) === 'O' && (await page.locator('[data-testid=key-friends]').innerText()) === 'U');
  await page.screenshot({ path: `${OUT}/bags-04-keys.png` });
  await page.keyboard.press('Escape');
  await page.keyboard.press('KeyO');
  await page.locator('[data-testid=pet-panel]').waitFor({ timeout: 3000 });
  check('New key opens Pets', true);
  check('No page errors', errors.length === 0, errors.join(' | '));
  log('ALL BAG CHECKS PASSED');
} catch (e) {
  console.error(e);
  process.exitCode = 1;
} finally {
  await browser.close();
  await db.end();
}
