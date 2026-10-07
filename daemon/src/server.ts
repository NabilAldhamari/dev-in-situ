import { randomUUID, timingSafeEqual } from 'node:crypto';
import express, { type NextFunction, type Request, type Response } from 'express';
import { type RunMode, buildArgs, expandEnv, interpretLine, resolveAgent } from './agents.js';
import { ALLOWED_HOSTS, CONFIG_FILE, type Config, NAME, TOKEN_FILE, VERSION, saveConfig, validateConfig } from './config.js';
import { RunLog } from './events.js';
import { buildPrompt } from './prompt.js';
import { openTerminal, resolveExecutable, runProcess } from './runner.js';
import { type Scope, Store, sessionKey } from './store.js';
import { ChangeWatcher, checkWorkspace, listDirs } from './workspace.js';

export interface DispatchTarget {
  selector: string;
  elementKey: string | null;
  html: string;
  component: { name?: string | null; file?: string | null; line?: number | null } | null;
}

export interface DispatchBody {
  agent: string;
  mode: RunMode;
  scope: Scope;
  origin: string;
  url: string;
  pathname: string;
  selector: string;
  elementKey: string | null;
  html: string;
  instruction: string;
  workspacePath: string;
  component: { name?: string | null; file?: string | null; line?: number | null } | null;
  stack: string[] | null;
  model: string | null;
  bypass: boolean;
  sessionKey: string | null;
  followUp: boolean;
  targets: DispatchTarget[];
}

export const MAX_TARGETS = 20;

export interface ServerDeps {
  config: Config;
  token: string;
  store: Store;
  configFile?: string;
  watcher?: ChangeWatcher;
}

const EXTENSION_ORIGIN = /^(chrome|moz|safari-web)-extension:\/\/[a-z0-9-]+$/i;
const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);
const SCOPES: Scope[] = ['page', 'element', 'new'];

function parseTarget(value: unknown): DispatchTarget | null {
  const t = (value ?? {}) as Record<string, unknown>;
  const selector = text(t.selector, 2000);
  if (!selector) return null;
  const component = t.component && typeof t.component === 'object' ? (t.component as DispatchTarget['component']) : null;
  return { selector, elementKey: text(t.elementKey, 2000) || null, html: text(t.html, 50_000), component };
}

function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

const text = (v: unknown, max = 100_000): string => (typeof v === 'string' ? v.slice(0, max) : '');

export function parseDispatch(body: unknown, config: Config): DispatchBody {
  const b = (body ?? {}) as Record<string, unknown>;
  const agent = text(b.agent) || config.defaultAgent;
  if (!config.agents[agent]) throw new Error(`Unknown agent "${agent}". Add it to ${CONFIG_FILE}.`);
  const mode = b.mode === 'terminal' ? 'terminal' : 'background';
  const scope = SCOPES.includes(b.scope as Scope) ? (b.scope as Scope) : 'element';
  const instruction = text(b.instruction, 20_000).trim();
  if (!instruction) throw new Error('Write an instruction first.');
  for (const key of ['origin', 'url', 'workspacePath'] as const) {
    if (!text(b[key])) throw new Error(`${key} is required`);
  }
  const listed = Array.isArray(b.targets) ? b.targets.slice(0, MAX_TARGETS).map(parseTarget) : [parseTarget(b)];
  const targets = listed.filter((t): t is DispatchTarget => t !== null);
  if (!targets.length) throw new Error('selector is required');
  const first = targets[0]!;
  return {
    agent,
    mode,
    scope,
    origin: text(b.origin, 500),
    url: text(b.url, 2000),
    pathname: text(b.pathname, 2000) || '/',
    selector: first.selector,
    elementKey: text(b.elementKey, 2000) || first.elementKey,
    html: first.html,
    instruction,
    workspacePath: text(b.workspacePath, 1000),
    component: first.component,
    stack: Array.isArray(b.stack) ? b.stack.filter((s): s is string => typeof s === 'string').slice(0, 12) : null,
    model: text(b.model, 200).trim() || null,
    bypass: b.bypass === true,
    sessionKey: text(b.sessionKey, 5000) || null,
    followUp: b.followUp === true,
    targets,
  };
}

