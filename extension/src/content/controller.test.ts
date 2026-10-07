import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS, type Settings } from '../shared/types.js';
import { fakeBridge, flush, openShadowRoots, restoreShadowRoots, rootOf } from '../test/helpers.js';
import { Controller, MAX_SELECTION, RESTORE } from './controller.js';

let controller: Controller;
let fake: ReturnType<typeof fakeBridge>;
let notified: [string, string][];

function setup(settings: Partial<Settings> = {}, releaseGraceMs = 0) {
  fake = fakeBridge();
  notified = [];
  controller = new Controller({
    bridge: fake.bridge,
    loadSettings: async () => ({ ...DEFAULT_SETTINGS, collapseOnSend: false, ...settings }),
    notify: (title, message) => void notified.push([title, message]),
    ask: () => null,
    releaseGraceMs,
  });
  return controller;
}

const el = (selector: string) => document.querySelector(selector)!;
const panelRoot = () => rootOf('dev-in-situ-panel');
const ref = <T extends HTMLElement = HTMLElement>(name: string) => panelRoot().querySelector<T>(`[data-ref="${name}"]`)!;
const chips = () => Array.from(ref('chips').querySelectorAll('.chip-sel')).map((c) => c.textContent);
const marks = () => Array.from(rootOf('dev-in-situ-highlighter').querySelectorAll<HTMLElement>('.mark'));
const status = () => rootOf('dev-in-situ-highlighter').querySelector<HTMLElement>('.status')!;

function click(target: Element, init: MouseEventInit = {}) {
  target.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, composed: true, ...init }));
}
function key(type: 'keydown' | 'keyup', k: string) {
  document.body.dispatchEvent(new KeyboardEvent(type, { key: k, bubbles: true, cancelable: true }));
}

/** Waits for the panel to open, including its config and session requests. */
const settle = async () => {
  for (let i = 0; i < 5; i++) await flush();
};

beforeEach(() => {
  openShadowRoots();
  sessionStorage.clear();
  document.body.innerHTML = `
    <header id="top"><h1 id="title">Shop</h1></header>
    <main><section id="hero">Hero</section><article id="card">Card</article><button id="buy">Buy</button></main>`;
});

