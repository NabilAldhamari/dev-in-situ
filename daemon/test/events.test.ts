import assert from 'node:assert/strict';
import { test } from 'node:test';
import { RunLog, type RunEvent } from '../src/events.js';

test('events are numbered per run and replayed after a sequence', () => {
  const log = new RunLog();
  log.open('a');
  log.open('b');
  log.emit('a', 'status', 'one');
  log.emit('b', 'status', 'other');
  log.emit('a', 'stdout', 'two');
  const seen: RunEvent[] = [];
  const off = log.subscribe('a', 1, (e) => seen.push(e));
  log.emit('a', 'done', 'end', { exitCode: 0 });
  log.emit('a', 'stdout', 'ignored after done');
  off?.();
  assert.deepEqual(seen.map((e) => [e.seq, e.message]), [[2, 'two'], [3, 'end']]);
});

test('unknown runs return null and finished runs only replay', () => {
  const log = new RunLog();
  assert.equal(log.subscribe('missing', 0, () => {}), null);
  log.open('x');
  log.emit('x', 'done', 'end');
  const seen: RunEvent[] = [];
  log.subscribe('x', 0, (e) => seen.push(e));
  assert.equal(seen.length, 1);
});
