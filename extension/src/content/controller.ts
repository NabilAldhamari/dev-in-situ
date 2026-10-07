import { type ComponentHint, DEFAULT_SETTINGS, type PageInfo, type Settings, type Target } from '../shared/types.js';
import { RefreshWatcher } from './refresh.js';
import { buildSelector, elementKey, targetHtml } from './selector.js';
import { detectTheme } from './theme.js';
import { Highlighter } from './ui/highlighter.js';
import { type Bridge, Panel, type Snapshot } from './ui/panel.js';
import { Toaster } from './ui/toaster.js';

export const RESTORE = 'dev-in-situ:restore';

export interface ControllerDeps {
  bridge: Bridge;
  loadSettings(): Promise<Settings | null>;
  notify(title: string, message: string): void;
  /** Asks the page's main world for stack or component info. */
  ask<T>(kind: 'page' | 'component', target?: Element): T | null;
  /** How long after Ctrl/⌘ is released the pick finishes, so a quick scroll or re-press can continue it. */
  releaseGraceMs?: number;
}

/** The most elements one chat can be about; the daemon accepts the same number. */
export const MAX_SELECTION = 20;

const isModifier = (key: string) => key === 'Control' || key === 'Meta';

const elementAt = (x: number, y: number): Element | null =>
  typeof document.elementFromPoint === 'function' ? document.elementFromPoint(x, y) : null;

/** Picks elements, owns the single chat bar, and keeps the selection outlined while the bar is open. */
export class Controller {
  readonly highlighter = new Highlighter();
  readonly toaster = new Toaster();
  panel: Panel | null = null;
  /** The elements the chat bar is about. */
  group: Element[] = [];
  /** Elements collected during the current pick, committed when picking finishes. */
  pending: Element[] = [];
  picking = false;
  private multi = false;
  private wasMinimized = false;
  private finishTimer: ReturnType<typeof setTimeout> | null = null;
  private opening: Promise<Panel> | null = null;
  private themeTimer: ReturnType<typeof setTimeout> | null = null;
  private hovered: Element | null = null;
  private point: { x: number; y: number } | null = null;
  private frame = 0;
  private readonly marked = new Set<Element>();
  private settings: Settings | null = null;
  private page: PageInfo | null = null;
  private readonly media = typeof window.matchMedia === 'function' ? window.matchMedia('(prefers-color-scheme: dark)') : null;
  readonly refresher: RefreshWatcher;

  constructor(private readonly deps: ControllerDeps) {
    this.refresher = new RefreshWatcher({
      poll: async () => {
        const project = await deps.bridge.api<{ path: string | null }>(`/project?origin=${encodeURIComponent(location.origin)}`);
        if (!project.ok || !project.data.path) return null;
        const res = await deps.bridge.api<{ stamp: number | null }>(`/workspace/stamp?path=${encodeURIComponent(project.data.path)}`);
        return res.ok ? res.data.stamp : null;
      },
      canReload: () => !this.panel?.busy,
      reload: () => {
        const snapshot = this.panel?.snapshot();
        try {
          sessionStorage.setItem(RESTORE, JSON.stringify(snapshot ? [snapshot] : []));
        } catch {}
        location.reload();
      },
    });
    this.media?.addEventListener?.('change', () => this.applyTheme());
    // Sites that switch their own dark mode usually do it with a class or attribute on html or body.
    if (typeof MutationObserver === 'function') {
      const observer = new MutationObserver(() => {
        if (this.themeTimer) return;
        this.themeTimer = setTimeout(() => {
          this.themeTimer = null;
          this.applyTheme();
        }, 150);
      });
      const options = { attributes: true, attributeFilter: ['class', 'style', 'data-theme', 'data-mode', 'data-color-mode', 'data-bs-theme'] };
      observer.observe(document.documentElement, options);
      if (document.body) observer.observe(document.body, options);
    }
  }

  async init(): Promise<void> {
    this.settings = await this.deps.loadSettings().catch(() => null);
    setTimeout(() => this.syncRefresh(), 1500);
    await this.restore();
  }

