/**
 * v0.9 in a real browser: daily reward nudge + Journal (claim, achievements,
 * leaderboards), then the admin page (overview, players, announcement shows
 * in game). Run: node scripts/e2e-journal.mjs
 */
import { mkdirSync } from 'node:fs';
import pg from 'pg';
import { chromium } from 'playwright';

const WEB = process.env.WEB_URL ?? 'http://localhost:3000';
const OUT = process.env.OUT_DIR ?? 'test-results/e2e';
const DB = process.env.DATABASE_URL ?? 'postgres://terrago:terrago_dev_password@localhost:5432/terrago';
mkdirSync(OUT, { recursive: true });
const db = new pg.Pool({ connectionString: DB, max: 2 });
const log = (...a) => console.log('[journal]', ...a);
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
  await page.fill('#email', `journal-${tag}-${stamp}@example.com`);
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

try {
  const A = await makePlayer('Jrnl', 30, (id) => db.query('UPDATE characters SET level=12 WHERE id=$1', [id]), 'greenhaven', 26);
  await A.page.locator('[data-testid=daily-ready]').waitFor();
  await A.page.click('[data-testid=daily-ready]');
  await A.page.locator('[data-testid=journal-panel]').waitFor();
  await A.page.screenshot({ path: `${OUT}/v09-01-journal.png` });
  const g0 = (await A.ui()).inventory.gold;
  await A.page.click('[data-testid=claim-login]');
  await A.page.waitForFunction((g) => window.__terrago.client.ui.get().inventory.gold > g, g0);
  check('Login reward claimed', true);
  await A.page.click('[data-testid=journal-tab-achievements]');
  await A.page.locator('[data-testid=achievements] li').first().waitFor();
  await A.page.screenshot({ path: `${OUT}/v09-02-achievements.png` });
  await A.page.click('[data-testid=journal-tab-ranks]');
  await A.page.locator('[data-testid=leaderboard] li').first().waitFor();
  await A.page.screenshot({ path: `${OUT}/v09-03-leaderboard.png` });
  check('Leaderboard shows', true);

  // Make this account an admin and use the admin page in a second tab.
  await db.query(`UPDATE users SET roles = ARRAY['player','admin'] WHERE id = (SELECT user_id FROM characters WHERE id = $1)`, [A.id]);
  const admin = await A.page.context().newPage();
  await admin.goto(`${WEB}/admin`);
  await admin.locator('[data-testid=admin-stats]').waitFor();
  await admin.screenshot({ path: `${OUT}/v09-04-admin.png`, fullPage: true });
  await admin.click('[data-testid=admin-tab-players]');
  await admin.locator('[data-testid=admin-players] tbody tr').first().waitFor();
  await admin.click('[data-testid=admin-tab-tools]');
  await admin.fill('[data-testid=admin-announce]', 'Welcome to TerraGo v0.9!');
  await admin.click('[data-testid=admin-announce-send]');
  await A.page.locator('[data-testid=announcement]').waitFor();
  await A.page.screenshot({ path: `${OUT}/v09-05-announcement.png` });
  check('Announcement reached the game', true);
  log('ALL v0.9 BROWSER CHECKS PASSED');
} catch (e) {
  log('ERROR', e.message);
  process.exitCode = 1;
} finally {
  await browser.close();
  await db.end();
}
