/**
 * HD art tour: one hero visits several maps and takes a screenshot of each
 * (after the sprites have baked). Run: npx tsx scripts/tour-hd.mjs [map,map]
 */
import { mkdirSync } from 'node:fs';
import pg from 'pg';
import { chromium } from 'playwright';

const WEB = process.env.WEB_URL ?? 'http://localhost:3000';
const OUT = 'test-results/hd';
const DB = process.env.DATABASE_URL ?? 'postgres://terrago:terrago_dev_password@localhost:5432/terrago';
mkdirSync(OUT, { recursive: true });
const db = new pg.Pool({ connectionString: DB, max: 2 });
const stamp = Date.now().toString(36).replace(/[0-9]/g, (d) => 'abcdefghij'[d]);
const maps = (process.argv[2] ?? 'desolate_crags,glacial_depths,infernal_caldera,dragonspire').split(',');
const WAIT = Number(process.env.WAIT ?? 30000);
const b = await chromium.launch();
const page = await (await b.newContext({ viewport: { width: 1280, height: 760 } })).newPage();
page.on('pageerror', (e) => console.log('pageerror', e.message));
await page.goto(`${WEB}/register`);
await page.fill('#email', `tour-${stamp}@example.com`);
await page.fill('#password', 'touring the world');
await page.fill('#confirm', 'touring the world');
await page.click('button[type=submit]');
await page.waitForURL('**/characters');
const name = `Tour${stamp}`.slice(0, 16);
await page.fill('#char-name', name);
await page.click('button:has-text("Create character")');
await page.locator('[data-testid=character-card]').first().waitFor();
const id = (await db.query('SELECT id FROM characters WHERE name=$1', [name])).rows[0].id;
await db.query('UPDATE characters SET level=60 WHERE id=$1', [id]);
await db.query(`UPDATE users SET roles = ARRAY['player','admin'] WHERE email = $1`, [`tour-${stamp}@example.com`]);
await page.locator('[data-testid=character-card]').first().click();
await page.waitForFunction(() => window.__terrago?.client.ui.get().status === 'online', null, { timeout: 90000 });
for (const m of maps) {
  const map = (await import('../packages/game-data/data/maps/' + m + '.json', { with: { type: 'json' } })).default;
  const sp = map.spawn ?? { x: Math.floor(map.width / 2), y: Math.floor(map.height / 2) };
  const r = await page.evaluate(async ([cid, mapId, x, y]) => {
    const res = await fetch('/api/admin/teleport', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ characterId: cid, mapId, x, y }) });
    return res.status;
  }, [id, m, sp.x, sp.y]);
  await page.waitForFunction((mm) => window.__terrago?.client.map?.id === mm, m, { timeout: 30000 }).catch(() => console.log('teleport failed', r));
  await page.waitForTimeout(WAIT);
  await page.screenshot({ path: `${OUT}/${m}.png` });
  console.log('shot', m);
}
await b.close();
await db.end();
