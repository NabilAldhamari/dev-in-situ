export type RunMode = 'background' | 'terminal';

export interface AgentSpec {
  command: string;
  background: string[];
  terminal: string[];
  args: string[];
  model: string;
  env: Record<string, string>;
  output: 'json' | 'text';
  modelFlag: string[];
  resumeFlag: string[];
  sessionFlag: string[];
  editFlag: string[];
  bypassFlag: string[];
}

export type AgentConfig = Partial<AgentSpec> & { preset?: string };

const EMPTY: AgentSpec = {
  command: '',
  background: ['{options}', '{prompt}'],
  terminal: ['{options}', '{prompt}'],
  args: [],
  model: '',
  env: {},
  output: 'text',
  modelFlag: [],
  resumeFlag: [],
  sessionFlag: [],
  editFlag: [],
  bypassFlag: [],
};

export const PRESETS: Record<string, Partial<AgentSpec>> = {
  claude: {
    command: 'claude',
    background: ['-p', '{prompt}', '--output-format', 'stream-json', '--verbose', '{options}'],
    terminal: ['{options}', '{prompt}'],
    output: 'json',
    modelFlag: ['--model', '{model}'],
    resumeFlag: ['--resume', '{session}'],
    sessionFlag: ['--session-id', '{session}'],
    editFlag: ['--permission-mode', 'acceptEdits'],
    bypassFlag: ['--dangerously-skip-permissions'],
  },
  codex: {
    command: 'codex',
    background: ['exec', '--json', '--skip-git-repo-check', '{options}', '{prompt}'],
    terminal: ['{options}', '{prompt}'],
    output: 'json',
    modelFlag: ['-m', '{model}'],
    resumeFlag: ['resume', '{session}'],
    editFlag: ['--full-auto'],
    bypassFlag: ['--dangerously-bypass-approvals-and-sandbox'],
  },
  gemini: {
    command: 'gemini',
    background: ['--output-format', 'stream-json', '{options}', '-p', '{prompt}'],
    terminal: ['{options}', '-i', '{prompt}'],
    output: 'json',
    modelFlag: ['-m', '{model}'],
    resumeFlag: ['--resume', '{session}'],
    editFlag: ['--approval-mode', 'auto_edit'],
    bypassFlag: ['--approval-mode', 'yolo'],
  },
  opencode: {
    command: 'opencode',
    background: ['run', '--format', 'json', '{options}', '{prompt}'],
    terminal: ['{options}', '--prompt', '{prompt}'],
    output: 'json',
    modelFlag: ['-m', '{model}'],
    resumeFlag: ['--session', '{session}'],
  },
  antigravity: {
    command: 'agy',
    background: ['--add-dir', '{cwd}', '--output-format', 'stream-json', '--print-timeout', '{timeout}s', '{options}', '-p', '{prompt}'],
    terminal: ['--add-dir', '{cwd}', '{options}', '--prompt-interactive', '{prompt}'],
    output: 'json',
    modelFlag: ['--model', '{model}'],
    resumeFlag: ['--conversation', '{session}'],
    bypassFlag: ['--dangerously-skip-permissions'],
  },
};

export function resolveAgent(config: AgentConfig): AgentSpec {
  const preset = (config.preset && PRESETS[config.preset]) || {};
  const own = Object.fromEntries(Object.entries(config).filter(([k, v]) => k !== 'preset' && v !== undefined));
  return { ...EMPTY, ...preset, ...own, env: { ...preset.env, ...config.env } };
}

export interface InvocationInput {
  mode: RunMode;
  prompt: string;
  cwd: string;
  model?: string | null;
  session?: string | null;
  newSession?: string | null;
  bypass?: boolean;
  timeoutSeconds?: number;
}

const DEFAULT_TIMEOUT_SECONDS = 30 * 60;

export function buildArgs(spec: AgentSpec, input: InvocationInput): string[] {
  const model = input.model || spec.model;
  const values: Record<string, string> = {
    prompt: input.prompt,
    cwd: input.cwd,
    model,
    session: input.session || input.newSession || '',
    timeout: String(input.timeoutSeconds ?? DEFAULT_TIMEOUT_SECONDS),
  };
  const options = [
    ...spec.args,
    ...(model ? spec.modelFlag : []),
    ...(input.bypass ? spec.bypassFlag : spec.editFlag),
    ...(input.session ? spec.resumeFlag : input.newSession ? spec.sessionFlag : []),
  ];
  const template = spec[input.mode];
  const expanded = template.includes('{options}')
    ? template.flatMap((arg) => (arg === '{options}' ? options : [arg]))
    : [...template, ...options];
  return expanded.map((arg) => arg.replace(/\{(\w+)\}/g, (m, key: string) => values[key] ?? m));
}

