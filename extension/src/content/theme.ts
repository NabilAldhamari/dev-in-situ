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

/** The theme the page itself paints, from the first mostly opaque background of body or html. */
export function siteTheme(doc: Document, win: Window): Theme | null {
  for (const el of [doc.body, doc.documentElement]) {
    if (!el) continue;
    const color = parseColor(win.getComputedStyle(el).backgroundColor);
    if (color && color[3] >= 0.5) return luminance(color) < 0.4 ? 'dark' : 'light';
  }
  return null;
}

export function systemTheme(win: Window): Theme {
  return win.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

/** An explicit preference wins, then the site's own colors, then the operating system. */
export function detectTheme(doc: Document, win: Window, preference: ThemePreference = 'auto'): Theme {
  if (preference !== 'auto') return preference;
  return siteTheme(doc, win) ?? systemTheme(win);
}
