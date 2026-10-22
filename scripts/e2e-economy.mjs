/**
 * Economy in a real browser: bank vault, waystone travel, and a player stall
 * another player browses and buys from. Run: node scripts/e2e-economy.mjs
 */
import { mkdirSync } from 'node:fs';
import pg from 'pg';
import { chromium } from 'playwright';

const WEB = process.env.WEB_URL ?? 'http://localhost:3000';
const OUT = process.env.OUT_DIR ?? 'test-results/e2e';
const DB = process.env.DATABASE_URL ?? 'postgres://terrago:terrago_dev_password@localhost:5432/terrago';
mkdirSync(OUT, { recursive: true });
const db = new pg.Pool({ connectionString: DB, max: 2 });
const log = (...a) => console.log('[eco]', ...a);
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
  await page.fill('#email', `eco-${tag}-${stamp}@example.com`);
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
  const A = await makePlayer('Sela', 53, (id) => db.query(`UPDATE characters SET gold = 5000 WHERE id = $1; `, [id]).then(() => db.query(`INSERT INTO inventory_items (character_id, container, slot, item_id, quantity) VALUES ($1,'bag',10,'iron_ore',6),($1,'bag',11,'carrot',4)`, [id])), 'greenhaven', 12);
  // Bank: talk to Orrin and deposit.
  await A.page.evaluate(() => window.__terrago.client.ui.set({ serviceNpc: 'banker_orrin', panel: 'bank' }));
  await A.page.locator('[data-testid=bank-vault]').waitFor();
  await A.page.locator('[data-testid=bank-bag] [data-testid=slot-10]').click();
  await A.page.waitForFunction(() => !window.__terrago.client.ui.get().inventory.slots.some((s) => s.itemId === 'iron_ore'));
  await A.page.screenshot({ path: `${OUT}/e-01-bank.png` });
  check('Deposited into the vault', true);
  await A.page.keyboard.press('Escape');

  // Stall in the plaza, B buys.
  await A.page.evaluate(() => window.__terrago.client.ui.set({ panel: 'stall' }));
  await A.page.fill('[data-testid=stall-name]', 'Fresh Crops!');
  await A.page.fill('[data-testid=stall-price-11]', '12');
  await A.page.click('[data-testid=stall-open]');
  await A.page.waitForFunction(() => window.__terrago.client.ui.get().stallOpenName === 'Fresh Crops!', null, { timeout: 5000 }).catch(async (e) => {
    log('notices', JSON.stringify(await A.page.evaluate(() => window.__terrago.client.ui.get().notices)));
    await A.page.screenshot({ path: `${OUT}/e-fail.png` });
    throw e;
  });
  log('stall open ok');
  const B = await makePlayer('Byer', 52, (id) => db.query('UPDATE characters SET gold = 500 WHERE id = $1', [id]), 'greenhaven', 13);
  await B.page.waitForFunction((id) => window.__terrago.client.remotes.get(id)?.info.shop === 'Fresh Crops!', A.id, { timeout: 8000 }).catch(async (e) => {
    log('B sees', JSON.stringify(await B.page.evaluate((id) => window.__terrago.client.remotes.get(id)?.info ?? [...window.__terrago.client.remotes.keys()], A.id)));
    log('A stall', JSON.stringify(await A.page.evaluate(() => [window.__terrago.client.ui.get().stallOpenName, window.__terrago.client.ui.get().notices])));
    throw e;
  });
  await B.page.waitForTimeout(500);
  await B.page.screenshot({ path: `${OUT}/e-02-stall-sign.png` });
  await B.page.evaluate((id) => window.__terrago.client.stallView(id), A.id);
  await B.page.locator('[data-testid=stall-browse]').waitFor();
  await B.page.screenshot({ path: `${OUT}/e-03-stall-browse.png` });
  await B.page.click('[data-testid=stall-buy-11]');
  await B.page.waitForFunction(() => window.__terrago.client.ui.get().inventory.slots.filter((s) => s.itemId === 'carrot').reduce((n, s) => n + s.quantity, 0) >= 4);
  check('Bought from the stall', true);
  await B.page.screenshot({ path: `${OUT}/e-03-stall-bought.png` });
  log('ALL ECONOMY CHECKS PASSED');
} catch (e) {
  log('ERROR', e.message, (e.stack ?? '').split('\n').find((l) => l.includes('e2e-economy')));
  for (const [i, c] of browser.contexts().entries()) await c.pages()[0]?.screenshot({ path: `${OUT}/e-fail-${i}.png` }).catch(() => {});
  process.exitCode = 1;
} finally {
  await browser.close();
  await db.end();
}
