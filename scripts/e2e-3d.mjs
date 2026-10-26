/**
 * TerraGo 3.0 beta: the 3D view in a real browser. Visits every open map with
 * a fully geared hero and screenshots it, checks visible gear, clicking a
 * monster, rotating the camera, and switching back to 2D.
 * Run: npx tsx scripts/e2e-3d.mjs   (PHONE=1 for a phone viewport)
 */
import { mkdirSync } from 'node:fs';
import pg from 'pg';
import { chromium } from 'playwright';

const WEB = process.env.WEB_URL ?? 'http://localhost:3000';
const OUT = process.env.OUT_DIR ?? 'test-results/e2e';
const DB = process.env.DATABASE_URL ?? 'postgres://terrago:terrago_dev_password@localhost:5432/terrago';
const PHONE = !!process.env.PHONE;
const ONLY = process.env.MAPS?.split(',');
mkdirSync(OUT, { recursive: true });
const db = new pg.Pool({ connectionString: DB, max: 2 });
const log = (...a) => console.log('[3d]', ...a);
const check = (name, ok, detail = '') => {
  log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) throw new Error(`Check failed: ${name}`);
};
const stamp = Date.now().toString(36).replace(/[0-9]/g, (d) => 'abcdefghij'[d]);
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const errors = [];
const ctx = await browser.newContext(PHONE ? { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true } : { viewport: { width: 1366, height: 800 } });
// Software GL in CI is slow: functional checks run on Classic quality unless QUALITY=hd.
await ctx.addInitScript((q) => (window.__q = q), process.env.QUALITY ?? 'classic');
await ctx.addInitScript(() => {
  try {
    const cur = JSON.parse(localStorage.getItem('terrago.fx') || '{}');
    if (cur.view3d === undefined) localStorage.setItem('terrago.fx', JSON.stringify({ ...cur, view3d: true, graphics: window.__q }));
  } catch {}
});
const page = await ctx.newPage();
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => m.type() === 'error' && !/401|404|Failed to load resource/.test(m.text()) && errors.push(m.text()));

await page.goto(`${WEB}/register`);
await page.fill('#email', `threed-${stamp}@example.com`);
await page.fill('#password', 'shiny buttons');
await page.fill('#confirm', 'shiny buttons');
await page.click('button[type=submit]');
await page.waitForURL('**/characters');
await page.locator('#char-name').waitFor();
const name = `Td${stamp}`.slice(0, 14);
await page.fill('#char-name', name);
await page.click('button:has-text("Create character")');
await page.locator('[data-testid=character-card]').first().waitFor();
const id = (await db.query('SELECT id FROM characters WHERE name=$1', [name])).rows[0].id;
await db.query(`UPDATE characters SET level = 95, pet = 'pet_fox' WHERE id = $1`, [id]);
await db.query(`DELETE FROM inventory_items WHERE character_id = $1 AND container = 'equip'`, [id]);
await db.query(
  `INSERT INTO inventory_items (character_id, container, slot, item_id, quantity, durability, enhance) VALUES
   ($1, 'equip', 0, 'star_metal_sword', 1, 400, 7), ($1, 'equip', 1, 'iron_shield', 1, 400, 0), ($1, 'equip', 2, 'gold_head', 1, 400, 0),
   ($1, 'equip', 3, 'mithril_chest', 1, 400, 4), ($1, 'equip', 8, 'angel_wings', 1, 400, 0)`,
  [id],
);

const SPOTS = [
  ['greenhaven', 31, 27],
  ['sunfield_plains', 44, 12],
  ['desolate_crags', 16, 22],
  ['glacial_depths', 16, 22],
  ['dragonspire', 24, 33],
  ['infernal_caldera', 8, 32],
].filter(([m]) => !ONLY || ONLY.includes(m));

async function enterAt(map, x, y, settle = 3500) {
  if (!page.url().endsWith('/characters')) {
    // Leave properly so the server saves now (not after the link-dead grace).
    await page.evaluate(() => window.__terrago?.client.logout());
    await page.waitForTimeout(800);
    await page.goto(`${WEB}/characters`);
  }
  await page.locator('[data-testid=character-card]').first().waitFor();
  await page.waitForTimeout(1200);
  await db.query(`UPDATE characters SET map_id = $2, pos_x = $3, pos_y = $4, direction = 'down' WHERE id = $1`, [id, map, x * 32 + 16, y * 32 + 16]);
  await page.locator('[data-testid=character-card]').first().click();
  try {
    await page.waitForFunction(() => window.__terrago?.client.ui.get().status === 'online', null, { timeout: 90000 });
    await page.waitForFunction((m) => !!window.__terrago?.world3d && window.__terrago.client.map?.id === m, map, { timeout: 30000 });
  } catch (e) {
    await page.screenshot({ path: `${OUT}/3d-fail-${map}.png` });
    log('stuck entering', map, JSON.stringify(await page.evaluate(() => ({ url: location.href, status: window.__terrago?.client.ui.get().status, msg: window.__terrago?.client.ui.get().statusMessage, w: !!window.__terrago?.world3d }))));
    throw e;
  }
  await page.evaluate((d) => (window.__terrago.world3d.darkOverride = d), process.env.NIGHT ? 0.58 : 0);
  await page.waitForTimeout(settle);
  await page.waitForTimeout(process.env.EXTRA_WAIT ? Number(process.env.EXTRA_WAIT) : 0);
}

