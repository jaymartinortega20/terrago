/**
 * Upgrade glow and wings in a real browser: four players with each kind of wings
 * and +4 / +7 / +10 gear stand together; one of them opens the blacksmith.
 * Run: npx tsx scripts/e2e-gear.mjs
 */
import { mkdirSync } from 'node:fs';
import pg from 'pg';
import { chromium } from 'playwright';

const WEB = process.env.WEB_URL ?? 'http://localhost:3000';
const OUT = process.env.OUT_DIR ?? 'test-results/e2e';
const DB = process.env.DATABASE_URL ?? 'postgres://terrago:terrago_dev_password@localhost:5432/terrago';
mkdirSync(OUT, { recursive: true });
const db = new pg.Pool({ connectionString: DB, max: 2 });
const log = (...a) => console.log('[gear]', ...a);
const check = (name, ok, detail = '') => {
  log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) throw new Error(`Check failed: ${name}`);
};
const stamp = Date.now().toString(36).replace(/[0-9]/g, (d) => 'abcdefghij'[d]);
const browser = await chromium.launch();
const errors = [];
const kit = [
  { wings: 'fairy_wings', weapon: 4, armor: 0 },
  { wings: 'angel_wings', weapon: 7, armor: 4 },
  { wings: 'demon_wings', weapon: 10, armor: 7 },
  { wings: 'dragon_wings', weapon: 10, armor: 10 },
];
const pages = [];
try {
  for (let i = 0; i < kit.length; i++) {
    const ctx = await browser.newContext({ viewport: { width: 1100, height: 720 } });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(`${WEB}/register`);
    await page.fill('#email', `gear${i}-${stamp}@example.com`);
    await page.fill('#password', 'shiny wings please');
    await page.fill('#confirm', 'shiny wings please');
    await page.click('button[type=submit]');
    await page.waitForURL('**/characters');
    await page.locator('#char-name').waitFor();
    const name = `Wg${i}${stamp}`.slice(0, 16);
    await page.fill('#char-name', name);
    await page.click('button:has-text("Create character")');
    await page.locator('[data-testid=character-card]').first().waitFor();
    const id = (await db.query('SELECT id FROM characters WHERE name=$1', [name])).rows[0].id;
    const k = kit[i];
    await db.query('UPDATE characters SET level = 100, map_id=$2, pos_x=$3, pos_y=$4, direction=$5 WHERE id=$1', [id, 'greenhaven', (29 + i * 2) * 32 + 16, 24 * 32 + 16, 'down']);
    await db.query(`DELETE FROM inventory_items WHERE character_id = $1 AND container = 'equip' AND slot = 0`, [id]);
    await db.query(
      `INSERT INTO inventory_items (character_id, container, slot, item_id, quantity, durability, enhance) VALUES ($1, 'equip', 0, 'star_metal_sword', 1, 400, $4), ($1, 'equip', 3, 'padded_chest', 1, 180, $2), ($1, 'equip', 8, $3, 1, 400, 0)`,
      [id, k.armor, k.wings, k.weapon],
    );
    await page.locator('[data-testid=character-card]').first().click();
    await page.waitForFunction(() => window.__terrago?.client.ui.get().status === 'online', null, { timeout: 90000 });
    pages.push({ page, id });
  }
  const viewer = pages[0].page;
  await viewer.waitForTimeout(1500);
  const seen = await viewer.evaluate(() => [...window.__terrago.client.remotes.values()].map((r) => [r.info.back, r.info.weaponGlow, r.info.armorGlow]));
  check('Others see wings and glow levels', seen.some((s) => s[0] === 'dragon_wings' && s[1] === 10 && s[2] === 10), JSON.stringify(seen));
  await viewer.evaluate(() => {
    const sc = window.__terrago.game.scene.getScene('world');
    sc.cameras.main.setZoom(2.5);
    sc.cameras.main.stopFollow();
    sc.cameras.main.centerOn(32 * 32 + 16, 23 * 32 + 16);
    if (sc.night) sc.night.setFillStyle(0x0a0f2c, 0.45);
    sc.updateLighting = () => {};
    const cv = document.querySelector('canvas');
    document.querySelectorAll('body *').forEach((el) => {
      if (el !== cv && !el.contains(cv)) el.style.visibility = 'hidden';
    });
  });
  await viewer.waitForTimeout(800);
  await viewer.screenshot({ path: `${OUT}/gear-01-wings-glow.png` });
  check('No page errors', errors.length === 0, errors.join(' | '));
  log('ALL GEAR BROWSER CHECKS PASSED');
} finally {
  await browser.close();
  await db.end();
}
