// Builds the single-page hosted version of the app.
// The host wraps the page in its own <html>/<head>/<body>, so this takes the marked
// regions of index.html, inlines the stylesheets, and leaves the JS modules as separate
// files to be published next to the page at the same relative paths.
//
//   node tools/build-artifact.mjs <output-dir>
//
// Writes <output-dir>/dema-intelligence-room.html and prints the files to publish with it.

import { readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = resolve(process.argv[2] || join(root, 'dist'));
const html = readFileSync(join(root, 'index.html'), 'utf8');

const between = (a, b) => {
  const i = html.indexOf(a), j = html.indexOf(b);
  if (i < 0 || j < 0) throw new Error(`Marker missing in index.html: ${a} … ${b}`);
  return html.slice(i + a.length, j);
};

let head = between('<!--page-->', '<!--/page-head-->');
const cssBlock = between('<!--css-->', '<!--/css-->');
const sheets = [...cssBlock.matchAll(/href="([^"]+)"/g)].map((m) => m[1]);
const css = sheets.map((f) => `/* ${f} */\n${readFileSync(join(root, f), 'utf8')}`).join('\n');
head = head.replace(`<!--css-->${cssBlock}<!--/css-->`, `<style>\n${css}\n</style>`);
const body = between('<!--page-body-->', '<!--/page-body-->');

mkdirSync(out, { recursive: true });
const page = join(out, 'dema-intelligence-room.html');
writeFileSync(page, `${head.trim()}\n${body.trim()}\n`);

const files = {
  ...Object.fromEntries(readdirSync(join(root, 'js')).filter((f) => f.endsWith('.js')).map((f) => [`js/${f}`, join(root, 'js', f)])),
  'vendor/three.module.min.js': join(root, 'vendor', 'three.module.min.js'),
};
console.log(JSON.stringify({ page, files }, null, 2));
