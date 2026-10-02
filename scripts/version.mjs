import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const version = process.argv[2];
if (!/^\d+\.\d+\.\d+$/.test(version ?? '')) {
  console.error('Usage: npm run version -- <x.y.z>');
  process.exit(1);
}

const files = ['package.json', 'daemon/package.json', 'extension/package.json', 'extension/manifest.json'];
for (const file of files) {
  const full = path.join(root, file);
  const json = JSON.parse(fs.readFileSync(full, 'utf8'));
  json.version = version;
  fs.writeFileSync(full, `${JSON.stringify(json, null, 2)}\n`);
  console.log(`${file} -> ${version}`);
}

for (const file of ['daemon/package-lock.json', 'extension/package-lock.json']) {
  const full = path.join(root, file);
  const lock = JSON.parse(fs.readFileSync(full, 'utf8'));
  lock.version = version;
  if (lock.packages?.['']) lock.packages[''].version = version;
  fs.writeFileSync(full, `${JSON.stringify(lock, null, 2)}\n`);
  console.log(`${file} -> ${version}`);
}