afterEach(() => {
  controller?.cancelPicking();
  controller?.panel?.close();
  restoreShadowRoots();
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

describe('picking elements', () => {
  it('a plain click selects one element and opens the chat bar for it', async () => {
    setup().toggle();
    expect(controller.picking).toBe(true);
    expect(status().textContent).toMatch(/hold (Ctrl|⌘) to select several/);
    click(el('#hero'));
    await settle();
    expect(controller.picking).toBe(false);
    expect(chips()).toEqual(['#hero']);
    expect(controller.marks).toEqual([el('#hero')]);
    expect(marks()).toHaveLength(1);
  });

  it('holding Ctrl collects several elements into one chat bar, released Ctrl finishes', async () => {
    setup().toggle();
    click(el('#hero'), { ctrlKey: true });
    click(el('#card'), { ctrlKey: true });
    expect(controller.picking).toBe(true);
    expect(controller.pending).toEqual([el('#hero'), el('#card')]);
    expect(marks()).toHaveLength(2);
    expect(status().textContent).toMatch(/^2 selected/);
    key('keyup', 'Control');
    await settle();
    expect(controller.picking).toBe(false);
    expect(chips()).toEqual(['#hero', '#card']);
    expect(controller.group).toEqual([el('#hero'), el('#card')]);
  });

  it('Cmd works like Ctrl, and clicking a selected element again deselects it', async () => {
    setup().toggle();
    click(el('#hero'), { metaKey: true });
    click(el('#card'), { metaKey: true });
    click(el('#hero'), { metaKey: true });
    expect(controller.pending).toEqual([el('#card')]);
    key('keyup', 'Meta');
    await settle();
    expect(chips()).toEqual(['#card']);
  });

  it('a plain click after Ctrl-clicks adds that element and finishes', async () => {
    setup().toggle();
    click(el('#hero'), { ctrlKey: true });
    click(el('#buy'));
    await settle();
    expect(chips()).toEqual(['#hero', '#buy']);
  });

  it('Enter finishes and Escape cancels without opening anything', async () => {
    setup().toggle();
    click(el('#hero'), { ctrlKey: true });
    key('keydown', 'Enter');
    await settle();
    expect(chips()).toEqual(['#hero']);
    controller.panel!.close();
    controller.panel = null;
    controller.group = [];
    controller.setMarks([]);

    controller.toggle();
    click(el('#card'), { ctrlKey: true });
    key('keydown', 'Escape');
    await settle();
    expect(controller.picking).toBe(false);
    expect(controller.panel).toBeNull();
    expect(controller.marks).toEqual([]);
  });

  it('scrolling right after letting go of Ctrl keeps picking, so more elements can be added', async () => {
    setup({}, 100).toggle();
    click(el('#hero'), { ctrlKey: true });
    key('keyup', 'Control');
    window.dispatchEvent(new Event('scroll'));
    await new Promise((r) => setTimeout(r, 150));
    expect(controller.picking).toBe(true);
    click(el('#buy'), { ctrlKey: true });
    key('keyup', 'Control');
    await new Promise((r) => setTimeout(r, 150));
    await settle();
    expect(chips()).toEqual(['#hero', '#buy']);
  });

  it('pressing Ctrl again within the grace period keeps picking', async () => {
    setup({}, 100).toggle();
    click(el('#hero'), { ctrlKey: true });
    key('keyup', 'Control');
    key('keydown', 'Control');
    await new Promise((r) => setTimeout(r, 150));
    expect(controller.picking).toBe(true);
  });

  it('a Mac Ctrl+click (context menu) adds to the selection and never opens the menu', async () => {
    setup().toggle();
    const menu = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, ctrlKey: true });
    el('#card').dispatchEvent(menu);
    expect(menu.defaultPrevented).toBe(true);
    expect(controller.pending).toEqual([el('#card')]);
    const plain = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
    el('#hero').dispatchEvent(plain);
    expect(plain.defaultPrevented).toBe(true);
    expect(controller.pending).toEqual([el('#card')]);
  });

  it(`caps the selection at ${MAX_SELECTION} elements with a toast`, () => {
    document.body.innerHTML = Array.from({ length: MAX_SELECTION + 1 }, (_, i) => `<p id="p${i}">${i}</p>`).join('');
    setup().toggle();
    for (let i = 0; i <= MAX_SELECTION; i++) click(el(`#p${i}`), { ctrlKey: true });
    expect(controller.pending).toHaveLength(MAX_SELECTION);
    const toasts = Array.from(rootOf('dev-in-situ-toasts').querySelectorAll('.text')).map((t) => t.textContent);
    expect(toasts).toEqual([`You can select up to ${MAX_SELECTION} elements at once.`]);
  });

  it('releasing Ctrl before any Ctrl-click does not finish', async () => {
    setup().toggle();
    key('keyup', 'Control');
    await settle();
    expect(controller.picking).toBe(true);
  });

  it('blocks page clicks while picking but leaves the scrollbar alone', () => {
    setup().toggle();
    const onPage = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
    el('#buy').dispatchEvent(onPage);
    expect(onPage.defaultPrevented).toBe(true);
    const onScrollbar = new MouseEvent('mousedown', { bubbles: true, cancelable: true, clientX: 5000, clientY: 10 });
    document.documentElement.dispatchEvent(onScrollbar);
    expect(onScrollbar.defaultPrevented).toBe(false);
  });

  it('follows the element under the pointer when the page scrolls, so the outline never sticks', async () => {
    setup().toggle();
    let under = el('#hero');
    (document as unknown as { elementFromPoint: (x: number, y: number) => Element }).elementFromPoint = () => under;
    window.dispatchEvent(new PointerEvent('pointermove', { clientX: 40, clientY: 40 }));
    const tag = () => rootOf('dev-in-situ-highlighter').querySelector<HTMLElement>('.tag')!.textContent;
    expect(tag()).toMatch(/^section/);
    under = el('#card');
    window.dispatchEvent(new Event('scroll'));
    await new Promise((r) => setTimeout(r, 40));
    expect(tag()).toMatch(/^article/);
    click(el('#hero'), { clientX: 40, clientY: 40 });
    await settle();
    expect(chips()).toEqual(['#card']);
    delete (document as unknown as { elementFromPoint?: unknown }).elementFromPoint;
  });
});

