// Builds the single-page offline preview of TerraGo:
//   npm run build:preview -w @terrago/web   →  apps/web/dist-preview/terrago-preview.html
//
// React, React DOM and Phaser load from cdnjs (pinned versions); TerraGo's own
// code and CSS are inlined so the page is one self-contained file.
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const here = dirname(fileURLToPath(import.meta.url));
const web = resolve(here, '..');
const out = join(web, 'dist-preview');
mkdirSync(out, { recursive: true });

export const CDN = {
  react: 'https://cdnjs.cloudflare.com/ajax/libs/react/18.3.1/umd/react.production.min.js',
  reactDom: 'https://cdnjs.cloudflare.com/ajax/libs/react-dom/18.3.1/umd/react-dom.production.min.js',
  phaser: 'https://cdnjs.cloudflare.com/ajax/libs/phaser/3.90.0/phaser.min.js',
  font: 'https://fonts.googleapis.com/css2?family=Pixelify+Sans:wght@400;700&display=swap',
};

// 1. Tailwind CSS (scans src/ and demo/)
const cssFile = join(out, 'preview.css');
execFileSync(join(web, '..', '..', 'node_modules', '.bin', 'tailwindcss'), ['-i', join(here, 'demo.css'), '-o', cssFile, '--minify'], {
  cwd: web,
  stdio: 'inherit',
});

// 2. JavaScript bundle; libraries resolve to the CDN globals.
const globals = { phaser: 'Phaser', react: 'React', 'react-dom': 'ReactDOM', 'react-dom/client': 'ReactDOM' };
const result = await build({
  entryPoints: [join(here, 'main.tsx')],
  bundle: true,
  write: false,
  format: 'iife',
  platform: 'browser',
  target: ['es2020', 'safari15'],
  minify: true,
  legalComments: 'none',
  jsx: 'automatic',
  alias: { '@': join(web, 'src'), 'node:crypto': join(here, 'shims', 'crypto.ts') },
  define: {
    'process.env.NODE_ENV': '"production"',
    'process.env.NEXT_PUBLIC_GAME_SERVER_URL': '"http://localhost:4000"',
  },
  plugins: [
    {
      name: 'cdn-globals',
      setup(b) {
        b.onResolve({ filter: /^react\/jsx-runtime$/ }, () => ({ path: join(here, 'shims', 'jsx-runtime.ts') }));
        b.onResolve({ filter: /^(phaser|react|react-dom|react-dom\/client)$/ }, (args) => ({ path: args.path, namespace: 'cdn-global' }));
        b.onLoad({ filter: /.*/, namespace: 'cdn-global' }, (args) => ({ contents: `module.exports = window.${globals[args.path]};`, loader: 'js' }));
      },
    },
  ],
  logLevel: 'warning',
});
const js = result.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
const css = readFileSync(cssFile, 'utf8').replace(/<\/style/gi, '<\\/style');

// 3. One HTML page (the Artifact host adds <!doctype>, <head> and <body>).
const html = `<title>TerraGo Preview</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="${CDN.font}">
<style>
/* One visual world: a dark pixel-MMO night palette, single theme by design. */
:root { color-scheme: dark; --bg: #12141f; --fg: #f3e6c4; }
html, body { height: 100%; background: var(--bg); color: var(--fg); overscroll-behavior: none; }
#terrago-root { min-height: 100%; }
</style>
<style>${css}</style>
<div id="terrago-root"></div>
<noscript>TerraGo needs JavaScript to run.</noscript>
<script src="${CDN.react}"></script>
<script src="${CDN.reactDom}"></script>
<script src="${CDN.phaser}"></script>
<script>${js}</script>
`;
const file = join(out, 'terrago-preview.html');
writeFileSync(file, html);
console.log(`wrote ${file} (${(html.length / 1024).toFixed(0)} KB)`);
