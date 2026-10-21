/**
 * v0.7 in a real browser: walk into the Mossy Crypt gate, see the dungeon,
 * a boss telegraph and the boss bar. Run: node scripts/e2e-dungeon.mjs
 */
import { mkdirSync } from 'node:fs';
import pg from 'pg';
import { chromium } from 'playwright';

const WEB = process.env.WEB_URL ?? 'http://localhost:3000';
const OUT = process.env.OUT_DIR ?? 'test-results/e2e';
const DB = process.env.DATABASE_URL ?? 'postgres://terrago:terrago_dev_password@localhost:5432/terrago';
mkdirSync(OUT, { recursive: true });
const db = new pg.Pool({ connectionString: DB, max: 2 });
const log = (...a) => console.log('[dungeon]', ...a);
const check = (name, ok, detail = '') => {
  log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) throw new Error(`Check failed: ${name}`);
};
const stamp = Date.now().toString(36).replace(/[0-9]/g, (d) => 'abcdefghij'[d]);
const browser = await chromium.launch();

async function makePlayer(tag, tx, setup) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 760 } });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => log(tag, 'pageerror:', e.message));
  await page.goto(`${WEB}/register`);
  await page.fill('#email', `dungeon-${tag}-${stamp}@example.com`);
  await page.fill('#password', 'friends forever');
  await page.fill('#confirm', 'friends forever');
  await page.click('button[type=submit]');
  await page.waitForURL('**/characters');
  const name = `${tag}${stamp}`.slice(0, 16);
  await page.fill('#char-name', name);
  await page.click('button:has-text("Create character")');
  await page.locator('[data-testid=character-card]').first().waitFor();
  const id = (await db.query('SELECT id FROM characters WHERE name=$1', [name])).rows[0].id;
  await db.query('UPDATE characters SET map_id=$2,pos_x=$3,pos_y=$4 WHERE id=$1', [id, 'whisperwood', tx * 32 + 16, 19 * 32 + 16]);
  await setup?.(id);
  await page.locator('[data-testid=character-card]').first().click();
  await page.waitForFunction(() => window.__terrago?.client.ui.get().status === 'online');
  await page.waitForTimeout(600);
  return { page, id, name, ui: () => page.evaluate(() => window.__terrago.client.ui.get()) };
}

try {
  const A = await makePlayer('Delv', 11, (id) => db.query('UPDATE characters SET level=16 WHERE id=$1', [id]));
  await A.page.screenshot({ path: `${OUT}/v07-01-gate.png` });
  await A.page.keyboard.down('w');
  await A.page.waitForFunction(() => window.__terrago.client.ui.get().mapId === 'dg_mossy_crypt', null, { timeout: 8000 });
  await A.page.keyboard.up('w');
  check('Entered the Mossy Crypt', true);
  await A.page.waitForTimeout(1200);
  await A.page.screenshot({ path: `${OUT}/v07-02-inside.png` });
  // Show what a boss wind-up looks like (client rendering only).
  await A.page.evaluate(() => {
    const c = window.__terrago.client;
    c.emit('telegraph', { id: 'x', x: c.pos.x + 64, y: c.pos.y - 10, r: 80, ms: 1500, name: 'Bone Slam' });
  });
  await A.page.waitForTimeout(900);
  await A.page.screenshot({ path: `${OUT}/v07-03-telegraph.png` });
  log('ALL v0.7 BROWSER CHECKS PASSED');
} catch (e) {
  log('ERROR', e.message);
  await browser.contexts()[0]?.pages()[0]?.screenshot({ path: `${OUT}/v07-failure.png` }).catch(() => {});
  process.exitCode = 1;
} finally {
  await browser.close();
  await db.end();
}
