/**
 * Gem Shop end to end with the development (pretend) checkout.
 * Start the dev server with GEM_FAKE_PAYMENTS=true, then: npx tsx scripts/e2e-gems.mjs
 */
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';

const WEB = process.env.WEB_URL ?? 'http://localhost:3000';
const OUT = process.env.OUT_DIR ?? 'test-results/e2e';
mkdirSync(OUT, { recursive: true });
const log = (...a) => console.log('[gems]', ...a);
const check = (name, ok, detail = '') => {
  log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) throw new Error(`Check failed: ${name}`);
};
const stamp = Date.now().toString(36).replace(/[0-9]/g, (d) => 'abcdefghij'[d]);
const browser = await chromium.launch();
const errors = [];
try {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${WEB}/register`);
  await page.fill('#email', `gem-${stamp}@example.com`);
  await page.fill('#password', 'shiny gems please');
  await page.fill('#confirm', 'shiny gems please');
  await page.click('button[type=submit]');
  await page.waitForURL('**/characters');
  await page.locator('#char-name').waitFor();
  await page.fill('#char-name', `Gm${stamp}`.slice(0, 12));
  await page.click('button:has-text("Create character")');
  await page.locator('[data-testid=character-card]').first().waitFor();
  await page.locator('[data-testid=character-card]').first().click();
  await page.waitForFunction(() => window.__terrago?.client.ui.get().status === 'online', null, { timeout: 90000 });
  await page.waitForTimeout(1500);
  await page.keyboard.press('Shift+G');
  await page.locator('[data-testid=gem-shop]').waitFor();
  await page.screenshot({ path: `${OUT}/gems-01-cosmetics.png` });
  await page.click('[data-testid=gem-tab-gems]');
  await page.screenshot({ path: `${OUT}/gems-02-packs.png` });
  const [tab] = await Promise.all([ctx.waitForEvent('page'), page.click('[data-testid=pack-gems_1200]')]);
  await tab.waitForURL('**/gems?order=*', { timeout: 15000 });
  await tab.locator('[data-testid=fake-pay]').click();
  await tab.locator('text=Gems added').waitFor({ timeout: 10000 });
  await tab.screenshot({ path: `${OUT}/gems-03-return.png` });
  check('Return page confirms the Gems', true);
  await page.waitForFunction(() => window.__terrago.client.ui.get().gems === 1200, null, { timeout: 10000 });
  check('Balance updated in the game', true);
  page.on('dialog', (d) => d.accept());
  await page.click('[data-testid=gem-tab-shop]');
  await page.click('[data-testid=buy-skin_celestial_regalia]');
  await page.waitForFunction(() => window.__terrago.client.ui.get().gems === 0, null, { timeout: 8000 });
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${OUT}/gems-04-bought.png` });
  check('Bought a skin', (await page.locator('[data-testid=buy-skin_celestial_regalia]').innerText()).includes('Owned'));
  check('No page errors', errors.length === 0, errors.join(' | '));
  log('ALL GEM CHECKS PASSED');
} catch (e) {
  console.error(e);
  process.exitCode = 1;
} finally {
  await browser.close();
}
