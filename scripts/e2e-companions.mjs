/**
 * Companions in a real browser: a Beastmaster's hawk and a pet fox fight
 * alongside their owner. Run: npx tsx scripts/e2e-companions.mjs
 */
import { mkdirSync } from 'node:fs';
import pg from 'pg';
import { chromium } from 'playwright';

const WEB = process.env.WEB_URL ?? 'http://localhost:3000';
const OUT = process.env.OUT_DIR ?? 'test-results/e2e';
const DB = process.env.DATABASE_URL ?? 'postgres://terrago:terrago_dev_password@localhost:5432/terrago';
mkdirSync(OUT, { recursive: true });
const db = new pg.Pool({ connectionString: DB, max: 2 });
const log = (...a) => console.log('[companions]', ...a);
const check = (name, ok, detail = '') => {
  log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) throw new Error(`Check failed: ${name}`);
};
const stamp = Date.now().toString(36).replace(/[0-9]/g, (d) => 'abcdefghij'[d]);
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1100, height: 720 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
try {
  await page.goto(`${WEB}/register`);
  await page.fill('#email', `hawk-${stamp}@example.com`);
  await page.fill('#password', 'eyes in the sky');
  await page.fill('#confirm', 'eyes in the sky');
  await page.click('button[type=submit]');
  await page.waitForURL('**/characters');
  await page.locator('#char-name').waitFor();
  const name = `Hk${stamp}`.slice(0, 16);
  await page.fill('#char-name', name);
  await page.click('button:has-text("Archer")').catch(() => {});
  await page.click('button:has-text("Create character")');
  await page.locator('[data-testid=character-card]').first().waitFor();
  const id = (await db.query('SELECT id FROM characters WHERE name=$1', [name])).rows[0].id;
  await db.query(`UPDATE characters SET class_id = 'archer', job = 'beastmaster', level = 45, pet = 'pet_fox', map_id = 'sunfield_plains', pos_x = $2, pos_y = $3 WHERE id = $1`, [id, 44 * 32 + 16, 10 * 32 + 22]);
  await page.locator('[data-testid=character-card]').first().click();
  await page.waitForFunction(() => window.__terrago?.client.ui.get().status === 'online', null, { timeout: 60000 });
  await page.waitForTimeout(1500);
  check('The hawk circles above its Beastmaster', await page.evaluate(() => window.__terrago.game.scene.getScene('world').hawks.size === 1));
  // Replay a hawk dive and a fox pounce at the nearest monster (real damage is covered by the server tests).
  const dive = await page.evaluate(async () => {
    const t = window.__terrago;
    const c = t.client;
    const sc = t.game.scene.getScene('world');
    const me = c.ui.get().self.characterId;
    const m = c.nearestMonster(30);
    c.emit('combat', [{ s: me, t: m.info.id, a: 14, k: 'hit', sk: 'hawk' }, { s: me, t: m.info.id, a: 9, k: 'hit', sk: 'pet' }]);
    await new Promise((r) => setTimeout(r, 120));
    return { hawk: !!sc.hawks.get(me)?.strike, pet: !!sc.pets.get(me)?.strike };
  });
  check('Hawk dives and the fox pounces', dive.hawk && dive.pet, JSON.stringify(dive));
  await page.evaluate(() => window.__terrago.game.scene.getScene('world').cameras.main.setZoom(2));
  await page.screenshot({ path: `${OUT}/companions-01-fight.png` });
  await page.screenshot({ path: `${OUT}/companions-02-after.png` });
  check('No page errors', errors.length === 0, errors.join(' | '));
  log('ALL COMPANION BROWSER CHECKS PASSED');
} catch (e) {
  await page.screenshot({ path: `${OUT}/companions-failure.png` }).catch(() => {});
  throw e;
} finally {
  await browser.close();
  await db.end();
}
