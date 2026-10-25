/**
 * Mount stable, mount channel, mount gear and pet growth in a real browser.
 * Run: npx tsx scripts/e2e-mounts.mjs
 */
import { mkdirSync } from 'node:fs';
import pg from 'pg';
import { chromium } from 'playwright';

const WEB = process.env.WEB_URL ?? 'http://localhost:3000';
const OUT = process.env.OUT_DIR ?? 'test-results/e2e';
const DB = process.env.DATABASE_URL ?? 'postgres://terrago:terrago_dev_password@localhost:5432/terrago';
mkdirSync(OUT, { recursive: true });
const db = new pg.Pool({ connectionString: DB, max: 2 });
const log = (...a) => console.log('[mounts]', ...a);
const check = (name, ok, detail = '') => {
  log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) throw new Error(`Check failed: ${name}`);
};
const stamp = Date.now().toString(36).replace(/[0-9]/g, (d) => 'abcdefghij'[d]);
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const errors = [];

async function makeCharacter(ctx, tag, setup) {
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${WEB}/register`);
  await page.fill('#email', `${tag}-${stamp}@example.com`);
  await page.fill('#password', 'saddle up please');
  await page.fill('#confirm', 'saddle up please');
  await page.click('button[type=submit]');
  await page.waitForURL('**/characters');
  await page.locator('#char-name').waitFor();
  const name = `${tag}${stamp}`.slice(0, 16);
  await page.fill('#char-name', name);
  await page.click('button:has-text("Create character")');
  await page.locator('[data-testid=character-card]').first().waitFor();
  const id = (await db.query('SELECT id FROM characters WHERE name=$1', [name])).rows[0].id;
  await setup(id);
  await page.locator('[data-testid=character-card]').first().click();
  await page.waitForFunction(() => window.__terrago?.client.ui.get().status === 'online', null, { timeout: 90000 });
  await page.waitForTimeout(1200);
  return { page, id };
}

async function give(id, items) {
  let slot = 12;
  for (const [item, n] of items) {
    await db.query(`INSERT INTO inventory_items (character_id, container, slot, item_id, quantity, durability) VALUES ($1, 'bag', $2, $3, $4, null)`, [id, slot++, item, n]);
  }
}

try {
  // --- Desktop: the stable, mount gear, riding and the pet menu ---------------
  if (!process.env.PHONE_ONLY) {
  const desk = await browser.newContext({ viewport: { width: 1280, height: 760 } });
  const { page, id } = await makeCharacter(desk, 'Rd', async (cid) => {
    await db.query(`UPDATE characters SET level = 95, gold = 200000, pet = 'pet_dragonling', map_id = 'greenhaven', pos_x = $2, pos_y = $3, direction = 'left' WHERE id = $1`, [cid, 45 * 32 + 16, 23 * 32 + 16]);
    await give(cid, [['celestial_stag', 1], ['war_wolf', 1], ['brown_pony', 1], ['pet_dragonling', 1], ['premium_pet_treat', 40], ['minnow', 5]]);
  });
  await page.keyboard.down('Shift');
  await page.keyboard.press('KeyZ');
  await page.keyboard.up('Shift');
  await page.locator('[data-testid=stable-panel]').waitFor();
  await page.locator('[data-testid=mount-showcase] canvas').waitFor({ timeout: 20000 });
  await page.click('[data-testid=stable-celestial_stag]');
  await page.click('[data-testid=stable-choose]');
  // Buy and put on gear (we're next to Hana).
  await page.click('button:has-text("Barding")');
  await page.click('[data-testid=style-barding_celestial]');
  await page.waitForTimeout(400);
  await page.click('[data-testid=style-barding_celestial]');
  await page.click('button:has-text("Trail")');
  await page.click('[data-testid=style-trail_frost]');
  await page.waitForTimeout(400);
  await page.click('[data-testid=style-trail_frost]');
  await page.click('button:has-text("Saddle")');
  await page.click('[data-testid=style-saddle_gilded]');
  await page.waitForTimeout(400);
  await page.click('[data-testid=style-saddle_gilded]');
  await page.waitForTimeout(1200);
  const look = await page.evaluate(() => window.__terrago.client.ui.get().self.mountLook);
  check('Mount gear bought and equipped', look.barding === 'barding_celestial' && look.trail === 'trail_frost' && look.saddle === 'saddle_gilded', JSON.stringify(look));
  const bought = await db.query(`SELECT count(*)::int AS n FROM character_mount_styles WHERE character_id = $1`, [id]);
  check('Purchases saved', bought.rows[0].n === 3);
  await page.screenshot({ path: `${OUT}/mounts-01-stable.png` });
  // A locked mount shows where to find it.
  await page.click('[data-testid=stable-mech_hovergear]');
  await page.waitForTimeout(600);
  const src = await page.locator('[data-testid=stable-source]').innerText();
  check('Locked mounts say where they drop', /Rock Golem/.test(src), src.replace(/\n/g, ' '));
  await page.screenshot({ path: `${OUT}/mounts-02-locked.png` });
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  if (await page.locator('[data-testid=stable-panel]').count()) await page.click('[data-testid=stable-panel] button[aria-label=Close]');

  // Ride: Z starts the 0.5 s channel, then you're on.
  await page.keyboard.press('KeyZ');
  await page.waitForFunction(() => window.__terrago.client.ui.get().self.mountChannelUntil, null, { timeout: 3000 });
  await page.waitForTimeout(200);
  await page.evaluate(() => {
    const sc = window.__terrago.game.scene.getScene('world');
    sc.cameras.main.setZoom(2.4);
  });
  await page.screenshot({ path: `${OUT}/mounts-03-channel.png` });
  await page.waitForFunction(() => window.__terrago.client.ui.get().self.mount === 'celestial_stag', null, { timeout: 4000 });
  const speed = await page.evaluate(() => window.__terrago.client.ui.get().self.speed);
  check('Riding the Celestial Stag at +130%', speed === 2.3, String(speed));
  await page.keyboard.down('ArrowLeft');
  await page.waitForTimeout(700);
  await page.screenshot({ path: `${OUT}/mounts-04-riding.png` });
  await page.keyboard.up('ArrowLeft');

  // Pets: feed treats, spend growth points.
  await page.keyboard.press('KeyU');
  await page.locator('[data-testid=pet-card]').waitFor();
  for (let i = 0; i < 25; i++) {
    const b = page.locator('[data-testid=feed-premium_pet_treat]');
    if (!(await b.count())) break;
    await b.click();
    await page.waitForTimeout(120);
  }
  await page.waitForTimeout(500);
  const lvl = Number((await page.locator('[data-testid=pet-level]').innerText()).replace(/\D/g, ''));
  check('Treats level the pet up', lvl >= 30, `Lv ${lvl}`);
  await page.click('[data-testid=grow-speed]');
  await page.click('[data-testid=grow-crit]');
  await page.waitForTimeout(500);
  const row = await db.query(`SELECT level, loyalty, growth FROM character_pets WHERE character_id = $1 AND pet_id = 'pet_dragonling'`, [id]);
  check('Pet growth saved', row.rows[0].growth.speed === 1 && row.rows[0].growth.crit === 1, JSON.stringify(row.rows[0]));
  check('Loyalty 80+ unlocks the third skill', !(await page.locator('[data-testid=pet-skill-3]').innerText()).includes('🔒'));
  await page.screenshot({ path: `${OUT}/mounts-05-pets.png` });
  await desk.close();
  }

  // --- Phone: the horseshoe button above the joystick ----------------------------
  const phone = await browser.newContext({ viewport: { width: 860, height: 400 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
  const m = await makeCharacter(phone, 'Mb', async (cid) => {
    await db.query(`UPDATE characters SET level = 50, map_id = 'sunfield_plains', pos_x = $2, pos_y = $3 WHERE id = $1`, [cid, 30 * 32 + 16, 90 * 32 + 16]);
    await give(cid, [['war_wolf', 1]]);
  });
  await m.page.locator('[data-testid=mount-button]').waitFor();
  await m.page.screenshot({ path: `${OUT}/mounts-06-phone-walk.png` });
  await m.page.locator('[data-testid=mount-button]').tap();
  await m.page.waitForTimeout(250);
  await m.page.screenshot({ path: `${OUT}/mounts-07-phone-channel.png` });
  await m.page.locator('[data-testid=mounted-tag]').waitFor({ timeout: 4000 });
  await m.page.waitForTimeout(400);
  await m.page.screenshot({ path: `${OUT}/mounts-08-phone-mounted.png` });
  check('Phone: tap to mount', (await m.page.evaluate(() => window.__terrago.client.ui.get().self.mount)) === 'war_wolf');
  check('No page errors', errors.length === 0, errors.join(' | '));
  log('ALL MOUNT BROWSER CHECKS PASSED');
} catch (e) {
  for (const [i, c] of browser.contexts().entries()) for (const pg2 of c.pages()) await pg2.screenshot({ path: `${OUT}/mounts-failure-${i}.png` }).catch(() => {});
  console.error(e);
  process.exitCode = 1;
} finally {
  await browser.close();
  await db.end();
}
