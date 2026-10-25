/**
 * Quest auto-walk and the bounty board in a real browser.
 * Run: npx tsx scripts/e2e-quests.mjs
 */
import { mkdirSync } from 'node:fs';
import pg from 'pg';
import { chromium } from 'playwright';

const WEB = process.env.WEB_URL ?? 'http://localhost:3000';
const OUT = process.env.OUT_DIR ?? 'test-results/e2e';
const DB = process.env.DATABASE_URL ?? 'postgres://terrago:terrago_dev_password@localhost:5432/terrago';
mkdirSync(OUT, { recursive: true });
const db = new pg.Pool({ connectionString: DB, max: 2 });
const log = (...a) => console.log('[quests]', ...a);
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
  await page.fill('#email', `qst-${stamp}@example.com`);
  await page.fill('#password', 'walk me there');
  await page.fill('#confirm', 'walk me there');
  await page.click('button[type=submit]');
  await page.waitForURL('**/characters');
  await page.locator('#char-name').waitFor();
  const name = `Qw${stamp}`.slice(0, 12);
  await page.fill('#char-name', name);
  await page.click('button:has-text("Create character")');
  await page.locator('[data-testid=character-card]').first().waitFor();
  const id = (await db.query('SELECT id FROM characters WHERE name=$1', [name])).rows[0].id;
  // A level-6 ranger's apprentice, standing in Oakhaven with the pony quest under way.
  await db.query(`UPDATE characters SET level = 6, map_id = 'greenhaven', pos_x = 28*32+16, pos_y = 26*32+22 WHERE id = $1`, [id]);
  await db.query(`INSERT INTO quest_progress (character_id, quest_id) VALUES ($1, 'q_pony')`, [id]);
  await page.locator('[data-testid=character-card]').first().click();
  await page.waitForFunction(() => window.__terrago?.client.ui.get().status === 'online', null, { timeout: 90000 });
  await page.waitForTimeout(2000);
  await page.locator('[data-testid=quest-go-q_pony]').click();
  await page.screenshot({ path: `${OUT}/quests-01-walking.png` });
  await page.waitForFunction(() => !window.__terrago.client.ui.get().autoWalk, null, { timeout: 30000 });
  const at = await page.evaluate(() => ({ x: Math.floor(window.__terrago.client.pos.x / 32), y: Math.floor(window.__terrago.client.pos.y / 32) }));
  check('Auto-walk reached Stablemaster Hana', Math.hypot(at.x - 44, at.y - 23) <= 2, JSON.stringify(at));
  await page.screenshot({ path: `${OUT}/quests-02-arrived.png` });

  // Cross-map: walk to Ranger Wren in Sunfield Plains (through the south gate).
  await page.evaluate(() => window.__terrago.client.autoWalkTo({ map: 'sunfield_plains', x: 26, y: 24, label: 'Ranger Wren' }));
  await page.waitForFunction(() => window.__terrago.client.ui.get().mapId === 'sunfield_plains', null, { timeout: 60000 });
  await page.waitForFunction(() => !window.__terrago.client.ui.get().autoWalk, null, { timeout: 30000 });
  const at2 = await page.evaluate(() => ({ x: Math.floor(window.__terrago.client.pos.x / 32), y: Math.floor(window.__terrago.client.pos.y / 32) }));
  check('Auto-walk crossed maps to Ranger Wren', Math.hypot(at2.x - 26, at2.y - 24) <= 2, JSON.stringify(at2));

  // Bounty board.
  await page.evaluate(() => window.__terrago.client.ui.set({ serviceNpc: 'ranger_wren', panel: 'bounty' }));
  await page.locator('[data-testid=bounty-0]').waitFor({ timeout: 8000 });
  check('Three bounties posted', (await page.locator('[data-testid^=bounty-accept-]').count()) === 3);
  await page.click('[data-testid=bounty-accept-0]');
  await page.waitForTimeout(800);
  check('Bounty accepted', (await page.locator('[data-testid=bounty-accept-0]').count()) === 0);
  await page.screenshot({ path: `${OUT}/quests-03-bounties.png` });
  check('No page errors', errors.length === 0, errors.join(' | '));
  log('ALL QUEST CHECKS PASSED');
} catch (e) {
  console.error(e);
  process.exitCode = 1;
} finally {
  await browser.close();
  await db.end();
}
