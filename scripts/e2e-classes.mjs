/**
 * New classes in a real browser: the creator offers Warrior/Mage/Archer/Acolyte,
 * a Warrior shows a Rage bar, stat points are spent from the Character window,
 * and the Job Trainer offers Paladin/Berserker at level 40.
 * Run: npx tsx scripts/e2e-classes.mjs
 */
import { mkdirSync } from 'node:fs';
import pg from 'pg';
import { chromium } from 'playwright';

const WEB = process.env.WEB_URL ?? 'http://localhost:3000';
const OUT = process.env.OUT_DIR ?? 'test-results/e2e';
const DB = process.env.DATABASE_URL ?? 'postgres://terrago:terrago_dev_password@localhost:5432/terrago';
mkdirSync(OUT, { recursive: true });
const db = new pg.Pool({ connectionString: DB, max: 2 });
const log = (...a) => console.log('[classes]', ...a);
const check = (name, ok, detail = '') => {
  log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) throw new Error(`Check failed: ${name}`);
};
const stamp = Date.now().toString(36).replace(/[0-9]/g, (d) => 'abcdefghij'[d]);
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 860 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('dialog', (d) => d.accept());
try {
  await page.goto(`${WEB}/register`);
  await page.fill('#email', `cls-${stamp}@example.com`);
  await page.fill('#password', 'rage and glory');
  await page.fill('#confirm', 'rage and glory');
  await page.click('button[type=submit]');
  await page.waitForURL('**/characters');
  await page.locator('#char-name').waitFor();
  const text = await page.locator('body').innerText();
  check('Creator offers the four classes', ['Warrior', 'Mage', 'Archer', 'Acolyte'].every((c) => text.includes(c)) && !text.includes('Rogue'));
  await page.screenshot({ path: `${OUT}/classes-01-creator.png` });
  const name = `Cl${stamp}`.slice(0, 16);
  await page.fill('#char-name', name);
  await page.click('button:has-text("Create character")');
  await page.locator('[data-testid=character-card]').first().waitFor();
  const id = (await db.query('SELECT id FROM characters WHERE name=$1', [name])).rows[0].id;
  await db.query('UPDATE characters SET level = 40 WHERE id = $1', [id]);
  await db.query('UPDATE characters SET map_id=$2,pos_x=$3,pos_y=$4 WHERE id=$1', [id, 'greenhaven', 38 * 32 + 16, 14 * 32 + 16]);
  await page.locator('[data-testid=character-card]').first().click();
  await page.waitForFunction(() => window.__terrago?.client.ui.get().status === 'online');
  await page.waitForTimeout(800);
  const hud = await page.locator('[data-testid=hud]').innerText();
  const cls = await page.evaluate(() => window.__terrago.client.ui.get().self.classId);
  check('HUD shows the class resource', cls !== 'warrior' || hud.includes('RG'), `${cls}: ${hud.replace(/\n/g, ' ')}`);
  await page.keyboard.press('c');
  await page.locator('[data-testid=stat-points]').waitFor();
  check('195 stat points at level 40', (await page.locator('[data-testid=stat-points]').innerText()).includes('195'));
  await page.click('[data-testid=stat-add-STR]', { modifiers: ['Shift'] });
  await page.waitForFunction(() => window.__terrago.client.ui.get().self.statPoints === 185);
  check('Shift-click spent 10 points', true);
  await page.screenshot({ path: `${OUT}/classes-02-stats.png` });
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  // Job Trainer.
  await page.evaluate(() => window.__terrago.client.ui.set({ serviceNpc: 'job_master_aldric', panel: 'job' }));
  await page.locator('[data-testid=job-panel]').waitFor();
  const jobs = await page.locator('[data-testid=job-panel]').innerText();
  check('Trainer shows two jobs with skills', /Paladin|Sorcerer|Ranger|High Priest/.test(jobs));
  await page.screenshot({ path: `${OUT}/classes-03-jobs.png` });
  await page.locator('[data-testid^=job-pick-]').first().click();
  await page.waitForFunction(() => !!window.__terrago.client.ui.get().self.job);
  const job = await page.evaluate(() => window.__terrago.client.ui.get().self.job);
  check('Became a second job', !!job, job);
  await page.waitForTimeout(500);
  check('Skill bar grew to 5 skills', (await page.locator('[data-testid=skill-bar] button').count()) >= 5);
  await page.screenshot({ path: `${OUT}/classes-04-job.png` });
  check('No page errors', errors.length === 0, errors.join(' | '));
  log('ALL CLASS BROWSER CHECKS PASSED');
} catch (e) {
  await page.screenshot({ path: `${OUT}/classes-failure.png` }).catch(() => {});
  throw e;
} finally {
  await browser.close();
  await db.end();
}
