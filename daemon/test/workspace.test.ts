import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { ChangeWatcher, checkWorkspace, listDirs } from '../src/workspace.js';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'dis-ws-'));

test('checkWorkspace accepts real folders and rejects the rest', () => {
  const dir = tmp();
  assert.deepEqual(checkWorkspace(dir), { ok: true, path: path.resolve(dir) });
  assert.equal(checkWorkspace('relative/path').ok, false);
  assert.equal(checkWorkspace(path.join(dir, 'missing')).ok, false);
  assert.equal(checkWorkspace(os.homedir()).ok, false);
  assert.equal(checkWorkspace(path.parse(dir).root).ok, false);
});

test('listDirs lists visible folders and spots projects', () => {
  const dir = tmp();
  fs.mkdirSync(path.join(dir, 'b'));
  fs.mkdirSync(path.join(dir, 'a'));
  fs.mkdirSync(path.join(dir, '.hidden'));
  fs.mkdirSync(path.join(dir, 'node_modules'));
  fs.writeFileSync(path.join(dir, 'package.json'), '{}');
  const listing = listDirs(dir);
  assert.deepEqual(listing.dirs, ['a', 'b']);
  assert.equal(listing.isProject, true);
  assert.equal(listing.parent, path.dirname(path.resolve(dir)));
  const home = listDirs(undefined);
  if (process.platform === 'win32') assert.ok(home.dirs.length > 0);
  else assert.equal(home.path, path.resolve(os.homedir()));
});

test('ChangeWatcher bumps the stamp on edits but not in ignored folders', async () => {
  const dir = tmp();
  fs.mkdirSync(path.join(dir, 'node_modules'));
  const watcher = new ChangeWatcher();
  try {
    assert.notEqual(watcher.stamp(dir), null);
    // macOS reports events from before the watch started, so settle first and compare against a baseline.
    await new Promise((r) => setTimeout(r, 500));
    const base = watcher.stamp(dir) ?? 0;
    fs.writeFileSync(path.join(dir, 'node_modules', 'x.js'), '1');
    await new Promise((r) => setTimeout(r, 500));
    assert.equal(watcher.stamp(dir), base);
    fs.writeFileSync(path.join(dir, 'index.html'), '<p>hi</p>');
    const deadline = Date.now() + 3000;
    while ((watcher.stamp(dir) ?? 0) === base && Date.now() < deadline) await new Promise((r) => setTimeout(r, 50));
    assert.ok((watcher.stamp(dir) ?? 0) > base);
  } finally {
    watcher.close();
  }
});
