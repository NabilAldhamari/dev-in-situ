import { afterEach, describe, expect, it } from 'vitest';
import { componentHint, detectStack, hasHmr } from './detect.js';
import { ask, installProbe } from './probe.js';

const define = (target: object, key: string, value: unknown) =>
  Object.defineProperty(target, key, { value, enumerable: true, configurable: true });

afterEach(() => {
  document.head.innerHTML = '';
  document.body.innerHTML = '';
  for (const key of ['__NUXT__', 'jQuery', 'webpackHotUpdate_app']) delete (window as unknown as Record<string, unknown>)[key];
});

describe('component hints', () => {
  it('finds the nearest React component with its source', () => {
    document.body.innerHTML = '<div id="root"><button>Save</button></div>';
    const button = document.querySelector('button')!;
    define(button, '__reactFiber$abc', {
      type: 'button',
      return: { type: function SaveButton() {}, _debugSource: { fileName: '/src/SaveButton.tsx', lineNumber: 42 }, return: null },
    });
    expect(componentHint(button)).toEqual({ name: 'SaveButton', file: '/src/SaveButton.tsx', line: 42, framework: 'React' });
  });

  it('prefers displayName', () => {
    document.body.innerHTML = '<i>x</i>';
    const icon = document.querySelector('i')!;
    define(icon, '__reactFiber$x', { type: 'i', return: { elementType: { displayName: 'IconButton' }, return: null } });
    expect(componentHint(icon)?.name).toBe('IconButton');
  });

  it('reads Vue and Svelte metadata', () => {
    document.body.innerHTML = '<em>v</em><b>s</b>';
    define(document.querySelector('em')!, '__vueParentComponent', { type: { __name: 'PriceTag', __file: '/src/PriceTag.vue' } });
    define(document.querySelector('b')!, '__svelte_meta', { loc: { file: 'src/lib/Card.svelte', line: 3 } });
    expect(componentHint(document.querySelector('em')!)).toMatchObject({ name: 'PriceTag', framework: 'Vue' });
    expect(componentHint(document.querySelector('b')!)).toMatchObject({ name: 'Card', line: 3, framework: 'Svelte' });
  });

  it('names the Angular host component', () => {
    document.body.innerHTML = '<app-root ng-version="18"><app-card><p>x</p></app-card></app-root>';
    expect(componentHint(document.querySelector('p')!)?.name).toBe('app-card');
  });

  it('returns null for plain markup', () => {
    document.body.innerHTML = '<s>plain</s>';
    expect(componentHint(document.querySelector('s')!)).toBeNull();
  });
});

describe('stack detection', () => {
  it('detects frameworks from globals, markers and meta tags', () => {
    (window as unknown as Record<string, unknown>).__NUXT__ = {};
    (window as unknown as Record<string, unknown>).jQuery = () => {};
    document.head.innerHTML = '<meta name="generator" content="WordPress 6.5">';
    document.body.innerHTML = '<div class="card svelte-x1y2">x</div>';
    const stack = detectStack(window);
    expect(stack).toEqual(expect.arrayContaining(['Nuxt', 'Vue', 'jQuery', 'Svelte', 'WordPress']));
    expect(hasHmr(window)).toBe(false);
  });

  it('detects React from fibers and HMR from Vite and webpack', () => {
    document.body.innerHTML = '<div id="root"><p>x</p></div>';
    define(document.getElementById('root')!, '__reactContainer$1', {});
    document.head.innerHTML = '<script type="module" src="/@vite/client"></script>';
    expect(detectStack(window)).toEqual(expect.arrayContaining(['React', 'Vite']));
    document.head.innerHTML = '';
    expect(hasHmr(window)).toBe(false);
    (window as unknown as Record<string, unknown>).webpackHotUpdate_app = () => {};
    expect(hasHmr(window)).toBe(true);
  });
});

describe('probe bridge', () => {
  it('answers page and component questions synchronously', () => {
    installProbe(window);
    document.body.innerHTML = '<em>v</em>';
    const em = document.querySelector('em')!;
    define(em, '__vueParentComponent', { type: { name: 'Tag' } });
    expect(ask<{ name: string }>('component', em)?.name).toBe('Tag');
    expect(em.hasAttribute('data-dev-in-situ-target')).toBe(false);
    expect(ask<{ stack: string[] }>('page')?.stack).toContain('Vue');
  });
});
