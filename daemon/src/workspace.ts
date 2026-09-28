import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export function checkWorkspace(input: string): { ok: true; path: string } | { ok: false; error: string } {
  const raw = input.trim().replace(/^~(?=$|[\\/])/, os.homedir());
  if (!raw) return { ok: false, error: 'Choose a project folder.' };
  if (!path.isAbsolute(raw)) return { ok: false, error: 'Use an absolute path.' };
  const resolved = path.resolve(raw);
  try {
    if (!fs.statSync(resolved).isDirectory()) return { ok: false, error: 'That path is not a folder.' };
  } catch {
    return { ok: false, error: 'That folder does not exist.' };
  }
  if (resolved === path.parse(resolved).root || resolved === os.homedir()) {
    return { ok: false, error: 'Pick the project folder, not a drive root or your home folder.' };
  }
  return { ok: true, path: resolved };
}

export interface Listing {
  path: string;
  parent: string | null;
  dirs: string[];
  isProject: boolean;
}

const PROJECT_MARKERS = ['package.json', '.git', 'index.html', 'pyproject.toml', 'Cargo.toml', 'go.mod', 'composer.json', 'Gemfile'];

export function listDirs(input: string | undefined): Listing {
  if (!input) {
    if (process.platform === 'win32') {
      const drives = 'CDEFGHIJKLMNOPQRSTUVWXYZ'.split('').map((d) => `${d}:\\`).filter((d) => fs.existsSync(d));
      return { path: '', parent: null, dirs: [os.homedir(), ...drives], isProject: false };
    }
    input = os.homedir();
  }
  const dir = path.resolve(input);
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const dirs = entries
    .filter((e) => e.isDirectory() && !e.name.startsWith('.') && e.name !== 'node_modules')
    .map((e) => e.name)
    .sort((a, b) => a.localeCompare(b));
  const names = new Set(entries.map((e) => e.name));
  const parentDir = path.dirname(dir);
  return {
    path: dir,
    parent: parentDir !== dir ? parentDir : process.platform === 'win32' ? '' : null,
    dirs,
    isProject: PROJECT_MARKERS.some((m) => names.has(m)),
  };
}

const IGNORED = /(^|[\\/])(\.git|node_modules|\.next|\.nuxt|\.svelte-kit|\.cache|\.turbo|\.idea|\.vscode)([\\/]|$)/;
const IDLE_MS = 10 * 60 * 1000;

interface Watch {
  stamp: number;
  used: number;
  watcher: fs.FSWatcher;
}

export class ChangeWatcher {
  private readonly watches = new Map<string, Watch>();
  private readonly sweeper = setInterval(() => this.sweep(), 60_000);

  constructor() {
    this.sweeper.unref();
  }

  stamp(dir: string): number | null {
    const existing = this.watches.get(dir);
    if (existing) {
      existing.used = Date.now();
      return existing.stamp;
    }
    try {
      const entry: Watch = { stamp: 0, used: Date.now(), watcher: null as unknown as fs.FSWatcher };
      entry.watcher = fs.watch(dir, { recursive: true }, (_event, file) => {
        if (file && IGNORED.test(String(file))) return;
        entry.stamp = Date.now();
      });
      entry.watcher.on('error', () => this.close(dir));
      this.watches.set(dir, entry);
      return 0;
    } catch {
      return null;
    }
  }

  close(dir?: string): void {
    for (const [key, w] of this.watches) {
      if (dir && key !== dir) continue;
      w.watcher.close();
      this.watches.delete(key);
    }
    if (!dir) clearInterval(this.sweeper);
  }

  private sweep(): void {
    for (const [key, w] of this.watches) if (Date.now() - w.used > IDLE_MS) this.close(key);
  }
}
