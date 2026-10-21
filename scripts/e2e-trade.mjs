/**
 * v0.4 in a real browser with two players: list on the marketplace, buy it,
 * then click the other player → Trade → offer, lock, confirm.
 * Run: node scripts/e2e-trade.mjs
 */
import { mkdirSync } from 'node:fs';
import pg from 'pg';
import { chromium } from 'playwright';

const WEB = process.env.WEB_URL ?? 'http://localhost:3000';
const OUT = process.env.OUT_DIR ?? 'test-results/e2e';
const DB = process.env.DATABASE_URL ?? 'postgres://terrago:terrago_dev_password@localhost:5432/terrago';
mkdirSync(OUT, { recursive: true });
const db = new pg.Pool({ connectionString: DB, max: 2 });
const log = (...a) => console.log('[trade]', ...a);
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
  await page.fill('#email', `trade-${tag}-${stamp}@example.com`);
  await page.fill('#password', 'gold for goods');
  await page.fill('#confirm', 'gold for goods');
  await page.click('button[type=submit]');
  await page.waitForURL('**/characters');
  const name = `${tag}${stamp}`.slice(0, 16);
  await page.fill('#char-name', name);
  await page.click('button:has-text("Create character")');
  await page.locator('[data-testid=character-card]').first().waitFor();
  const id = (await db.query('SELECT id FROM characters WHERE name=$1', [name])).rows[0].id;
  await db.query('UPDATE characters SET map_id=$2,pos_x=$3,pos_y=$4 WHERE id=$1', [id, 'greenhaven', tx * 32 + 16, 26 * 32 + 16]);
  await setup?.(id);
  await page.locator('[data-testid=character-card]').first().click();
  await page.waitForFunction(() => window.__terrago?.client.ui.get().status === 'online');
  await page.waitForTimeout(600);
  return { page, id, name, ui: () => page.evaluate(() => window.__terrago.client.ui.get()) };
}

try {
  const A = await makePlayer('Sela', 30, (id) =>
    db.query(`INSERT INTO inventory_items (character_id, container, slot, item_id, quantity) VALUES ($1,'bag',10,'iron_ore',8),($1,'bag',11,'carrot',5)`, [id]),
  );
  const B = await makePlayer('Buya', 32, (id) => db.query('UPDATE characters SET gold=2000 WHERE id=$1', [id]));

  // --- Marketplace: A lists 8 Iron Ore at 25 each ---
  await A.page.keyboard.press('p');
  await A.page.locator('[data-testid=market-panel]').waitFor();
  await A.page.click('[data-testid=market-tab-sell]');
  await A.page.locator('[data-testid=market-sell-grid] [data-testid=slot-10]').click();
  await A.page.fill('[data-testid=market-sell-price]', '25');
  await A.page.screenshot({ path: `${OUT}/v04-01-sell.png` });
  await A.page.click('[data-testid=market-list]');
  await A.page.waitForFunction(() => !window.__terrago.client.ui.get().inventory.slots.some((s) => s.itemId === 'iron_ore'));
  check('Listing put the ore in escrow', true);

  // --- B searches and buys ---
  await B.page.keyboard.press('p');
  await B.page.fill('[data-testid=market-search]', 'iron');
  const buyBtn = B.page.locator('[data-testid^=market-buy-]').first();
  await buyBtn.waitFor();
  await B.page.screenshot({ path: `${OUT}/v04-02-browse.png` });
  await buyBtn.click();
  await B.page.waitForFunction(() => window.__terrago.client.ui.get().inventory.slots.some((s) => s.itemId === 'iron_ore' && s.quantity === 8));
  check('Buyer got the ore', true, `gold now ${(await B.ui()).inventory.gold}`);
  check('Buyer paid 200', (await B.ui()).inventory.gold === 1800);
  await A.page.waitForFunction(() => window.__terrago.client.ui.get().inventory.gold > 180);
  check('Seller was paid minus tax', true, `seller gold ${(await A.ui()).inventory.gold}`);
  await A.page.keyboard.press('p');
  await B.page.keyboard.press('p');

  // --- Direct trade: B clicks A's character ---
  const pt = await B.page.evaluate((aid) => {
    const t = window.__terrago;
    const r = t.client.remotes.get(aid);
    const cam = t.game.scene.getScene('world').cameras.main;
    return r ? { x: (r.x - cam.worldView.x) * cam.zoom, y: (r.y - 14 - cam.worldView.y) * cam.zoom } : null;
  }, A.id);
  check('A visible to B', !!pt);
  await B.page.mouse.click(pt.x, pt.y);
  await B.page.locator('[data-testid=player-menu]').waitFor();
  await B.page.screenshot({ path: `${OUT}/v04-03-player-menu.png` });
  await B.page.click('[data-testid=player-trade]');
  await A.page.locator('[data-testid=trade-invite]').waitFor();
  await A.page.click('[data-testid=trade-accept]');
  await A.page.locator('[data-testid=trade-window]').waitFor();
  await B.page.locator('[data-testid=trade-window]').waitFor();

  // A offers 5 carrots, B offers 50 gold.
  await A.page.locator('[data-testid=trade-bag] [data-testid=slot-11]').click();
  await B.page.fill('[data-testid=trade-gold]', '50');
  await B.page.click('[data-testid=trade-lock]');
  await A.page.waitForFunction(() => window.__terrago.client.ui.get().trade?.theirs.locked);
  await A.page.click('[data-testid=trade-lock]');
  await B.page.waitForFunction(() => window.__terrago.client.ui.get().trade?.theirs.locked);
  await A.page.screenshot({ path: `${OUT}/v04-04-trade.png` });
  const goldA = (await A.ui()).inventory.gold;
  await A.page.click('[data-testid=trade-confirm]');
  await B.page.click('[data-testid=trade-confirm]');
  await A.page.waitForFunction(() => !window.__terrago.client.ui.get().trade);
  await B.page.waitForFunction(() => window.__terrago.client.ui.get().inventory.slots.some((s) => s.itemId === 'carrot' && s.quantity === 5));
  check('Trade swapped carrots for gold', (await A.ui()).inventory.gold === goldA + 50);
  check('Carrots left A', !(await A.ui()).inventory.slots.some((s) => s.itemId === 'carrot'));
  await B.page.screenshot({ path: `${OUT}/v04-05-done.png` });
  log('ALL v0.4 BROWSER CHECKS PASSED');
} catch (e) {
  log('ERROR', e.message);
  process.exitCode = 1;
} finally {
  await browser.close();
  await db.end();
}