describe('the chat bar and its selection', () => {
  async function openWithTwo(settings: Partial<Settings> = {}) {
    setup(settings).toggle();
    click(el('#hero'), { ctrlKey: true });
    click(el('#card'), { ctrlKey: true });
    key('keyup', 'Control');
    await settle();
  }

  it('minimizing clears every outline and opening it again restores them all', async () => {
    await openWithTwo();
    expect(marks()).toHaveLength(2);
    controller.panel!.setMinimized(true);
    expect(controller.marks).toEqual([]);
    expect(marks()).toHaveLength(0);
    controller.panel!.setMinimized(false);
    expect(controller.marks).toEqual([el('#hero'), el('#card')]);
    expect(marks()).toHaveLength(2);
  });

  it('re-finds elements the page re-rendered when the bar opens again', async () => {
    await openWithTwo();
    controller.panel!.setMinimized(true);
    const old = el('#card');
    old.replaceWith(Object.assign(document.createElement('article'), { id: 'card', textContent: 'Card v2' }));
    controller.panel!.setMinimized(false);
    expect(controller.group[1]).not.toBe(old);
    expect(controller.group[1]).toBe(el('#card'));
  });

  it('the add button keeps the selection and extends it', async () => {
    await openWithTwo();
    ref('add').click();
    expect(controller.picking).toBe(true);
    expect(controller.panel!.minimized).toBe(true);
    expect(marks()).toHaveLength(2);
    click(el('#buy'), { ctrlKey: true });
    key('keyup', 'Control');
    await settle();
    expect(chips()).toEqual(['#hero', '#card', '#buy']);
    expect(controller.panel!.minimized).toBe(false);
    expect(marks()).toHaveLength(3);
  });

  it('cancelling an added pick brings back the previous selection', async () => {
    await openWithTwo();
    ref('add').click();
    click(el('#buy'), { ctrlKey: true });
    key('keydown', 'Escape');
    await settle();
    expect(chips()).toEqual(['#hero', '#card']);
    expect(controller.marks).toEqual([el('#hero'), el('#card')]);
  });

  it('cancelling a pick that started from the minimized pill leaves the bar minimized without outlines', async () => {
    await openWithTwo();
    controller.panel!.setMinimized(true);
    controller.toggle();
    click(el('#buy'), { ctrlKey: true });
    key('keydown', 'Escape');
    await settle();
    expect(controller.panel!.minimized).toBe(true);
    expect(controller.marks).toEqual([]);
  });

  it('opening the bar from its pill while picking abandons the pick and restores the outlines', async () => {
    await openWithTwo();
    ref('add').click();
    click(el('#buy'), { ctrlKey: true });
    ref('pill').click();
    expect(controller.picking).toBe(false);
    expect(controller.marks).toEqual([el('#hero'), el('#card')]);
    key('keydown', 'Escape');
    expect(controller.marks).toEqual([el('#hero'), el('#card')]);
  });

  it('a second pick while the bar is still opening reuses the same bar', async () => {
    setup().toggle();
    click(el('#hero'));
    controller.toggle();
    click(el('#card'));
    await settle();
    expect(document.querySelectorAll('dev-in-situ-panel')).toHaveLength(1);
    expect(chips()).toEqual(['#card']);
  });

  it('removing a chip drops that element and its outline', async () => {
    await openWithTwo();
    (ref('chips').querySelectorAll('.chip-x')[0] as HTMLElement).click();
    expect(chips()).toEqual(['#card']);
    expect(controller.marks).toEqual([el('#card')]);
  });

  it('closing the bar clears the selection and outlines', async () => {
    await openWithTwo();
    ref('close').click();
    expect(controller.panel).toBeNull();
    expect(controller.group).toEqual([]);
    expect(marks()).toHaveLength(0);
  });

  it('sending all elements, minimizing to free the page, then toasting and notifying on reply', async () => {
    await openWithTwo({ collapseOnSend: true });
    const input = ref<HTMLTextAreaElement>('input');
    input.value = 'align these';
    input.dispatchEvent(new Event('input'));
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, composed: true }));
    await settle();
    const dispatch = fake.calls.find((c) => c.path === '/dispatch')!;
    expect(dispatch.body.targets.map((t: { selector: string }) => t.selector)).toEqual(['#hero', '#card']);
    expect(controller.panel!.minimized).toBe(true);
    expect(controller.marks).toEqual([]);
    fake.streams[0]!.push({ event: { seq: 1, level: 'stdout', message: 'Aligned.' } });
    fake.streams[0]!.push({ event: { seq: 2, level: 'done', message: 'Finished', exitCode: 0 } });
    expect(notified).toEqual([['dev-in-situ: reply ready', 'Aligned.']]);
    const toasts = Array.from(rootOf('dev-in-situ-toasts').querySelectorAll<HTMLElement>('.toast'));
    expect(toasts.map((t) => [t.dataset.kind, t.querySelector('.text')!.textContent])).toEqual([['success', 'Done: Aligned.']]);
  });

  it('starting a fresh pick from the toolbar replaces the selection', async () => {
    await openWithTwo();
    controller.toggle();
    click(el('#buy'));
    await settle();
    expect(chips()).toEqual(['#buy']);
    expect(controller.marks).toEqual([el('#buy')]);
  });
});

