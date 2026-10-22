/**
 * Attack effects in a real browser: weapon in hand, sword swing on a real fight,
 * then every weapon and skill effect shown on a nearby monster, plus the settings.
 * Run: npx tsx scripts/e2e-fx.mjs
 */
import { mkdirSync } from 'node:fs';
import pg from 'pg';
import { chromium } from 'playwright';

const WEB = process.env.WEB_URL ?? 'http://localhost:3000';
const OUT = process.env.OUT_DIR ?? 'test-results/e2e';
const DB = process.env.DATABASE_URL ?? 'postgres://terrago:terrago_dev_password@localhost:5432/terrago';
mkdirSync(OUT, { recursive: true });
const db = new pg.Pool({ connectionString: DB, max: 2 });
const log = (...a) => console.log('[fx]', ...a);
const check = (name, ok, detail = '') => {
  log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) throw new Error(`Check failed: ${name}`);
};
const stamp = Date.now().toString(36).replace(/[0-9]/g, (d) => 'abcdefghij'[d]);
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 760 } });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => {
  errors.push(e.message);
  log('pageerror:', e.message);
});
const ui = () => page.evaluate(() => window.__terrago.client.ui.get());
/** Screenshot around the player. */
const shot = async (name) => {
  const c = await page.evaluate(() => {
    const t = window.__terrago;
    const cam = t.game.scene.getScene('world').cameras.main;
    const m = t.client.nearestMonster(30);
    const px = t.client.pos.x;
    const py = t.client.pos.y;
    const wx = m ? (px + m.x) / 2 : px;
    const wy = m ? (py + m.y) / 2 : py;
    const r = t.game.canvas.getBoundingClientRect();
    return { x: r.left + (wx - cam.worldView.x) * cam.zoom, y: r.top + (wy - 20 - cam.worldView.y) * cam.zoom };
  });
  const x = Math.max(0, Math.min(1280 - 400, c.x - 200));
  const y = Math.max(0, Math.min(760 - 300, c.y - 150));
  await page.screenshot({ path: `${OUT}/fx-${name}.png`, clip: { x, y, width: 400, height: 300 } });
};

