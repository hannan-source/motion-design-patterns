// Builds the hosted preview: one page that runs without the server, keeping data in the browser.
// The host wraps the page in its own <html>/<head>/<body>, so this takes the marked regions of
// web/index.html, inlines the stylesheets, and lists the JS modules to publish beside the page
// at the same relative paths the browser asks the real server for (js/, shared/, vendor/).
//
//   node tools/build-artifact.mjs <output-dir>

import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const web = join(root, 'web');
const out = resolve(process.argv[2] || join(root, 'dist'));
const html = readFileSync(join(web, 'index.html'), 'utf8');

const between = (a, b) => {
  const i = html.indexOf(a), j = html.indexOf(b);
  if (i < 0 || j < 0) throw new Error(`Marker missing in index.html: ${a} … ${b}`);
  return html.slice(i + a.length, j);
};

let head = between('<!--page-->', '<!--/page-head-->');
const cssBlock = between('<!--css-->', '<!--/css-->');
const sheets = [...cssBlock.matchAll(/href="([^"]+)"/g)].map((m) => m[1]).filter((f) => existsSync(join(web, f)));
const css = sheets.map((f) => `/* ${f} */\n${readFileSync(join(web, f), 'utf8')}`).join('\n');
head = head.replace(`<!--css-->${cssBlock}<!--/css-->`, `<style>\n${css}\n</style>`);
// Marked as the preview so it keeps data in the browser; unmarked copies always use their server.
const body = between('<!--page-body-->', '<!--/page-body-->').replace('<div id="app">', '<div id="app" data-preview="1">');
if (!body.includes('data-preview="1"')) throw new Error('Could not mark the page as a preview.');

mkdirSync(out, { recursive: true });
const page = join(out, 'deme-erp.html');
writeFileSync(page, `${head.trim()}\n${body.trim()}\n`);

const js = (dir, as) => Object.fromEntries(readdirSync(dir).filter((f) => f.endsWith('.js')).map((f) => [`${as}/${f}`, join(dir, f)]));
const files = { ...js(join(web, 'js'), 'js'), ...js(join(root, 'shared'), 'shared'), ...js(join(web, 'vendor'), 'vendor') };
console.log(JSON.stringify({ page, files }, null, 2));
