import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { RUNS_DIR, ensureHome } from './config.js';

export interface Command {
  file: string;
  args: string[];
  cwd: string;
  env: Record<string, string>;
}

export function resolveExecutable(file: string, platform: NodeJS.Platform = process.platform): string | null {
  const exts = platform === 'win32' ? (process.env.PATHEXT ?? '.COM;.EXE;.BAT;.CMD').split(';').filter(Boolean) : [''];
  const candidates = (base: string) => (platform === 'win32' && path.extname(base) ? [base] : [base, ...exts.map((e) => base + e)]);
  const isFile = (p: string) => {
    try {
      return fs.statSync(p).isFile();
    } catch {
      return false;
    }
  };
  if (file.includes('/') || file.includes('\\')) return candidates(path.resolve(file)).find(isFile) ?? null;
  for (const dir of (process.env.PATH ?? '').split(path.delimiter).filter(Boolean)) {
    const found = candidates(path.join(dir, file)).find(isFile);
    if (found) return found;
  }
  return null;
}

export function unwrapCmdShim(shimPath: string, contents: string): string | null {
  const match = /"%~?dp0%?\\([^"]+?\.[cm]?js)"/i.exec(contents);
  return match ? path.join(path.dirname(shimPath), match[1]!) : null;
}

export function spawnable(file: string, args: string[]): { file: string; args: string[] } {
  const resolved = resolveExecutable(file);
  if (!resolved) throw new Error(`"${file}" was not found on PATH. Install it or set "command" to its full path.`);
  if (process.platform === 'win32' && /\.(cmd|bat)$/i.test(resolved)) {
    const script = unwrapCmdShim(resolved, fs.readFileSync(resolved, 'utf8'));
    if (!script) throw new Error(`${resolved} is a batch file, which cannot receive a multi-line prompt. Point "command" at the .exe or .js instead.`);
    return { file: process.execPath, args: [script, ...args] };
  }
  return { file: resolved, args };
}

export interface RunResult {
  exitCode: number | null;
  timedOut: boolean;
  error?: string;
}

