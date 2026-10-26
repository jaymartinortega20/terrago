/**
 * World boss badge, party finder and guild quests in a real browser.
 * Run: npx tsx scripts/e2e-group.mjs
 */
import { mkdirSync } from 'node:fs';
import pg from 'pg';
import { chromium } from 'playwright';

const WEB = process.env.WEB_URL ?? 'http://localhost:3000';
const OUT = process.env.OUT_DIR ?? 'test-results/e2e';
const DB = process.env.DATABASE_URL ?? 'postgres://terrago:terrago_dev_password@localhost:5432/terrago';
mkdirSync(OUT, { recursive: true });
const db = new pg.Pool({ connectionString: DB, max: 2 });
const log = (...a) => console.log('[group]', ...a);
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
  await page.fill('#email', `grp-${stamp}@example.com`);
  await page.fill('#password', 'better together');
  await page.fill('#confirm', 'better together');
  await page.click('button[type=submit]');
  await page.waitForURL('**/characters');
  await page.locator('#char-name').waitFor();
  const name = `Gr${stamp}`.slice(0, 12);
  await page.fill('#char-name', name);
  await page.click('button:has-text("Create character")');
  await page.locator('[data-testid=character-card]').first().waitFor();
  await db.query(`UPDATE characters SET level = 25, gold = 2000 WHERE name = $1`, [name]);
  await page.locator('[data-testid=character-card]').first().click();
  await page.waitForFunction(() => window.__terrago?.client.ui.get().status === 'online', null, { timeout: 90000 });
  await page.waitForTimeout(1500);
  // One badge takes turns between the world event and the world boss.
  await page.waitForSelector('[data-testid^=worldboss-]', { timeout: 15000 });
  check('World boss timer in the HUD', true, await page.locator('[data-testid^=worldboss-]').innerText());
  await page.evaluate(() => window.__terrago.client.ui.set({ panel: 'friends' }));
  await page.click('[data-testid=tab-party-finder]');
  await page.locator('[data-testid=party-finder]').waitFor();
  await page.selectOption('[data-testid=party-activity]', 'World boss');
  await page.click('[data-testid=party-post]');
  await page.locator('[data-testid=party-unpost]').waitFor({ timeout: 5000 });
  check('Posted on the party finder', true);
  await page.screenshot({ path: `${OUT}/group-01-finder.png` });
  await page.evaluate(() => window.__terrago.client.ui.set({ panel: 'guild' }));
  await page.fill('[data-testid=guild-name]', `Crew${stamp}`.slice(0, 20));
  await page.fill('[data-testid=guild-tag]', stamp.slice(-4).toUpperCase());
  await page.click('[data-testid=guild-create]');
  await page.locator('[data-testid=guild-quests]').waitFor({ timeout: 8000 });
  check('Guild quests shown', (await page.locator('[data-testid=guild-quests] li').count()) === 3);
  await page.locator('[data-testid=guild-quests]').scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${OUT}/group-02-guild.png` });
  check('No page errors', errors.length === 0, errors.join(' | '));
  log('ALL GROUP CHECKS PASSED');
} catch (e) {
  console.error(e, errors);
  process.exitCode = 1;
} finally {
  await browser.close();
  await db.end();
}
