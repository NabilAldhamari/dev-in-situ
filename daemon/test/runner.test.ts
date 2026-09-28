import assert from 'node:assert/strict';
import { test } from 'node:test';
import { renderLauncher, resolveExecutable, runProcess, unwrapCmdShim } from '../src/runner.js';

const cmd = { file: 'claude', args: ['--resume', 's', 'it\'s "quoted"\nline'], cwd: '/repo', env: { KEY: 'v' } };

test('posix launcher reads the prompt from a file and cleans up', () => {
  const script = renderLauncher(cmd, { platform: 'linux', promptFile: '/tmp/p.txt', promptIndex: 2 });
  assert.match(script, /cd '\/repo'/);
  assert.match(script, /export KEY='v'/);
  assert.match(script, /PROMPT="\$\(cat '\/tmp\/p.txt'\)"/);
  assert.match(script, /'claude' '--resume' 's' "\$PROMPT"/);
  assert.doesNotMatch(script, /quoted/);
});

test('powershell launcher splats arguments and handles legacy quoting', () => {
  const script = renderLauncher(cmd, { platform: 'win32', promptFile: 'C:\\p.txt', promptIndex: 2 });
  assert.match(script, /\$env:KEY = 'v'/);
  assert.match(script, /\$argv = @\('--resume', 's', \$prompt\)/);
  assert.match(script, /PSNativeCommandArgumentPassing/);
  assert.match(script, /& 'claude' @argv/);
  const inline = renderLauncher({ ...cmd, args: ["it's"] }, { platform: 'win32', promptFile: null, promptIndex: -1 });
  assert.match(inline, /@\('it''s'\)/);
});

test('npm cmd shims unwrap to their node script', () => {
  const shim = '"%_prog%"  "%dp0%\\node_modules\\@anthropic-ai\\claude-code\\cli.js" %*';
  assert.match(unwrapCmdShim('C:\\npm\\claude.cmd', shim) ?? '', /claude-code[\\/]cli\.js$/);
  assert.equal(unwrapCmdShim('C:\\x.cmd', 'echo hi'), null);
});

test('resolveExecutable finds node and rejects nonsense', () => {
  assert.ok(resolveExecutable(process.execPath));
  assert.equal(resolveExecutable('definitely-not-a-real-binary-xyz'), null);
});

test('runProcess streams output with the configured env', async () => {
  const chunks: string[] = [];
  const result = await runProcess(
    { file: process.execPath, args: ['-e', 'console.log(process.env.KEY, process.argv[1])', 'a "b"\nc'], cwd: process.cwd(), env: { KEY: 'k' } },
    { timeoutMs: 10_000, signal: new AbortController().signal, onData: (c) => chunks.push(c) },
  );
  assert.equal(result.exitCode, 0);
  assert.equal(chunks.join('').trim(), 'k a "b"\nc');
});

test('runProcess reports a missing command and a timeout', async () => {
  const opts = { timeoutMs: 300, signal: new AbortController().signal, onData: () => {} };
  const missing = await runProcess({ file: 'nope-xyz', args: [], cwd: process.cwd(), env: {} }, opts);
  assert.match(missing.error ?? '', /not found/);
  const slow = await runProcess({ file: process.execPath, args: ['-e', 'setTimeout(()=>{},5000)'], cwd: process.cwd(), env: {} }, opts);
  assert.equal(slow.timedOut, true);
});