export function createServer(deps: ServerDeps) {
  const { store, token } = deps;
  let config = deps.config;
  const configFile = deps.configFile ?? CONFIG_FILE;
  const watcher = deps.watcher ?? new ChangeWatcher();
  const log = new RunLog();
  const running = new Map<string, AbortController>();
  const queues = new Map<string, Promise<unknown>>();

  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '1mb' }));

  app.use((req: Request, res: Response, next: NextFunction) => {
    if (!LOOPBACK.has(req.socket.remoteAddress ?? '')) return void res.status(403).json({ error: 'loopback only' });
    if (req.headers.host && !ALLOWED_HOSTS.has(req.headers.host.toLowerCase())) return void res.status(403).json({ error: 'bad host' });
    const origin = req.headers.origin;
    if (origin && !EXTENSION_ORIGIN.test(origin)) return void res.status(403).json({ error: 'origin not allowed' });
    if (origin) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Bridge-Token');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    }
    if (req.method === 'OPTIONS') return void res.status(204).end();
    next();
  });

  const authed = (req: Request) => {
    const presented = req.get('X-Bridge-Token');
    return Boolean(presented && safeEqual(presented, token));
  };

  app.get('/health', (req, res) => {
    res.json({ ok: true, name: NAME, version: VERSION, authenticated: authed(req) });
  });

  app.use((req, res, next) => {
    if (authed(req)) return next();
    res.status(401).json({ error: `Wrong or missing token. Copy it from ${TOKEN_FILE}.` });
  });

  const agentList = () =>
    Object.entries(config.agents).map(([id, cfg]) => {
      const spec = resolveAgent(cfg);
      return { id, command: spec.command, model: spec.model, available: Boolean(resolveExecutable(spec.command)) };
    });

  app.get('/config', (_req, res) => {
    res.json({ config, agents: agentList(), file: configFile });
  });

  app.put('/config', (req, res) => {
    try {
      config = validateConfig(req.body);
      saveConfig(config, configFile);
      res.json({ config, agents: agentList(), file: configFile });
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  });

  app.get('/project', (req, res) => {
    res.json({ path: store.project(text(req.query.origin)), recent: store.recent() });
  });

  app.get('/fs/list', (req, res) => {
    try {
      res.json(listDirs(text(req.query.path) || undefined));
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  });

  app.get('/workspace/stamp', (req, res) => {
    const check = checkWorkspace(text(req.query.path));
    res.json({ stamp: check.ok ? watcher.stamp(check.path) : null });
  });

  app.get('/session', (req, res) => {
    const q = req.query as Record<string, string>;
    const agent = q.agent || config.defaultAgent;
    const scope = SCOPES.includes(q.scope as Scope) ? (q.scope as Scope) : 'element';
    const key = sessionKey({ origin: q.origin ?? '', pathname: q.pathname ?? '/', scope, elementKey: q.elementKey ?? null });
    res.json({ sessionKey: key, session: scope === 'new' ? null : store.session(agent, key) });
  });

  app.delete('/session', (req, res) => {
    store.forgetSession(text(req.query.agent), text(req.query.key));
    res.json({ ok: true });
  });

  app.post('/dispatch', (req, res) => {
    let body: DispatchBody;
    try {
      body = parseDispatch(req.body, config);
    } catch (err) {
      return void res.status(400).json({ error: (err as Error).message });
    }
    const check = checkWorkspace(body.workspacePath);
    if (!check.ok) return void res.status(400).json({ error: check.error });
    body.workspacePath = check.path;
    store.rememberProject(body.origin, body.workspacePath);
    const key = body.sessionKey ?? sessionKey({ ...body, scope: body.scope });
    const id = randomUUID();
    log.open(id);
    const previous = queues.get(key) ?? Promise.resolve();
    const next = previous
      .then(() => execute(id, key, body))
      .catch((err: Error) => {
        running.delete(id);
        log.emit(id, 'error', err.message);
        log.emit(id, 'done', 'Failed', { exitCode: null });
      });
    queues.set(key, next);
    void next.finally(() => queues.get(key) === next && queues.delete(key));
    res.status(202).json({ dispatchId: id, sessionKey: key, resumed: Boolean(store.session(body.agent, key)) });
  });

  app.delete('/dispatch/:id', (req, res) => {
    running.get(req.params.id)?.abort();
    res.json({ ok: running.has(req.params.id) });
  });

  app.get('/stream/:id', (req, res) => {
    const since = Number(req.query.since) || 0;
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
    res.write(': open\n\n');
    const ping = setInterval(() => res.write(': ping\n\n'), 15_000);
    const close = () => {
      clearInterval(ping);
      unsubscribe?.();
      res.end();
    };
    const unsubscribe = log.subscribe(req.params.id, since, (event) => {
      res.write(`data: ${JSON.stringify(event)}\n\n`);
      if (event.level === 'done') setImmediate(close);
    });
    if (!unsubscribe) {
      res.write(`data: ${JSON.stringify({ seq: 1, level: 'done', message: 'This run is no longer available.', exitCode: null })}\n\n`);
      return close();
    }
    req.on('close', close);
  });

  async function execute(id: string, key: string, body: DispatchBody): Promise<void> {
    const emit = log.emit.bind(log, id);
    const spec = resolveAgent(config.agents[body.agent] ?? {});
    const existing = body.scope === 'new' && !body.followUp ? null : store.session(body.agent, key);
    const session = spec.resumeFlag.length ? (existing?.session ?? null) : null;
    const newSession = !session && spec.sessionFlag.length ? randomUUID() : null;
    const prompt = body.followUp && session ? body.instruction : buildPrompt(body);
    const args = buildArgs(spec, {
      mode: body.mode,
      prompt,
      cwd: body.workspacePath,
      model: body.model,
      session,
      newSession,
      bypass: body.bypass,
      timeoutSeconds: config.timeoutMinutes * 60,
    });
    const cmd = { file: spec.command, args, cwd: body.workspacePath, env: expandEnv(spec.env) };
    emit('prompt', prompt);

    if (body.mode === 'terminal') {
      try {
        const via = await openTerminal(id, cmd, args.indexOf(prompt), config.terminal);
        if (session || newSession) store.saveSession(body.agent, key, (session ?? newSession)!, body.workspacePath);
        emit('status', `Opened ${body.agent} in ${via}`);
        emit('done', 'Continue in the terminal window.', { exitCode: 0, session: session ?? newSession });
      } catch (err) {
        emit('error', (err as Error).message);
        emit('done', 'Failed', { exitCode: null });
      }
      return;
    }

    const controller = new AbortController();
    running.set(id, controller);
    let learned = session ?? newSession;
    let sawText = false;
    let pending = '';
    const handleLine = (line: string) => {
      const parsed = interpretLine(line);
      if (!parsed) return;
      if (parsed.session) learned = parsed.session;
      if (parsed.status) emit('status', parsed.status);
      if (parsed.text) {
        sawText = true;
        emit('stdout', parsed.text);
      }
      if (parsed.final && !sawText) emit('stdout', `${parsed.final}\n`);
      if (parsed.error) emit('error', parsed.error);
    };
    emit('status', session ? `Resuming ${body.agent}…` : `Starting ${body.agent}…`);
    const result = await runProcess(cmd, {
      timeoutMs: config.timeoutMinutes * 60_000,
      signal: controller.signal,
      onData(chunk, stream) {
        if (stream === 'stderr' || spec.output !== 'json') return emit(stream, chunk);
        pending += chunk;
        const lines = pending.split(/\r?\n/);
        pending = lines.pop() ?? '';
        lines.forEach(handleLine);
      },
    });
    if (pending) handleLine(pending);
    running.delete(id);
    if (learned && (result.exitCode === 0 || learned !== session)) store.saveSession(body.agent, key, learned, body.workspacePath);
    if (result.error) emit('error', result.error);
    else if (result.timedOut) emit('error', `Stopped after ${config.timeoutMinutes} minutes.`);
    else if (controller.signal.aborted) emit('error', 'Cancelled.');
    else if (result.exitCode !== 0) emit('error', `${spec.command} exited with code ${result.exitCode}.`);
    emit('done', result.exitCode === 0 ? 'Finished' : 'Failed', { exitCode: result.exitCode, session: learned });
  }

  return { app, close: () => watcher.close() };
}