const tag = PHONE ? 'phone' : 'desk';
for (const [map, x, y] of SPOTS) {
  // The raid lair kills a lone level-95 quickly (and software GL is slow): look fast.
  await enterAt(map, x, y, map === 'infernal_caldera' ? 1200 : 3500);
  const fps = await page.evaluate(
    () =>
      new Promise((r) => {
        let n = 0;
        const t0 = performance.now();
        const f = () => (performance.now() - t0 < 2000 ? (n++, requestAnimationFrame(f)) : r(Math.round(n / 2)));
        requestAnimationFrame(f);
      }),
  );
  const info = await page.evaluate(() => {
    const c = window.__terrago.client;
    const w = window.__terrago.world3d;
    const me = w.selfEnt();
    const p = me?.root.position;
    return {
      map: c.map?.id,
      monsters: c.monsters.size,
      labels: document.querySelectorAll('.l3d').length,
      canvas2dHidden: document.querySelector('[data-testid=game-canvas] canvas')?.style.visibility === 'hidden',
      me: p ? [p.x.toFixed(1), p.y.toFixed(2), p.z.toFixed(1), me.root.visible, me.chibi?.root.parent === me.root] : null,
      pos: [c.pos.x / 32, c.pos.y / 32].map((v) => v.toFixed(1)),
      calls: w.renderer.info.render.calls,
      tris: w.renderer.info.render.triangles,
    };
  });
  await page.screenshot({ path: `${OUT}/3d-${tag}-${map}.png`, timeout: 120000 });
  log(map, JSON.stringify({ fps, ...info }));
  if (errors.length) log('errors so far:', errors.slice(0, 6).join(' | ').slice(0, 1500));
  if (process.env.INSPECT) {
    log('inspect', JSON.stringify(await page.evaluate(() => {
      const w = window.__terrago.world3d;
      return [...w.ents.entries()].slice(0, 12).map(([id, e]) => ({ id: id.slice(0, 6), ready: e.actor.ready, h: e.height.toFixed(2), pos: [e.root.position.x.toFixed(1), e.root.position.y.toFixed(2), e.root.position.z.toFixed(1)], kids: e.actor.root.children.map((c) => c.children.length) }));
    })));
  }
  check(`${map}: 3D view running`, info.map === map && info.canvas2dHidden && info.labels > 0 && !!info.me);
}

// Close-up of the hero: the gear is on the model.
await enterAt('greenhaven', 31, 27);
await page.evaluate(() => {
  const w = window.__terrago.world3d;
  w.dist = 5;
  w.pitch = 0.45;
});
await page.waitForTimeout(1500);
await page.screenshot({ path: `${OUT}/3d-${tag}-hero.png` });
await page.evaluate(() => {
  const w = window.__terrago.world3d;
  w.dist = 15;
  w.pitch = 0.7;
});

// Gear is visible, the camera rotates, clicking a monster engages it.
await enterAt('sunfield_plains', 44, 12);
await page.waitForFunction(() => window.__terrago.client.monsters.size > 0, null, { timeout: 20000 });
await page.waitForTimeout(1000);
const near = await page.evaluate(() => {
  const c = window.__terrago.client;
  const m = [...c.monsters.values()].sort((a, b) => Math.hypot(a.x - c.pos.x, a.y - c.pos.y) - Math.hypot(b.x - c.pos.x, b.y - c.pos.y))[0];
  return m ? { id: m.info.id } : null;
});
check('a monster nearby', !!near);
// Software GL is slow and slimes wander: aim fresh each try.
for (let i = 0; i < 4; i++) {
  const pt = await page.evaluate((mid) => {
    const w = window.__terrago.world3d;
    const e = w.ents.get(mid);
    const p = e.root.position.clone();
    p.y += e.height * 0.5;
    return w.toScreen(p);
  }, near.id);
  await page.mouse.click(pt.x, pt.y);
  await page.waitForTimeout(300);
  if ((await page.evaluate(() => window.__terrago.client.ui.get().targetId)) === near.id) break;
}
check('clicking a monster targets it', (await page.evaluate(() => window.__terrago.client.ui.get().targetId)) === near.id);
await page.waitForTimeout(2500);
await page.screenshot({ path: `${OUT}/3d-${tag}-fight.png` });
await page.keyboard.press(']');
await page.keyboard.press(']');
await page.waitForTimeout(800);
await page.screenshot({ path: `${OUT}/3d-${tag}-rotated.png` });
// Movement follows the camera: with the view turned 90°, "up" walks west.
const before = await page.evaluate(() => ({ ...window.__terrago.client.pos }));
await page.evaluate(() => window.__terrago.client.setTarget(null));
await page.keyboard.down('w');
await page.waitForTimeout(600);
await page.keyboard.up('w');
const after = await page.evaluate(() => ({ ...window.__terrago.client.pos }));
log('move with view turned', JSON.stringify({ dx: Math.round(after.x - before.x), dy: Math.round(after.y - before.y) }));
check('W walks away from the turned camera', after.x - before.x < -3 && Math.abs(after.y - before.y) < Math.abs(after.x - before.x));
// Back to 2D.
await page.click('[data-testid=cam3d-2d]');
await page.waitForTimeout(800);
const twoD = await page.evaluate(() => ({ w3d: !!document.querySelector('[data-testid=game-3d]'), vis: document.querySelector('[data-testid=game-canvas] canvas')?.style.visibility }));
check('back to 2D', !twoD.w3d && twoD.vis === 'visible');
check('no page errors', errors.length === 0, errors.slice(0, 5).join(' | '));
await browser.close();
await db.end();
