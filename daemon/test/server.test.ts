import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dis-home-'));
process.env.DEV_IN_SITU_HOME = home;
const { createServer } = await import('../src/server.js');
const { DEFAULT_CONFIG } = await import('../src/config.js');
const { Store } = await import('../src/store.js');

const FAKE_AGENT = `
const args = process.argv.slice(1);
const resumed = args.includes('--resume');
const out = (e) => console.log(JSON.stringify(e));
out({ type: 'system', subtype: 'init', session_id: 'sess-1', model: 'fake' });
out({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Edit', input: { file_path: 'a.css' } }] } });
out({ type: 'assistant', message: { content: [{ type: 'text', text: (resumed ? 'again: ' : 'first: ') + args.at(-1).split('\\n').at(-1) }] } });
out({ type: 'result', result: 'ignored', session_id: 'sess-1' });
`;

const TOKEN = 'x'.repeat(64);
const project = fs.mkdtempSync(path.join(os.tmpdir(), 'dis-project-'));
let server: http.Server;
let port = 0;
let close: () => void;

before(async () => {
  const config = structuredClone(DEFAULT_CONFIG);
  config.defaultAgent = 'fake';
  config.agents.fake = {
    command: process.execPath,
    background: ['-e', FAKE_AGENT, '--', '{options}', '{prompt}'],
    output: 'json',
    resumeFlag: ['--resume', '{session}'],
  };
  const created = createServer({ config, token: TOKEN, store: new Store(path.join(home, 'state.json')), configFile: path.join(home, 'config.json') });
  close = created.close;
  server = created.app.listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  port = (server.address() as AddressInfo).port;
});

after(() => {
  close();
  server.close();
});

function call(method: string, url: string, body?: unknown, headers: Record<string, string> = { 'X-Bridge-Token': TOKEN }) {
  return new Promise<{ status: number; body: any; raw: string }>((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, method, path: url, headers: { Host: '127.0.0.1', 'Content-Type': 'application/json', ...headers } }, (res) => {
      let raw = '';
      res.setEncoding('utf8').on('data', (c) => (raw += c)).on('end', () => {
        let parsed: unknown = null;
        try {
          parsed = JSON.parse(raw);
        } catch {}
        resolve({ status: res.statusCode ?? 0, body: parsed, raw });
      });
    });
    req.on('error', reject);
    req.end(body === undefined ? undefined : JSON.stringify(body));
  });
}

const events = (raw: string) => raw.split('\n').filter((l) => l.startsWith('data: ')).map((l) => JSON.parse(l.slice(6)));

test('health is public, everything else needs the token', async () => {
  assert.equal((await call('GET', '/health', undefined, {})).body.authenticated, false);
  assert.equal((await call('GET', '/health')).body.authenticated, true);
  assert.equal((await call('GET', '/config', undefined, {})).status, 401);
  assert.equal((await call('GET', '/config', undefined, { 'X-Bridge-Token': TOKEN, Origin: 'https://evil.example' })).status, 403);
  assert.equal((await call('GET', '/config', undefined, { 'X-Bridge-Token': TOKEN, Origin: 'chrome-extension://abcdef' })).status, 200);
});

test('config lists agents and rejects invalid edits', async () => {
  const res = await call('GET', '/config');
  const fake = res.body.agents.find((a: { id: string }) => a.id === 'fake');
  assert.equal(fake.available, true);
  const bad = await call('PUT', '/config', { ...res.body.config, agents: { x: { preset: 'nope' } } });
  assert.equal(bad.status, 400);
  assert.match(bad.body.error, /preset/);
});

test('dispatch streams progress, saves the session and resumes follow-ups', async () => {
  const request = {
    origin: 'http://localhost:5173',
    url: 'http://localhost:5173/',
    pathname: '/',
    selector: '#cta',
    elementKey: '#cta',
    html: '<button id="cta">Buy</button>',
    instruction: 'make it green',
    workspacePath: project,
  };
  const first = await call('POST', '/dispatch', request);
  assert.equal(first.status, 202);
  const stream = await call('GET', `/stream/${first.body.dispatchId}`);
  const log = events(stream.raw);
  assert.deepEqual(log.map((e) => e.seq), log.map((_, i) => i + 1));
  assert.ok(log.some((e) => e.level === 'status' && e.message === 'Edit a.css'));
  assert.ok(log.some((e) => e.level === 'stdout' && e.message === 'first: Task: make it green\n'));
  assert.ok(!log.some((e) => e.message.includes('ignored')));
  assert.deepEqual(log.at(-1), { seq: log.length, level: 'done', message: 'Finished', exitCode: 0, session: 'sess-1' });

  const replay = events((await call('GET', `/stream/${first.body.dispatchId}?since=${log.length - 1}`)).raw);
  assert.equal(replay.length, 1);

  const second = await call('POST', '/dispatch', { ...request, instruction: 'darker', sessionKey: first.body.sessionKey, followUp: true });
  assert.equal(second.body.resumed, true);
  const followUp = events((await call('GET', `/stream/${second.body.dispatchId}`)).raw);
  assert.equal(followUp.find((e) => e.level === 'prompt').message, 'darker');
  assert.ok(followUp.some((e) => e.message === 'again: darker\n'));

  const project2 = await call('GET', '/project?origin=http://localhost:5173');
  assert.equal(project2.body.path, path.resolve(project));
  const session = await call('GET', `/session?agent=fake&scope=element&origin=http://localhost:5173&pathname=/&elementKey=%23cta`);
  assert.equal(session.body.session.turns, 2);
});

test('dispatch sends every selected element to the agent and keys the session by the group', async () => {
  const request = {
    origin: 'http://localhost:5174',
    url: 'http://localhost:5174/',
    pathname: '/',
    elementKey: '#a|.b',
    targets: [
      { selector: '#a', elementKey: '#a', html: '<a id="a">A</a>' },
      { selector: '.b', elementKey: '.b', html: '<p class="b">B</p>' },
    ],
    instruction: 'line them up',
    workspacePath: project,
  };
  const res = await call('POST', '/dispatch', request);
  assert.equal(res.status, 202);
  const log = events((await call('GET', `/stream/${res.body.dispatchId}`)).raw);
  const prompt = log.find((e) => e.level === 'prompt').message as string;
  assert.match(prompt, /^Change these 2 elements on http:\/\/localhost:5174\/\./);
  assert.match(prompt, /1\. `#a`/);
  assert.match(prompt, /2\. `\.b`/);
  assert.equal(log.at(-1).level, 'done');
  const session = await call('GET', `/session?agent=fake&scope=element&origin=http://localhost:5174&pathname=/&elementKey=${encodeURIComponent('#a|.b')}`);
  assert.equal(session.body.session.turns, 1);
});

test('dispatch validates input', async () => {
  assert.match((await call('POST', '/dispatch', { instruction: '' })).body.error, /instruction/);
  const badPath = await call('POST', '/dispatch', { origin: 'o', url: 'u', selector: 's', instruction: 'x', workspacePath: 'relative' });
  assert.equal(badPath.status, 400);
  assert.equal(events((await call('GET', '/stream/unknown')).raw)[0].level, 'done');
});

test('folder browsing and change stamps', async () => {
  fs.mkdirSync(path.join(project, 'src'), { recursive: true });
  const listing = await call('GET', `/fs/list?path=${encodeURIComponent(project)}`);
  assert.ok(listing.body.dirs.includes('src'));
  const stamp = await call('GET', `/workspace/stamp?path=${encodeURIComponent(project)}`);
  assert.equal(typeof stamp.body.stamp, 'number');
});
