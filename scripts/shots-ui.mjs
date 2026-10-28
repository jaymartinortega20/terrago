/**
 * Screenshots of every screen (home, login, register, characters, creator,
 * game HUD and menus, admin) for a quick visual review.
 * Run: npx tsx scripts/shots-ui.mjs [outDir]
 */
import { mkdirSync } from 'node:fs';
import pg from 'pg';
import { chromium } from 'playwright';

const WEB = process.env.WEB_URL ?? 'http://localhost:3000';
const OUT = process.argv[2] ?? 'test-results/ui';
const DB = process.env.DATABASE_URL ?? 'postgres://terrago:terrago_dev_password@localhost:5432/terrago';
mkdirSync(OUT, { recursive: true });
const db = new pg.Pool({ connectionString: DB, max: 2 });
const stamp = Date.now().toString(36).replace(/[0-9]/g, (d) => 'abcdefghij'[d]);
const only = process.env.ONLY?.split(',');
const want = (n) => !only || only.includes(n);
const b = await chromium.launch();
const errors = [];
for (const [tag, vp] of [['desk', { width: 1366, height: 800 }], ...(process.env.PHONE ? [['phone', { width: 390, height: 844 }]] : [])]) {
  const ctx = await b.newContext({ viewport: vp, ...(tag === 'phone' ? { isMobile: true, hasTouch: true } : {}) });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  const shot = (n) => page.screenshot({ path: `${OUT}/${tag}-${n}.png` });
  if (want('home')) {
    await page.goto(`${WEB}/`, { waitUntil: 'load' });
    await page.waitForTimeout(1500);
    await shot('home');
  }
  await page.goto(`${WEB}/login`);
  await page.waitForTimeout(800);
  if (want('login')) await shot('login');
  await page.goto(`${WEB}/register`);
  await page.waitForTimeout(800);
  if (want('register')) await shot('register');
  const email = `ui-${tag}-${stamp}@example.com`;
  await page.fill('#email', email);
  await page.fill('#password', 'shiny buttons');
  await page.fill('#confirm', 'shiny buttons');
  await page.click('button[type=submit]');
  await page.waitForURL('**/characters');
  await page.locator('#char-name').waitFor();
  await page.waitForTimeout(800);
  if (want('create')) await shot('create');
  const name = `Ui${tag}${stamp}`.slice(0, 14);
  await page.fill('#char-name', name);
  await page.click('button:has-text("Create character")');
  await page.locator('[data-testid=character-card]').first().waitFor();
  await page.waitForTimeout(500);
  if (want('characters')) await shot('characters');
  await db.query(`UPDATE users SET roles = ARRAY['player','admin'] WHERE email = $1`, [email]).catch(() => {});
  await page.locator('[data-testid=character-card]').first().click();
  await page.waitForFunction(() => window.__terrago?.client.ui.get().status === 'online', null, { timeout: 90000 });
  await page.waitForTimeout(3000);
  if (want('game')) await shot('game');
  for (const [key, n] of [['i', 'inventory'], ['c', 'character'], ['k', 'skills'], ['j', 'quests'], ['Escape', 'settings']]) {
    if (!want(n)) continue;
    await page.keyboard.press(key);
    await page.waitForTimeout(700);
    await shot(n);
    await page.keyboard.press(key === 'Escape' ? 'Escape' : key);
    await page.waitForTimeout(300);
  }
  if (want('admin') && tag === 'desk') {
    await page.goto(`${WEB}/admin`);
    await page.waitForTimeout(2500);
    await shot('admin');
  }
  await ctx.close();
}
console.log('errors', errors.slice(0, 5));
await b.close();
await db.end();
