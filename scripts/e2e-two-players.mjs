/**
 * VERSION 0.1 SUCCESS TEST — two real browsers.
 *
 *   1. Browser A registers, creates a character, enters Greenhaven.
 *   2. Browser B does the same.
 *   3. A sees B and B sees A.
 *   4. A walks; B sees the movement almost instantly.
 *   5. A says "Hello"; B sees it.
 *   6. A refreshes and reconnects with saved data (same position, same bag).
 *
 * Requires the web app (WEB_URL) and game server running. Screenshots are
 * written to OUT_DIR. Run: npm run test:e2e
 */
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';

const WEB = process.env.WEB_URL ?? 'http://localhost:3000';
const OUT = process.env.OUT_DIR ?? 'test-results/e2e';
const HEADLESS = process.env.HEADED ? false : true;
mkdirSync(OUT, { recursive: true });

const stamp = Date.now().toString(36);
const log = (...a) => console.log(`[e2e ${((performance.now() / 1000) | 0).toString().padStart(3)}s]`, ...a);
const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) throw new Error(`Check failed: ${name} ${detail}`);
};

async function waitFor(page, fn, arg, timeout = 15000) {
  return page.waitForFunction(fn, arg, { timeout, polling: 50 });
}

async function newPlayer(browser, label, look) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 760 } });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => log(`${label} pageerror:`, e.message));
  page.on('console', (m) => m.type() === 'error' && log(`${label} console:`, m.text()));

  const email = `e2e-${label.toLowerCase()}-${stamp}@example.com`;
  const name = `${label}_${stamp}`.slice(0, 16);
  await page.goto(`${WEB}/register`);
  await page.fill('#email', email);
  await page.fill('#password', 'two browsers one world');
  await page.fill('#confirm', 'two browsers one world');
  await page.click('button[type=submit]');
  await page.waitForURL('**/characters');
  await page.fill('#char-name', name);
  for (let i = 0; i < look.hair; i++) await page.click('button[aria-label="Next hair style"]');
  for (let i = 0; i < look.outfit; i++) await page.click('button[aria-label="Next outfit"]');
  await page.click(`button[aria-label="Hair color ${look.hairColor}"]`);
  if (label === 'A') await page.screenshot({ path: `${OUT}/01-character-creator.png` });
  await page.click('button:has-text("Create character")');
  await page.locator('[data-testid=character-card]').first().click();
  await page.waitForURL('**/play?c=*');
  await waitFor(page, () => window.__terrago?.client.ui.get().status === 'online');
  await page.waitForTimeout(400);
  log(`${label} entered the world as ${name}`);
  return { ctx, page, name, email };
}

const remoteNames = (page) => page.evaluate(() => [...window.__terrago.client.remotes.values()].map((r) => r.info.name));
const myPos = (page) => page.evaluate(() => ({ ...window.__terrago.client.pos }));

