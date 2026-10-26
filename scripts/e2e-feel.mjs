/**
 * Game feel and QoL in a real browser: menu unlocks, click-to-engage, tap-map walking, death screen.
 * Run: npx tsx scripts/e2e-feel.mjs
 */
import { mkdirSync } from 'node:fs';
import pg from 'pg';
import { chromium } from 'playwright';

const WEB = process.env.WEB_URL ?? 'http://localhost:3000';
const OUT = process.env.OUT_DIR ?? 'test-results/e2e';
const DB = process.env.DATABASE_URL ?? 'postgres://terrago:terrago_dev_password@localhost:5432/terrago';
mkdirSync(OUT, { recursive: true });
const db = new pg.Pool({ connectionString: DB, max: 2 });
const log = (...a) => console.log('[feel]', ...a);
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
  await page.fill('#email', `feel-${stamp}@example.com`);
  await page.fill('#password', 'snappy combat');
  await page.fill('#confirm', 'snappy combat');
  await page.click('button[type=submit]');
  await page.waitForURL('**/characters');
  await page.locator('#char-name').waitFor();
  const name = `Fe${stamp}`.slice(0, 12);
  await page.fill('#char-name', name);
  await page.click('button:has-text("Create character")');
  await page.locator('[data-testid=character-card]').first().waitFor();
  const id = (await db.query('SELECT id FROM characters WHERE name=$1', [name])).rows[0].id;
  await page.locator('[data-testid=character-card]').first().click();
  await page.waitForFunction(() => window.__terrago?.client.ui.get().status === 'online', null, { timeout: 90000 });
  await page.waitForTimeout(1500);
  check('Market hidden for a brand-new player', (await page.locator('[data-testid=menu-market]').count()) === 0 && (await page.locator('[data-testid=menu-group-social]').count()) === 0);
  await page.click('[data-testid=menu-group-world]');
  check('Arena hidden', (await page.locator('[data-testid=menu-arena]').count()) === 0);
  await page.mouse.move(600, 500);
  await page.screenshot({ path: `${OUT}/feel-01-new-menu.png` });

  // Level 16 in the fields next to slimes.
  await page.evaluate(() => window.__terrago.client.logout?.());
  await db.query(`UPDATE characters SET level = 16, map_id = 'sunfield_plains', pos_x = 30*32+16, pos_y = 8*32+22 WHERE id = $1`, [id]);
  await db.query(`INSERT INTO quest_progress (character_id, quest_id, step, done) VALUES ($1, 'q_pony', 9, true)`, [id]);
  await page.goto(`${WEB}/characters`);
  await page.locator('[data-testid=character-card]').first().click();
  await page.waitForFunction(() => window.__terrago?.client.ui.get().status === 'online' && window.__terrago.client.ui.get().mapId === 'sunfield_plains', null, { timeout: 90000 });
  await page.waitForTimeout(2000);
  await page.click('[data-testid=menu-group-social]');
  check('Market unlocked with a NEW dot', (await page.locator('[data-testid=new-market]').count()) === 1);
  await page.screenshot({ path: `${OUT}/feel-02-unlocked.png` });
  await page.click('[data-testid=menu-group-world]');
  check('Arena unlocked', (await page.locator('[data-testid=menu-arena]').count()) === 1);
  await page.mouse.move(600, 500);

  // Click a monster a few tiles away: walk over and fight.
  const target = await page.evaluate(() => {
    const c = window.__terrago.client;
    const ms = [...c.monsters.values()].filter((m) => m.hp > 0).sort((a, b) => Math.hypot(a.x - c.pos.x, a.y - c.pos.y) - Math.hypot(b.x - c.pos.x, b.y - c.pos.y));
    const m = ms.find((x) => Math.hypot(x.x - c.pos.x, x.y - c.pos.y) > 3 * 32) ?? ms[0];
    c.engage(m.info.id);
    return { id: m.info.id, d: Math.round(Math.hypot(m.x - c.pos.x, m.y - c.pos.y)) };
  });
  log('engaging', JSON.stringify(target));
  const hit = await page
    .waitForFunction((tid) => !window.__terrago.client.monsters.get(tid) || window.__terrago.client.monsters.get(tid).hp < 100, target.id, { timeout: 20000 })
    .then(() => true, () => false);
  check('Click-to-engage walked over and hit the monster', hit);
  await page.screenshot({ path: `${OUT}/feel-03-engaged.png` });

  // Tap the big map to walk somewhere.
  await page.keyboard.press('m');
  await page.locator('[data-testid=map-image]').waitFor();
  const box = await page.locator('[data-testid=map-image]').boundingBox();
  await page.mouse.click(box.x + box.width * 0.45, box.y + box.height * 0.2);
  check('Map tap starts auto-walk', await page.evaluate(() => !!window.__terrago.client.ui.get().autoWalk));

  // Death screen (simulated server events).
  await page.evaluate(() => window.__terrago.client.ui.set({ death: { by: 'Field Rat', at: Date.now() }, self: { ...window.__terrago.client.ui.get().self, hp: 0 } }));
  await page.locator('[data-testid=death-screen]').waitFor();
  await page.screenshot({ path: `${OUT}/feel-04-death.png` });
  check('Death screen explains what happened', (await page.locator('[data-testid=death-screen]').innerText()).includes('Field Rat'));
  check('No page errors', errors.length === 0, errors.join(' | '));
  log('ALL FEEL CHECKS PASSED');
} catch (e) {
  console.error(e);
  process.exitCode = 1;
} finally {
  await browser.close();
  await db.end();
}
