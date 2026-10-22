/**
 * Game Master tools in a real browser: the admin picks their own character
 * ("Me"), sends items and Gold, sets level, gives and wears a skin, then
 * plays and sees it all in game (wardrobe included).
 * Run: npx tsx scripts/e2e-gm.mjs
 */
import { mkdirSync } from 'node:fs';
import pg from 'pg';
import { chromium } from 'playwright';

const WEB = process.env.WEB_URL ?? 'http://localhost:3000';
const OUT = process.env.OUT_DIR ?? 'test-results/e2e';
const DB = process.env.DATABASE_URL ?? 'postgres://terrago:terrago_dev_password@localhost:5432/terrago';
mkdirSync(OUT, { recursive: true });
const db = new pg.Pool({ connectionString: DB, max: 2 });
const log = (...a) => console.log('[gm]', ...a);
const check = (name, ok, detail = '') => {
  log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) throw new Error(`Check failed: ${name}`);
};
const stamp = Date.now().toString(36).replace(/[0-9]/g, (d) => 'abcdefghij'[d]);
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('dialog', (d) => d.accept());

try {
  const email = `gm-${stamp}@example.com`;
  await page.goto(`${WEB}/register`);
  await page.fill('#email', email);
  await page.fill('#password', 'all the power');
  await page.fill('#confirm', 'all the power');
  await page.click('button[type=submit]');
  await page.waitForURL('**/characters');
  const name = `Gm${stamp}`.slice(0, 16);
  await page.fill('#char-name', name);
  await page.click('button:has-text("Create character")');
  await page.locator('[data-testid=character-card]').first().waitFor();
  await db.query(`UPDATE users SET roles = ARRAY['player','admin'] WHERE email = $1`, [email]);
  const id = (await db.query('SELECT id FROM characters WHERE name=$1', [name])).rows[0].id;

  await page.goto(`${WEB}/admin`);
  await page.click('[data-testid=admin-tab-players]');
  await page.locator('[data-testid=gm-mine] button').first().click();
  await page.locator('[data-testid=gm-panel]').waitFor();
  await page.fill('[data-testid=gm-search]', 'star metal');
  await page.locator('[data-testid=gm-items] li').first().waitFor();
  await page.click('button:has-text("Add all")');
  await page.fill('[data-testid=gm-search]', 'carrot');
  await page.locator('[data-testid=gm-items] li button:has-text("+99")').first().click();
  await page.click('button:has-text("+100M")');
  await page.screenshot({ path: `${OUT}/gm-01-panel.png`, fullPage: true });
  await page.click('[data-testid=gm-send]');
  await page.locator('[role=status]', { hasText: 'Sent' }).waitFor();
  const gold = Number((await db.query('SELECT gold FROM characters WHERE id = $1', [id])).rows[0].gold);
  check('Got 100M Gold', gold >= 100_000_000, gold.toLocaleString());
  const swords = (await db.query(`SELECT count(*)::int AS n FROM inventory_items WHERE character_id = $1 AND item_id LIKE 'star_metal_%'`, [id])).rows[0].n;
  check('Got every Star Metal item', swords >= 5, `${swords} items`);

  await page.fill('[data-testid=gm-level]', '100');
  await page.click('[data-testid=gm-level-set]');
  await page.locator('[role=status]', { hasText: 'Levels set' }).waitFor();
  const emperor = await page.evaluate(() => [...document.querySelectorAll('[data-testid=gm-skins] li')].findIndex((li) => li.textContent.includes('Golden Emperor')));
  await page.locator('[data-testid=gm-skins] li').nth(emperor).locator('button', { hasText: 'Give & wear' }).click();
  await page.locator('[role=status]', { hasText: 'Golden Emperor' }).waitFor();
  check('Skin given and worn', (await db.query(`SELECT appearance->>'outfit' AS o FROM characters WHERE id = $1`, [id])).rows[0].o !== '0');

  // Play as that character and see it.
  await db.query('UPDATE characters SET map_id=$2,pos_x=$3,pos_y=$4 WHERE id=$1', [id, 'greenhaven', 31 * 32 + 16, 24 * 32 + 16]);
  await page.goto(`${WEB}/characters`);
  await page.locator('[data-testid=character-card]').first().click();
  await page.waitForFunction(() => window.__terrago?.client.ui.get().status === 'online');
  await page.waitForTimeout(1200);
  const self = await page.evaluate(() => window.__terrago.client.ui.get().self);
  check('In game: level 100 and rich', self.level === 100 && self.gold >= 100_000_000, `Lv ${self.level}, ${self.gold}`);
  await page.keyboard.press('c');
  await page.locator('[data-testid=wardrobe]').waitFor();
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${OUT}/gm-02-ingame.png` });
  check('No page errors', errors.length === 0, errors.join(' | '));
  log('ALL GM BROWSER CHECKS PASSED');
} catch (e) {
  await page.screenshot({ path: `${OUT}/gm-failure.png` }).catch(() => {});
  throw e;
} finally {
  await browser.close();
  await db.end();
}
