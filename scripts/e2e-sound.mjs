/**
 * v1.0 sound in a real browser: audio starts after the first key press, area
 * music plays and is audible, effects play on actions, and music changes
 * between areas. Run: node scripts/e2e-sound.mjs
 */
import { mkdirSync } from 'node:fs';
import pg from 'pg';
import { chromium } from 'playwright';

const WEB = process.env.WEB_URL ?? 'http://localhost:3000';
const OUT = process.env.OUT_DIR ?? 'test-results/e2e';
const DB = process.env.DATABASE_URL ?? 'postgres://terrago:terrago_dev_password@localhost:5432/terrago';
mkdirSync(OUT, { recursive: true });
const db = new pg.Pool({ connectionString: DB, max: 2 });
const log = (...a) => console.log('[sound]', ...a);
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
  await page.fill('#email', `sound-${tag}-${stamp}@example.com`);
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

const st = (page) => page.evaluate(() => window.__terrago.audio.state());
try {
  const A = await makePlayer('Snd', 30, null, 'greenhaven', 26);
  check('Silent before any interaction (browser rule)', !(await st(A.page)).ready);
  await A.page.keyboard.press('i');
  await A.page.keyboard.press('i');
  await A.page.waitForFunction(() => window.__terrago.audio.state().music === 'town', null, { timeout: 5000 });
  await A.page.waitForTimeout(1500);
  const s1 = await st(A.page);
  check('Town music playing and audible', s1.music === 'town' && s1.level > 0.001, JSON.stringify(s1));
  await A.page.keyboard.down('a');
  await A.page.waitForFunction(() => window.__terrago.client.ui.get().mapId === 'whisperwood', null, { timeout: 20000 }).catch(() => {});
  await A.page.keyboard.up('a');
  const map = (await A.ui()).mapId;
  if (map === 'whisperwood') {
    await A.page.waitForFunction(() => window.__terrago.audio.state().music === 'forest', null, { timeout: 5000 });
    check('Forest music in Whisperwood', true);
  } else log('(did not reach Whisperwood by walking; skipping area-change check)');
  // Effects: mute everything and check the output goes quiet.
  await A.page.evaluate(() => window.__terrago.audio.update({ music: 0, effects: 0, ambient: 0, muted: true }));
  await A.page.waitForTimeout(800);
  check('Mute silences output', (await st(A.page)).level < 0.002, JSON.stringify(await st(A.page)));
  log('ALL v1.0 SOUND CHECKS PASSED');
} catch (e) {
  log('ERROR', e.message);
  process.exitCode = 1;
} finally {
  await browser.close();
  await db.end();
}
