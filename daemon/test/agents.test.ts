import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PRESETS, buildArgs, describeTool, expandEnv, interpretLine, resolveAgent } from '../src/agents.js';

const base = { prompt: 'PROMPT', cwd: '/repo' };

test('user config overrides the preset and merges env', () => {
  const spec = resolveAgent({ preset: 'claude', model: 'm1', env: { A: '1' } });
  assert.equal(spec.command, 'claude');
  assert.equal(spec.model, 'm1');
  assert.deepEqual(spec.env, { A: '1' });
  assert.equal(resolveAgent({ command: 'aider' }).output, 'text');
});

test('claude background starts a named session with edit permissions', () => {
  const args = buildArgs(resolveAgent({ preset: 'claude' }), { ...base, mode: 'background', newSession: 'abc' });
  assert.deepEqual(args, [
    '-p', 'PROMPT', '--output-format', 'stream-json', '--verbose',
    '--permission-mode', 'acceptEdits', '--session-id', 'abc',
  ]);
});

test('claude resumes, bypasses and picks a model', () => {
  const args = buildArgs(resolveAgent({ preset: 'claude' }), { ...base, mode: 'terminal', session: 's1', bypass: true, model: 'opus' });
  assert.deepEqual(args, ['--model', 'opus', '--dangerously-skip-permissions', '--resume', 's1', 'PROMPT']);
});

test('codex resume lands as a subcommand before the prompt', () => {
  const args = buildArgs(resolveAgent({ preset: 'codex' }), { ...base, mode: 'background', session: 't1' });
  assert.deepEqual(args, ['exec', '--json', '--skip-git-repo-check', '--full-auto', 'resume', 't1', 'PROMPT']);
});

test('custom agents append options and fill placeholders once', () => {
  const spec = resolveAgent({ command: 'aider', background: ['--message', '{prompt}'], args: ['--yes-always'] });
  assert.deepEqual(buildArgs(spec, { ...base, prompt: 'use {cwd}', mode: 'background' }), ['--message', 'use {cwd}', '--yes-always']);
  const agy = buildArgs(resolveAgent({ preset: 'antigravity' }), { ...base, mode: 'background', timeoutSeconds: 60 });
  assert.deepEqual(agy.slice(0, 6), ['--add-dir', '/repo', '--output-format', 'stream-json', '--print-timeout', '60s']);
});

test('every preset has a command and puts the prompt in both modes', () => {
  for (const [id, preset] of Object.entries(PRESETS)) {
    const spec = resolveAgent({ preset: id });
    assert.ok(preset.command, id);
    assert.ok(buildArgs(spec, { ...base, mode: 'background' }).includes('PROMPT'), id);
    assert.ok(buildArgs(spec, { ...base, mode: 'terminal' }).includes('PROMPT'), id);
  }
});

test('env values expand ${VAR} from the environment', () => {
  assert.deepEqual(expandEnv({ KEY: 'x-${SECRET}-${MISSING}' }, { SECRET: 's' }), { KEY: 'x-s-' });
});

test('claude stream-json', () => {
  assert.deepEqual(interpretLine('{"type":"system","subtype":"init","session_id":"s","model":"opus"}'), { session: 's', status: 'Started (opus)' });
  assert.deepEqual(
    interpretLine(JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'hi' }, { type: 'tool_use', name: 'Edit', input: { file_path: 'a.ts' } }] } })),
    { status: 'Edit a.ts', text: 'hi\n' },
  );
  assert.deepEqual(interpretLine('{"type":"result","result":"ok","session_id":"s"}'), { session: 's', done: true, final: 'ok' });
  assert.equal(interpretLine('{"type":"result","is_error":true,"result":"boom"}')?.error, 'boom');
});

test('codex json', () => {
  assert.deepEqual(interpretLine('{"type":"thread.started","thread_id":"t"}'), { session: 't', status: 'Started' });
  assert.equal(interpretLine('{"type":"item.started","item":{"type":"command_execution","command":"npm test"}}')?.status, 'Run npm test');
  assert.equal(interpretLine('{"type":"item.completed","item":{"type":"file_change","changes":[{"path":"a.css"}]}}')?.status, 'Edit a.css');
  assert.equal(interpretLine('{"type":"item.completed","item":{"type":"agent_message","text":"done"}}')?.text, 'done\n');
  assert.equal(interpretLine('{"type":"turn.failed","error":{"message":"quota"}}')?.error, 'quota');
});

test('gemini, opencode and antigravity json', () => {
  assert.equal(interpretLine('{"type":"message","role":"assistant","content":"yo","delta":true}')?.text, 'yo');
  assert.equal(interpretLine('{"type":"tool_use","tool_name":"write_file","parameters":{"file_path":"x"}}')?.status, 'write_file x');
  assert.equal(interpretLine('{"type":"text","sessionID":"o","part":{"text":"hey"}}')?.session, 'o');
  assert.equal(interpretLine('{"event":"step_update","step_update":{"step_type":"agent_response","text_delta":"a","conversation_id":"c"}}')?.text, 'a');
  assert.deepEqual(interpretLine('{"event":"result","result":{"status":"ERROR","error":"no","conversation_id":"c"}}'), { session: 'c', done: true, error: 'no' });
});

test('non-json lines pass through as text', () => {
  assert.deepEqual(interpretLine('plain output'), { text: 'plain output\n' });
  assert.equal(interpretLine('   '), null);
  assert.equal(describeTool('Bash', { command: 'x'.repeat(100) }).length, 65);
});
