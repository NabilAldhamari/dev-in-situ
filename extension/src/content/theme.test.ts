import { afterEach, describe, expect, it } from 'vitest';
import { detectTheme, luminance, parseColor, siteTheme, systemTheme } from './theme.js';

const fakeWindow = (dark: boolean) => ({ matchMedia: () => ({ matches: dark }), getComputedStyle: window.getComputedStyle.bind(window) }) as unknown as Window;

afterEach(() => {
  document.body.removeAttribute('style');
  document.documentElement.removeAttribute('style');
});

describe('parseColor', () => {
  it('reads rgb, rgba and modern space-separated colors', () => {
    expect(parseColor('rgb(1, 2, 3)')).toEqual([1, 2, 3, 1]);
    expect(parseColor('rgba(1, 2, 3, 0.5)')).toEqual([1, 2, 3, 0.5]);
    expect(parseColor('rgb(1 2 3 / 40%)')).toEqual([1, 2, 3, 0.4]);
    expect(parseColor('transparent')).toBeNull();
    expect(parseColor(undefined)).toBeNull();
  });
});

describe('luminance', () => {
  it('is 0 for black and 1 for white', () => {
    expect(luminance([0, 0, 0, 1])).toBe(0);
    expect(luminance([255, 255, 255, 1])).toBeCloseTo(1);
  });
});

describe('detectTheme', () => {
  it('uses the site background when it is opaque', () => {
    document.body.style.backgroundColor = 'rgb(18, 18, 18)';
    expect(siteTheme(document, window)).toBe('dark');
    document.body.style.backgroundColor = 'rgb(250, 250, 250)';
    expect(siteTheme(document, window)).toBe('light');
  });

  it('falls back to the html background, then the system preference', () => {
    document.body.style.backgroundColor = 'rgba(0, 0, 0, 0)';
    document.documentElement.style.backgroundColor = 'rgb(0, 0, 0)';
    expect(detectTheme(document, fakeWindow(false))).toBe('dark');
    document.documentElement.style.backgroundColor = 'transparent';
    expect(detectTheme(document, fakeWindow(true))).toBe('dark');
    expect(detectTheme(document, fakeWindow(false))).toBe('light');
  });

  it('lets an explicit preference win', () => {
    document.body.style.backgroundColor = 'rgb(0, 0, 0)';
    expect(detectTheme(document, fakeWindow(true), 'light')).toBe('light');
    expect(detectTheme(document, fakeWindow(false), 'dark')).toBe('dark');
  });

  it('treats a missing matchMedia as light', () => {
    expect(systemTheme({} as Window)).toBe('light');
  });
});
