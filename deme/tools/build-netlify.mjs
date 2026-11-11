// Builds the static site Netlify publishes: web/ as the root, with shared/ beside it at /shared,
// which is where the browser asks for the code it shares with the server.
import { cpSync, rmSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'dist');
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
cpSync(join(root, 'web'), out, { recursive: true });
cpSync(join(root, 'shared'), join(out, 'shared'), { recursive: true });
console.log(`Built ${out}`);