  setSettings(settings: Settings): void {
    this.settings = settings;
    this.syncRefresh();
    this.applyTheme();
  }

  private detect(): PageInfo | null {
    this.page = this.deps.ask<PageInfo>('page') ?? this.page;
    return this.page;
  }

  private syncRefresh(): void {
    const s = this.settings;
    const hmr = this.detect()?.hmr ?? false;
    const wanted = s && s.token && (s.refresh === 'always' || (s.refresh === 'auto' && !hmr));
    if (wanted && !this.refresher.running) this.refresher.start(s.refreshSeconds);
    if (!wanted) this.refresher.stop();
  }

  applyTheme(): void {
    const theme = detectTheme(document, window, this.settings?.theme ?? 'auto');
    this.panel?.setTheme(theme);
    this.toaster.setTheme(theme);
    this.highlighter.setTheme(theme);
  }

  toggle(): void {
    if (this.picking) return this.cancelPicking();
    this.startPicking(false);
  }

  /** Starts picking. With `add`, the current selection is kept and new clicks extend it. */
  startPicking(add: boolean): void {
    if (this.picking) return;
    this.pending = add ? [...this.group] : [];
    this.multi = false;
    this.wasMinimized = this.panel?.minimized ?? false;
    this.picking = true;
    this.applyTheme();
    this.panel?.setMinimized(true);
    this.setMarks(this.pending);
    this.updateStatus();
    document.documentElement.style.setProperty('cursor', 'crosshair', 'important');
    for (const [type, fn] of this.listeners) window.addEventListener(type, fn, { capture: true, passive: false });
  }

