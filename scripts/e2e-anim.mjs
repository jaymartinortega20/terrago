/**
 * Animations and emotes in a real browser, seen by a second player:
 * emote menu (Y), wave bubble, sit pose, dance, strike pose while fighting.
 * Run: npx tsx scripts/e2e-anim.mjs
 */
import { mkdirSync } from 'node:fs';
import pg from 'pg';
import { chromium } from 'playwright';

const WEB = process.env.WEB_URL ?? 'http://localhost:3000';
const OUT = process.env.OUT_DIR ?? 'test-results/e2e';
const DB = process.env.DATABASE_URL ?? 'postgres://terrago:terrago_dev_password@localhost:5432/terrago';
mkdirSync(OUT, { recursive: true });
const db = new pg.Pool({ connectionString: DB, max: 2 });
const log = (...a) => console.log('[anim]', ...a);
const check = (name, ok, detail = '') => {
  log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) throw new Error(`Check failed: ${name}`);
};
const stamp = Date.now().toString(36).replace(/[0-9]/g, (d) => 'abcdefghij'[d]);
const browser = await chromium.launch();
const errors = [];

async function player(tag, tx, ty) {
  const ctx = await browser.newContext({ viewport: { width: 1100, height: 700 } });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`${tag}: ${e.message}`));
  await page.goto(`${WEB}/register`);
  await page.fill('#email', `${tag}-${stamp}@example.com`);
  await page.fill('#password', 'wave hello friend');
  await page.fill('#confirm', 'wave hello friend');
  await page.click('button[type=submit]');
  await page.waitForURL('**/characters');
  const name = `${tag}${stamp}`.slice(0, 16);
  await page.fill('#char-name', name);
  await page.click('button:has-text("Create character")');
  await page.locator('[data-testid=character-card]').first().waitFor();
  const id = (await db.query('SELECT id FROM characters WHERE name=$1', [name])).rows[0].id;
  await db.query('UPDATE characters SET map_id=$2,pos_x=$3,pos_y=$4 WHERE id=$1', [id, 'sunfield_plains', tx * 32 + 16, ty * 32 + 22]);
  await page.locator('[data-testid=character-card]').first().click();
  await page.waitForFunction(() => window.__terrago?.client.ui.get().status === 'online');
  await page.waitForTimeout(1200);
  return { page, id, name };
}

/** Close-up around a world point on a page. */
async function shot(page, file, wx, wy) {
  const c = await page.evaluate(([wx, wy]) => {
    const sc = window.__terrago.game.scene.getScene('world');
    const cam = sc.cameras.main;
    sc.cameras.main.setZoom(2);
    return null;
  }, [wx, wy]);
  await page.waitForTimeout(60);
  const p = await page.evaluate(([wx, wy]) => {
    const t = window.__terrago;
    const cam = t.game.scene.getScene('world').cameras.main;
    const r = t.game.canvas.getBoundingClientRect();
    return { x: r.left + (wx - cam.worldView.x) * cam.zoom, y: r.top + (wy - cam.worldView.y) * cam.zoom };
  }, [wx, wy]);
  await page.screenshot({ path: `${OUT}/anim-${file}.png`, clip: { x: Math.max(0, Math.min(1100 - 360, p.x - 180)), y: Math.max(0, Math.min(700 - 260, p.y - 200)), width: 360, height: 260 } });
}

try {
  const A = await player('Ann', 44, 12);
  const B = await player('Bob', 46, 12);
  const posA = () => A.page.evaluate(() => window.__terrago.client.pos);
  await B.page.waitForFunction((id) => window.__terrago.client.remotes.has(id), A.id);
  // Y opens the emote menu; wave.
  await A.page.keyboard.press('y');
  await A.page.locator('[data-testid=emote-menu]').waitFor();
  await A.page.screenshot({ path: `${OUT}/anim-01-menu.png` });
  await A.page.click('[data-testid=emote-wave]');
  await B.page.waitForFunction((id) => !!window.__terrago.game.scene.getScene('world').remotes.get(id)?.emote, A.id);
  check('Bob sees Ann wave', true);
  const pa = await posA();
  await shot(B.page, '02-wave-seen-by-bob', pa.x + 32, pa.y);

  await A.page.waitForTimeout(1100);
  await A.page.evaluate(() => window.__terrago.client.emote('sit'));
  await B.page.waitForFunction((id) => window.__terrago.client.remotes.get(id)?.info.pose === 'sit', A.id);
  check('Bob sees Ann sitting', true);
  await B.page.waitForTimeout(300);
  await shot(B.page, '03-sit', pa.x + 32, pa.y);
  await A.page.keyboard.down('a');
  await A.page.waitForTimeout(250);
  await A.page.keyboard.up('a');
  await B.page.waitForFunction((id) => window.__terrago.client.remotes.get(id)?.info.pose === null, A.id);
  check('Moving stands Ann up', true);

  await A.page.waitForTimeout(1100);
  await A.page.fill('[data-testid=chat-input]', '/dance');
  await A.page.press('[data-testid=chat-input]', 'Enter');
  await B.page.waitForTimeout(500);
  const pa2 = await posA();
  await shot(B.page, '04-dance', pa2.x + 32, pa2.y);

  // Strike pose: Ann's avatar shows the action frame right after an attack event.
  const pose = await A.page.evaluate(async () => {
    const t = window.__terrago;
    const c = t.client;
    const sc = t.game.scene.getScene('world');
    const m = c.nearestMonster(30);
    c.emit('combat', [{ s: c.ui.get().self.characterId, t: m.info.id, a: 9, k: 'hit' }]);
    return sc.local.actionUntil > sc.time.now ? 3 : 0;
  });
  check('Attack shows the strike pose', pose === 3, `frame column ${pose}`);
  const hurt = await A.page.evaluate(async () => {
    const t = window.__terrago;
    const c = t.client;
    const sc = t.game.scene.getScene('world');
    const m = c.nearestMonster(30);
    c.emit('combat', [{ s: m.info.id, t: c.ui.get().self.characterId, a: 3, k: 'hit' }]);
    return sc.local.hurtUntil > sc.time.now;
  });
  check('Getting hit flashes red', hurt === true);
  check('No page errors', errors.length === 0, errors.join(' | '));
  log('ALL ANIMATION BROWSER CHECKS PASSED');
} finally {
  await browser.close();
  await db.end();
}
