import { defineConfig } from 'vitest/config';

// `npm test` runs Vitest across the whole monorepo from the root with no
// per-workspace config, so without this it also picks up e2e/*.spec.ts
// (Vitest's default include glob matches *.spec.ts same as *.test.ts) and
// tries to run it as a unit test - it isn't one, it's a Playwright test
// (playwright.config.ts / `npm run test:e2e` runs that suite instead) and
// fails immediately because `test`/`expect` come from @playwright/test,
// not Vitest.
export default defineConfig({
  test: {
    exclude: ['**/node_modules/**', '**/dist/**', 'e2e/**'],
  },
});
