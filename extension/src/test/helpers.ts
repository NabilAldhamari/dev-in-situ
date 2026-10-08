import type { StreamMessage, Target } from '../shared/types.js';
import type { Bridge, PanelEvents } from '../content/ui/panel.js';

/** Shadow roots by host, opened so tests can look inside the closed roots the UI creates. */
export const roots = new Map<Element, ShadowRoot>();
const realAttach = Element.prototype.attachShadow;

export function openShadowRoots(): void {
  roots.clear();
  Element.prototype.attachShadow = function (this: Element, init: ShadowRootInit) {
    const root = realAttach.call(this, { ...init, mode: 'open' });
    roots.set(this, root);
    return root;
  };
}

export function restoreShadowRoots(): void {
  Element.prototype.attachShadow = realAttach;
  roots.clear();
}

/** The most recently created shadow root whose host has this tag name or id. */
export function rootOf(tag: string): ShadowRoot {
  const entry = [...roots.entries()].reverse().find(([host]) => host.tagName.toLowerCase() === tag.toLowerCase() || host.id === tag);
  if (!entry) throw new Error(`no shadow root for ${tag}`);
  return entry[1];
}

export const flush = () => new Promise((r) => setTimeout(r, 0));

export function target(selector: string, overrides: Partial<Target> = {}): Target {
  return {
    selector,
    elementKey: selector,
    tagName: 'BUTTON',
    html: `<button>${selector}</button>`,
    component: null,
    url: 'http://localhost:5173/',
    origin: 'http://localhost:5173',
    pathname: '/',
    rect: { top: 10, left: 10, width: 50, height: 20 },
    ...overrides,
  };
}

export interface Call {
  path: string;
  method: string;
  body: any;
}

export interface FakeStream {
  dispatchId: string;
  since: number;
  push: (m: StreamMessage) => void;
  end: () => void;
}

export function fakeBridge(overrides: Record<string, unknown> = {}) {
  const calls: Call[] = [];
  const streams: FakeStream[] = [];
  const saved: Record<string, unknown>[] = [];
  let opened = 0;
  const responses: Record<string, unknown> = {
    '/config': {
      config: { defaultAgent: 'claude', agents: {} },
      agents: [
        { id: 'claude', command: 'claude', model: 'sonnet', available: true },
        { id: 'codex', command: 'codex', model: '', available: false },
      ],
      file: '/h/config.json',
    },
    '/project': { path: '/work/app', recent: ['/work/app'] },
    '/session': { sessionKey: 'k1', session: null },
    '/dispatch': { dispatchId: 'd1', sessionKey: 'k1', resumed: false },
    ...overrides,
  };
  const bridge: Bridge = {
    async api<T>(path: string, method = 'GET', body?: unknown) {
      calls.push({ path, method, body });
      const key = Object.keys(responses).find((k) => path.split('?')[0] === k);
      const value = (key ? responses[key] : {}) as { error?: string; status?: number };
      if (value.error) return { ok: false, status: value.status ?? 500, error: value.error };
      return { ok: true, data: value as T };
    },
    stream(dispatchId, since, onMessage, onEnd) {
      streams.push({ dispatchId, since, push: onMessage, end: onEnd });
      return () => {};
    },
    saveSettings: (patch) => void saved.push(patch),
    openOptions: () => void opened++,
  };
  return { bridge, calls, streams, saved, responses, opened: () => opened };
}

export function fakeEvents(overrides: Partial<PanelEvents> = {}) {
  const log = {
    toasts: [] as [string, string, string | undefined][],
    notifications: [] as [string, string][],
    minimized: [] as boolean[],
    removed: [] as number[],
    picks: 0,
  };
  const events: PanelEvents = {
    onClose: (p) => p.close(),
    onPick: () => void log.picks++,
    onMinimize: (_p, m) => void log.minimized.push(m),
    onRemoveTarget: (_p, i) => void log.removed.push(i),
    toast: (kind, text, action) => void log.toasts.push([kind, text, action?.label]),
    notify: (title, message) => void log.notifications.push([title, message]),
    ...overrides,
  };
  return { events, log };
}
