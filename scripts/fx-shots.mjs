/**
 * Combat effects check: fight slimes in Whispering Fields and capture frames
 * right after each blow. Run: npx tsx scripts/fx-shots.mjs
 */
import { mkdirSync } from 'node:fs';
import pg from 'pg';
import { chromium } from 'playwright';

const WEB = process.env.WEB_URL ?? 'http://localhost:3000';
const OUT = 'test-results/fx';
const DB = process.env.DATABASE_URL ?? 'postgres://terrago:terrago_dev_password@localhost:5432/terrago';
mkdirSync(OUT, { recursive: true });
const db = new pg.Pool({ connectionString: DB, max: 2 });
const stamp = Date.now().toString(36).replace(/[0-9]/g, (d) => 'abcdefghij'[d]);
const b = await chromium.launch();
const page = await (await b.newContext({ viewport: { width: 1280, height: 760 } })).newPage();
page.on('pageerror', (e) => console.log('pageerror', e.message));
await page.goto(`${WEB}/register`);
await page.fill('#email', `fx-${stamp}@example.com`);
await page.fill('#password', 'sparks and flashes');
await page.fill('#confirm', 'sparks and flashes');
await page.click('button[type=submit]');
await page.waitForURL('**/characters');
const name = `Fx${stamp}`.slice(0, 16);
await page.fill('#char-name', name);
await page.click('button:has-text("Create character")');
await page.locator('[data-testid=character-card]').first().waitFor();
const id = (await db.query('SELECT id FROM characters WHERE name=$1', [name])).rows[0].id;
await db.query('UPDATE characters SET map_id=$2,pos_x=$3,pos_y=$4,level=9 WHERE id=$1', [id, 'sunfield_plains', 45 * 32 + 16, 10 * 32 + 22]);
await page.locator('[data-testid=character-card]').first().click();
await page.waitForFunction(() => window.__terrago?.client.ui.get().status === 'online');
await page.waitForTimeout(Number(process.env.BAKE_WAIT ?? 25000));
let shot = 0;
for (let i = 0; i < 120 && shot < 8; i++) {
  const st = await page.evaluate(() => {
    const c = window.__terrago.client;
    const t = c.ui.get().targetId ? c.monsters.get(c.ui.get().targetId) : c.nearestMonster(20);
    return t ? { dx: t.x - c.pos.x, dy: t.y - c.pos.y } : { dx: 0, dy: 0 };
  });
  const keys = [];
  if (Math.abs(st.dx) > 30) keys.push(st.dx > 0 ? 'd' : 'a');
  if (Math.abs(st.dy) > 30) keys.push(st.dy > 0 ? 's' : 'w');
  for (const k of keys) await page.keyboard.down(k);
  await page.waitForTimeout(150);
  for (const k of keys) await page.keyboard.up(k);
  await page.keyboard.press('f');
  if (!keys.length && i % 2 === 0) {
    await page.waitForTimeout(Number(process.env.DELAY ?? 120));
    await page.screenshot({ path: `${OUT}/hit-${shot++}.png` });
  }
  await page.waitForTimeout(200);
}
await b.close();
await db.end();
