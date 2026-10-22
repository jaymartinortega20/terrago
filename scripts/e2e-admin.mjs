/**
 * Admin tools in a real browser: economy dashboard, anti-bot flags, player
 * details, settings and starting a world event. Run: npx tsx scripts/e2e-admin.mjs
 */
import { mkdirSync } from 'node:fs';
import pg from 'pg';
import { chromium } from 'playwright';

const WEB = process.env.WEB_URL ?? 'http://localhost:3000';
const OUT = process.env.OUT_DIR ?? 'test-results/e2e';
const DB = process.env.DATABASE_URL ?? 'postgres://terrago:terrago_dev_password@localhost:5432/terrago';
mkdirSync(OUT, { recursive: true });
const db = new pg.Pool({ connectionString: DB, max: 2 });
const log = (...a) => console.log('[admin]', ...a);
const check = (name, ok, detail = '') => {
  log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) throw new Error(`Check failed: ${name}`);
};
const stamp = Date.now().toString(36).replace(/[0-9]/g, (d) => 'abcdefghij'[d]);
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('dialog', (d) => d.accept('looked fine'));

async function account(prefix) {
  await page.goto(`${WEB}/register`);
  await page.fill('#email', `${prefix}-${stamp}@example.com`);
  await page.fill('#password', 'keys to the kingdom');
  await page.fill('#confirm', 'keys to the kingdom');
  await page.click('button[type=submit]');
  await page.waitForURL('**/characters');
  const name = `${prefix[0].toUpperCase()}${prefix.slice(1, 3)}${stamp}`.slice(0, 16);
  await page.fill('#char-name', name);
  await page.click('button:has-text("Create character")');
  await page.locator('[data-testid=character-card]').first().waitFor();
  return { email: `${prefix}-${stamp}@example.com`, name, id: (await db.query('SELECT id FROM characters WHERE name=$1', [name])).rows[0].id };
}

try {
  // A suspicious player first (then log out), then the admin.
  const sus = await account('sus');
  await ctx.clearCookies();
  const admin = await account('adm');
  await db.query(`UPDATE users SET roles = ARRAY['player','admin'] WHERE email = $1`, [admin.email]);
  await db.query(`INSERT INTO security_events (kind, character_id, details) VALUES ('bot_timing', $1, '{"meanMs": 1500, "sdMs": 4}')`, [sus.id]);
  await db.query(`INSERT INTO direct_trade_logs (a_id, b_id, a_gold, b_gold) VALUES ($1, $2, 30000, 0)`, [sus.id, admin.id]);

  await page.goto(`${WEB}/admin`);
  await page.locator('[data-testid=admin-stats]').waitFor();
  // Give the suspicious player gold through the UI so the ledger has a source.
  await page.click('[data-testid=admin-tab-players]');
  await page.fill('[data-testid=admin-search]', sus.name);
  await page.locator('[data-testid=admin-players] tr', { hasText: sus.name }).waitFor();
  await page.click('button:has-text("Give")');
  await page.locator('input[type=number]').first().fill('60000');
  await page.click('button:has-text("Send")');
  await page.locator('[role=status]', { hasText: 'Sent' }).waitFor();

  await page.click('[data-testid=admin-tab-economy]');
  await page.locator('[data-testid=economy-sources]').waitFor();
  check('Economy shows admin gold as a source', (await page.locator('[data-testid=economy-sources]').innerText()).toLowerCase().includes('admin'));
  check('Gift trade flagged as suspicious', (await page.locator('[data-testid=economy-suspicious]').innerText()).includes('30,000'));
  check('Daily chart drawn', (await page.locator('[data-testid=economy-daily] rect').count()) > 2);
  await page.screenshot({ path: `${OUT}/admin-01-economy.png`, fullPage: true });

  await page.click('[data-testid=admin-tab-flags]');
  await page.locator('[data-testid=admin-flags] article', { hasText: sus.name }).first().waitFor();
  await page.screenshot({ path: `${OUT}/admin-02-flags.png` });
  await page.locator('[data-testid=admin-flags] article', { hasText: sus.name }).first().locator('button:has-text("fine")').click();
  await page.locator('[role=status]', { hasText: 'cleared' }).waitFor();
  check('Flag cleared', true);

  // Big gold move → click the name → player details.
  await page.click('[data-testid=admin-tab-economy]');
  await page.locator('[data-testid=economy-suspicious] button', { hasText: sus.name }).first().click();
  await page.locator('[data-testid=admin-player-detail]').waitFor();
  await page.click('button:has-text("Gold history")');
  check('Player gold history shows the admin gift', (await page.locator('[data-testid=admin-player-detail]').innerText()).includes('60,000'));
  await page.screenshot({ path: `${OUT}/admin-03-player.png` });

  await page.click('[data-testid=admin-tab-tools]');
  await page.locator('[data-testid=admin-settings]').waitFor();
  await page.selectOption('[data-testid=admin-event-pick]', 'fishing_frenzy');
  await page.click('[data-testid=admin-event-start]');
  await page.locator('[data-testid=admin-settings]', { hasText: 'Fishing Frenzy (until' }).waitFor();
  check('Event started from the panel', true);
  await page.screenshot({ path: `${OUT}/admin-04-tools.png` });
  await page.click('button:has-text("Stop")');
  await page.locator('[role=status]', { hasText: 'stopped' }).waitFor();
  check('No page errors', errors.length === 0, errors.join(' | '));
  log('ALL ADMIN BROWSER CHECKS PASSED');
} catch (e) {
  await page.screenshot({ path: `${OUT}/admin-failure.png` }).catch(() => {});
  throw e;
} finally {
  await browser.close();
  await db.end();
}
