import { type ApiResult, DEFAULT_SETTINGS, type RunEvent, type Settings } from './types.js';

const KEY = 'settings';
const PAGE_API = /^(GET \/(config|project|fs\/list|workspace\/stamp|session)|POST \/dispatch|DELETE \/(dispatch\/[\w-]+|session))(\?|$)/;

export const allowedFromPage = (method: string, path: string): boolean => PAGE_API.test(`${method} ${path}`);

export async function loadSettings(): Promise<Settings> {
  const stored = (await chrome.storage.local.get(KEY))[KEY] as Partial<Settings> | undefined;
  return { ...DEFAULT_SETTINGS, ...stored };
}

export async function saveSettings(patch: Partial<Settings>): Promise<Settings> {
  const next = { ...(await loadSettings()), ...patch };
  await chrome.storage.local.set({ [KEY]: next });
  return next;
}

const base = (settings: Settings) => settings.daemonUrl.replace(/\/+$/, '');

export async function request<T>(
  settings: Settings,
  path: string,
  init: { method?: string; body?: unknown; timeoutMs?: number } = {},
): Promise<ApiResult<T>> {
  try {
    const res = await fetch(base(settings) + path, {
      method: init.method ?? 'GET',
      headers: { 'Content-Type': 'application/json', 'X-Bridge-Token': settings.token },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      signal: AbortSignal.timeout(init.timeoutMs ?? 15_000),
    });
    const data = (await res.json().catch(() => ({}))) as T & { error?: string };
    if (!res.ok) return { ok: false, status: res.status, error: data.error ?? `Daemon responded ${res.status}` };
    return { ok: true, data };
  } catch {
    return { ok: false, status: 0, error: `Daemon not running at ${settings.daemonUrl}. Start it with "npm start" in the dev-in-situ folder.` };
  }
}

export function parseSse(buffer: string): { events: RunEvent[]; pings: number; rest: string } {
  const blocks = buffer.split('\n\n');
  const rest = blocks.pop() ?? '';
  const events: RunEvent[] = [];
  let pings = 0;
  for (const block of blocks) {
    const data = block
      .split('\n')
      .filter((l) => l.startsWith('data: '))
      .map((l) => l.slice(6))
      .join('\n');
    if (!data) {
      pings += 1;
      continue;
    }
    try {
      events.push(JSON.parse(data) as RunEvent);
    } catch {}
  }
  return { events, pings, rest };
}

export async function* stream(settings: Settings, dispatchId: string, since: number, signal: AbortSignal) {
  const res = await fetch(`${base(settings)}/stream/${encodeURIComponent(dispatchId)}?since=${since}`, {
    headers: { 'X-Bridge-Token': settings.token },
    signal,
  });
  if (!res.ok || !res.body) throw new Error(`Stream failed (${res.status})`);
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) return;
    const parsed = parseSse((buffer + value).replace(/\r\n/g, '\n'));
    buffer = parsed.rest;
    yield parsed;
  }
}
