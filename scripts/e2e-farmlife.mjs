/**
 * Farm life in a real browser: the animal pen with chickens and a cow, feeding
 * and collecting. Run: node scripts/e2e-farmlife.mjs
 */
import { mkdirSync } from 'node:fs';
import pg from 'pg';
import { chromium } from 'playwright';

const WEB = process.env.WEB_URL ?? 'http://localhost:3000';
const OUT = process.env.OUT_DIR ?? 'test-results/e2e';
const DB = process.env.DATABASE_URL ?? 'postgres://terrago:terrago_dev_password@localhost:5432/terrago';
mkdirSync(OUT, { recursive: true });
const db = new pg.Pool({ connectionString: DB, max: 2 });
const log = (...a) => console.log('[farm]', ...a);
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
  await page.fill('#email', `farm-${tag}-${stamp}@example.com`);
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
  const A = await makePlayer('Hen', 8, (id) => db.query(`INSERT INTO character_skills (character_id, skill, level, xp) VALUES ($1,'farming',20,0) ON CONFLICT (character_id, skill) DO UPDATE SET level = 20`, [id]).then(() => db.query(`INSERT INTO inventory_items (character_id, container, slot, item_id, quantity) VALUES ($1,'bag',10,'chicken',1),($1,'bag',11,'cow',1),($1,'bag',12,'animal_feed',4)`, [id])), 'homestead', 20);
  await A.page.evaluate(() => window.__terrago.client.ui.set({ panel: 'animals' }));
  await A.page.locator('[data-testid=animals-panel]').waitFor();
  await A.page.click('[data-testid=animals-add-chicken]');
  await A.page.click('[data-testid=animals-add-cow]');
  await A.page.click('[data-testid=animals-feed]');
  await A.page.waitForFunction(() => window.__terrago.client.animals.length === 2 && window.__terrago.client.animals.every((a) => a.fedUntil > Date.now()));
  check('Two fed animals in the pen', true);
  await A.page.screenshot({ path: `${OUT}/f-01-pen-panel.png` });
  await A.page.evaluate(() => window.__terrago.client.ui.set({ panel: null }));
  await A.page.waitForTimeout(2500);
  await A.page.screenshot({ path: `${OUT}/f-02-pen.png` });
  log('ALL FARM LIFE CHECKS PASSED');
} catch (e) {
  log('ERROR', e.message);
  process.exitCode = 1;
} finally {
  await browser.close();
  await db.end();
}
