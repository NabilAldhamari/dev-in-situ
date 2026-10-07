import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, type Settings } from '../../shared/types.js';
import { fakeBridge, fakeEvents, flush, openShadowRoots, restoreShadowRoots, rootOf, target } from '../../test/helpers.js';
import { Panel, groupKey } from './panel.js';

const CTA = target('#cta', { component: { name: 'Cta', file: 'src/Cta.tsx', line: 4, framework: 'React' } });
const NAV = target('nav > a', { elementKey: 'nav-a', tagName: 'A' });

let root: ShadowRoot;
const q = <T extends HTMLElement = HTMLElement>(ref: string) => root.querySelector<T>(`[data-ref="${ref}"]`)!;

beforeEach(() => {
  openShadowRoots();
  document.body.innerHTML = '<button id="cta">Buy</button><nav><a href="#">Home</a></nav>';
});

afterEach(() => {
  restoreShadowRoots();
  document.body.innerHTML = '';
});

async function openPanel(opts: { overrides?: Record<string, unknown>; settings?: Partial<Settings>; targets?: typeof CTA[] } = {}) {
  const fake = fakeBridge(opts.overrides);
  const ev = fakeEvents();
  const panel = new Panel(fake.bridge, ev.events);
  root = rootOf('dev-in-situ-panel');
  await panel.open(opts.targets ?? [CTA], { ...DEFAULT_SETTINGS, collapseOnSend: false, ...opts.settings }, { stack: ['React', 'Vite'], hmr: true });
  return { panel, ...fake, ...ev };
}

function type(text: string) {
  const input = q<HTMLTextAreaElement>('input');
  input.value = text;
  input.dispatchEvent(new Event('input'));
}

function press(key: string, init: KeyboardEventInit = {}) {
  q('input').dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, composed: true, ...init }));
}

describe('groupKey', () => {
  it('is stable regardless of selection order and ignores duplicates', () => {
    expect(groupKey([CTA, NAV])).toBe(groupKey([NAV, CTA, NAV]));
    expect(groupKey([CTA])).toBe('#cta');
  });
});

