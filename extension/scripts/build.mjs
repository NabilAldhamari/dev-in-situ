import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'dist');
const configFile = path.join(root, 'vite.config.ts');
const watch = process.argv.includes('--watch') ? {} : null;

fs.rmSync(dist, { recursive: true, force: true });
for (const mode of ['main', 'inspector', 'probe']) {
  await build({ root, mode, configFile, logLevel: 'warn', build: { watch } });
}
fs.copyFileSync(path.join(root, 'manifest.json'), path.join(dist, 'manifest.json'));
fs.mkdirSync(path.join(dist, 'options'), { recursive: true });
fs.copyFileSync(path.join(root, 'src/options/options.html'), path.join(dist, 'options/options.html'));
fs.cpSync(path.join(root, 'public/icons'), path.join(dist, 'icons'), { recursive: true });
console.log(`Extension built: ${dist}`);
