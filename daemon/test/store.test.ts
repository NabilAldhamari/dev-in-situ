import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { Store, sessionKey } from '../src/store.js';

test('session keys follow the scope', () => {
  const input = { origin: 'http://a', pathname: '/x/', elementKey: '#b' };
  assert.equal(sessionKey({ ...input, scope: 'page' }), 'http://a/x');
  assert.equal(sessionKey({ ...input, scope: 'element' }), 'http://a/x::#b');
  assert.equal(sessionKey({ ...input, scope: 'new', now: 5 }), 'http://a/x::#b::5');
});

test('store persists sessions and projects', () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'dis-')), 'state.json');
  const store = new Store(file);
  store.saveSession('claude', 'k', 's1', '/repo');
  store.saveSession('claude', 'k', 's1', '/repo');
  store.rememberProject('http://a', path.resolve('/repo'));
  const reloaded = new Store(file);
  assert.equal(reloaded.session('claude', 'k')?.turns, 2);
  assert.equal(reloaded.session('codex', 'k'), null);
  assert.equal(reloaded.project('http://a'), path.resolve('/repo'));
  reloaded.forgetSession('claude', 'k');
  assert.equal(new Store(file).session('claude', 'k'), null);
});
