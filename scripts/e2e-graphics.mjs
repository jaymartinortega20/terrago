/**
 * HD-2D graphics and the Play button when logged out.
 * Run: npx tsx scripts/e2e-graphics.mjs
 */
import { mkdirSync } from 'node:fs';
import pg from 'pg';
import { chromium } from 'playwright';

const WEB = process.env.WEB_URL ?? 'http://localhost:3000';
const OUT = process.env.OUT_DIR ?? 'test-results/e2e';
const DB = process.env.DATABASE_URL ?? 'postgres://terrago:terrago_dev_password@localhost:5432/terrago';
mkdirSync(OUT, { recursive: true });
const db = new pg.Pool({ connectionString: DB, max: 2 });
const log = (...a) => console.log('[gfx]', ...a);
const check = (name, ok, detail = '') => {
  log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) throw new Error(`Check failed: ${name}`);
};
const stamp = Date.now().toString(36).replace(/[0-9]/g, (d) => 'abcdefghij'[d]);
const browser = await chromium.launch();
const errors = [];
try {
  // Logged out: Play goes to the login page, not a blank screen.
  const anon = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  await anon.goto(WEB);
  await anon.click('[data-testid=play-link] >> nth=0');
  await anon.waitForURL('**/login**', { timeout: 10000 });
  check('Logged-out Play opens the login page', anon.url().includes('/login'));
  await anon.goto(`${WEB}/characters`);
  await anon.waitForURL('**/login**', { timeout: 60000 });
  check('Characters page sends you to log in', true);
  await anon.goto(`${WEB}/play?c=00000000-0000-0000-0000-000000000000`);
  await anon.waitForURL('**/login**', { timeout: 60000 });
  check('Play page sends you to log in', true);
  await anon.goto(WEB);
  check('Home page shows the roadmap', (await anon.locator('[data-testid=roadmap-done]').count()) >= 10);
  await anon.screenshot({ path: `${OUT}/gfx-00-home.png`, fullPage: false });
  await anon.locator('#roadmap').scrollIntoViewIfNeeded();
  await anon.screenshot({ path: `${OUT}/gfx-00-roadmap.png` });
  await anon.close();

  // In game: HD-2D vs Classic.
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${WEB}/register`);
  await page.fill('#email', `gfx-${stamp}@example.com`);
  await page.fill('#password', 'pretty shadows');
  await page.fill('#confirm', 'pretty shadows');
  await page.click('button[type=submit]');
  await page.waitForURL('**/characters');
  await page.locator('#char-name').waitFor();
  const name = `Gx${stamp}`.slice(0, 12);
  await page.fill('#char-name', name);
  await page.click('button:has-text("Create character")');
  await page.locator('[data-testid=character-card]').first().waitFor();
  const id = (await db.query('SELECT id FROM characters WHERE name=$1', [name])).rows[0].id;
  await db.query(`UPDATE characters SET map_id='greenhaven', pos_x=$2, pos_y=$3 WHERE id=$1`, [id, 36 * 32 + 16, 21 * 32 + 16]);
  await page.locator('[data-testid=character-card]').first().click();
  await page.waitForFunction(() => window.__terrago?.client.ui.get().status === 'online', null, { timeout: 90000 });
  await page.waitForTimeout(2000);
  const look = await page.evaluate(() => {
    const sc = window.__terrago.game.scene.getScene('world');
    return { passes: sc.cameras.main.postPipelines.length, ground: sc.groundImage.texture.key, shadows: sc.shadowDraws.length };
  });
  check('HD-2D uses no extra GPU passes', look.passes === 0, JSON.stringify(look));
  check('Shadows and colour baked into the ground', look.ground.endsWith(':hd') && look.shadows > 20, JSON.stringify(look));
  // Frame rate per mode (this test browser renders on the CPU — a worst case).
  await page.evaluate(() => (window.__terrago.game.scene.getScene('world').fpsWindow.start = Infinity)); // no auto-downgrade while measuring
  const fps = {};
  for (const mode of ['ultra', 'hd', 'lite', 'classic']) {
    await page.keyboard.press('Escape');
    await page.click(`[data-testid=gfx-${mode}]`);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(4000);
    fps[mode] = await page.evaluate(() => Math.round(window.__terrago.game.loop.actualFps));
  }
  log('FPS by mode (software rendering):', JSON.stringify(fps));
  check('HD-2D is much faster than Ultra', fps.hd >= fps.ultra, JSON.stringify(fps));
  await page.keyboard.press('Escape');
  await page.click('[data-testid=gfx-hd]');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${OUT}/gfx-01-hd2d.png` });
  await page.evaluate(() => window.__terrago.game.scene.getScene('world').cameras.main.setZoom(2));
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${OUT}/gfx-02-hd2d-zoom.png` });
  await page.keyboard.press('Escape');
  await page.click('[data-testid=gfx-classic]');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(500);
  check('Classic shows the plain ground', (await page.evaluate(() => window.__terrago.game.scene.getScene('world').groundImage.texture.key)).split(':').length === 2);
  await page.screenshot({ path: `${OUT}/gfx-03-classic-zoom.png` });
  await page.keyboard.press('Escape');
  await page.click('[data-testid=gfx-hd]');
  await page.keyboard.press('Escape');
  check('No page errors', errors.length === 0, errors.join(' | '));
  log('ALL GRAPHICS CHECKS PASSED');
} catch (e) {
  console.error(e);
  process.exitCode = 1;
} finally {
  await browser.close();
  await db.end();
}
