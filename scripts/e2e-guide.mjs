/**
 * Guide quests, riding and ranged combat in a real browser.
 * Run: npx tsx scripts/e2e-guide.mjs
 */
import { mkdirSync } from 'node:fs';
import pg from 'pg';
import { chromium } from 'playwright';

const WEB = process.env.WEB_URL ?? 'http://localhost:3000';
const OUT = process.env.OUT_DIR ?? 'test-results/e2e';
const DB = process.env.DATABASE_URL ?? 'postgres://terrago:terrago_dev_password@localhost:5432/terrago';
mkdirSync(OUT, { recursive: true });
const db = new pg.Pool({ connectionString: DB, max: 2 });
const log = (...a) => console.log('[guide]', ...a);
const check = (name, ok, detail = '') => {
  log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) throw new Error(`Check failed: ${name}`);
};
const stamp = Date.now().toString(36).replace(/[0-9]/g, (d) => 'abcdefghij'[d]);
const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 1280, height: 760 } })).newPage();
page.on('pageerror', (e) => log('pageerror:', e.message));
const ui = () => page.evaluate(() => window.__terrago.client.ui.get());
const online = () => page.waitForFunction(() => window.__terrago?.client.ui.get().status === 'online', null, { timeout: 15000 });
let id;
async function goto(map, x, y, dir) {
  await page.evaluate(() => window.__terrago.client.logout());
  await page.waitForTimeout(300);
  await db.query('UPDATE characters SET map_id=$2,pos_x=$3,pos_y=$4,direction=$5 WHERE id=$1', [id, map, x * 32 + 16, y * 32 + 22, dir]);
  await page.goto(`${WEB}/play?c=${id}`);
  await online();
  await page.waitForTimeout(700);
}
/** Talk to the NPC in front and click through to a dialogue action (e.g. quest_offer). */
async function talkUntil(action) {
  await page.keyboard.press('e');
  await page.locator('[data-testid=dialogue]').waitFor();
  for (let i = 0; i < 12; i++) {
    if (action && (await page.locator(`[data-testid=dialogue-action-${action}]`).first().isVisible())) {
      await page.locator(`[data-testid=dialogue-action-${action}]`).first().click();
      return;
    }
    if (!(await page.locator('[data-testid=dialogue]').isVisible())) return;
    await page.click('[data-testid=dialogue-next]');
    await page.waitForTimeout(200);
  }
  if (action) throw new Error(`no ${action} action`);
}
try {
  await page.goto(`${WEB}/register`);
  await page.fill('#email', `guide-${stamp}@example.com`);
  await page.fill('#password', 'follow the guide');
  await page.fill('#confirm', 'follow the guide');
  await page.click('button[type=submit]');
  await page.waitForURL('**/characters');
  const name = `Guid${stamp}`.slice(0, 16);
  await page.fill('#char-name', name);
  await page.click('button:has-text("Ranger")').catch(() => {});
  await page.click('button:has-text("Create character")');
  await page.locator('[data-testid=character-card]').first().waitFor();
  id = (await db.query('SELECT id FROM characters WHERE name=$1', [name])).rows[0].id;
  await page.locator('[data-testid=character-card]').first().click();
  await online();
  await page.waitForTimeout(800);
  const tracker = await page.locator('[data-testid=quest-tracker]').innerText();
  check('Tracker invites you to find a quest', /New quest/.test(tracker), tracker.replace(/\n/g, ' '));
  await page.screenshot({ path: `${OUT}/guide-01-tracker.png` });

  await goto('greenhaven', 29, 22, 'left');
  check('Lina shows a ! marker', await page.evaluate(() => window.__terrago.game.scene.getScene('world').npcMarkers.get('mayor_lina')?.text === '!'));
  await talkUntil('quest_offer');
  await page.locator('[data-testid=quest-offer]').waitFor();
  await page.screenshot({ path: `${OUT}/guide-01b-offer.png` });
  await page.click('[data-testid=quest-accept]');
  await page.waitForFunction(() => window.__terrago.client.ui.get().quests.some((q) => q.id === 'q_pony'));
  check('Accepted the pony quest', true);
  await page.waitForTimeout(600);
  check('Guide arrow points somewhere', await page.evaluate(() => !!window.__terrago.game.scene.getScene('world').guideTarget));
  await page.screenshot({ path: `${OUT}/guide-01c-arrow.png` });

  await goto('greenhaven', 45, 23, 'left');
  await talkUntil(null);
  await page.waitForFunction(() => window.__terrago.client.ui.get().inventory.slots.some((s) => s.itemId === 'brown_pony'));
  check('Hana gives a pony', true);
  await page.waitForTimeout(400);
  await page.keyboard.press('z');
  await page.waitForFunction(() => window.__terrago.client.ui.get().self.mount === 'brown_pony');
  check('Z mounts the pony', (await ui()).self.speed > 1.4);
  const x0 = await page.evaluate(() => window.__terrago.client.pos.x);
  await page.keyboard.down('d');
  await page.waitForTimeout(1000);
  await page.keyboard.up('d');
  await page.waitForTimeout(300);
  const dx = (await page.evaluate(() => window.__terrago.client.pos.x)) - x0;
  check('Riding is faster than walking (112 px/s)', dx > 140, `${Math.round(dx)} px in 1s`);
  await page.screenshot({ path: `${OUT}/guide-02-riding.png` });
  check('Tracker says return to Hana', /Return to Stablemaster Hana/.test(await page.locator('[data-testid=quest-tracker]').innerText()));
  await page.keyboard.press('z');
  await goto('greenhaven', 45, 23, 'left');
  await talkUntil('quest_complete');
  await page.locator('[data-testid=quest-reward]').waitFor();
  await page.screenshot({ path: `${OUT}/guide-03-reward.png` });
  await page.click('[data-testid=quest-reward-ok]');
  check('Next quest offered by Hana (! marker)', await page.evaluate(() => window.__terrago.game.scene.getScene('world').npcMarkers.get('stablemaster_hana')?.text === '!'));
  log('ALL GUIDE CHECKS PASSED');
} catch (e) {
  await page.screenshot({ path: `${OUT}/guide-failure.png` }).catch(() => {});
  console.error(e);
  process.exitCode = 1;
} finally {
  await browser.close();
  await db.end();
}