const browser = await chromium.launch({ headless: HEADLESS, executablePath: process.env.CHROMIUM_PATH || undefined });
try {
  const landing = await browser.newPage({ viewport: { width: 1280, height: 760 } });
  await landing.goto(WEB);
  await landing.waitForTimeout(800);
  await landing.screenshot({ path: `${OUT}/00-landing.png` });
  await landing.close();

  const A = await newPlayer(browser, 'A', { hair: 1, outfit: 0, hairColor: 6 });
  const B = await newPlayer(browser, 'B', { hair: 3, outfit: 4, hairColor: 9 });

  // 3. Mutual visibility
  await waitFor(A.page, (n) => [...window.__terrago.client.remotes.values()].some((r) => r.info.name === n), B.name);
  await waitFor(B.page, (n) => [...window.__terrago.client.remotes.values()].some((r) => r.info.name === n), A.name);
  check('Player A sees Player B', (await remoteNames(A.page)).includes(B.name));
  check('Player B sees Player A', (await remoteNames(B.page)).includes(A.name));
  await A.page.screenshot({ path: `${OUT}/02-A-sees-B.png` });
  await B.page.screenshot({ path: `${OUT}/03-B-sees-A.png` });

  // 4. Movement sync: A walks right; measure how quickly B sees it.
  const remoteX = (page, n) => page.evaluate((nm) => [...window.__terrago.client.remotes.values()].find((r) => r.info.name === nm)?.x ?? null, n);
  const bBefore = await remoteX(B.page, A.name);
  const aBefore = await myPos(A.page);
  await A.page.bringToFront();
  const t0 = Date.now();
  await A.page.keyboard.down('d');
  await waitFor(B.page, ([n, x0]) => {
    const r = [...window.__terrago.client.remotes.values()].find((q) => q.info.name === n);
    return r && r.x > x0 + 2;
  }, [A.name, bBefore]);
  const firstSeenMs = Date.now() - t0;
  await A.page.waitForTimeout(900);
  await A.page.keyboard.up('d');
  await A.page.waitForTimeout(500);
  const aAfter = await myPos(A.page);
  const bAfter = await remoteX(B.page, A.name);
  check('Player A moved', aAfter.x > aBefore.x + 60, `${aBefore.x.toFixed(1)} → ${aAfter.x.toFixed(1)}`);
  check('Player B sees the movement nearly instantly', firstSeenMs < 600, `first visible after ${firstSeenMs} ms`);
  check('B ends with A at the same place A sees itself', Math.abs(bAfter - aAfter.x) < 1.5, `A=${aAfter.x.toFixed(2)} B sees ${bAfter?.toFixed(2)}`);
  await B.page.screenshot({ path: `${OUT}/04-B-sees-A-moved.png` });

  // 5. Chat
  await A.page.keyboard.press('Enter');
  await A.page.keyboard.type('Hello');
  await A.page.keyboard.press('Enter');
  await waitFor(B.page, () => window.__terrago.client.ui.get().chat.some((m) => m.text === 'Hello'));
  const bChat = await B.page.locator('[data-testid=chat-line]').allInnerTexts();
  check('Player B sees "Hello"', bChat.some((t) => t.includes(`${A.name}: Hello`)), bChat.at(-1));
  await B.page.waitForTimeout(300);
  await B.page.screenshot({ path: `${OUT}/05-B-sees-hello.png` });

  // 6. Refresh A: reconnects with saved data
  const beforeRefresh = await myPos(A.page);
  const invBefore = await A.page.evaluate(() => JSON.stringify(window.__terrago.client.ui.get().inventory));
  await A.page.reload();
  await waitFor(A.page, () => window.__terrago?.client.ui.get().status === 'online');
  await A.page.waitForTimeout(500);
  const afterRefresh = await myPos(A.page);
  const invAfter = await A.page.evaluate(() => JSON.stringify(window.__terrago.client.ui.get().inventory));
  const hudName = await A.page.locator('[data-testid=hud-name]').innerText();
  check('A reconnects as the same character', hudName === A.name, hudName);
  check(
    'A reconnects at the saved position',
    Math.hypot(afterRefresh.x - beforeRefresh.x, afterRefresh.y - beforeRefresh.y) < 1,
    `(${beforeRefresh.x.toFixed(1)},${beforeRefresh.y.toFixed(1)}) → (${afterRefresh.x.toFixed(1)},${afterRefresh.y.toFixed(1)})`,
  );
  check('A reconnects with the same inventory', invAfter === invBefore);
  await waitFor(A.page, (n) => [...window.__terrago.client.remotes.values()].some((r) => r.info.name === n), B.name);
  check('After refresh A still sees B', (await remoteNames(A.page)).includes(B.name));
  const ghosts = await B.page.evaluate((n) => [...window.__terrago.client.remotes.values()].filter((r) => r.info.name === n).length, A.name);
  check('No ghost copy of A after refresh', ghosts === 1, `B sees ${ghosts} copies of A`);
  await A.page.screenshot({ path: `${OUT}/06-A-after-refresh.png` });

  // Extra: B walks to Mayor Lina, talks to her, receives the welcome gift, opens the bag.
  await B.page.bringToFront();
  await B.page.keyboard.down('a');
  await B.page.waitForTimeout(650);
  await B.page.keyboard.up('a');
  await B.page.keyboard.down('w');
  await B.page.waitForTimeout(1300);
  await B.page.keyboard.up('w');
  await waitFor(B.page, () => window.__terrago.client.nearestNpc()?.id === 'mayor_lina', undefined, 5000);
  await B.page.keyboard.press('e');
  await B.page.waitForSelector('[data-testid=dialogue]');
  await B.page.waitForTimeout(700);
  await B.page.screenshot({ path: `${OUT}/07-B-talks-to-mayor-lina.png` });
  for (let i = 0; i < 12 && (await B.page.locator('[data-testid=dialogue]').count()); i++) {
    if (await B.page.locator('[data-testid=dialogue-rewards]').count()) break;
    await B.page.click('[data-testid=dialogue-next]');
    await B.page.waitForTimeout(250);
  }
  const rewards = await B.page.locator('[data-testid=dialogue-rewards]').innerText();
  check('Mayor Lina gives the welcome gift', /Honey Bun/.test(rewards) && /Charter/.test(rewards), rewards.replace(/\s+/g, ' '));
  await B.page.screenshot({ path: `${OUT}/08-B-welcome-gift.png` });
  await B.page.click('[data-testid=dialogue-next]');
  await B.page.keyboard.press('i');
  await B.page.waitForSelector('[data-testid=inventory-panel]');
  await B.page.click('[data-testid=slot-4]');
  await B.page.waitForTimeout(200);
  await B.page.screenshot({ path: `${OUT}/09-B-inventory.png` });
  log('All v0.1 checks passed.');
} finally {
  await browser.close();
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  process.exitCode = failed.length ? 1 : 0;
}
