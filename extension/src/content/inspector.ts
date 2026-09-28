import { type ApiResult, DEFAULT_SETTINGS, type ComponentHint, type Message, type PageInfo, type Settings, STREAM_PORT, type StreamMessage, type Target } from '../shared/types.js';
import { ask } from './probe.js';
import { RefreshWatcher } from './refresh.js';
import { buildSelector, elementKey, targetHtml } from './selector.js';
import { Highlighter } from './ui/highlighter.js';
import { type Bridge, Panel, type Snapshot } from './ui/panel.js';

const RESTORE = 'dev-in-situ:restore';

const send = <T>(message: Message): Promise<T> => chrome.runtime.sendMessage(message) as Promise<T>;

const bridge: Bridge = {
  api: <T>(path: string, method: 'GET' | 'POST' | 'DELETE' = 'GET', body?: unknown) =>
    send<ApiResult<T>>({ type: 'api', method, path, body }).catch((err: Error) => ({ ok: false as const, status: 0, error: err.message })),
  stream(dispatchId, since, onMessage, onEnd) {
    let port: chrome.runtime.Port;
    try {
      port = chrome.runtime.connect({ name: STREAM_PORT });
    } catch {
      setTimeout(onEnd, 0);
      return () => {};
    }
    port.onMessage.addListener((m: StreamMessage) => onMessage(m));
    port.onDisconnect.addListener(onEnd);
    port.postMessage({ dispatchId, since });
    return () => port.disconnect();
  },
  saveSettings: (patch) => void send({ type: 'saveSettings', patch }).catch(() => {}),
  openOptions: () => void send({ type: 'openOptions' }).catch(() => {}),
};

class Inspector {
  private readonly highlighter = new Highlighter();
  private readonly panels = new Set<Panel>();
  private picking = false;
  private hovered: Element | null = null;
  private retargeting: Panel | null = null;
  private settings: Settings | null = null;
  private page: PageInfo | null = null;
  private readonly refresher = new RefreshWatcher({
    poll: async () => {
      const project = await bridge.api<{ path: string | null }>(`/project?origin=${encodeURIComponent(location.origin)}`);
      if (!project.ok || !project.data.path) return null;
      const res = await bridge.api<{ stamp: number | null }>(`/workspace/stamp?path=${encodeURIComponent(project.data.path)}`);
      return res.ok ? res.data.stamp : null;
    },
    canReload: () => [...this.panels].every((p) => !p.busy),
    reload: () => {
      const snapshots = [...this.panels].map((p) => p.snapshot()).filter(Boolean);
      try {
        sessionStorage.setItem(RESTORE, JSON.stringify(snapshots));
      } catch {}
      location.reload();
    },
  });

  async init(): Promise<void> {
    chrome.runtime.onMessage.addListener((message: Message) => {
      if (message.type === 'toggle') this.toggle();
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.picking) this.stopPicking();
    });
    this.settings = await send<Settings>({ type: 'settings' }).catch(() => null);
    chrome.storage.onChanged.addListener((changes) => {
      if (!changes.settings) return;
      this.settings = changes.settings.newValue as Settings;
      this.syncRefresh();
    });
    setTimeout(() => this.syncRefresh(), 1500);
    await this.restore();
  }

  private detect(): PageInfo | null {
    this.page = ask<PageInfo>('page') ?? this.page;
    return this.page;
  }

  private syncRefresh(): void {
    const s = this.settings;
    const hmr = this.detect()?.hmr ?? false;
    const wanted = s && s.token && (s.refresh === 'always' || (s.refresh === 'auto' && !hmr));
    if (wanted && !this.refresher.running) this.refresher.start(s.refreshSeconds);
    if (!wanted) this.refresher.stop();
  }

  toggle(): void {
    if (this.picking) return this.stopPicking();
    this.startPicking(null);
  }

  private startPicking(panel: Panel | null): void {
    this.retargeting = panel;
    this.picking = true;
    panel?.setMinimized(true);
    this.highlighter.setStatus('Click an element · Esc to cancel');
    document.documentElement.style.setProperty('cursor', 'crosshair', 'important');
    for (const [type, fn] of this.listeners) window.addEventListener(type, fn, true);
  }

  private stopPicking(): void {
    this.picking = false;
    this.hovered = null;
    this.highlighter.clearRing();
    this.highlighter.setStatus(null);
    document.documentElement.style.removeProperty('cursor');
    for (const [type, fn] of this.listeners) window.removeEventListener(type, fn, true);
    this.retargeting?.setMinimized(false);
    this.retargeting = null;
  }

  private owns(node: EventTarget | null): boolean {
    return node instanceof Element && (node.tagName === 'DEV-IN-SITU-PANEL' || this.highlighter.owns(node));
  }

  private readonly listeners: [string, (e: Event) => void][] = [
    [
      'mousemove',
      (e) => {
        const el = document.elementFromPoint((e as MouseEvent).clientX, (e as MouseEvent).clientY);
        if (!el || this.owns(el) || el === this.hovered) return;
        this.hovered = el;
        this.highlighter.highlight(el);
      },
    ],
    ...(['mousedown', 'mouseup', 'pointerdown', 'pointerup'] as const).map(
      (type) => [type, (e: Event) => !this.owns(e.target) && (e.preventDefault(), e.stopPropagation())] as [string, (e: Event) => void],
    ),
    [
      'click',
      (e) => {
        if (this.owns(e.target)) return;
        e.preventDefault();
        e.stopPropagation();
        const el = this.hovered ?? (e.target as Element);
        const panel = this.retargeting;
        this.retargeting = null;
        this.stopPicking();
        void this.select(el, panel);
      },
    ],
  ];

  private target(el: Element): Target {
    const rect = el.getBoundingClientRect();
    return {
      selector: buildSelector(el).selector,
      elementKey: elementKey(el),
      tagName: el.tagName,
      html: targetHtml(el),
      component: ask<ComponentHint>('component', el),
      url: location.href,
      origin: location.origin,
      pathname: location.pathname,
      rect: { top: rect.top, left: rect.left, width: rect.width, height: rect.height },
    };
  }

  private async restore(): Promise<void> {
    let snapshots: Snapshot[] = [];
    try {
      snapshots = JSON.parse(sessionStorage.getItem(RESTORE) ?? '[]') as Snapshot[];
      sessionStorage.removeItem(RESTORE);
    } catch {}
    for (const snapshot of snapshots) {
      let el: Element | null = null;
      try {
        el = document.querySelector(snapshot.selector);
      } catch {}
      const panel = await this.select(el ?? document.body, null);
      panel.restore(snapshot);
    }
  }

  private async select(el: Element, existing: Panel | null): Promise<Panel> {
    const target = this.target(el);
    const markable = el !== document.body && el !== document.documentElement;
    if (existing) {
      if (markable) this.highlighter.mark(existing, el);
      else this.highlighter.unmark(existing);
      existing.retarget(target);
      existing.setMinimized(false);
      return existing;
    }
    this.settings = await send<Settings>({ type: 'settings' }).catch(() => this.settings);
    const panel = new Panel(bridge, {
      onClose: (p) => {
        p.close();
        this.panels.delete(p);
        this.highlighter.unmark(p);
      },
      onPick: (p) => this.startPicking(p),
    });
    this.panels.add(panel);
    if (markable) this.highlighter.mark(panel, el);
    await panel.open(target, this.settings ?? DEFAULT_SETTINGS, this.detect(), this.panels.size - 1);
    return panel;
  }
}

void new Inspector().init();
