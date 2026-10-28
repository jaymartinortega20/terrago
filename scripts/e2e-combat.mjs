/**
 * v0.5 in a real browser: starter weapon, fight a slime with the attack key,
 * use a skill, see damage numbers, gain XP, equip armor. Run: npx tsx scripts/e2e-combat.mjs
 */
import { mkdirSync } from 'node:fs';
import pg from 'pg';
import { chromium } from 'playwright';

const WEB = process.env.WEB_URL ?? 'http://localhost:3000';
const OUT = process.env.OUT_DIR ?? 'test-results/e2e';
const DB = process.env.DATABASE_URL ?? 'postgres://terrago:terrago_dev_password@localhost:5432/terrago';
mkdirSync(OUT, { recursive: true });
const db = new pg.Pool({ connectionString: DB, max: 2 });
const log = (...a) => console.log('[combat]', ...a);
const check = (name, ok, detail = '') => {
  log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) throw new Error(`Check failed: ${name}`);
};
const stamp = Date.now().toString(36).replace(/[0-9]/g, (d) => 'abcdefghij'[d]);
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 760 } });
const page = await ctx.newPage();
page.on('pageerror', (e) => log('pageerror:', e.message));
const ui = () => page.evaluate(() => window.__terrago.client.ui.get());
try {
  await page.goto(`${WEB}/register`);
  await page.fill('#email', `fight-${stamp}@example.com`);
  await page.fill('#password', 'swords and slimes');
  await page.fill('#confirm', 'swords and slimes');
  await page.click('button[type=submit]');
  await page.waitForURL('**/characters');
  const name = `Fite${stamp}`.slice(0, 16);
  await page.fill('#char-name', name);
  await page.click('button:has-text("Create character")');
  await page.locator('[data-testid=character-card]').first().waitFor();
  const id = (await db.query('SELECT id FROM characters WHERE name=$1', [name])).rows[0].id;
  // Next to the slime meadow in Sunfield (north-east).
  await db.query('UPDATE characters SET map_id=$2,pos_x=$3,pos_y=$4 WHERE id=$1', [id, 'sunfield_plains', 45 * 32 + 16, 10 * 32 + 22]);
  await db.query(`INSERT INTO inventory_items (character_id, container, slot, item_id, quantity, durability) VALUES ($1,'bag',10,'padded_chest',1,180)`, [id]);
  await page.locator('[data-testid=character-card]').first().click();
  await page.waitForFunction(() => window.__terrago?.client.ui.get().status === 'online');
  await page.waitForTimeout(Number(process.env.BAKE_WAIT ?? 800));
  check('Starter weapon worn', (await ui()).inventory.equipment.some((e) => e.itemId === 'training_sword'));
  check('Monsters visible', await page.evaluate(() => window.__terrago.client.monsters.size > 0));

  // Walk toward the nearest monster with the keyboard, attacking with F until it dies.
  const xp0 = (await ui()).self.xp;
  let killed = false;
  for (let i = 0; i < 160 && !killed; i++) {
    const st = await page.evaluate(() => {
      const c = window.__terrago.client;
      const t = c.ui.get().targetId ? c.monsters.get(c.ui.get().targetId) : c.nearestMonster(20);
      return t ? { dx: t.x - c.pos.x, dy: t.y - c.pos.y, xp: c.ui.get().self.xp } : { dx: 0, dy: 0, xp: c.ui.get().self.xp };
    });
    if (st.xp > xp0) killed = true;
    const keys = [];
    if (Math.abs(st.dx) > 30) keys.push(st.dx > 0 ? 'd' : 'a');
    if (Math.abs(st.dy) > 30) keys.push(st.dy > 0 ? 's' : 'w');
    for (const k of keys) await page.keyboard.down(k);
    await page.waitForTimeout(150);
    for (const k of keys) await page.keyboard.up(k);
    await page.keyboard.press('f');
    if (i === 12) await page.keyboard.press('q');
    if (i === 14) await page.screenshot({ path: `${OUT}/v05-01-fight.png` });
    await page.waitForTimeout(150);
  }
  check('Killed a monster and gained XP', killed, `xp ${xp0} → ${(await ui()).self.xp}`);
  await page.screenshot({ path: `${OUT}/v05-02-after-kill.png` });

  // Equip armor from the bag and look at the character sheet.
  const def0 = (await ui()).self.derived.physicalDefense;
  await page.evaluate(() => window.__terrago.client.equip(10));
  await page.waitForFunction((d) => window.__terrago.client.ui.get().self.derived.physicalDefense > d, def0);
  check('Equipping armor raised defense', true);
  await page.keyboard.press('c');
  await page.locator('[data-testid=equipment]').waitFor();
  await page.screenshot({ path: `${OUT}/v05-03-character.png` });
  log('ALL v0.5 BROWSER CHECKS PASSED');
} catch (e) {
  await page.screenshot({ path: `${OUT}/v05-failure.png` }).catch(() => {});
  console.error(e);
  process.exitCode = 1;
} finally {
  await browser.close();
  await db.end();
}