describe('theme', () => {
  it('follows an explicit preference', async () => {
    setup({ theme: 'light' }).toggle();
    click(el('#hero'));
    await settle();
    expect(ref('bar').dataset.theme).toBe('light');
  });

  it('matches a dark site in auto mode and updates when settings change', async () => {
    document.body.style.backgroundColor = 'rgb(10, 10, 12)';
    setup().toggle();
    click(el('#hero'));
    await settle();
    expect(ref('bar').dataset.theme).toBe('dark');
    controller.setSettings({ ...DEFAULT_SETTINGS, theme: 'light' });
    expect(ref('bar').dataset.theme).toBe('light');
  });
});

describe('restoring after an auto-refresh', () => {
  it('reopens the chat bar with every element and the conversation', async () => {
    sessionStorage.setItem(
      RESTORE,
      JSON.stringify([{ selectors: ['#hero', '#buy'], path: '/work/app', sessionKey: 'k1', entries: [['prompt', 'hi'], ['stdout', 'ok']], minimized: false }]),
    );
    await setup().init();
    await settle();
    expect(chips()).toEqual(['#hero', '#buy']);
    expect(Array.from(ref('log').children).map((e) => e.textContent)).toEqual(['hi', 'ok', 'Page reloaded to show the changes.']);
    expect(controller.marks).toEqual([el('#hero'), el('#buy')]);
    expect(sessionStorage.getItem(RESTORE)).toBeNull();
  });

  it('restores minimized without outlines when it was minimized', async () => {
    sessionStorage.setItem(RESTORE, JSON.stringify([{ selectors: ['#hero'], path: '/w', sessionKey: null, entries: [], minimized: true }]));
    await setup().init();
    await settle();
    expect(controller.panel!.minimized).toBe(true);
    expect(controller.marks).toEqual([]);
  });

  it('ignores snapshots from older versions', async () => {
    sessionStorage.setItem(RESTORE, JSON.stringify([{ selector: '#hero', path: '/w', sessionKey: null, entries: [] }]));
    await setup().init();
    expect(controller.panel).toBeNull();
  });
});
