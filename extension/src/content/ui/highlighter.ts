import { applyHostBarrier } from './host-barrier.js';

const HIGHLIGHTER_ID = 'dev-in-situ-highlighter';

export const HIGHLIGHTER_CSS = `
:host { all: initial; direction: ltr; }
.ring {
  position: fixed;
  box-sizing: border-box;
  border: 2px solid #7aa2f7;
  border-radius: 3px;
  background: rgba(122, 162, 247, 0.12);
  box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.35);
  pointer-events: none;
  display: none;
}
.mark {
  position: fixed;
  box-sizing: border-box;
  border: 2px solid #7aa2f7;
  border-radius: 3px;
  background: rgba(122, 162, 247, 0.08);
  box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.35), 0 0 0 4px rgba(122, 162, 247, 0.25);
  pointer-events: none;
}
.tag {
  position: fixed;
  font: 600 11px/1.4 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  color: #0b0d10;
  background: #7aa2f7;
  padding: 2px 6px;
  border-radius: 4px;
  white-space: nowrap;
  pointer-events: none;
  max-width: 60vw;
  overflow: hidden;
  text-overflow: ellipsis;
  display: none;
}
.status {
  position: fixed;
  left: 50%;
  bottom: 16px;
  transform: translateX(-50%);
  font: 500 12px/1.4 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
  color: #e6e8ec;
  background: rgba(20, 22, 26, 0.94);
  border: 1px solid #3b424e;
  padding: 6px 12px;
  border-radius: 999px;
  white-space: nowrap;
  pointer-events: none;
  box-shadow: 0 6px 20px rgba(0, 0, 0, 0.4);
  backdrop-filter: blur(16px) saturate(180%);
  -webkit-backdrop-filter: blur(16px) saturate(180%);
  display: none;
}
.status[data-theme='light'] {
  color: #1f2328;
  background: rgba(255, 255, 255, 0.85);
  border-color: rgba(0, 0, 0, 0.12);
  box-shadow: 0 6px 20px rgba(0, 0, 0, 0.15);
}
`;

export class Highlighter {
  private host: HTMLElement | null = null;
  private root: ShadowRoot | null = null;
  private ring: HTMLElement | null = null;
  private tag: HTMLElement | null = null;
  private status: HTMLElement | null = null;
  private readonly marks = new Map<object, { el: Element; ring: HTMLElement }>();
  private theme: 'light' | 'dark' = 'dark';
  private frame = 0;
  private readonly schedule = (): void => {
    if (this.frame) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      this.positionMarks();
    });
  };

  private mount(): void {
    if (this.host) return;
    const host = document.createElement('div');
    host.id = HIGHLIGHTER_ID;
    applyHostBarrier(host, {
      position: 'fixed',
      top: '0',
      left: '0',
      width: '0',
      height: '0',
      margin: '0',
      padding: '0',
      border: '0',
      'pointer-events': 'none',
      'z-index': '2147482999',
      display: 'block',
      visibility: 'visible',
      opacity: '1',
    });

    const root = host.attachShadow({ mode: 'closed' });
    const style = document.createElement('style');
    style.textContent = HIGHLIGHTER_CSS;
    const ring = document.createElement('div');
    ring.className = 'ring';
    const tag = document.createElement('div');
    tag.className = 'tag';
    const status = document.createElement('div');
    status.className = 'status';
    root.append(style, ring, tag, status);
    this.root = root;

    (document.body ?? document.documentElement).append(host);
    this.host = host;
    this.ring = ring;
    this.tag = tag;
    this.status = status;
  }

  setTheme(theme: 'light' | 'dark'): void {
    this.theme = theme;
    if (this.status) this.status.dataset.theme = theme;
  }

  highlight(el: Element, label?: string): void {
    this.mount();
    const rect = el.getBoundingClientRect();
    const ring = this.ring as HTMLElement;
    ring.style.display = 'block';
    ring.style.top = `${rect.top}px`;
    ring.style.left = `${rect.left}px`;
    ring.style.width = `${rect.width}px`;
    ring.style.height = `${rect.height}px`;

    const tag = this.tag as HTMLElement;
    const text =
      label ??
      `${el.tagName.toLowerCase()} · ${Math.round(rect.width)}×${Math.round(rect.height)}`;
    tag.textContent = text;
    tag.style.display = 'block';
    const above = rect.top >= 22;
    tag.style.top = above ? `${rect.top - 21}px` : `${rect.bottom + 4}px`;
    tag.style.left = `${Math.max(2, rect.left)}px`;
  }

  clearRing(): void {
    if (this.ring) this.ring.style.display = 'none';
    if (this.tag) this.tag.style.display = 'none';
  }

  setStatus(text: string | null): void {
    if (!text) {
      if (this.status) this.status.style.display = 'none';
      return;
    }
    this.mount();
    const status = this.status as HTMLElement;
    status.dataset.theme = this.theme;
    status.textContent = text;
    status.style.display = 'block';
  }

  /** Keeps `el` outlined for as long as `owner` (usually a popover) wants it, following scroll and resize. */
  mark(owner: object, el: Element): void {
    this.mount();
    let entry = this.marks.get(owner);
    if (!entry) {
      const ring = document.createElement('div');
      ring.className = 'mark';
      this.root?.append(ring);
      entry = { el, ring };
      this.marks.set(owner, entry);
    }
    entry.el = el;
    if (this.marks.size === 1) {
      window.addEventListener('scroll', this.schedule, true);
      window.addEventListener('resize', this.schedule);
    }
    this.positionMarks();
  }

  unmark(owner: object): void {
    const entry = this.marks.get(owner);
    if (!entry) return;
    entry.ring.remove();
    this.marks.delete(owner);
    if (this.marks.size === 0) {
      window.removeEventListener('scroll', this.schedule, true);
      window.removeEventListener('resize', this.schedule);
    }
  }

  private positionMarks(): void {
    for (const { el, ring } of this.marks.values()) {
      if (!el.isConnected) {
        ring.style.display = 'none';
        continue;
      }
      const rect = el.getBoundingClientRect();
      ring.style.display = 'block';
      ring.style.top = `${rect.top}px`;
      ring.style.left = `${rect.left}px`;
      ring.style.width = `${rect.width}px`;
      ring.style.height = `${rect.height}px`;
    }
  }

  destroy(): void {
    for (const owner of [...this.marks.keys()]) this.unmark(owner);
    this.host?.remove();
    this.host = null;
    this.root = null;
    this.ring = null;
    this.tag = null;
    this.status = null;
  }

  owns(node: EventTarget | null): boolean {
    return node instanceof Node && this.host !== null && this.host.contains(node);
  }
}
