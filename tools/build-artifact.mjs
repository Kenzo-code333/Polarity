// =============================================================================
// Builds dist/polarity-offline.html: a single self-contained page that runs
// Polarity entirely in the browser (practice vs bots, custom matches, the
// tutorial) with no server. Used for the Claude artifact.
//   node tools/build-artifact.mjs
// =============================================================================
import { build } from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const PIXI_VERSION = JSON.parse(fs.readFileSync(path.join(ROOT, 'node_modules/pixi.js/package.json'))).version;
const FILTERS_VERSION = JSON.parse(fs.readFileSync(path.join(ROOT, 'node_modules/pixi-filters/package.json'))).version;

// the client imports shared code with absolute "/shared/..." paths
const sharedPaths = {
  name: 'shared-paths',
  setup(b) {
    b.onResolve({ filter: /^\/shared\// }, (args) => ({ path: path.join(ROOT, args.path) }));
  },
};

const result = await build({
  entryPoints: [path.join(ROOT, 'client/js/offline-entry.js')],
  bundle: true, format: 'iife', minify: true, target: 'es2020', write: false,
  plugins: [sharedPaths], legalComments: 'none',
});
const js = result.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');

const html = fs.readFileSync(path.join(ROOT, 'client/index.html'), 'utf8');
const css = fs.readFileSync(path.join(ROOT, 'client/css/style.css'), 'utf8');
const body = html.slice(html.indexOf('<body>') + 6, html.indexOf('<script src="/lib/pixi.min.js">')).trim();
const fonts = html.match(/<link href="https:\/\/fonts\.googleapis\.com[^>]+>/)[0];

const out = `<title>Polarity</title>
<meta name="theme-color" content="#05030f">
<meta name="description" content="Polarity offline edition: a magnetic knockout brawler. Pull, push and anchor bots into the void.">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
${fonts}
<style>
:root { color-scheme: dark; }
${css}
</style>
${body}
<script src="https://cdn.jsdelivr.net/npm/pixi.js@${PIXI_VERSION}/dist/pixi.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/pixi-filters@${FILTERS_VERSION}/dist/browser/pixi-filters.js"></script>
<script>
${js}
</script>
`;
fs.mkdirSync(path.join(ROOT, 'dist'), { recursive: true });
const file = path.join(ROOT, 'dist/polarity-offline.html');
fs.writeFileSync(file, out);
console.log(`wrote ${path.relative(ROOT, file)} (${(out.length / 1024).toFixed(0)} KB)`);
