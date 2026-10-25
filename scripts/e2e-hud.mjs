/**
 * The ornate HUD and the spell effects in a real browser (desktop and phone):
 * replays skill events so every effect is drawn, and checks the HUD works.
 * Run: npx tsx scripts/e2e-hud.mjs
 */
import { mkdirSync } from 'node:fs';
import pg from 'pg';
import { chromium } from 'playwright';

const WEB = process.env.WEB_URL ?? 'http://localhost:3000';
const OUT = process.env.OUT_DIR ?? 'test-results/e2e';
const DB = process.env.DATABASE_URL ?? 'postgres://terrago:terrago_dev_password@localhost:5432/terrago';
mkdirSync(OUT, { recursive: true });
const db = new pg.Pool({ connectionString: DB, max: 2 });
const log = (...a) => console.log('[hud]', ...a);
const check = (name, ok, detail = '') => {
  log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) throw new Error(`Check failed: ${name}`);
};
const stamp = Date.now().toString(36).replace(/[0-9]/g, (d) => 'abcdefghij'[d]);
const browser = await chromium.launch();
const errors = [];

async function enter(ctx, tag, cls, setup) {
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${WEB}/register`);
  await page.fill('#email', `${tag}-${stamp}@example.com`);
  await page.fill('#password', 'shiny buttons');
  await page.fill('#confirm', 'shiny buttons');
  await page.click('button[type=submit]');
  await page.waitForURL('**/characters');
  await page.locator('#char-name').waitFor();
  const name = `${tag}${stamp}`.slice(0, 14);
  await page.fill('#char-name', name);
  await page.click(`button:has-text("${cls}")`).catch(() => {});
  await page.click('button:has-text("Create character")');
  await page.locator('[data-testid=character-card]').first().waitFor();
  const id = (await db.query('SELECT id FROM characters WHERE name=$1', [name])).rows[0].id;
  await setup(id);
  await page.locator('[data-testid=character-card]').first().click();
  await page.waitForFunction(() => window.__terrago?.client.ui.get().status === 'online', null, { timeout: 90000 });
  await page.waitForTimeout(1500);
  return { page, id };
}

/** Replay a burst of spell events around the player so every effect shows at once. */
async function showOff(page) {
  return page.evaluate(async () => {
    const t = window.__terrago;
    const c = t.client;
    const me = c.ui.get().self.characterId;
    const ms = [...c.monsters.values()].sort((a, b) => Math.hypot(a.x - c.pos.x, a.y - c.pos.y) - Math.hypot(b.x - c.pos.x, b.y - c.pos.y)).slice(0, 3);
    const [a, b, d] = ms.map((m) => m.info.id);
    const ev = (e) => c.emit('combat', [e]);
    ev({ s: me, t: a, a: 0, k: 'cast', sk: 'chain_lightning' });
    ev({ s: me, t: a, a: 18742, k: 'crit', sk: 'chain_lightning' });
    await new Promise((r) => setTimeout(r, 90));
    ev({ s: me, t: a, a: 6833, k: 'hit' });
    ev({ s: me, t: a, a: 2871, k: 'hit', sk: 'pet' });
    ev({ s: me, t: b ?? a, a: 0, k: 'cast', sk: 'meteor' });
    ev({ s: me, t: me, a: 0, k: 'cast', sk: 'frost_nova' });
    ev({ s: me, t: d ?? a, a: 4686, k: 'hit', sk: 'frost_nova' });
    ev({ s: a, t: me, a: 312, k: 'hit' });
    ev({ s: me, t: me, a: 520, k: 'heal' });
    await new Promise((r) => setTimeout(r, 140));
    return ms.length;
  });
}

try {
  // Desktop -------------------------------------------------------------------
  const desk = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const D = await enter(desk, 'Hd', 'Mage', async (id) => {
    await db.query(`UPDATE characters SET class_id='mage', job='sorcerer', level = 60, map_id='sunfield_plains', pos_x=$2, pos_y=$3 WHERE id=$1`, [id, 44 * 32 + 16, 11 * 32 + 16]);
  });
  const page = D.page;
  check('Ornate HUD portrait', (await page.locator('[data-testid=hud] svg').count()) > 0);
  check('Skill orbs', (await page.locator('[data-testid=skill-bar] button.orb').count()) >= 5);
  check('Round menu buttons', (await page.locator('nav button.orb').count()) >= 10);
  await page.click('[data-testid=menu-character]');
  await page.waitForTimeout(400);
  check('Menu orb opens a panel', (await page.locator('section[role=dialog]').count()) > 0);
  await page.click('section[role=dialog] button[aria-label=Close]');
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${OUT}/hud-01-desktop.png` });
  const n = await showOff(page);

  check('Monsters nearby for the effects', n >= 1, String(n));
  await page.evaluate(() => {
    const fire = (n) => window.__terrago.client.socket.listeners('notice').forEach((f) => f(n));
    fire({ kind: 'success', text: 'Green Slime defeated: +2 XP, +2 Gold' });
    fire({ kind: 'info', text: '📅 Daily task done: Defeat 10 monsters! Claim it in your Journal (L).' });
    fire({ kind: 'success', text: 'Green Slime defeated: +2 XP, +2 Gold, 2× Slime Gel, 1× Minor Health Potion' });
    fire({ kind: 'info', text: 'Your bag is full — loot was left on the ground.' });
  });
  check('Rewards go to the side feed, not the middle', (await page.locator('[data-testid=loot-feed] > div').count()) === 4);
  await page.screenshot({ path: `${OUT}/hud-02-desktop-spells.png` });
  await page.waitForTimeout(260);
  await page.screenshot({ path: `${OUT}/hud-03-desktop-spells-late.png` });
  // AUTO engages the nearest monster in reach.
  await page.evaluate(() => {
    const c = window.__terrago.client;
    const m = [...c.monsters.values()].sort((a, b) => Math.hypot(a.x - c.pos.x, a.y - c.pos.y) - Math.hypot(b.x - c.pos.x, b.y - c.pos.y))[0];
    c.pos = { x: m.x, y: m.y + 20 };
  });
  await page.click('[data-testid=auto-button]');
  await page.waitForFunction(() => window.__terrago.client.ui.get().autoAttack, null, { timeout: 5000 }).catch(() => {});
  check('AUTO picks a target', await page.evaluate(() => !!window.__terrago.client.ui.get().targetId));
  await page.click('[data-testid=auto-button]');
  await desk.close();

  // Phone ---------------------------------------------------------------------
  const phone = await browser.newContext({ viewport: { width: 844, height: 390 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
  const P = await enter(phone, 'Hp', 'Warrior', async (id) => {
    await db.query(`UPDATE characters SET level = 50, map_id='sunfield_plains', pos_x=$2, pos_y=$3 WHERE id=$1`, [id, 44 * 32 + 16, 11 * 32 + 16]);
    await db.query(`INSERT INTO inventory_items (character_id, container, slot, item_id, quantity, durability) VALUES ($1, 'bag', 12, 'war_wolf', 1, null)`, [id]);
  });
  const ph = P.page;
  check('Phone attack orb', (await ph.locator('[data-testid=attack-button]').count()) === 1);
  check('Phone skill orbs', (await ph.locator('[data-testid^=skill-]').count()) >= 3);
  await ph.screenshot({ path: `${OUT}/hud-04-phone.png` });
  await ph.locator('[data-testid=mount-button]').tap();
  await ph.locator('[data-testid=mounted-tag]').waitFor({ timeout: 5000 });
  await showOff(ph);
  await ph.screenshot({ path: `${OUT}/hud-05-phone-spells.png` });
  await ph.click('[data-testid=menu-toggle]');
  await ph.waitForTimeout(300);
  await ph.screenshot({ path: `${OUT}/hud-06-phone-menu.png` });
  check('No page errors', errors.length === 0, errors.join(' | '));
  log('ALL HUD BROWSER CHECKS PASSED');
} catch (e) {
  console.error(e);
  process.exitCode = 1;
} finally {
  await browser.close();
  await db.end();
}
