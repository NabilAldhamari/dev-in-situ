import type { ComponentHint, PageInfo } from '../shared/types.js';

type Bag = Record<string, unknown>;

const GLOBALS: [string, string][] = [
  ['__NEXT_DATA__', 'Next.js'],
  ['__NUXT__', 'Nuxt'],
  ['__remixContext', 'Remix'],
  ['___gatsby', 'Gatsby'],
  ['__sveltekit_dev', 'SvelteKit'],
  ['jQuery', 'jQuery'],
  ['Alpine', 'Alpine.js'],
  ['htmx', 'htmx'],
  ['Ember', 'Ember'],
  ['litElementVersions', 'Lit'],
  ['Stimulus', 'Stimulus'],
  ['Livewire', 'Livewire'],
  ['Turbo', 'Turbo'],
  ['preact', 'Preact'],
  ['angular', 'AngularJS'],
];

const SELECTORS: [string, string][] = [
  ['[ng-version]', 'Angular'],
  ['[data-reactroot]', 'React'],
  ['[data-v-app], [data-server-rendered]', 'Vue'],
  ['[class*="svelte-"]', 'Svelte'],
  ['astro-island', 'Astro'],
  ['[q\\:container]', 'Qwik'],
  ['[data-hk]', 'Solid'],
  ['[x-data]', 'Alpine.js'],
  ['[hx-get], [hx-post]', 'htmx'],
  ['[wire\\:id]', 'Livewire'],
];

function hasKey(el: Element | null, prefix: string): boolean {
  return Boolean(el) && Object.keys(el as object).some((k) => k.startsWith(prefix));
}

function sampleElements(doc: Document): Element[] {
  const root = doc.getElementById('root') ?? doc.getElementById('app') ?? doc.getElementById('__next') ?? doc.body;
  return [root, root?.firstElementChild ?? null, ...Array.from(doc.body?.querySelectorAll('*') ?? []).slice(0, 200)].filter(
    (el): el is Element => Boolean(el),
  );
}

export function detectStack(win: Window, doc: Document = win.document): string[] {
  const found = new Set<string>();
  const g = win as unknown as Bag;
  const sample = sampleElements(doc);
  if (g.__REACT_DEVTOOLS_GLOBAL_HOOK__ && (g.__REACT_DEVTOOLS_GLOBAL_HOOK__ as Bag).renderers instanceof Map && ((g.__REACT_DEVTOOLS_GLOBAL_HOOK__ as Bag).renderers as Map<unknown, unknown>).size) found.add('React');
  if (sample.some((el) => hasKey(el, '__reactFiber$') || hasKey(el, '__reactContainer$') || hasKey(el, '_reactRootContainer'))) found.add('React');
  if (g.__VUE__ || sample.some((el) => hasKey(el, '__vue_app__') || hasKey(el, '__vue__') || hasKey(el, '__vueParentComponent'))) found.add('Vue');
  if (sample.some((el) => hasKey(el, '__svelte_meta') || hasKey(el, '__svelte'))) found.add('Svelte');
  if (sample.some((el) => hasKey(el, '__k') && hasKey(el, '__P'))) found.add('Preact');
  for (const [key, name] of GLOBALS) if (g[key] !== undefined) found.add(name);
  for (const [selector, name] of SELECTORS) {
    try {
      if (doc.querySelector(selector)) found.add(name);
    } catch {}
  }
  if (doc.querySelector('script[src*="/_next/"]')) found.add('Next.js');
  if (found.has('Next.js') || found.has('Remix') || found.has('Gatsby')) found.add('React');
  if (found.has('Nuxt')) found.add('Vue');
  if (found.has('SvelteKit')) found.add('Svelte');
  const generator = doc.querySelector('meta[name="generator"]')?.getAttribute('content')?.split(/\s/)[0];
  if (generator) found.add(generator);
  if (hasHmr(win, doc)) found.add(viteLike(doc) ? 'Vite' : 'HMR');
  return [...found];
}

function viteLike(doc: Document): boolean {
  return Boolean(doc.querySelector('script[src*="@vite/client"]'));
}

export function hasHmr(win: Window, doc: Document = win.document): boolean {
  const g = win as unknown as Bag;
  if (viteLike(doc)) return true;
  if (Object.keys(g).some((k) => k.startsWith('webpackHotUpdate'))) return true;
  if (g.__NEXT_HMR_CB !== undefined || g.__webpack_hmr !== undefined || g.__vite_plugin_react_preamble_installed__ !== undefined) return true;
  if (doc.querySelector('script[src*="/_next/static/chunks/webpack.js"],script[src*="react-refresh"], script[src*="turbopack"]')) return true;
  if (g.LiveReload !== undefined || doc.querySelector('script[src*="livereload"], script[src*="browser-sync"]')) return true;
  return false;
}

interface Fiber {
  type?: unknown;
  elementType?: unknown;
  return?: Fiber | null;
  _debugSource?: { fileName?: string; lineNumber?: number };
  _debugOwner?: Fiber | null;
}

const nameOf = (type: unknown): string | null => {
  if (!type || typeof type === 'string') return null;
  const t = type as { displayName?: string; name?: string; render?: { name?: string } };
  return t.displayName || t.name || t.render?.name || null;
};

function reactHint(el: Element): ComponentHint | null {
  const key = Object.keys(el).find((k) => k.startsWith('__reactFiber$') || k.startsWith('__reactInternalInstance$'));
  if (!key) return null;
  let fiber = (el as unknown as Bag)[key] as Fiber | null;
  for (let depth = 0; fiber && depth < 30; depth += 1, fiber = fiber.return ?? null) {
    const name = nameOf(fiber.elementType ?? fiber.type);
    if (!name) continue;
    const source = fiber._debugSource ?? fiber._debugOwner?._debugSource;
    return { name, file: source?.fileName ?? null, line: source?.lineNumber ?? null, framework: 'React' };
  }
  return null;
}

function vueHint(el: Element): ComponentHint | null {
  const node = el as unknown as Bag;
  const instance = (node.__vueParentComponent ?? node.__vue__) as Bag | undefined;
  if (!instance) return null;
  const type = (instance.type ?? instance.$options) as Bag | undefined;
  const name = (type?.__name ?? type?.name ?? null) as string | null;
  return name ? { name, file: (type?.__file as string) ?? null, line: null, framework: 'Vue' } : null;
}

function svelteHint(el: Element): ComponentHint | null {
  const meta = (el as unknown as Bag).__svelte_meta as { loc?: { file?: string; line?: number } } | undefined;
  const file = meta?.loc?.file;
  if (!file) return null;
  return { name: file.split('/').pop()?.replace(/\.svelte$/, '') ?? null, file, line: meta.loc?.line ?? null, framework: 'Svelte' };
}

export function componentHint(el: Element): ComponentHint | null {
  let cursor: Element | null = el;
  for (let depth = 0; cursor && depth < 6; depth += 1, cursor = cursor.parentElement) {
    const hint = reactHint(cursor) ?? vueHint(cursor) ?? svelteHint(cursor);
    if (hint) return hint;
  }
  if (!el.closest('[ng-version]')) return null;
  for (cursor = el; cursor; cursor = cursor.parentElement) {
    if (cursor.tagName.includes('-')) return { name: cursor.tagName.toLowerCase(), file: null, line: null, framework: 'Angular' };
  }
  return null;
}

export function pageInfo(win: Window): PageInfo {
  return { stack: detectStack(win), hmr: hasHmr(win) };
}
