/**
 * v0.6 in a real browser with two players: party via the player menu, world
 * chat, a guild with invite + tag, friends list. Run: node scripts/e2e-social.mjs
 */
import { mkdirSync } from 'node:fs';
import pg from 'pg';
import { chromium } from 'playwright';

const WEB = process.env.WEB_URL ?? 'http://localhost:3000';
const OUT = process.env.OUT_DIR ?? 'test-results/e2e';
const DB = process.env.DATABASE_URL ?? 'postgres://terrago:terrago_dev_password@localhost:5432/terrago';
mkdirSync(OUT, { recursive: true });
const db = new pg.Pool({ connectionString: DB, max: 2 });
const log = (...a) => console.log('[social]', ...a);
const check = (name, ok, detail = '') => {
  log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) throw new Error(`Check failed: ${name}`);
};
const stamp = Date.now().toString(36).replace(/[0-9]/g, (d) => 'abcdefghij'[d]);
const browser = await chromium.launch();

async function makePlayer(tag, tx, setup) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 760 } });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => log(tag, 'pageerror:', e.message));
  await page.goto(`${WEB}/register`);
  await page.fill('#email', `social-${tag}-${stamp}@example.com`);
  await page.fill('#password', 'friends forever');
  await page.fill('#confirm', 'friends forever');
  await page.click('button[type=submit]');
  await page.waitForURL('**/characters');
  const name = `${tag}${stamp}`.slice(0, 16);
  await page.fill('#char-name', name);
  await page.click('button:has-text("Create character")');
  await page.locator('[data-testid=character-card]').first().waitFor();
  const id = (await db.query('SELECT id FROM characters WHERE name=$1', [name])).rows[0].id;
  await db.query('UPDATE characters SET map_id=$2,pos_x=$3,pos_y=$4 WHERE id=$1', [id, 'greenhaven', tx * 32 + 16, 26 * 32 + 16]);
  await setup?.(id);
  await page.locator('[data-testid=character-card]').first().click();
  await page.waitForFunction(() => window.__terrago?.client.ui.get().status === 'online');
  await page.waitForTimeout(600);
  return { page, id, name, ui: () => page.evaluate(() => window.__terrago.client.ui.get()) };
}

async function clickPlayer(viewer, target) {
  const pt = await viewer.page.evaluate((id) => {
    const t = window.__terrago;
    const r = t.client.remotes.get(id);
    const cam = t.game.scene.getScene('world').cameras.main;
    return r ? { x: (r.x - cam.worldView.x) * cam.zoom, y: (r.y - 14 - cam.worldView.y) * cam.zoom } : null;
  }, target.id);
  await viewer.page.mouse.click(pt.x, pt.y);
  await viewer.page.locator('[data-testid=player-menu]').waitFor();
}

try {
  const A = await makePlayer('Gwen', 30, (id) => db.query('UPDATE characters SET gold=1000, level=3 WHERE id=$1', [id]));
  const B = await makePlayer('Rook', 32, (id) => db.query('UPDATE characters SET level=3 WHERE id=$1', [id]));

  // Party via the player menu.
  await clickPlayer(A, B);
  await A.page.click('[data-testid=player-party]');
  await B.page.locator('[data-testid=invite-party]').waitFor();
  await B.page.screenshot({ path: `${OUT}/v06-01-party-invite.png` });
  await B.page.click('[data-testid=invite-accept-party]');
  await A.page.locator('[data-testid=party-frame]').waitFor();
  check('Party formed', (await A.ui()).party.members.length === 2);

  // Party chat through the channel picker, and world chat with /g.
  await A.page.keyboard.press('Enter');
  await A.page.selectOption('[data-testid=chat-channel]', '/p ');
  await A.page.fill('[data-testid=chat-input]', 'stick together');
  await A.page.keyboard.press('Enter');
  await B.page.waitForFunction(() => window.__terrago.client.ui.get().chat.some((m) => m.channel === 'party' && m.text === 'stick together'));
  check('Party chat delivered', true);
  await A.page.keyboard.press('Enter');
  await A.page.fill('[data-testid=chat-input]', '/g anyone selling iron?');
  await A.page.keyboard.press('Enter');
  await B.page.waitForFunction(() => window.__terrago.client.ui.get().chat.some((m) => m.channel === 'global'));
  check('World chat delivered', true);

  // Found a guild and invite B from their profile.
  await A.page.keyboard.press('g');
  await A.page.fill('[data-testid=guild-name]', `Moss ${stamp.slice(-4)}`);
  await A.page.fill('[data-testid=guild-tag]', 'MOS');
  await A.page.click('[data-testid=guild-create]');
  await A.page.locator('[data-testid=guild-members]').waitFor();
  check('Guild founded for 500 Gold', (await A.ui()).inventory.gold === 500);
  await A.page.keyboard.press('g');
  await clickPlayer(A, B);
  await A.page.click('[data-testid=player-profile]');
  await A.page.locator('[data-testid=profile-window]').waitFor();
  await A.page.click('button:has-text("Guild invite")');
  await B.page.locator('[data-testid=invite-guild]').waitFor();
  await B.page.click('[data-testid=invite-accept-guild]');
  await A.page.waitForFunction(() => window.__terrago.client.ui.get().guild?.members.length === 2);
  await A.page.waitForFunction((id) => window.__terrago.client.remotes.get(id)?.info.guild === 'MOS', B.id);
  check('Guild tag shows over B', true);

  // Friends: request from the profile, accept, see them online.
  await A.page.click('[data-testid=profile-friend]');
  await B.page.locator('[data-testid=invite-friend]').waitFor();
  await B.page.click('[data-testid=invite-accept-friend]');
  await A.page.click('[data-testid=profile-window] button[aria-label=Close]');
  await A.page.keyboard.press('o');
  await A.page.locator('[data-testid=friends-list] li').first().waitFor();
  const txt = await A.page.locator('[data-testid=friends-list]').innerText();
  check('Friend listed', txt.includes(B.name), txt.replace(/\n/g, ' '));
  await A.page.screenshot({ path: `${OUT}/v06-02-friends.png` });
  await A.page.keyboard.press('o');
  await A.page.keyboard.press('g');
  await A.page.waitForTimeout(400);
  await A.page.screenshot({ path: `${OUT}/v06-03-guild.png` });
  log('ALL v0.6 BROWSER CHECKS PASSED');
} catch (e) {
  log('ERROR', e.message);
  process.exitCode = 1;
} finally {
  await browser.close();
  await db.end();
}
