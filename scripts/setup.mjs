import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const [major] = process.versions.node.split('.').map(Number);
if (major < 22) {
  console.error(`dev-in-situ needs Node 22 or newer (found ${process.version}).`);
  process.exit(1);
}

const tasks = process.argv.slice(2);
const steps = tasks.length ? tasks : ['install', 'build'];

for (const pkg of ['daemon', 'extension']) {
  for (const step of steps) {
    const args = step === 'install' ? ['install', '--no-audit', '--no-fund'] : ['run', step];
    console.log(`\n> ${pkg}: npm ${args.join(' ')}`);
    const result = spawnSync('npm', args, { cwd: path.join(root, pkg), stdio: 'inherit', shell: process.platform === 'win32' });
    if (result.status !== 0) process.exit(result.status ?? 1);
  }
}

if (!tasks.length) {
  console.log(`
Done.
  1. npm start                         starts the daemon and prints your token
  2. Open chrome://extensions, turn on Developer mode, click "Load unpacked"
     and select ${path.join(root, 'extension', 'dist')}
  3. Paste the token in the settings page that opens, then press Ctrl+Shift+X on any page.`);
}
