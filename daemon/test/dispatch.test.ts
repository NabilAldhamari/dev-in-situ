import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DEFAULT_CONFIG } from '../src/config.js';
import { MAX_TARGETS, parseDispatch } from '../src/server.js';

const base = { origin: 'http://localhost', url: 'http://localhost/', instruction: 'x', workspacePath: '/w' };

test('parseDispatch keeps the legacy single-element fields working', () => {
  const body = parseDispatch({ ...base, selector: '#a', elementKey: '#a', html: '<a>', component: { name: 'A' } }, DEFAULT_CONFIG);
  assert.equal(body.selector, '#a');
  assert.deepEqual(body.targets, [{ selector: '#a', elementKey: '#a', html: '<a>', component: { name: 'A' } }]);
});

test('parseDispatch reads a target list and mirrors the first target', () => {
  const body = parseDispatch(
    { ...base, elementKey: '#a|.b', targets: [{ selector: '#a', html: '<a>' }, { selector: '' }, { selector: '.b', component: 'bad' }] },
    DEFAULT_CONFIG,
  );
  assert.deepEqual(
    body.targets.map((t) => t.selector),
    ['#a', '.b'],
  );
  assert.equal(body.selector, '#a');
  assert.equal(body.elementKey, '#a|.b');
  assert.equal(body.targets[1]!.component, null);
});

test('parseDispatch caps the number of targets and requires at least one', () => {
  const many = Array.from({ length: MAX_TARGETS + 5 }, (_, i) => ({ selector: `#e${i}` }));
  assert.equal(parseDispatch({ ...base, targets: many }, DEFAULT_CONFIG).targets.length, MAX_TARGETS);
  assert.throws(() => parseDispatch({ ...base, targets: [] }, DEFAULT_CONFIG), /selector is required/);
  assert.throws(() => parseDispatch({ ...base }, DEFAULT_CONFIG), /selector is required/);
  assert.throws(() => parseDispatch({ ...base, selector: '#a', agent: 'nope' }, DEFAULT_CONFIG), /Unknown agent/);
});
