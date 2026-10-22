/**
 * Phone-size check: every menu window opens and fits on a 390x844 touch screen.
 * Run: node scripts/e2e-mobile.mjs
 */
import { mkdirSync } from 'node:fs';
import pg from 'pg';
import { chromium, devices } from 'playwright';

const WEB = process.env.WEB_URL ?? 'http://localhost:3000';
const OUT = process.env.OUT_DIR ?? 'test-results/e2e';
const DB = process.env.DATABASE_URL ?? 'postgres://terrago:terrago_dev_password@localhost:5432/terrago';
mkdirSync(OUT, { recursive: true });
const db = new pg.Pool({ connectionString: DB, max: 2 });
const log = (...a) => console.log('[mobile]', ...a);
const problems = [];
const stamp = Date.now().toString(36).replace(/[0-9]/g, (d) => 'abcdefghij'[d]);
const browser = await chromium.launch();
const ctx = await browser.newContext({ ...devices['iPhone 13'] });
const page = await ctx.newPage();
page.on('pageerror', (e) => log('pageerror:', e.message));
try {
  await page.goto(`${WEB}/register`);
  await page.fill('#email', `mob-${stamp}@example.com`);
  await page.fill('#password', 'tiny screens rule');
  await page.fill('#confirm', 'tiny screens rule');
  await page.click('button[type=submit]');
  await page.waitForURL('**/characters');
  await page.screenshot({ path: `${OUT}/m-01-create.png` });
  const name = `Mob${stamp}`.slice(0, 16);
  await page.fill('#char-name', name);
  await page.click('button:has-text("Create character")');
  await page.locator('[data-testid=character-card]').first().waitFor();
  await page.locator('[data-testid=character-card]').first().click();
  await page.waitForFunction(() => window.__terrago?.client.ui.get().status === 'online');
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `${OUT}/m-02-game.png` });
  const panels = ['character', 'inventory', 'skills', 'quests', 'map', 'journal', 'market', 'guild', 'friends', 'settings'];
  for (const p of panels) {
    await page.click('[data-testid=menu-toggle]');
    const btn = page.locator(`[data-testid=menu-${p}]`);
    if (!(await btn.isVisible())) {
      problems.push(`${p}: menu button not visible`);
      await page.click('[data-testid=menu-toggle]');
      continue;
    }
    await btn.click();
    await page.waitForTimeout(500);
    const box = await page.locator('section[role=dialog]').first().boundingBox();
    if (!box) problems.push(`${p}: no window opened`);
    else if (box.x < 0 || box.y < 0 || box.x + box.width > 391 || box.y + box.height > 845) problems.push(`${p}: window off-screen ${JSON.stringify(box)}`);
    await page.screenshot({ path: `${OUT}/m-${p}.png` });
    const close = page.locator('section[role=dialog] button[aria-label=Close]').first();
    if (await close.isVisible()) await close.click();
    await page.waitForTimeout(200);
  }
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  if (overflow > 0) problems.push(`page scrolls sideways by ${overflow}px`);
  log(problems.length ? `PROBLEMS:\n - ${problems.join('\n - ')}` : 'ALL MOBILE CHECKS PASSED');
  if (problems.length) process.exitCode = 1;
} catch (e) {
  log('ERROR', e.message);
  await page.screenshot({ path: `${OUT}/m-failure.png` }).catch(() => {});
  process.exitCode = 1;
} finally {
  await browser.close();
  await db.end();
}