try {
  await page.goto(`${WEB}/register`);
  await page.fill('#email', `fx-${stamp}@example.com`);
  await page.fill('#password', 'swords and sparks');
  await page.fill('#confirm', 'swords and sparks');
  await page.click('button[type=submit]');
  await page.waitForURL('**/characters');
  const name = `Fx${stamp}`.slice(0, 16);
  await page.fill('#char-name', name);
  await page.click('button:has-text("Create character")');
  await page.locator('[data-testid=character-card]').first().waitFor();
  const id = (await db.query('SELECT id FROM characters WHERE name=$1', [name])).rows[0].id;
  await db.query('UPDATE characters SET map_id=$2,pos_x=$3,pos_y=$4 WHERE id=$1', [id, 'sunfield_plains', 45 * 32 + 16, 10 * 32 + 22]);
  await page.locator('[data-testid=character-card]').first().click();
  await page.waitForFunction(() => window.__terrago?.client.ui.get().status === 'online');
  await page.waitForTimeout(1200);
  await shot('01-sword-in-hand');

  // Real fight: F attacks; grab frames mid-swing.
  let frames = 0;
  for (let i = 0; i < 120 && frames < 3; i++) {
    const st = await page.evaluate(() => {
      const c = window.__terrago.client;
      const t = c.ui.get().targetId ? c.monsters.get(c.ui.get().targetId) : c.nearestMonster(20);
      return t ? { dx: t.x - c.pos.x, dy: t.y - c.pos.y } : { dx: 0, dy: 0 };
    });
    const keys = [];
    if (Math.abs(st.dx) > 28) keys.push(st.dx > 0 ? 'd' : 'a');
    if (Math.abs(st.dy) > 28) keys.push(st.dy > 0 ? 's' : 'w');
    for (const k of keys) await page.keyboard.down(k);
    await page.waitForTimeout(140);
    for (const k of keys) await page.keyboard.up(k);
    if (!keys.length) {
      const got = page.evaluate(
        () =>
          new Promise((res) => {
            const off = window.__terrago.client.on('combat', (ev) => {
              if (ev.some((e) => e.s === window.__terrago.client.ui.get().self.characterId)) {
                off();
                res(true);
              }
            });
            setTimeout(() => res(false), 1500);
          }),
      );
      await page.keyboard.press('f');
      if (await got) {
        await page.waitForTimeout(70);
        await shot(`02-real-swing-${++frames}`);
      }
    }
    await page.waitForTimeout(250);
  }
  check('Real attacks drew a swing', frames > 0, `${frames} frames`);

  // Showcase: replay effects on the nearest monster for each weapon and skill.
  const play = async (label, weapon, events, wait = 110) => {
    await page.evaluate(
      ({ weapon, events }) => {
        const c = window.__terrago.client;
        const st = c.ui.get();
        if (weapon !== undefined) c.ui.set({ inventory: { ...st.inventory, equipment: [...st.inventory.equipment.filter((x) => x.slot !== 0), ...(weapon ? [{ slot: 0, itemId: weapon, quantity: 1, durability: 100 }] : [])] } });
        const me = st.self.characterId;
        const m = c.nearestMonster(30);
        c.emit(
          'combat',
          events.map((e) => ({ s: e.s === 'mon' ? m.info.id : me, t: e.t === 'me' ? me : m.info.id, a: e.a ?? 12, k: e.k ?? 'hit', ...(e.sk ? { sk: e.sk } : {}) })),
        );
      },
      { weapon, events },
    );
    await page.waitForTimeout(wait);
    await shot(label);
    await page.waitForTimeout(700);
  };
  await play('03-sword-crit', 'gold_sword', [{ k: 'crit', a: 40 }], 120);
  await play('04-power-strike', 'star_metal_sword', [{ sk: 'power_strike', a: 60 }], 150);
  await play('05-mace', 'mithril_mace', [{}], 180);
  await play('06-dagger', 'obsidian_dagger', [{}], 200);
  await play('07-bow', 'silver_bow', [{}], 90);
  await play('08-staff', 'mithril_staff', [{}], 140);
  await play('09-fireball', 'mithril_staff', [{ sk: 'fireball', a: 55 }], 200);
  await play('10-frost-nova', 'mithril_staff', [{ k: 'cast', sk: 'frost_nova', t: 'me' }, { sk: 'frost_nova' }], 150);
  await play('11-whirlwind', 'gold_sword', [{ k: 'cast', sk: 'whirlwind', t: 'me' }, { sk: 'whirlwind' }], 200);
  await play('12-volley', 'gold_bow', [{ k: 'cast', sk: 'volley' }], 230);
  await play('13-smite', 'gold_mace', [{ sk: 'smite', a: 33 }], 200);
  await play('14-heal', 'gold_mace', [{ k: 'heal', t: 'me', sk: 'heal', a: 70 }], 200);
  await play('15-monster-claws', undefined, [{ s: 'mon', t: 'me', a: 6 }], 120);
  await play('16-war-cry', 'gold_sword', [{ k: 'cast', sk: 'war_cry', t: 'me' }], 200);
  await play('17-backstab', 'gold_dagger', [{ sk: 'backstab', a: 44 }], 210);
  await play('18-hunters-mark', 'gold_bow', [{ k: 'cast', sk: 'hunters_mark' }], 260);

  // Personal colour style and the settings section.
  await page.evaluate(() => {
    localStorage.setItem('terrago.fx', JSON.stringify({ style: 'fire' }));
  });
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);
  if (!(await page.locator('[data-testid=settings-panel]').isVisible())) await page.keyboard.press('Escape');
  await page.locator('[data-testid=settings-panel]').waitFor();
  await page.selectOption('[data-testid=fx-style]', 'ice');
  check('Style saved', (await page.evaluate(() => JSON.parse(localStorage.getItem('terrago.fx')).style)) === 'ice');
  await page.locator('[data-testid=settings-panel]').screenshot({ path: `${OUT}/fx-19-settings.png` });
  await page.click('[data-testid=fx-handWeapon]');
  await page.keyboard.press('Escape');
  await play('20-ice-style-no-hand', 'gold_sword', [{}], 120);
  check('No page errors', errors.length === 0, errors.join(' | '));
  log('ALL FX BROWSER CHECKS PASSED');
} catch (e) {
  await page.screenshot({ path: `${OUT}/fx-failure.png` }).catch(() => {});
  throw e;
} finally {
  await browser.close();
  await db.end();
}
