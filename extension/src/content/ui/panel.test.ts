import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, type StreamMessage, type Target } from '../../shared/types.js';
import { type Bridge, Panel } from './panel.js';

const realAttach = Element.prototype.attachShadow;
let root: ShadowRoot;

const TARGET: Target = {
  selector: '#cta',
  elementKey: '#cta',
  tagName: 'BUTTON',
  html: '<button id="cta">Buy</button>',
  component: { name: 'Cta', file: 'src/Cta.tsx', line: 4, framework: 'React' },
  url: 'http://localhost:5173/',
  origin: 'http://localhost:5173',
  pathname: '/',
  rect: { top: 10, left: 10, width: 50, height: 20 },
};

interface Call {
  path: string;
  method: string;
  body: any;
}

function fakeBridge(overrides: Record<string, unknown> = {}) {
  const calls: Call[] = [];
  const streams: { dispatchId: string; since: number; push: (m: StreamMessage) => void; end: () => void }[] = [];
  const responses: Record<string, unknown> = {
    '/config': { config: { defaultAgent: 'claude', agents: {} }, agents: [{ id: 'claude', command: 'claude', model: 'sonnet', available: true }, { id: 'codex', command: 'codex', model: '', available: false }], file: '/h/config.json' },
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
    saveSettings: () => {},
    openOptions: () => {},
  };
  return { bridge, calls, streams };
}

const q = <T extends HTMLElement = HTMLElement>(ref: string) => root.querySelector<T>(`[data-ref="${ref}"]`)!;
const flush = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  Element.prototype.attachShadow = function (this: Element, init: ShadowRootInit) {
    root = realAttach.call(this, { ...init, mode: 'open' });
    return root;
  };
  document.body.innerHTML = '<button id="cta">Buy</button>';
});

afterEach(() => {
  Element.prototype.attachShadow = realAttach;
  document.body.innerHTML = '';
});

async function openPanel(overrides?: Record<string, unknown>) {
  const fake = fakeBridge(overrides);
  const panel = new Panel(fake.bridge, { onClose: (p) => p.close(), onPick: () => {} });
  await panel.open(TARGET, DEFAULT_SETTINGS, { stack: ['React', 'Vite'], hmr: true });
  return { panel, ...fake };
}

describe('Panel', () => {
  it('fills the project, agents, stack and component hint', async () => {
    await openPanel();
    expect(q<HTMLInputElement>('path').value).toBe('/work/app');
    expect(q('stack').textContent).toBe('React · Vite');
    expect(q('target-hint').textContent).toBe('Cta — src/Cta.tsx:4');
    const options = Array.from(q<HTMLSelectElement>('agent').options).map((o) => o.textContent);
    expect(options).toEqual(['claude', 'codex (not found)']);
    expect(q<HTMLInputElement>('model').placeholder).toBe('sonnet');
    expect(q<HTMLButtonElement>('send').disabled).toBe(false);
  });

  it('shows a settings banner when the token is wrong', async () => {
    await openPanel({ '/config': { error: 'Wrong or missing token.', status: 401 } });
    expect(q('banner').hidden).toBe(false);
    expect(q('banner-action').hidden).toBe(false);
    expect(q<HTMLButtonElement>('send').disabled).toBe(true);
  });

  it('streams progress, stays open, and sends replies as follow-ups', async () => {
    const { panel, calls, streams } = await openPanel();
    q<HTMLTextAreaElement>('instruction').value = 'make it green';
    q('send').click();
    await flush();
    const dispatch = calls.find((c) => c.path === '/dispatch')!;
    expect(dispatch.body).toMatchObject({ instruction: 'make it green', workspacePath: '/work/app', selector: '#cta', stack: ['React', 'Vite'], followUp: false });
    expect(panel.busy).toBe(true);
    expect(q('compose').hidden).toBe(true);

    const s = streams[0]!;
    s.push({ event: { seq: 1, level: 'status', message: 'Edit Cta.tsx' } });
    s.push({ ping: true });
    s.push({ event: { seq: 2, level: 'stdout', message: 'Done, ' } });
    s.push({ event: { seq: 2, level: 'stdout', message: 'duplicate' } });
    s.push({ event: { seq: 3, level: 'stdout', message: 'it is green.' } });
    expect(q('progress').textContent).toBe('Edit Cta.tsx');
    s.push({ event: { seq: 4, level: 'done', message: 'Finished', exitCode: 0 } });
    expect(panel.busy).toBe(false);
    const entries = Array.from(q('log').children).map((e) => [(e as HTMLElement).dataset.level, e.textContent]);
    expect(entries).toEqual([
      ['prompt', 'make it green'],
      ['status', 'Edit Cta.tsx'],
      ['stdout', 'Done, it is green.'],
      ['done', 'Finished'],
    ]);
    expect(q('reply').hidden).toBe(false);

    q<HTMLTextAreaElement>('reply').value = 'darker';
    q('send').click();
    await flush();
    expect(calls.filter((c) => c.path === '/dispatch')[1]!.body).toMatchObject({ instruction: 'darker', sessionKey: 'k1', followUp: true });
  });

  it('reconnects a dropped stream from the last event', async () => {
    const { streams } = await openPanel();
    q<HTMLTextAreaElement>('instruction').value = 'x';
    q('send').click();
    await flush();
    streams[0]!.push({ event: { seq: 1, level: 'status', message: 'working' } });
    streams[0]!.end();
    await new Promise((r) => setTimeout(r, 450));
    expect(streams[1]).toMatchObject({ dispatchId: 'd1', since: 1 });
  });

  it('stop cancels the run and a snapshot restores the chat', async () => {
    const { panel, calls } = await openPanel();
    q<HTMLTextAreaElement>('instruction').value = 'x';
    q('send').click();
    await flush();
    q('stop').click();
    await flush();
    expect(calls.some((c) => c.path === '/dispatch/d1' && c.method === 'DELETE')).toBe(true);
    const snapshot = panel.snapshot()!;
    expect(snapshot.entries[0]).toEqual(['prompt', 'x']);
    const again = (await openPanel()).panel;
    again.restore(snapshot);
    expect(q('compose').hidden).toBe(true);
    expect(q('log').children.length).toBe(2);
  });

  it('browses folders and picks one', async () => {
    const { calls } = await openPanel({ '/fs/list': { path: '/work', parent: '/', dirs: ['app', 'site'], isProject: false } });
    q('browse').click();
    await flush();
    expect(calls.at(-1)!.path).toBe('/fs/list?path=%2Fwork%2Fapp');
    expect(Array.from(q('dirs').querySelectorAll('button')).map((b) => b.textContent)).toEqual(['📁 app', '📁 site']);
    q('use').click();
    expect(q<HTMLInputElement>('path').value).toBe('/work');
  });
});
