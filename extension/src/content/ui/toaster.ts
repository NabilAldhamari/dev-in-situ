import type { Theme } from '../../shared/types.js';
import { applyHostBarrier } from './host-barrier.js';

export type ToastKind = 'success' | 'error' | 'info';

export interface ToastAction {
  label: string;
  run(): void;
}

export const TOASTER_CSS = `
:host { all: initial; direction: ltr; }
.stack { position: fixed; top: 16px; right: 16px; display: flex; flex-direction: column; gap: 8px; align-items: flex-end; pointer-events: none; max-width: min(380px, calc(100vw - 32px)); }
.toast {
  --bg: rgba(30, 32, 38, 0.78); --text: #ececf1; --line: rgba(255, 255, 255, 0.14);
  pointer-events: auto; display: flex; align-items: flex-start; gap: 10px; padding: 10px 12px; border-radius: 14px;
  font: 500 13px/1.45 ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; color: var(--text);
  background: var(--bg); border: 1px solid var(--line); box-shadow: 0 12px 32px rgba(0, 0, 0, 0.22);
  backdrop-filter: blur(20px) saturate(180%); -webkit-backdrop-filter: blur(20px) saturate(180%);
  animation: in 160ms ease-out;
}
.toast[data-theme='light'] { --bg: rgba(255, 255, 255, 0.8); --text: #1f2328; --line: rgba(0, 0, 0, 0.1); }
.icon { flex: none; width: 18px; height: 18px; border-radius: 50%; display: grid; place-items: center; font-size: 11px; font-weight: 700; color: #fff; margin-top: 1px; }
.toast[data-kind='success'] .icon { background: #22a06b; }
.toast[data-kind='error'] .icon { background: #e5484d; }
.toast[data-kind='info'] .icon { background: #5b8def; }
.text { flex: 1; min-width: 0; word-break: break-word; white-space: pre-wrap; }
button { font: inherit; color: inherit; cursor: pointer; background: transparent; border: 0; padding: 0 2px; opacity: 0.7; }
button:hover { opacity: 1; }
.action { text-decoration: underline; opacity: 1; font-weight: 600; }
@keyframes in { from { opacity: 0; transform: translateY(-6px); } }
`;

const ICONS: Record<ToastKind, string> = { success: '✓', error: '!', info: 'i' };

export class Toaster {
  private host: HTMLElement | null = null;
  private stack: HTMLElement | null = null;
  private theme: Theme = 'dark';

  constructor(private readonly durationMs = 5000) {}

  setTheme(theme: Theme): void {
    this.theme = theme;
    for (const toast of this.toasts()) toast.dataset.theme = theme;
  }

  private mount(): HTMLElement {
    if (this.stack && this.host?.isConnected) return this.stack;
    const host = document.createElement('dev-in-situ-toasts');
    applyHostBarrier(host, { position: 'fixed', top: '0', left: '0', width: '0', height: '0', 'z-index': '2147483647', display: 'block' });
    const root = host.attachShadow({ mode: 'closed' });
    const style = document.createElement('style');
    style.textContent = TOASTER_CSS;
    const stack = document.createElement('div');
    stack.className = 'stack';
    root.append(style, stack);
    for (const type of ['click', 'mousedown', 'mouseup', 'pointerdown', 'pointerup']) host.addEventListener(type, (e) => e.stopPropagation());
    (document.body ?? document.documentElement).append(host);
    this.host = host;
    this.stack = stack;
    return stack;
  }

  show(kind: ToastKind, text: string, action?: ToastAction): HTMLElement {
    const stack = this.mount();
    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.dataset.kind = kind;
    toast.dataset.theme = this.theme;
    toast.setAttribute('role', kind === 'error' ? 'alert' : 'status');
    const icon = Object.assign(document.createElement('span'), { className: 'icon', textContent: ICONS[kind] });
    const body = Object.assign(document.createElement('span'), { className: 'text', textContent: text });
    toast.append(icon, body);
    if (action) {
      const button = Object.assign(document.createElement('button'), { className: 'action', textContent: action.label });
      button.addEventListener('click', () => {
        action.run();
        toast.remove();
      });
      toast.append(button);
    }
    const close = Object.assign(document.createElement('button'), { className: 'close', textContent: '✕', title: 'Dismiss' });
    close.addEventListener('click', () => toast.remove());
    toast.append(close);
    stack.append(toast);
    // Errors stay longer so they can be read; anything with an action waits for the user.
    if (!action) setTimeout(() => toast.remove(), kind === 'error' ? this.durationMs * 2 : this.durationMs);
    return toast;
  }

  toasts(): HTMLElement[] {
    return this.stack ? Array.from(this.stack.children as HTMLCollectionOf<HTMLElement>) : [];
  }

  destroy(): void {
    this.host?.remove();
    this.host = null;
    this.stack = null;
  }
}