  private stopPicking(): void {
    this.picking = false;
    this.multi = false;
    this.clearFinishTimer();
    this.hovered = null;
    this.point = null;
    if (this.frame && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(this.frame);
    this.frame = 0;
    this.highlighter.clearRing();
    this.highlighter.setStatus(null);
    document.documentElement.style.removeProperty('cursor');
    for (const [type, fn] of this.listeners) window.removeEventListener(type, fn, { capture: true });
  }

  cancelPicking(): void {
    if (!this.picking) return;
    this.pending = [];
    this.stopPicking();
    this.restorePanel();
  }

  /** Puts the chat bar and its outlines back the way they were before picking started. */
  private restorePanel(): void {
    const panel = this.panel;
    if (!panel) return this.setMarks([]);
    if (this.wasMinimized) {
      panel.setMinimized(true);
      return this.setMarks([]);
    }
    panel.setMinimized(false);
    this.resolveGroup();
    this.setMarks(this.group);
  }

  private clearFinishTimer(): void {
    if (this.finishTimer) clearTimeout(this.finishTimer);
    this.finishTimer = null;
  }

  /** Commits the picked elements as the selection and opens the chat bar for them. */
  async finishPicking(): Promise<void> {
    if (!this.picking) return;
    const picked = this.pending.filter((el) => el.isConnected);
    this.pending = [];
    this.stopPicking();
    if (!picked.length) return this.restorePanel();
    this.group = picked;
    await this.showPanel();
  }

  private updateStatus(): void {
    const n = this.pending.length;
    const mod = /mac/i.test(navigator.platform) ? '⌘' : 'Ctrl';
    this.highlighter.setStatus(
      n ? `${n} selected · release ${mod} or press Enter to finish · Esc to cancel` : `Click an element · hold ${mod} to select several · Esc to cancel`,
    );
  }

  private owns(node: EventTarget | null): boolean {
    if (!(node instanceof Element)) return false;
    return node.tagName === 'DEV-IN-SITU-PANEL' || node.tagName === 'DEV-IN-SITU-TOASTS' || this.highlighter.owns(node);
  }

  /** Re-reads the element under the last pointer position; also runs on scroll so the outline never sticks. */
  private refreshHover(): void {
    this.frame = 0;
    if (!this.picking || !this.point) return;
    const el = elementAt(this.point.x, this.point.y);
    if (!el || this.owns(el)) {
      this.hovered = null;
      this.highlighter.clearRing();
      return;
    }
    this.hovered = el;
    this.highlighter.highlight(el);
  }

  private scheduleHover(): void {
    if (this.frame) return;
    this.frame = typeof requestAnimationFrame === 'function' ? requestAnimationFrame(() => this.refreshHover()) : (setTimeout(() => this.refreshHover(), 16) as unknown as number);
  }

  private onScrollbar(e: MouseEvent): boolean {
    const root = document.documentElement;
    return e.target === root && (e.clientX >= root.clientWidth || e.clientY >= root.clientHeight);
  }

  /** Adds `el` to the pick, or removes it if it is already there. Returns false when the selection is full. */
  private togglePending(el: Element): boolean {
    const index = this.pending.indexOf(el);
    if (index >= 0) this.pending.splice(index, 1);
    else if (this.pending.length >= MAX_SELECTION) {
      this.toaster.show('info', `You can select up to ${MAX_SELECTION} elements at once.`);
      return false;
    } else this.pending.push(el);
    this.setMarks(this.pending);
    this.updateStatus();
    return true;
  }

  private elementForEvent(m: MouseEvent): Element | null {
    const under = m.clientX || m.clientY ? elementAt(m.clientX, m.clientY) : null;
    const el = under && !this.owns(under) ? under : (this.hovered ?? (m.target as Element));
    return el instanceof Element && !this.owns(el) ? el : null;
  }

  private readonly listeners: [string, (e: Event) => void][] = [
    [
      'pointermove',
      (e) => {
        const m = e as PointerEvent;
        this.point = { x: m.clientX, y: m.clientY };
        this.refreshHover();
      },
    ],
    [
      'scroll',
      () => {
        // Scrolling right after letting go of Ctrl/⌘ means the user is looking for more elements.
        this.clearFinishTimer();
        this.scheduleHover();
      },
    ],
    [
      'contextmenu',
      (e) => {
        const m = e as MouseEvent;
        if (this.owns(m.target)) return;
        m.preventDefault();
        m.stopPropagation();
        // On a Mac, Ctrl+click opens the context menu instead of clicking.
        const el = m.ctrlKey ? this.elementForEvent(m) : null;
        if (!el) return;
        this.multi = true;
        this.clearFinishTimer();
        this.togglePending(el);
      },
    ],
    ...(['mousedown', 'mouseup', 'pointerdown', 'pointerup'] as const).map(
      (type) =>
        [
          type,
          (e: Event) => {
            if (this.owns(e.target) || this.onScrollbar(e as MouseEvent)) return;
            e.preventDefault();
            e.stopPropagation();
          },
        ] as [string, (e: Event) => void],
    ),
    [
      'click',
      (e) => {
        const m = e as MouseEvent;
        if (this.owns(m.target) || this.onScrollbar(m)) return;
        m.preventDefault();
        m.stopPropagation();
        const el = this.elementForEvent(m);
        if (!el) return;
        this.clearFinishTimer();
        if (m.ctrlKey || m.metaKey) {
          this.multi = true;
          this.togglePending(el);
          return;
        }
        if (!this.pending.includes(el) && !this.togglePending(el)) return;
        void this.finishPicking();
      },
    ],
    [
      'keydown',
      (e) => {
        const k = e as KeyboardEvent;
        if (isModifier(k.key)) this.clearFinishTimer();
        if (k.key === 'Escape') {
          k.preventDefault();
          k.stopPropagation();
          this.cancelPicking();
        } else if (k.key === 'Enter' && this.pending.length) {
          k.preventDefault();
          k.stopPropagation();
          void this.finishPicking();
        }
      },
    ],
    [
      'keyup',
      (e) => {
        const k = e as KeyboardEvent;
        if (!isModifier(k.key) || !this.multi || !this.pending.length) return;
        this.clearFinishTimer();
        this.finishTimer = setTimeout(() => void this.finishPicking(), this.deps.releaseGraceMs ?? 600);
      },
    ],
  ];

  /** Outlines exactly `elements`, removing every other outline. */
  setMarks(elements: Element[]): void {
    const wanted = new Set(elements);
    for (const el of [...this.marked]) {
      if (wanted.has(el)) continue;
      this.highlighter.unmark(el);
      this.marked.delete(el);
    }
    for (const el of wanted) {
      if (el === document.body || el === document.documentElement) continue;
      this.highlighter.mark(el, el);
      this.marked.add(el);
    }
  }

  get marks(): Element[] {
    return [...this.marked];
  }

  target(el: Element): Target {
    const rect = el.getBoundingClientRect();
    return {
      selector: buildSelector(el).selector,
      elementKey: elementKey(el),
      tagName: el.tagName,
      html: targetHtml(el),
      component: this.deps.ask<ComponentHint>('component', el),
      url: location.href,
      origin: location.origin,
      pathname: location.pathname,
      rect: { top: rect.top, left: rect.left, width: rect.width, height: rect.height },
    };
  }

  /** Swaps elements the page re-rendered for their current copies, found by selector. */
  private resolveGroup(): void {
    const targets = this.panel?.selection ?? [];
    this.group = this.group
      .map((el, i) => {
        if (el.isConnected) return el;
        try {
          return targets[i] ? document.querySelector(targets[i].selector) : null;
        } catch {
          return null;
        }
      })
      .filter((el): el is Element => el !== null);
  }

  private async showPanel(): Promise<Panel> {
    if (this.opening) {
      await this.opening;
      return this.showPanel();
    }
    const targets = this.group.map((el) => this.target(el));
    if (this.panel) {
      this.panel.setTargets(targets);
      this.panel.setMinimized(false);
      this.setMarks(this.group);
      return this.panel;
    }
    this.opening = this.createPanel(targets);
    try {
      return await this.opening;
    } finally {
      this.opening = null;
    }
  }

  private async createPanel(targets: Target[]): Promise<Panel> {
    this.settings = (await this.deps.loadSettings().catch(() => null)) ?? this.settings;
    const panel = new Panel(this.deps.bridge, {
      onClose: (p) => {
        p.close();
        if (this.panel === p) this.panel = null;
        this.group = [];
        this.setMarks([]);
      },
      onPick: () => this.startPicking(true),
      onMinimize: (_p, minimized) => {
        if (this.picking) {
          // Opening the bar from its pill while picking abandons the pick.
          if (!minimized) {
            this.pending = [];
            this.stopPicking();
            this.resolveGroup();
            this.setMarks(this.group);
          }
          return;
        }
        if (minimized) return this.setMarks([]);
        this.resolveGroup();
        this.setMarks(this.group);
      },
      onRemoveTarget: (p, index) => {
        this.group.splice(index, 1);
        p.setTargets(this.group.map((el) => this.target(el)));
        this.setMarks(p.minimized ? [] : this.group);
      },
      toast: (kind, text, action) => void this.toaster.show(kind, text, action),
      notify: (title, message) => this.deps.notify(title, message),
    });
    this.panel = panel;
    this.applyTheme();
    this.setMarks(this.group);
    await panel.open(targets, this.settings ?? DEFAULT_SETTINGS, this.detect());
    return panel;
  }

  private async restore(): Promise<void> {
    let snapshots: Snapshot[] = [];
    try {
      snapshots = JSON.parse(sessionStorage.getItem(RESTORE) ?? '[]') as Snapshot[];
      sessionStorage.removeItem(RESTORE);
    } catch {}
    const snapshot = snapshots[0];
    if (!snapshot || !Array.isArray(snapshot.selectors)) return;
    this.group = snapshot.selectors
      .map((selector) => {
        try {
          return document.querySelector(selector);
        } catch {
          return null;
        }
      })
      .filter((el): el is Element => el !== null);
    if (!this.group.length) this.group = [document.body];
    const panel = await this.showPanel();
    panel.restore(snapshot);
  }
}
