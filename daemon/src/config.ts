import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { type AgentConfig, PRESETS } from './agents.js';

export const NAME = 'dev-in-situ';
export const VERSION = (JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string }).version;
export const HOST = '127.0.0.1';
export const PORT = Number.parseInt(process.env.DEV_IN_SITU_PORT ?? '4141', 10);
export const HOME_DIR = process.env.DEV_IN_SITU_HOME ?? path.join(os.homedir(), '.dev-in-situ');
export const TOKEN_FILE = path.join(HOME_DIR, 'token');
export const CONFIG_FILE = path.join(HOME_DIR, 'config.json');
export const STATE_FILE = path.join(HOME_DIR, 'state.json');
export const RUNS_DIR = path.join(HOME_DIR, 'runs');

export const ALLOWED_HOSTS = new Set([
  `127.0.0.1:${PORT}`,
  `localhost:${PORT}`,
  `[::1]:${PORT}`,
  '127.0.0.1',
  'localhost',
]);

export interface Config {
  defaultAgent: string;
  timeoutMinutes: number;
  terminal: string;
  agents: Record<string, AgentConfig>;
}

export const DEFAULT_CONFIG: Config = {
  defaultAgent: 'claude',
  timeoutMinutes: 30,
  terminal: '',
  agents: {
    claude: { preset: 'claude' },
    codex: { preset: 'codex' },
    gemini: { preset: 'gemini' },
    antigravity: { preset: 'antigravity' },
    kimi: {
      preset: 'claude',
      model: 'kimi-k2-turbo-preview',
      env: { ANTHROPIC_BASE_URL: 'https://api.moonshot.ai/anthropic', ANTHROPIC_AUTH_TOKEN: '${KIMI_API_KEY}' },
    },
    glm: {
      preset: 'claude',
      model: 'glm-4.6',
      env: { ANTHROPIC_BASE_URL: 'https://api.z.ai/api/anthropic', ANTHROPIC_AUTH_TOKEN: '${ZAI_API_KEY}' },
    },
    ollama: {
      preset: 'claude',
      model: 'qwen3-coder',
      env: { ANTHROPIC_BASE_URL: 'http://localhost:11434', ANTHROPIC_AUTH_TOKEN: 'ollama' },
    },
  },
};

export function ensureHome(): void {
  fs.mkdirSync(RUNS_DIR, { recursive: true, mode: 0o700 });
}

export function readOrCreateToken(file = TOKEN_FILE): string {
  ensureHome();
  try {
    const existing = fs.readFileSync(file, 'utf8').trim();
    if (existing.length >= 32) return existing;
  } catch {}
  const token = randomBytes(32).toString('hex');
  fs.writeFileSync(file, `${token}\n`, { mode: 0o600 });
  return token;
}

export function validateConfig(input: unknown): Config {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('config must be an object');
  const raw = input as Partial<Config>;
  const agents = raw.agents ?? DEFAULT_CONFIG.agents;
  if (!agents || typeof agents !== 'object' || Array.isArray(agents)) throw new Error('agents must be an object');
  for (const [id, agent] of Object.entries(agents)) {
    if (!/^[\w-]{1,32}$/.test(id)) throw new Error(`agent id "${id}" must be letters, digits, - or _`);
    if (!agent || typeof agent !== 'object') throw new Error(`agents.${id} must be an object`);
    if (agent.preset && !PRESETS[agent.preset]) {
      throw new Error(`agents.${id}.preset must be one of ${Object.keys(PRESETS).join(', ')}`);
    }
    if (!agent.preset && !agent.command) throw new Error(`agents.${id} needs a preset or a command`);
    for (const key of ['background', 'terminal', 'args', 'modelFlag', 'resumeFlag', 'sessionFlag', 'editFlag', 'bypassFlag'] as const) {
      const value = agent[key];
      if (value !== undefined && (!Array.isArray(value) || value.some((v) => typeof v !== 'string'))) {
        throw new Error(`agents.${id}.${key} must be a list of strings`);
      }
    }
  }
  const timeout = Number(raw.timeoutMinutes ?? DEFAULT_CONFIG.timeoutMinutes);
  if (!Number.isFinite(timeout) || timeout < 1 || timeout > 24 * 60) throw new Error('timeoutMinutes must be 1-1440');
  const defaultAgent = String(raw.defaultAgent ?? Object.keys(agents)[0] ?? '');
  if (!agents[defaultAgent]) throw new Error(`defaultAgent "${defaultAgent}" is not in agents`);
  return {
    defaultAgent,
    timeoutMinutes: timeout,
    terminal: typeof raw.terminal === 'string' ? raw.terminal : '',
    agents,
  };
}

export function loadConfig(file = CONFIG_FILE): Config {
  ensureHome();
  if (!fs.existsSync(file)) {
    saveConfig(DEFAULT_CONFIG, file);
    return structuredClone(DEFAULT_CONFIG);
  }
  try {
    return validateConfig(JSON.parse(fs.readFileSync(file, 'utf8')));
  } catch (err) {
    process.stderr.write(`[${NAME}] ${file}: ${(err as Error).message}. Using defaults.\n`);
    return structuredClone(DEFAULT_CONFIG);
  }
}

export function saveConfig(config: Config, file = CONFIG_FILE): void {
  writeJsonAtomic(file, config);
}

export function writeJsonAtomic(file: string, data: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(data, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(tmp, file);
}
