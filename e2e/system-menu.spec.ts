import { test, expect } from '@playwright/test';

/**
 * M1 acceptance (SPEC.md section 3): "the story intro... is skipped [on
 * later logins] and can be replayed from Settings." Covers the system
 * menu (ui/hud/systemMenu.ts, task #76) end to end: Esc opens it from
 * World, "Replay Intro" actually leaves World and shows the intro again
 * with the gameplay HUD out of the way, and skipping it a second time
 * returns cleanly to World with the HUD back and session state intact.
 *
 * This suite exists because task #76's own live verification pass caught
 * three real bugs that a purely visual/manual check had missed:
 *  1. `.terago-hud-system-menu` set `display: flex` directly, which (per
 *     the CSS cascade - author origin always beats the browser's own
 *     `[hidden] { display: none }` UA rule, regardless of specificity)
 *     meant toggling the `hidden` property never actually hid the panel.
 *  2. The menu's "Replay Intro" callback called the global
 *     `game.scene.start('Intro')` from outside any Scene - which, unlike
 *     an in-scene `this.scene.start(...)` call, does not stop whatever
 *     scene is currently running, so WorldScene kept running underneath.
 *  3. IntroScene never calls `hud.hide()` itself (fine on a first
 *     playthrough, since the HUD isn't shown yet at that point) - so on
 *     a *replay* nothing ever hid the already-visible gameplay HUD.
 * See docs/DECISIONS.md for the fuller account. Assertions below target
 * exactly these: the panel's actual visibility (not just the `hidden`
 * property), the HUD's `is-visible` class as a stand-in for "did we
 * really leave World", and a clean round trip back.
 */

test('replay intro from the system menu hides the HUD during the intro and returns cleanly to World', async ({ page }) => {
  const isRealError = (text: string) => !/^Failed to load resource/.test(text);
  const consoleErrors: string[] = [];
  page.on('console', (m) => { if (m.type() === 'error' && isRealError(m.text())) consoleErrors.push(m.text()); });
  page.on('pageerror', (e) => consoleErrors.push(String(e)));

  await page.goto('/');
  await page.locator('#terago-auth-toggle').click(); // default mode is Log In
  await page.locator('#terago-username').fill(`e2esm${Date.now()}`);
  await page.locator('#terago-password').fill('pw123456');
  await page.locator('#terago-auth-submit').click();
  await page.waitForTimeout(1200);
  await page.keyboard.press('Escape'); // skip the first-run story intro
  await expect(page.locator('.terago-hud-status')).toBeVisible({ timeout: 8000 });

  const menu = page.locator('.terago-hud-system-menu');
  const hud = page.locator('.terago-hud');

  // Closed by default: not just `hidden` as a DOM property, but actually
  // not rendered (bug #1 above would otherwise leave this "visible").
  await expect(menu).toBeHidden();

  // Esc with nothing else open reveals the system menu.
  await page.keyboard.press('Escape');
  await expect(menu).toBeVisible();
  await expect(hud).toHaveClass(/is-visible/);

  // A plain, unscripted click - no manual coordinates - on "Replay Intro".
  await page.locator('.terago-system-replay-intro').click();

  // The menu closes, and - the real regression - the gameplay HUD comes
  // down too: WorldScene actually stopped and Intro actually started
  // (bugs #2/#3), not just rendered invisibly behind it.
  await expect(menu).toBeHidden();
  await expect(hud).not.toHaveClass(/is-visible/);

  // While "in" the replayed intro, World-only input must be inert - if
  // WorldScene were still running underneath (bug #2), its own HUD
  // would still be live enough for this to open the inventory panel.
  await page.keyboard.press('i');
  await expect(page.locator('.terago-hud-inventory')).toBeHidden();

  // Skip the replayed intro the same way as the first time.
  await page.keyboard.press('Escape');
  await expect(page.locator('.terago-hud-status')).toBeVisible({ timeout: 8000 });
  await expect(hud).toHaveClass(/is-visible/);

  expect(consoleErrors, `console errors: ${consoleErrors.join('; ')}`).toEqual([]);
});
