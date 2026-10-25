/**
 * Ranked arena with two real browsers, plus the pet evolution panel.
 * Run: npx tsx scripts/e2e-arena.mjs
 */
import { mkdirSync } from 'node:fs';
import pg from 'pg';
import { chromium } from 'playwright';

const WEB = process.env.WEB_URL ?? 'http://localhost:3000';
const OUT = process.env.OUT_DIR ?? 'test-results/e2e';
const DB = process.env.DATABASE_URL ?? 'postgres://terrago:terrago_dev_password@localhost:5432/terrago';
mkdirSync(OUT, { recursive: true });
const db = new pg.Pool({ connectionString: DB, max: 2 });
const log = (...a) => console.log('[arena]', ...a);
const check = (name, ok, detail = '') => {
  log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) throw new Error(`Check failed: ${name}`);
};
const stamp = Date.now().toString(36).replace(/[0-9]/g, (d) => 'abcdefghij'[d]);
const browser = await chromium.launch();
const errors = [];

async function player(tag, setup) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${WEB}/register`);
  await page.fill('#email', `ar${tag}-${stamp}@example.com`);
  await page.fill('#password', 'fight me fairly');
  await page.fill('#confirm', 'fight me fairly');
  await page.click('button[type=submit]');
  await page.waitForURL('**/characters');
  await page.locator('#char-name').waitFor();
  const name = `A${tag}${stamp}`.slice(0, 12);
  await page.fill('#char-name', name);
  await page.click('button:has-text("Create character")');
  await page.locator('[data-testid=character-card]').first().waitFor();
  const id = (await db.query('SELECT id FROM characters WHERE name=$1', [name])).rows[0].id;
  await setup(id);
  await page.locator('[data-testid=character-card]').first().click();
  await page.waitForFunction(() => window.__terrago?.client.ui.get().status === 'online', null, { timeout: 90000 });
  await page.waitForTimeout(1500);
  return { page, id, name };
}

try {
  const A = await player('a', async (id) => {
    await db.query(`UPDATE characters SET level = 35, gold = 30000, pet = 'pet_dog' WHERE id = $1`, [id]);
    await db.query(`INSERT INTO character_pets (character_id, pet_id, level, loyalty) VALUES ($1, 'pet_dog', 31, 75)`, [id]);
    await db.query(`INSERT INTO inventory_items (character_id, container, slot, item_id, quantity) VALUES ($1, 'bag', 20, 'evolution_stone', 1), ($1, 'bag', 21, 'hearty_stew', 3)`, [id]);
  });
  // Pet evolution.
  await A.page.keyboard.press('u');
  await A.page.locator('[data-testid=pet-evolve]').waitFor({ timeout: 8000 });
  await A.page.click('[data-testid=pet-evolve-btn]');
  await A.page.waitForFunction(() => window.__terrago.client.ui.get().pet?.stage === 2, null, { timeout: 5000 });
  check('Pet evolved to Grown', true);
  await A.page.screenshot({ path: `${OUT}/arena-01-pet-evolved.png` });
  await A.page.keyboard.press('Escape');
  await A.page.keyboard.press('Escape');
  // Food buff.
  await A.page.evaluate(() => window.__terrago.client.useItem(21));
  await A.page.waitForTimeout(800);
  const fx = await A.page.evaluate(() => JSON.stringify(window.__terrago.client.ui.get().effects ?? null));
  check('Food buff active', fx.includes('Hearty'), fx.slice(0, 120));

  const B = await player('b', async (id) => db.query(`UPDATE characters SET level = 36 WHERE id = $1`, [id]));
  await A.page.keyboard.press('Shift+B');
  await A.page.locator('[data-testid=arena-panel]').waitFor();
  await A.page.click('[data-testid=arena-queue]');
  await A.page.screenshot({ path: `${OUT}/arena-02-queue.png` });
  await B.page.evaluate(() => window.__terrago.client.arenaQueue(true));
  await A.page.waitForFunction(() => window.__terrago.client.ui.get().mapId === 'arena', null, { timeout: 15000 });
  await A.page.waitForTimeout(1200);
  await A.page.screenshot({ path: `${OUT}/arena-03-vs.png` });
  check('Both in the ring', (await B.page.evaluate(() => window.__terrago.client.ui.get().mapId)) === 'arena');
  await A.page.waitForFunction(() => !!window.__terrago.client.ui.get().duel, null, { timeout: 8000 });
  // B forfeits via chat command.
  await B.page.evaluate(() => window.__terrago.client.sendChat('/forfeit'));
  await A.page.locator('[data-testid=arena-result]').waitFor({ timeout: 8000 });
  await A.page.screenshot({ path: `${OUT}/arena-04-result.png` });
  check('Victory shown', (await A.page.locator('[data-testid=arena-result]').innerText()).includes('VICTORY'));
  await A.page.waitForFunction(() => window.__terrago.client.ui.get().mapId === 'greenhaven', null, { timeout: 15000 });
  check('Back home', true);
  check('No page errors', errors.length === 0, errors.join(' | '));
  log('ALL ARENA CHECKS PASSED');
} catch (e) {
  console.error(e);
  process.exitCode = 1;
} finally {
  await browser.close();
  await db.end();
}