describe('Panel chat bar', () => {
  it('fills the project, agents, stack and element chip', async () => {
    await openPanel();
    expect(q<HTMLInputElement>('path').value).toBe('/work/app');
    expect(q('project-name').textContent).toBe('app');
    expect(q('stack').textContent).toBe('React · Vite');
    const chips = Array.from(q('chips').querySelectorAll('.chip'));
    expect(chips.map((c) => c.querySelector('.chip-label')!.textContent)).toEqual(['Cta']);
    expect((chips[0] as HTMLElement).title).toBe('#cta\nsrc/Cta.tsx:4');
    const options = Array.from(q<HTMLSelectElement>('agent').options).map((o) => o.textContent);
    expect(options).toEqual(['claude', 'codex (not found)']);
    expect(q<HTMLInputElement>('model').placeholder).toBe('sonnet');
    expect(q('options').hidden).toBe(true);
  });

  it('enables send only when there is text, a folder and live elements', async () => {
    await openPanel();
    expect(q<HTMLButtonElement>('send').disabled).toBe(true);
    type('make it green');
    expect(q<HTMLButtonElement>('send').disabled).toBe(false);
    document.querySelector('#cta')!.remove();
    type('make it green ');
    expect(q('hint').textContent).toBe('A selected element is no longer on the page');
    expect(q<HTMLButtonElement>('send').disabled).toBe(true);
  });

  it('opens the options when no project folder is known', async () => {
    await openPanel({ overrides: { '/project': { path: null, recent: [] } } });
    expect(q('options').hidden).toBe(false);
    expect(q('project-name').textContent).toBe('Choose folder');
    type('x');
    expect(q('hint').textContent).toBe('Choose the project folder');
  });

  it('shows connection problems as an error toast with a settings action', async () => {
    const { log } = await openPanel({ overrides: { '/config': { error: 'Wrong or missing token.', status: 401 } } });
    expect(log.toasts).toEqual([['error', 'Wrong or missing token.', 'Open settings']]);
    type('x');
    expect(q<HTMLButtonElement>('send').disabled).toBe(true);
  });

  it('shows one chip per selected element and reports removals', async () => {
    const { panel, log } = await openPanel({ targets: [CTA, NAV] });
    expect(q('chips').querySelectorAll('.chip')).toHaveLength(2);
    expect(q('chips').querySelectorAll('.chip-label')[1]!.textContent).toBe('<a>');
    (q('chips').querySelectorAll('.chip-x')[1] as HTMLElement).click();
    expect(log.removed).toEqual([1]);
    panel.setTargets([CTA]);
    expect(q('chips').querySelectorAll('.chip')).toHaveLength(1);
    panel.setTargets([]);
    type('x');
    expect(q('hint').textContent).toBe('Select an element first');
  });

  it('sends with Enter, keeps Shift+Enter for new lines, and sends every element', async () => {
    const { calls } = await openPanel({ targets: [CTA, NAV] });
    type('line one');
    press('Enter', { shiftKey: true });
    expect(calls.some((c) => c.path === '/dispatch')).toBe(false);
    press('Enter');
    await flush();
    const dispatch = calls.find((c) => c.path === '/dispatch')!;
    expect(dispatch.body).toMatchObject({
      instruction: 'line one',
      workspacePath: '/work/app',
      selector: '#cta',
      elementKey: groupKey([CTA, NAV]),
      stack: ['React', 'Vite'],
      followUp: false,
    });
    expect(dispatch.body.targets.map((t: { selector: string }) => t.selector)).toEqual(['#cta', 'nav > a']);
    expect(q<HTMLTextAreaElement>('input').value).toBe('');
  });

  it('streams a conversation, swaps send for stop, then toasts and notifies', async () => {
    const { panel, calls, streams, log } = await openPanel();
    type('make it green');
    q('send').click();
    await flush();
    expect(panel.busy).toBe(true);
    expect(q('send').hidden).toBe(true);
    expect(q('stop').hidden).toBe(false);

    const s = streams[0]!;
    s.push({ event: { seq: 1, level: 'status', message: 'Edit Cta.tsx' } });
    s.push({ ping: true });
    s.push({ event: { seq: 2, level: 'stdout', message: 'Done, ' } });
    s.push({ event: { seq: 2, level: 'stdout', message: 'duplicate' } });
    s.push({ event: { seq: 3, level: 'stdout', message: 'it is green.' } });
    expect(q('progress').textContent).toBe('Edit Cta.tsx');
    s.push({ event: { seq: 4, level: 'done', message: 'Finished', exitCode: 0 } });
    expect(panel.busy).toBe(false);
    expect(q('send').hidden).toBe(false);
    const entries = Array.from(q('log').children).map((e) => [(e as HTMLElement).dataset.level, e.textContent]);
    expect(entries).toEqual([
      ['prompt', 'make it green'],
      ['status', 'Edit Cta.tsx'],
      ['stdout', 'Done, it is green.'],
    ]);
    expect(log.toasts).toEqual([['success', 'Done: Done, it is green.', undefined]]);
    expect(log.notifications).toEqual([['dev-in-situ: reply ready', 'Done, it is green.']]);

    type('darker');
    press('Enter');
    await flush();
    expect(calls.filter((c) => c.path === '/dispatch')[1]!.body).toMatchObject({ instruction: 'darker', sessionKey: 'k1', followUp: true });
  });

  it('re-sends the element context when the selection changed mid-conversation', async () => {
    const { panel, calls, streams } = await openPanel();
    type('one');
    press('Enter');
    await flush();
    streams[0]!.push({ event: { seq: 1, level: 'done', message: 'Finished', exitCode: 0 } });
    panel.setTargets([CTA, NAV]);
    type('two');
    press('Enter');
    await flush();
    expect(calls.filter((c) => c.path === '/dispatch')[1]!.body).toMatchObject({ followUp: false, sessionKey: 'k1' });
  });

  it('turns run errors into error toasts and skips notifications when turned off', async () => {
    const { streams, log } = await openPanel({ settings: { notify: false } });
    type('x');
    press('Enter');
    await flush();
    streams[0]!.push({ event: { seq: 1, level: 'error', message: 'claude exited with code 1.' } });
    streams[0]!.push({ event: { seq: 2, level: 'done', message: 'Failed', exitCode: 1 } });
    expect(log.toasts).toEqual([['error', 'claude exited with code 1.', undefined]]);
    expect(log.notifications).toEqual([]);
    expect(q('dot').dataset.state).toBe('bad');
  });

  it('minimizes after sending when that option is on, and flags the reply as unread', async () => {
    const { panel, streams, log } = await openPanel({ settings: { collapseOnSend: true } });
    type('x');
    press('Enter');
    await flush();
    expect(panel.minimized).toBe(true);
    expect(log.minimized).toEqual([true]);
    streams[0]!.push({ event: { seq: 1, level: 'status', message: 'Edit a.css' } });
    expect(q('pill-text').textContent).toBe('Edit a.css');
    streams[0]!.push({ event: { seq: 2, level: 'done', message: 'Finished', exitCode: 0 } });
    expect(q('pill-text').textContent).toBe('Reply ready · click to view');
    q('pill').click();
    expect(panel.minimized).toBe(false);
    expect(log.minimized).toEqual([true, false]);
  });

  it('Escape minimizes; minimizing twice reports once', async () => {
    const { panel, log } = await openPanel();
    press('Escape');
    expect(panel.minimized).toBe(true);
    panel.setMinimized(true);
    expect(log.minimized).toEqual([true]);
  });

  it('docks to the bottom by default and floats when undocked', async () => {
    const { panel, saved } = await openPanel();
    expect(panel.docked).toBe(true);
    expect(panel.host.style.getPropertyValue('bottom')).toBe('16px');
    q('toggle-options').click();
    const docked = q<HTMLInputElement>('docked');
    docked.checked = false;
    docked.dispatchEvent(new Event('change'));
    expect(panel.docked).toBe(false);
    expect(panel.host.style.getPropertyValue('bottom')).toBe('auto');
    expect(saved).toContainEqual({ docked: false });
  });

  it('applies the theme to the bar', async () => {
    const { panel } = await openPanel();
    panel.setTheme('light');
    expect(q('bar').dataset.theme).toBe('light');
    expect(panel.host.style.getPropertyValue('color-scheme')).toBe('light');
  });

  it('reconnects a dropped stream from the last event', async () => {
    const { streams } = await openPanel();
    type('x');
    press('Enter');
    await flush();
    streams[0]!.push({ event: { seq: 1, level: 'status', message: 'working' } });
    streams[0]!.end();
    await new Promise((r) => setTimeout(r, 450));
    expect(streams[1]).toMatchObject({ dispatchId: 'd1', since: 1 });
  });

  it('stop cancels the run and a snapshot restores the chat', async () => {
    const { panel, calls } = await openPanel({ targets: [CTA, NAV] });
    type('x');
    press('Enter');
    await flush();
    q('stop').click();
    await flush();
    expect(calls.some((c) => c.path === '/dispatch/d1' && c.method === 'DELETE')).toBe(true);
    const snapshot = panel.snapshot()!;
    expect(snapshot).toMatchObject({ selectors: ['#cta', 'nav > a'], path: '/work/app', sessionKey: 'k1', minimized: false });
    expect(snapshot.entries[0]).toEqual(['prompt', 'x']);
    const again = (await openPanel({ targets: [CTA, NAV] })).panel;
    again.restore(snapshot);
    expect(q('log').children.length).toBe(2);
    expect(q('new').hidden).toBe(false);
  });

  it('new chat forgets the session and clears the thread', async () => {
    const { calls, streams } = await openPanel();
    type('x');
    press('Enter');
    await flush();
    streams[0]!.push({ event: { seq: 1, level: 'done', message: 'Finished', exitCode: 0 } });
    q('new').click();
    await flush();
    expect(calls.some((c) => c.path.startsWith('/session?agent=') && c.method === 'DELETE')).toBe(true);
    expect(q('log').hidden).toBe(true);
    expect(q('log').children.length).toBe(0);
  });

  it('shows an earlier conversation notice and can start fresh', async () => {
    const { calls } = await openPanel({ overrides: { '/session': { sessionKey: 'k9', session: { turns: 3, updatedAt: 0 } } } });
    expect(q('notice').hidden).toBe(false);
    expect(q('notice-text').textContent).toBe('Continues an earlier conversation (3 turns).');
    q('fresh').click();
    await flush();
    expect(calls.at(-1)).toMatchObject({ method: 'DELETE', path: '/session?agent=claude&key=k9' });
    expect(q('notice').hidden).toBe(true);
  });

  it('browses folders and picks one', async () => {
    const { calls } = await openPanel({ overrides: { '/fs/list': { path: '/work', parent: '/', dirs: ['app', 'site'], isProject: false } } });
    q('browse').click();
    await flush();
    expect(calls.at(-1)!.path).toBe('/fs/list?path=%2Fwork%2Fapp');
    expect(Array.from(q('dirs').querySelectorAll('button')).map((b) => b.textContent)).toEqual(['📁 app', '📁 site']);
    q('use').click();
    expect(q<HTMLInputElement>('path').value).toBe('/work');
    expect(q('project-name').textContent).toBe('work');
  });

  it('asks for more elements through the add button', async () => {
    const { log } = await openPanel();
    q('add').click();
    expect(log.picks).toBe(1);
  });
});
