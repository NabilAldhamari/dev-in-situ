import type { Theme, ThemePreference } from '../shared/types.js';

export type Rgba = [number, number, number, number];

/** Parses the `rgb()`/`rgba()` strings that getComputedStyle returns. */
export function parseColor(value: string | null | undefined): Rgba | null {
  const match = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:[\s,/]+([\d.]+%?))?\s*\)$/i.exec((value ?? '').trim());
  if (!match) return null;
  const alphaRaw = match[4];
  const alpha = alphaRaw === undefined ? 1 : alphaRaw.endsWith('%') ? Number.parseFloat(alphaRaw) / 100 : Number(alphaRaw);
  return [Number(match[1]), Number(match[2]), Number(match[3]), alpha];
}

/** Relative luminance (WCAG) of an sRGB color, 0 = black, 1 = white. */
export function luminance([r, g, b]: Rgba): number {
  const channel = (v: number) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

let probe: CanvasRenderingContext2D | null | undefined;

/** Converts any CSS color (oklch(), lab(), color(), named…) to rgba by painting it, when canvas is available. */
export function toRgba(value: string, doc: Document = document): Rgba | null {
  const direct = parseColor(value);
  if (direct) return direct;
  if (probe === undefined) {
    try {
      const canvas = doc.createElement('canvas');
      canvas.width = canvas.height = 1;
      probe = canvas.getContext('2d', { willReadFrequently: true });
    } catch {
      probe = null;
    }
  }
  if (!probe) return null;
  probe.clearRect(0, 0, 1, 1);
  probe.fillStyle = 'rgba(0, 0, 0, 0)';
  probe.fillStyle = value;
  probe.fillRect(0, 0, 1, 1);
  const [r, g, b, a] = probe.getImageData(0, 0, 1, 1).data;
  return [r ?? 0, g ?? 0, b ?? 0, (a ?? 0) / 255];
}

/**
 * The theme the page itself paints: the first mostly opaque background of body or html.
 * With no background at all, the browser's canvas shows, which is light unless the page opts into dark.
 * Returns null when the page leaves it to the system (`color-scheme: light dark`).
 */
export function siteTheme(doc: Document, win: Window): Theme | null {
  for (const el of [doc.body, doc.documentElement]) {
    if (!el) continue;
    const color = toRgba(win.getComputedStyle(el).backgroundColor, doc);
    if (color && color[3] >= 0.5) return luminance(color) < 0.4 ? 'dark' : 'light';
  }
  const scheme = win.getComputedStyle(doc.documentElement).colorScheme ?? '';
  const dark = /\bdark\b/.test(scheme);
  const light = /\blight\b/.test(scheme);
  if (dark && light) return null;
  return dark ? 'dark' : 'light';
}

export function systemTheme(win: Window): Theme {
  return win.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

/** An explicit preference wins, then the site's own colors, then the operating system. */
export function detectTheme(doc: Document, win: Window, preference: ThemePreference = 'auto'): Theme {
  if (preference !== 'auto') return preference;
  return siteTheme(doc, win) ?? systemTheme(win);
}
