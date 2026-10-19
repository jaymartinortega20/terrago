// Production build: bundle the server and its workspace packages into dist/index.js.
// Third-party dependencies stay external and are installed in the runtime image.
import { build } from 'esbuild';
import { cpSync, mkdirSync, readFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));
const external = Object.keys(pkg.dependencies).filter((d) => !d.startsWith('@terrago/'));

await build({
  entryPoints: ['src/index.ts'],
  outfile: 'dist/index.js',
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'esm',
  sourcemap: true,
  external,
  banner: { js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" },
  logLevel: 'info',
});

// Migrations ship next to the bundle; MIGRATIONS_DIR points at them in production.
mkdirSync('dist/migrations', { recursive: true });
cpSync('../../packages/database/migrations', 'dist/migrations', { recursive: true });
console.log('copied migrations to dist/migrations');