export function runProcess(
  cmd: Command,
  opts: { timeoutMs: number; signal: AbortSignal; onData(chunk: string, stream: 'stdout' | 'stderr'): void },
): Promise<RunResult> {
  return new Promise((resolve) => {
    let target: { file: string; args: string[] };
    try {
      target = spawnable(cmd.file, cmd.args);
    } catch (err) {
      resolve({ exitCode: null, timedOut: false, error: (err as Error).message });
      return;
    }
    const child = spawn(target.file, target.args, {
      cwd: cmd.cwd,
      env: { ...process.env, ...cmd.env, DEV_IN_SITU: '1', FORCE_COLOR: '0', NO_COLOR: '1' },
      shell: false,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let timedOut = false;
    let error: string | undefined;
    const stop = () => {
      child.kill('SIGTERM');
      setTimeout(() => child.kill('SIGKILL'), 3000).unref();
    };
    const timer = setTimeout(() => {
      timedOut = true;
      stop();
    }, opts.timeoutMs);
    opts.signal.addEventListener('abort', stop, { once: true });
    child.stdout.setEncoding('utf8').on('data', (c: string) => opts.onData(c, 'stdout'));
    child.stderr.setEncoding('utf8').on('data', (c: string) => opts.onData(c, 'stderr'));
    child.on('error', (err) => {
      error = err.message;
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      opts.signal.removeEventListener('abort', stop);
      resolve({ exitCode: code, timedOut, ...(error ? { error } : {}) });
    });
  });
}

const posixQuote = (v: string) => `'${v.split("'").join(`'\\''`)}'`;
const psQuote = (v: string) => `'${v.split("'").join("''")}'`;
const PS_LEGACY_ESCAPE = String.raw`$_ -replace '(\\*)"', '$1$1\"' -replace '(\\+)$', '$1$1'`;

export function renderLauncher(cmd: Command, opts: { platform: NodeJS.Platform; promptFile: string | null; promptIndex: number }): string {
  const win = opts.platform === 'win32';
  const quote = win ? psQuote : posixQuote;
  const args = cmd.args.map((arg, i) =>
    i === opts.promptIndex && opts.promptFile ? (win ? '$prompt' : '"$PROMPT"') : quote(arg),
  );
  if (win) {
    const lines = [`Set-Location -LiteralPath ${psQuote(cmd.cwd)}`];
    for (const [k, v] of Object.entries(cmd.env)) lines.push(`$env:${k} = ${psQuote(v)}`);
    if (opts.promptFile) {
      lines.push(`$prompt = Get-Content -Raw -LiteralPath ${psQuote(opts.promptFile)}`);
      lines.push(`Remove-Item -LiteralPath ${psQuote(opts.promptFile)}`);
    }
    lines.push('Remove-Item -LiteralPath $PSCommandPath');
    lines.push(`$argv = @(${args.join(', ')})`);
    lines.push("if (Test-Path Variable:PSNativeCommandArgumentPassing) { $PSNativeCommandArgumentPassing = 'Standard' }");
    lines.push(`else { $argv = @($argv | ForEach-Object { ${PS_LEGACY_ESCAPE} }) }`);
    lines.push(`& ${psQuote(cmd.file)} @argv`);
    return `${lines.join('\r\n')}\r\n`;
  }
  const lines = ['#!/usr/bin/env bash', `cd ${posixQuote(cmd.cwd)} || exit 1`];
  for (const [k, v] of Object.entries(cmd.env)) lines.push(`export ${k}=${posixQuote(v)}`);
  if (opts.promptFile) lines.push(`PROMPT="$(cat ${posixQuote(opts.promptFile)})"`, `rm -f ${posixQuote(opts.promptFile)}`);
  lines.push('rm -f -- "$0"', `${posixQuote(cmd.file)} ${args.join(' ')}`, 'exec "${SHELL:-/bin/bash}" -i');
  return `${lines.join('\n')}\n`;
}

const LINUX_TERMINALS: Array<[string, (s: string) => string[]]> = [
  ['x-terminal-emulator', (s) => ['-e', 'bash', s]],
  ['gnome-terminal', (s) => ['--', 'bash', s]],
  ['konsole', (s) => ['-e', 'bash', s]],
  ['xfce4-terminal', (s) => ['-x', 'bash', s]],
  ['kitty', (s) => ['bash', s]],
  ['alacritty', (s) => ['-e', 'bash', s]],
  ['wezterm', (s) => ['start', '--', 'bash', s]],
  ['xterm', (s) => ['-e', 'bash', s]],
];

function detached(file: string, args: string[]): void {
  const child = spawn(file, args, { detached: true, stdio: 'ignore', windowsHide: false });
  child.on('error', () => {});
  child.unref();
}

export async function openTerminal(id: string, cmd: Command, promptIndex: number, terminalApp = ''): Promise<string> {
  ensureHome();
  const platform = process.platform;
  const promptFile = promptIndex >= 0 ? path.join(RUNS_DIR, `${id}.txt`) : null;
  if (promptFile) fs.writeFileSync(promptFile, cmd.args[promptIndex] ?? '', { encoding: 'utf8', mode: 0o600 });
  const script = path.join(RUNS_DIR, `${id}.${platform === 'win32' ? 'ps1' : 'sh'}`);
  fs.writeFileSync(script, renderLauncher(cmd, { platform, promptFile, promptIndex }), { encoding: 'utf8', mode: 0o700 });

  if (platform === 'darwin') {
    const command = `bash ${posixQuote(script)}`;
    detached('osascript', ['-e', `tell application "Terminal"\nactivate\ndo script ${JSON.stringify(command)}\nend tell`]);
    return 'Terminal.app';
  }
  if (platform === 'win32') {
    const shell = resolveExecutable('pwsh') ? 'pwsh' : 'powershell';
    const shellArgs = ['-NoExit', '-ExecutionPolicy', 'Bypass', '-File', script];
    if (terminalApp || resolveExecutable('wt')) {
      detached(terminalApp || 'wt', ['-w', '0', 'nt', '--title', 'dev-in-situ', '-d', cmd.cwd, shell, ...shellArgs]);
      return 'Windows Terminal';
    }
    detached('cmd.exe', ['/c', 'start', 'dev-in-situ', shell, ...shellArgs]);
    return shell;
  }
  const candidates: Array<[string, (s: string) => string[]]> = terminalApp
    ? [[terminalApp, (s) => ['-e', 'bash', s]], ...LINUX_TERMINALS]
    : LINUX_TERMINALS;
  for (const [bin, args] of candidates) {
    if (resolveExecutable(bin)) {
      detached(bin, args(script));
      return bin;
    }
  }
  throw new Error('No terminal emulator found. Set "terminal" in ~/.dev-in-situ/config.json.');
}
