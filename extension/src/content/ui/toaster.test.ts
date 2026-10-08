import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { openShadowRoots, restoreShadowRoots } from '../../test/helpers.js';
import { Toaster } from './toaster.js';

beforeEach(() => {
  openShadowRoots();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  restoreShadowRoots();
  document.body.innerHTML = '';
});

describe('Toaster', () => {
  it('shows toasts by kind and theme, and dismisses them after a while', () => {
    const toaster = new Toaster(1000);
    toaster.setTheme('light');
    const ok = toaster.show('success', 'Saved');
    const bad = toaster.show('error', 'Broke');
    expect([ok.dataset.kind, ok.dataset.theme, ok.getAttribute('role')]).toEqual(['success', 'light', 'status']);
    expect(bad.getAttribute('role')).toBe('alert');
    vi.advanceTimersByTime(1001);
    expect(toaster.toasts()).toEqual([bad]);
    vi.advanceTimersByTime(1000);
    expect(toaster.toasts()).toEqual([]);
  });

  it('keeps toasts with an action until used, and runs the action', () => {
    const toaster = new Toaster(1000);
    const run = vi.fn();
    const toast = toaster.show('error', 'Wrong token', { label: 'Open settings', run });
    vi.advanceTimersByTime(10_000);
    expect(toaster.toasts()).toEqual([toast]);
    toast.querySelector<HTMLButtonElement>('.action')!.click();
    expect(run).toHaveBeenCalledOnce();
    expect(toaster.toasts()).toEqual([]);
  });

  it('can be dismissed, re-themed, and survives the page removing its host', () => {
    const toaster = new Toaster();
    const toast = toaster.show('info', 'Hi');
    toaster.setTheme('dark');
    expect(toast.dataset.theme).toBe('dark');
    toast.querySelector<HTMLButtonElement>('.close')!.click();
    expect(toaster.toasts()).toEqual([]);
    document.body.innerHTML = '';
    toaster.show('info', 'Again');
    expect(document.querySelector('dev-in-situ-toasts')).not.toBeNull();
  });

  it('does not let toast clicks reach the page', () => {
    const toaster = new Toaster();
    toaster.show('info', 'Hi');
    const onPage = vi.fn();
    document.addEventListener('click', onPage);
    document.querySelector('dev-in-situ-toasts')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(onPage).not.toHaveBeenCalled();
    document.removeEventListener('click', onPage);
  });
});
