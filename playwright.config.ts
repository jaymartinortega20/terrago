import { defineConfig, devices } from '@playwright/test';

/**
 * SPEC.md section 12 (definition of done): "The Playwright smoke test logs
 * in two players and confirms each sees the other move." `npm run test:e2e`
 * runs this. It starts the real stack (`npm run dev`, from the repo root -
 * both the game server and the Vite client) and drives it with a real
 * browser, same as a person playing the game - no mocking, no stubs.
 *
 * `webServer` reuses an already-running dev server when one is up (handy
 * locally and for the many smoke/acceptance passes this project runs
 * during development) and starts a fresh one otherwise (CI, a clean
 * checkout). Each test run gets a fresh SQLite row per account because
 * every spec registers a freshly-timestamped username rather than reusing
 * a fixed one.
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: false, // two-player tests need a shared, consistent server
  retries: 0,
  reporter: 'list',
  // The default 30s runs right up against the wire for a real two-client
  // multiplayer flow (double registration, movement waits, an equip-UI
  // round trip) - it passed in ~27s in one measured run with no margin at
  // all. This is a portable margin increase, not an environment-specific
  // workaround (see .sandbox-verify.config.ts's own comment for that).
  timeout: 60_000,
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:5173',
    reuseExistingServer: true,
    timeout: 60_000,
  },
});
