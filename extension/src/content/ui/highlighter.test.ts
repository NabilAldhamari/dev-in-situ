import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Highlighter } from './highlighter.js';

const realAttach = Element.prototype.attachShadow;
let root: ShadowRoot;

beforeEach(() => {
  Element.prototype.attachShadow = function (this: Element, init: ShadowRootInit) {
    root = realAttach.call(this, { ...init, mode: 'open' });
    return root;
  };
  document.body.innerHTML = '<section id="a"></section><section id="b"></section>';
});

afterEach(() => {
  Element.prototype.attachShadow = realAttach;
  document.body.innerHTML = '';
});

const p1 = {};
const p2 = {};
const marks = () => [...root.querySelectorAll<HTMLElement>('.mark')];

describe('Highlighter marks', () => {
  it('keeps one outline per owner after the hover ring is cleared', () => {
    const h = new Highlighter();
    const a = document.querySelector('#a')!;
    h.highlight(a);
    h.clearRing();
    h.mark(p1, a);
    h.mark(p2, document.querySelector('#b')!);
    expect(marks()).toHaveLength(2);
    expect(marks().every((m) => m.style.display === 'block')).toBe(true);
  });

  it('moves an existing mark instead of adding one when the owner retargets', () => {
    const h = new Highlighter();
    h.mark(p1, document.querySelector('#a')!);
    h.mark(p1, document.querySelector('#b')!);
    expect(marks()).toHaveLength(1);
  });

  it('removes the mark on unmark and hides it once the element is gone', () => {
    const h = new Highlighter();
    const a = document.querySelector('#a')!;
    h.mark(p1, a);
    h.mark(p2, document.querySelector('#b')!);
    h.unmark(p2);
    expect(marks()).toHaveLength(1);
    a.remove();
    h.mark(p1, a);
    expect(marks()[0]!.style.display).toBe('none');
  });
});

describe('Highlighter status', () => {
  it('shows the picking hint in the current theme and hides it again', () => {
    const h = new Highlighter();
    h.setTheme('light');
    h.setStatus('Click an element');
    const status = root.querySelector<HTMLElement>('.status')!;
    expect([status.textContent, status.style.display, status.dataset.theme]).toEqual(['Click an element', 'block', 'light']);
    h.setTheme('dark');
    expect(status.dataset.theme).toBe('dark');
    h.setStatus(null);
    expect(status.style.display).toBe('none');
  });

  it('follows the hovered element with a size label', () => {
    const h = new Highlighter();
    h.highlight(document.querySelector('#a')!);
    expect(root.querySelector('.tag')!.textContent).toBe('section · 0×0');
    h.clearRing();
    expect(root.querySelector<HTMLElement>('.ring')!.style.display).toBe('none');
  });
});
