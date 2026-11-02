import { test, expect, type Page } from '@playwright/test';

/**
 * SPEC.md section 12 (definition of done): "The Playwright smoke test logs
 * in two players and confirms each sees the other move." Also exercises
 * M1's equipment-sync acceptance bullet ("changes the character sprite
 * immediately, on the wearer's screen and on other players' screens"),
 * since it's cheap to check once two real sessions are already up.
 *
 * Assertions read the actual wire protocol (world:snapshot) rather than
 * pixels or DOM text, because player name tags and sprites are drawn on
 * a Phaser <canvas> - invisible to Playwright's DOM/accessibility
 * locators - and a canvas screenshot diff would be a flaky way to check
 * "did position X change" when a precise number is right there on the
 * wire. A small `window.__entities` map, filled by a WebSocket tap
 * installed before the page's own scripts run, is the same technique
 * used throughout this project's manual Playwright verification passes
 * (see docs/DECISIONS.md).
 */

const TILE_PX = 48;
function tilePx(tx: number, ty: number): [number, number] {
  return [tx * TILE_PX + TILE_PX / 2, ty * TILE_PX + TILE_PX / 2];
}

interface TrackedEntity {
  id: string;
  kind: 'player' | 'monster';
  name: string;
  x: number;
  y: number;
  equipment?: Record<string, string | null>;
}

async function installEntityTap(page: Page): Promise<void> {
  await page.addInitScript(() => {
    (window as any).__entities = new Map<string, TrackedEntity>();
    const OrigWS = window.WebSocket;
    // @ts-expect-error - intentionally replacing the global constructor
    window.WebSocket = new Proxy(OrigWS, {
      construct(target, args: ConstructorParameters<typeof WebSocket>) {
        const ws = new target(...args);
        ws.addEventListener('message', (ev: MessageEvent) => {
          try {
            const msg = JSON.parse(ev.data as string);
            if (msg.t === 'world:snapshot') {
              const map: Map<string, TrackedEntity> = (window as any).__entities;
              for (const e of [...(msg.entered ?? []), ...(msg.updated ?? [])]) map.set(e.id, e);
              for (const id of msg.left ?? []) map.delete(id);
            }
          } catch {
            /* ignore non-JSON frames */
          }
        });
        return ws;
      },
    });
  });
}

async function knownEntities(page: Page): Promise<TrackedEntity[]> {
  return page.evaluate(() => [...(window as any).__entities.values()]);
}

async function findByName(page: Page, name: string, timeoutMs = 8000): Promise<TrackedEntity> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const found = (await knownEntities(page)).find((e) => e.name === name);
    if (found) return found;
    await page.waitForTimeout(200);
  }
  throw new Error(`entity named "${name}" never appeared in ${page.url()}'s world:snapshot stream`);
}

async function waitForPosition(
  page: Page,
  name: string,
  predicate: (e: TrackedEntity) => boolean,
  timeoutMs = 8000
): Promise<TrackedEntity> {
  const deadline = Date.now() + timeoutMs;
  let last: TrackedEntity | undefined;
  while (Date.now() < deadline) {
    last = (await knownEntities(page)).find((e) => e.name === name);
    if (last && predicate(last)) return last;
    await page.waitForTimeout(200);
  }
  throw new Error(`"${name}" never matched the expected condition (last seen: ${JSON.stringify(last)})`);
}

async function registerAndEnterWorld(page: Page, username: string): Promise<void> {
  await page.goto('/');
  await page.locator('#terago-auth-toggle').click(); // default mode is Log In
  await page.locator('#terago-username').fill(username);
  await page.locator('#terago-password').fill('pw123456');
  await page.locator('#terago-auth-submit').click();
  await page.waitForTimeout(1200);
  await page.keyboard.press('Escape'); // skip the story intro
  await expect(page.locator('.terago-hud-status')).toBeVisible({ timeout: 8000 });
}

