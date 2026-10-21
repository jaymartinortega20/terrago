/**
 * v0.8 in a real browser: walk from Irondeep into Frostpine Peaks, then look at
 * night + snow, swamp fog at dusk, and valley rain (clock overridden for the
 * screenshots). Run: node scripts/e2e-regions.mjs
 */
import { mkdirSync } from 'node:fs';
import pg from 'pg';
import { chromium } from 'playwright';

const WEB = process.env.WEB_URL ?? 'http://localhost:3000';
const OUT = process.env.OUT_DIR ?? 'test-results/e2e';
const DB = process.env.DATABASE_URL ?? 'postgres://terrago:terrago_dev_password@localhost:5432/terrago';
mkdirSync(OUT, { recursive: true });
const db = new pg.Pool({ connectionString: DB, max: 2 });
const log = (...a) => console.log('[regions]', ...a);
const check = (name, ok, detail = '') => {
  log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) throw new Error(`Check failed: ${name}`);
};
const stamp = Date.now().toString(36).replace(/[0-9]/g, (d) => 'abcdefghij'[d]);
const browser = await chromium.launch();

async function makePlayer(tag, tx, setup, mapId = 'whisperwood', ty = 19) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 760 } });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => log(tag, 'pageerror:', e.message));
  await page.goto(`${WEB}/register`);
  await page.fill('#email', `regions-${tag}-${stamp}@example.com`);
  await page.fill('#password', 'friends forever');
  await page.fill('#confirm', 'friends forever');
  await page.click('button[type=submit]');
  await page.waitForURL('**/characters');
  const name = `${tag}${stamp}`.slice(0, 16);
  await page.fill('#char-name', name);
  await page.click('button:has-text("Create character")');
  await page.locator('[data-testid=character-card]').first().waitFor();
  const id = (await db.query('SELECT id FROM characters WHERE name=$1', [name])).rows[0].id;
  await db.query('UPDATE characters SET map_id=$2,pos_x=$3,pos_y=$4 WHERE id=$1', [id, mapId, tx * 32 + 16, ty * 32 + 16]);
  await setup?.(id);
  await page.locator('[data-testid=character-card]').first().click();
  await page.waitForFunction(() => window.__terrago?.client.ui.get().status === 'online').catch(async (e) => {
    await page.screenshot({ path: `${OUT}/v08-fail-${tag}.png` });
    log(tag, 'status', await page.evaluate(() => JSON.stringify(window.__terrago?.client.ui.get().statusMessage)));
    throw e;
  });
  await page.waitForTimeout(600);
  return { page, id, name, ui: () => page.evaluate(() => window.__terrago.client.ui.get()) };
}

const at = (page, t) => page.evaluate((t) => { const c = window.__terrago.client; const s = Date.now(); c.serverNow = () => t + (Date.now() - s); }, t);
const T = JSON.parse(process.env.TIMES);
try {
  const A = await makePlayer('Peak', 36, (id) => db.query('UPDATE characters SET level=22 WHERE id=$1', [id]), 'irondeep_entrance', 19);
  await A.page.keyboard.down('d');
  await A.page.waitForFunction(() => window.__terrago.client.ui.get().mapId === 'frostpine_peaks', null, { timeout: 8000 });
  await A.page.keyboard.up('d');
  check('Walked into Frostpine Peaks', true);
  await at(A.page, T.snowNight);
  await A.page.waitForTimeout(5600);
  await A.page.screenshot({ path: `${OUT}/v08-01-peaks-night-snow.png` });
  const snow = await A.page.locator('[data-testid=weather-snow]').count();
  check('Snow shows', snow === 1);
  void (await A.page.locator('[data-testid=weather-snow]').count() === 1);
  await A.page.context().close();
  const B = await makePlayer('Bog', 3, null, 'mirefen_swamp', 21);
  await at(B.page, T.fogDusk);
  await B.page.waitForTimeout(5600);
  await B.page.screenshot({ path: `${OUT}/v08-02-swamp-fog.png` });
  await B.page.context().close();
  const C = await makePlayer('Rain', 30, null, 'greenhaven', 26);
  await at(C.page, T.rainDay);
  await C.page.waitForTimeout(5600);
  await C.page.screenshot({ path: `${OUT}/v08-03-valley-rain.png` });
  check('Rain shows', await C.page.locator('[data-testid=weather-rain]').count() === 1);
  log('ALL v0.8 BROWSER CHECKS PASSED');
} catch (e) {
  log('ERROR', e.message);
  process.exitCode = 1;
} finally {
  await browser.close();
  await db.end();
}