export function expandEnv(env: Record<string, string>, source: NodeJS.ProcessEnv = process.env): Record<string, string> {
  return Object.fromEntries(
    Object.entries(env).map(([k, v]) => [k, String(v).replace(/\$\{(\w+)\}/g, (_, name: string) => source[name] ?? '')]),
  );
}

export interface Parsed {
  text?: string;
  final?: string;
  status?: string;
  session?: string;
  error?: string;
  done?: boolean;
}

type Obj = Record<string, unknown>;

const GENERIC_ERROR = 'The agent reported an error.';
const TARGET_DISPLAY_LIMIT = 60;

const str = (v: unknown): string | undefined => (typeof v === 'string' && v ? v : undefined);
const obj = (v: unknown): Obj => (v && typeof v === 'object' ? (v as Obj) : {});

export function describeTool(name: string, input: unknown): string {
  const f = obj(input);
  const target = str(f.file_path) ?? str(f.filePath) ?? str(f.path) ?? str(f.command) ?? str(f.pattern) ?? str(f.query) ?? '';
  const short = target.length > TARGET_DISPLAY_LIMIT ? `…${target.slice(1 - TARGET_DISPLAY_LIMIT)}` : target;
  return short ? `${name} ${short}` : name;
}

/** Codex reports each step as an item; these turn the item into a one-line status. */
const ITEM_STATUS = new Map<unknown, (item: Obj) => string>([
  ['reasoning', () => 'Thinking…'],
  ['command_execution', (item) => describeTool('Run', { command: item.command })],
  ['file_change', (item) => `Edit ${((item.changes as Obj[] | undefined) ?? []).map((c) => str(c.path)).filter(Boolean).join(', ')}`.trim()],
  ['mcp_tool_call', (item) => `${str(item.server) ?? 'mcp'} ${str(item.tool) ?? ''}`.trim()],
  ['web_search', (item) => describeTool('Search', { query: item.query })],
]);

export function interpretLine(line: string): Parsed | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  let e: Obj;
  try {
    e = JSON.parse(trimmed) as Obj;
    if (!e || typeof e !== 'object' || Array.isArray(e)) throw new Error();
  } catch {
    return { text: `${trimmed}\n` };
  }
  const kind = str(e.type) ?? str(e.event) ?? '';
  const out: Parsed = {};
  const step = obj(e.step_update);
  const result = obj(e.result);
  const session =
    str(e.session_id) ?? str(e.thread_id) ?? str(e.sessionID) ?? str(e.conversation_id) ??
    str(step.conversation_id) ?? str(result.conversation_id);
  if (session) out.session = session;

  switch (kind) {
    case 'system':
    case 'init':
    case 'thread.started':
      out.status = str(e.model) ? `Started (${e.model})` : 'Started';
      break;
    case 'assistant': {
      const parts: string[] = [];
      for (const block of (obj(e.message).content as Obj[] | undefined) ?? []) {
        if (block.type === 'text' && str(block.text)) parts.push(block.text as string);
        if (block.type === 'tool_use') out.status = describeTool(String(block.name), block.input);
        if (block.type === 'thinking') out.status = 'Thinking…';
      }
      if (parts.length) out.text = `${parts.join('\n')}\n`;
      break;
    }
    case 'message':
      if (e.role === 'assistant' && str(e.content)) out.text = e.content as string;
      break;
    case 'text':
      if (str(obj(e.part).text)) out.text = `${obj(e.part).text}\n`;
      break;
    case 'tool_use': {
      const part = obj(e.part);
      out.status = describeTool(str(e.tool_name) ?? str(part.tool) ?? 'tool', e.parameters ?? obj(part.state).input);
      break;
    }
    case 'item.started':
    case 'item.completed': {
      const item = obj(e.item);
      if (item.type === 'agent_message' && kind === 'item.completed' && str(item.text)) out.text = `${item.text}\n`;
      const describe = ITEM_STATUS.get(item.type);
      if (describe) out.status = describe(item);
      break;
    }
    case 'step_update': {
      const type = str(step.step_type) ?? '';
      if (type === 'user_input') break;
      if (str(step.text_delta)) out.text = step.text_delta as string;
      if (type && type !== 'agent_response') out.status = type.replace(/_/g, ' ');
      break;
    }
    case 'result':
    case 'turn.completed':
      out.done = true;
      if (typeof e.result === 'string') out.final = e.result;
      if (str(result.response)) out.final = result.response as string;
      if (e.is_error === true || e.status === 'error' || result.status === 'ERROR') {
        out.error = str(e.result) ?? str(obj(e.error).message) ?? str(e.error) ?? str(result.error) ?? GENERIC_ERROR;
      }
      break;
    case 'turn.failed':
    case 'error':
      out.error = str(obj(e.error).message) ?? str(obj(obj(e.error).data).message) ?? str(e.message) ?? str(e.error) ?? GENERIC_ERROR;
      break;
  }
  return out;
}