test('two players in separate sessions see each other, move, and sync equipment live', async ({ browser }) => {
  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  const pageA = await ctxA.newPage();
  const pageB = await ctxB.newPage();

  // "Failed to load resource" console entries (e.g. the browser's own
  // automatic /favicon.ico probe - this app serves no favicon) are
  // routine network noise the browser itself logs as type 'error', not a
  // game bug; `pageerror` (an actual uncaught exception) is the real bar.
  const isRealError = (text: string) => !/^Failed to load resource/.test(text);
  const consoleErrorsA: string[] = [];
  const consoleErrorsB: string[] = [];
  pageA.on('console', (m) => { if (m.type() === 'error' && isRealError(m.text())) consoleErrorsA.push(m.text()); });
  pageB.on('console', (m) => { if (m.type() === 'error' && isRealError(m.text())) consoleErrorsB.push(m.text()); });
  pageA.on('pageerror', (e) => consoleErrorsA.push(String(e)));
  pageB.on('pageerror', (e) => consoleErrorsB.push(String(e)));

  await installEntityTap(pageA);
  await installEntityTap(pageB);

  const stamp = Date.now();
  const unameA = `e2eA${stamp}`;
  const unameB = `e2eB${stamp}`;

  await Promise.all([registerAndEnterWorld(pageA, unameA), registerAndEnterWorld(pageB, unameB)]);

  // Both characters spawn at the same Oakhaven spawn point (shared/config/maps.ts),
  // so each should already see the other the moment both are in the room.
  await findByName(pageA, unameB);
  await findByName(pageB, unameA);

  // --- A click-to-moves to (10,10): inside Oakhaven's bounds, clear of
  // every OAKHAVEN_OBSTACLES rect (x in [3,6] or [14,17] only) ---
  const [mx, my] = tilePx(10, 10);
  await pageA.mouse.click(mx, my);
  const aAsSeenByB = await waitForPosition(pageB, unameA, (e) => Math.round(e.x) === 10 && Math.round(e.y) === 10);
  expect(Math.round(aAsSeenByB.x)).toBe(10);
  expect(Math.round(aAsSeenByB.y)).toBe(10);

  // --- B moves via WASD diagonal (S+D: down-right, away from spawn and
  // clear of every obstacle rect) ---
  const bBefore = await findByName(pageA, unameB);
  await pageB.keyboard.down('S');
  await pageB.keyboard.down('D');
  await pageB.waitForTimeout(900);
  await pageB.keyboard.up('S');
  await pageB.keyboard.up('D');
  const bAfterAsSeenByA = await waitForPosition(
    pageA,
    unameB,
    (e) => e.x > bBefore.x + 0.5 && e.y > bBefore.y + 0.5
  );
  expect(bAfterAsSeenByA.x).toBeGreaterThan(bBefore.x);
  expect(bAfterAsSeenByA.y).toBeGreaterThan(bBefore.y);

  // --- Equipment sync: A unequips the starting sword, B must see it
  // vanish from A's equipment; A re-equips, B must see it return ---
  await pageA.keyboard.press('i');
  await pageA.locator('.terago-equip-slot[data-slot="weapon"]').click();
  await pageA.keyboard.press('i');
  await waitForPosition(pageB, unameA, (e) => e.equipment?.weapon == null);

  await pageA.keyboard.press('i');
  const bagTitles = await pageA.$$eval('.terago-bag-slot', (els) => els.map((e) => e.getAttribute('title')));
  const swordIdx = bagTitles.findIndex((t) => t && /sword/i.test(t));
  expect(swordIdx).toBeGreaterThanOrEqual(0);
  await pageA.locator('.terago-bag-slot').nth(swordIdx).click();
  await pageA.keyboard.press('i');
  await waitForPosition(pageB, unameA, (e) => e.equipment?.weapon != null);

  expect(consoleErrorsA, `console errors on A's page: ${consoleErrorsA.join('; ')}`).toEqual([]);
  expect(consoleErrorsB, `console errors on B's page: ${consoleErrorsB.join('; ')}`).toEqual([]);

  await ctxA.close();
  await ctxB.close();
});
