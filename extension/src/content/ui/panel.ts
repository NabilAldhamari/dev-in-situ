import css from './panel.css?raw';
import { applyHostBarrier } from './host-barrier.js';
import type { ToastAction, ToastKind } from './toaster.js';
import type {
  ApiResult,
  ConfigResponse,
  DirListing,
  DispatchResponse,
  PageInfo,
  RunEvent,
  SessionInfo,
  Settings,
  StreamMessage,
  Target,
  Theme,
} from '../../shared/types.js';

export interface Bridge {
  api<T>(path: string, method?: 'GET' | 'POST' | 'DELETE', body?: unknown): Promise<ApiResult<T>>;
  stream(dispatchId: string, since: number, onMessage: (m: StreamMessage) => void, onEnd: () => void): () => void;
  saveSettings(patch: Partial<Settings>): void;
  openOptions(): void;
}

export interface Snapshot {
  selectors: string[];
  path: string;
  sessionKey: string | null;
  entries: [string, string][];
  minimized: boolean;
}

export interface PanelEvents {
  onClose(panel: Panel): void;
  /** The user wants to pick more elements for this chat. */
  onPick(panel: Panel): void;
  /** Fired whenever the bar collapses to its pill or opens again. */
  onMinimize(panel: Panel, minimized: boolean): void;
  onRemoveTarget(panel: Panel, index: number): void;
  toast(kind: ToastKind, text: string, action?: ToastAction): void;
  notify(title: string, message: string): void;
}

const TEMPLATE = `
<div class="bar" data-ref="bar" data-min="false" data-dock="bottom" data-theme="dark">
  <button class="pill" data-ref="pill" title="Open dev-in-situ">
    <span class="dot" data-ref="pill-dot"></span>
    <span class="pill-text" data-ref="pill-text">dev-in-situ</span>
  </button>
  <div class="window" data-ref="window" role="dialog" aria-label="dev-in-situ">
    <div class="topline" data-ref="grip">
      <span class="dot" data-ref="dot"></span>
      <span class="title">dev-in-situ</span>
      <span class="stack" data-ref="stack"></span>
      <button class="ghost" data-ref="new" hidden>New chat</button>
      <button class="icon" data-ref="minimize" title="Minimize (Esc)" aria-label="Minimize">–</button>
      <button class="icon" data-ref="close" title="Close" aria-label="Close">✕</button>
    </div>
    <div class="thread" data-ref="log" hidden></div>
    <div class="activity" data-ref="progress" hidden></div>
    <div class="composer">
      <div class="notice" data-ref="notice" hidden><span data-ref="notice-text"></span><button class="link" data-ref="fresh">Start fresh</button></div>
      <div class="chips" data-ref="chips"></div>
      <textarea data-ref="input" rows="1" placeholder="Describe the change…" spellcheck="true"></textarea>
      <div class="toolbar">
        <button class="tool" data-ref="add" title="Add elements (or hold Ctrl/⌘ while picking)" aria-label="Add elements">＋</button>
        <button class="tool" data-ref="toggle-options" aria-expanded="false" title="More options">Options</button>
        <button class="tool folder" data-ref="project" title="Project folder"><span data-ref="project-name">Choose folder</span></button>
        <select class="tool" data-ref="agent" title="Agent" aria-label="Agent"></select>
        <span class="hint" data-ref="hint"></span>
        <button class="send stop" data-ref="stop" title="Stop" aria-label="Stop" hidden>■</button>
        <button class="send" data-ref="send" title="Send (Enter)" aria-label="Send">↑</button>
      </div>
      <div class="options" data-ref="options" hidden>
        <label class="wide">Project folder
          <span class="row">
            <input class="mono" data-ref="path" list="dis-recent" placeholder="/path/to/your/project" spellcheck="false">
            <button class="btn" data-ref="browse">Browse</button>
          </span>
          <datalist id="dis-recent" data-ref="recent"></datalist>
        </label>
        <div class="browser wide" data-ref="browser" hidden>
          <div class="where"><button class="btn" data-ref="up" title="Up">↑</button><span data-ref="where"></span><button class="btn primary" data-ref="use">Use</button></div>
          <ul data-ref="dirs"></ul>
        </div>
        <label>Run
          <select data-ref="mode">
            <option value="background">Here, as a chat</option>
            <option value="terminal">In a terminal window</option>
          </select>
        </label>
        <label>Conversation
          <select data-ref="scope">
            <option value="element">Continue per selection</option>
            <option value="page">Continue per page</option>
            <option value="new">Always start fresh</option>
          </select>
        </label>
        <label>Model <input data-ref="model" spellcheck="false"></label>
        <label class="check"><input type="checkbox" data-ref="bypass"> Skip all permission prompts</label>
        <label class="check"><input type="checkbox" data-ref="collapse"> Minimize after sending</label>
        <label class="check"><input type="checkbox" data-ref="docked"> Dock to the bottom</label>
        <label class="check"><input type="checkbox" data-ref="notify"> Browser notifications</label>
        <button class="link" data-ref="settings">All settings</button>
      </div>
    </div>
  </div>
</div>`;

const MARGIN = 12;
const ABSOLUTE = /^([a-zA-Z]:[\\/]|[\\/]|~[\\/]?)/;
const FLOAT_WIDTH = 520;

/** One key for the whole selection, so a group of elements gets its own conversation. */
export const groupKey = (targets: Target[]): string => [...new Set(targets.map((t) => t.elementKey))].sort().join('|');

const folderName = (path: string): string => path.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || path;

export class Panel {
  readonly host: HTMLElement;
  private readonly root: ShadowRoot;
  private readonly refs = new Map<string, HTMLElement>();
  private targets: Target[] = [];
  private settings!: Settings;
  private page: PageInfo | null = null;
  private config: ConfigResponse | null = null;
  private sessionKey: string | null = null;
  /** The selection the current conversation last saw, so a changed selection re-sends its context. */
  private sentKey: string | null = null;
  private chatting = false;
  private run: string | null = null;
  private disconnect: (() => void) | null = null;
  private agentText: HTMLElement | null = null;
  private lastReply = '';
  /** Per run: how it was started, whether the user stopped it, and whether an error was already shown. */
  private runMode: Settings['mode'] = 'background';
  private stopping = false;
  private errorShown = false;
  private unread = false;
  private drag: { x: number; y: number } | null = null;
  private position: { left: number; top: number } | null = null;
  private readonly onResize = (): void => this.layout();

  constructor(
    private readonly bridge: Bridge,
    private readonly events: PanelEvents,
  ) {
    this.host = document.createElement('dev-in-situ-panel');
    applyHostBarrier(this.host, { position: 'fixed', 'z-index': '2147483000', display: 'block' });
    this.root = this.host.attachShadow({ mode: 'closed' });
    this.root.innerHTML = `<style>${css}</style>${TEMPLATE}`;
    for (const el of Array.from(this.root.querySelectorAll<HTMLElement>('[data-ref]'))) this.refs.set(el.dataset.ref!, el);
    for (const type of ['keydown', 'keyup', 'keypress', 'click', 'mousedown', 'mouseup', 'pointerdown', 'pointerup', 'input', 'wheel', 'focusin']) {
      this.host.addEventListener(type, (e) => e.stopPropagation());
    }
    this.wire();
  }

  get busy(): boolean {
    return this.run !== null;
  }

  get minimized(): boolean {
    return this.$('bar').dataset.min === 'true';
  }

  get docked(): boolean {
    return this.$('bar').dataset.dock === 'bottom';
  }

  get selection(): Target[] {
    return [...this.targets];
  }

  private $<T extends HTMLElement = HTMLElement>(ref: string): T {
    return this.refs.get(ref) as T;
  }

  private value(ref: string): string {
    return this.$<HTMLInputElement>(ref).value.trim();
  }

  private checked(ref: string): boolean {
    return this.$<HTMLInputElement>(ref).checked;
  }

  private wire(): void {
    const on = (ref: string, type: string, fn: (e: Event) => void) => this.$(ref).addEventListener(type, fn);
    on('close', 'click', () => this.events.onClose(this));
    on('minimize', 'click', () => this.setMinimized(true));
    on('pill', 'click', () => this.setMinimized(false));
    on('settings', 'click', () => this.bridge.openOptions());
    on('add', 'click', () => this.events.onPick(this));
    on('toggle-options', 'click', () => this.toggleOptions());
    on('project', 'click', () => {
      this.toggleOptions(true);
      this.$('path').focus();
    });
    on('browse', 'click', () => void this.toggleBrowser());
    on('up', 'click', () => void this.browse(this.$('where').dataset.parent || undefined));
    on('use', 'click', () => {
      this.$<HTMLInputElement>('path').value = this.$('where').dataset.path ?? '';
      this.$('browser').hidden = true;
      this.onPath();
    });
    on('path', 'input', () => this.onPath());
    on('input', 'input', () => {
      this.autosize();
      this.validate();
    });
    on('agent', 'change', () => this.onPreference({ agent: this.value('agent') }));
    on('mode', 'change', () => this.onPreference({ mode: this.value('mode') as Settings['mode'] }));
    on('scope', 'change', () => this.onPreference({ scope: this.value('scope') as Settings['scope'] }));
    on('bypass', 'change', () => this.onPreference({ bypass: this.checked('bypass') }));
    on('collapse', 'change', () => this.onPreference({ collapseOnSend: this.checked('collapse') }));
    on('notify', 'change', () => this.onPreference({ notify: this.checked('notify') }));
    on('docked', 'change', () => {
      this.onPreference({ docked: this.checked('docked') });
      this.layout();
    });
    on('fresh', 'click', () => void this.forget());
    on('send', 'click', () => void this.send());
    on('stop', 'click', () => void this.stop());
    on('new', 'click', () => void this.reset());
    this.root.addEventListener('keydown', (event) => {
      const e = event as KeyboardEvent;
      const inInput = (e.target as HTMLElement | null)?.dataset?.ref === 'input';
      if (e.key === 'Enter' && !e.isComposing && ((inInput && !e.shiftKey) || e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        void this.send();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        this.setMinimized(true);
      }
    });
    const grip = this.$('grip');
    grip.addEventListener('pointerdown', (e) => {
      if (this.docked || (e.target as HTMLElement).closest('button')) return;
      const rect = this.host.getBoundingClientRect();
      this.drag = { x: e.clientX - rect.left, y: e.clientY - rect.top };
      grip.setPointerCapture?.(e.pointerId);
    });
    grip.addEventListener('pointermove', (e) => this.drag && this.moveTo(e.clientX - this.drag.x, e.clientY - this.drag.y));
    grip.addEventListener('pointerup', () => (this.drag = null));
    window.addEventListener('resize', this.onResize);
  }

  async open(targets: Target[], settings: Settings, page: PageInfo | null): Promise<void> {
    this.settings = settings;
    this.page = page;
    (document.body ?? document.documentElement).append(this.host);
    this.$<HTMLSelectElement>('mode').value = settings.mode;
    this.$<HTMLSelectElement>('scope').value = settings.scope;
    this.$<HTMLInputElement>('bypass').checked = settings.bypass;
    this.$<HTMLInputElement>('collapse').checked = settings.collapseOnSend;
    this.$<HTMLInputElement>('docked').checked = settings.docked;
    this.$<HTMLInputElement>('notify').checked = settings.notify;
    this.setTargets(targets);
    this.renderStack();
    this.layout();
    this.$('input').focus();
    const origin = targets[0]?.origin ?? location.origin;
    const [config, project] = await Promise.all([
      this.bridge.api<ConfigResponse>('/config'),
      this.bridge.api<{ path: string | null; recent: string[] }>(`/project?origin=${encodeURIComponent(origin)}`),
    ]);
    if (!config.ok) return this.fail(config.error, config.status === 401);
    this.config = config.data;
    this.renderAgents();
    if (project.ok) {
      const path = this.$<HTMLInputElement>('path');
      if (!path.value && project.data.path) path.value = project.data.path;
      this.$('recent').replaceChildren(...project.data.recent.map((p) => Object.assign(document.createElement('option'), { value: p })));
    }
    this.setDot('ok');
    this.onPath();
    if (!this.value('path')) this.toggleOptions(true);
    await this.checkSession();
  }

  /** Replaces the selection this chat is about. */
  setTargets(targets: Target[]): void {
    const before = groupKey(this.targets);
    this.targets = [...targets];
    this.renderChips();
    this.validate();
    this.renderPill();
    if (this.config && groupKey(this.targets) !== before) void this.checkSession();
  }

  setPage(page: PageInfo | null): void {
    this.page = page;
    this.renderStack();
  }

  setTheme(theme: Theme): void {
    this.$('bar').dataset.theme = theme;
    this.host.style.setProperty('color-scheme', theme, 'important');
  }

  private renderChips(): void {
    const chips = this.targets.map((t, index) => {
      const chip = document.createElement('span');
      chip.className = 'chip';
      const c = t.component;
      const label = c?.name ? c.name : `<${t.tagName.toLowerCase()}>`;
      chip.title = c?.file ? `${t.selector}\n${c.file}${c.line ? `:${c.line}` : ''}` : t.selector;
      const name = Object.assign(document.createElement('span'), { className: 'chip-label', textContent: label });
      const sel = Object.assign(document.createElement('span'), { className: 'chip-sel', textContent: t.selector });
      const remove = Object.assign(document.createElement('button'), { className: 'chip-x', textContent: '✕', title: 'Remove' });
      remove.setAttribute('aria-label', `Remove ${t.selector}`);
      remove.addEventListener('click', () => this.events.onRemoveTarget(this, index));
      chip.append(name, sel, remove);
      return chip;
    });
    this.$('chips').replaceChildren(...chips);
    this.$('chips').hidden = chips.length === 0;
  }

  private renderStack(): void {
    const stack = this.page?.stack.join(' · ') ?? '';
    this.$('stack').textContent = stack;
    this.$('stack').title = stack ? `Detected: ${stack}` : '';
  }

  private renderPill(): void {
    const count = this.targets.length;
    const progress = this.$('progress').textContent ?? '';
    const text = this.busy
      ? progress || 'Working…'
      : this.unread
        ? 'Reply ready · click to view'
        : count
          ? `dev-in-situ · ${count} ${count === 1 ? 'element' : 'elements'}`
          : 'dev-in-situ';
    this.$('pill-text').textContent = text;
    this.$('pill').title = this.busy ? text : 'Open dev-in-situ';
  }

  private renderAgents(): void {
    const agents = this.config?.agents ?? [];
    const select = this.$<HTMLSelectElement>('agent');
    select.replaceChildren(
      ...agents.map((a) => Object.assign(document.createElement('option'), { value: a.id, textContent: a.available ? a.id : `${a.id} (not found)` })),
    );
    const wanted = [this.settings.agent, this.config?.config.defaultAgent].find((id) => agents.some((a) => a.id === id && a.available));
    select.value = wanted ?? agents.find((a) => a.available)?.id ?? agents[0]?.id ?? '';
    this.renderModel();
    if (agents.length && !agents.some((a) => a.available)) {
      this.fail(`No agent CLI was found on your PATH. Install one (claude, codex, gemini…) or set its "command" in ${this.config?.file}.`, true);
    }
  }

  private renderModel(): void {
    const agent = this.config?.agents.find((a) => a.id === this.value('agent'));
    this.$<HTMLInputElement>('model').placeholder = agent?.model || 'agent default';
  }

  private onPath(): void {
    const path = this.value('path');
    this.$('project-name').textContent = path ? folderName(path) : 'Choose folder';
    this.$('project').title = path ? `Project folder: ${path}` : 'Choose the project folder';
    this.validate();
  }

  private onPreference(patch: Partial<Settings>): void {
    this.settings = { ...this.settings, ...patch };
    this.bridge.saveSettings(patch);
    if ('agent' in patch) this.renderModel();
    this.validate();
    if ('agent' in patch || 'scope' in patch) void this.checkSession();
  }

  private toggleOptions(force?: boolean): void {
    const open = force ?? this.$('options').hidden;
    this.$('options').hidden = !open;
    this.$('toggle-options').setAttribute('aria-expanded', String(open));
  }

  private sessionQuery(): string {
    const t = this.targets[0];
    const q = new URLSearchParams({
      agent: this.value('agent'),
      scope: this.value('scope'),
      origin: t?.origin ?? location.origin,
      pathname: t?.pathname ?? location.pathname,
      elementKey: groupKey(this.targets),
    });
    return q.toString();
  }

  private async checkSession(): Promise<void> {
    if (this.chatting || !this.targets.length) return;
    const res = await this.bridge.api<SessionInfo>(`/session?${this.sessionQuery()}`);
    const session = res.ok ? res.data.session : null;
    this.$('notice').hidden = !session;
    if (res.ok) this.sessionKey = session ? res.data.sessionKey : null;
    if (session) this.$('notice-text').textContent = `Continues an earlier conversation (${session.turns} ${session.turns === 1 ? 'turn' : 'turns'}).`;
  }

  private async forget(): Promise<void> {
    if (this.sessionKey) {
      await this.bridge.api(`/session?agent=${encodeURIComponent(this.value('agent'))}&key=${encodeURIComponent(this.sessionKey)}`, 'DELETE');
    }
    this.sessionKey = null;
    this.sentKey = null;
    this.$('notice').hidden = true;
  }

  private async toggleBrowser(): Promise<void> {
    const browser = this.$('browser');
    if (!browser.hidden) return void (browser.hidden = true);
    const current = this.value('path');
    await this.browse(ABSOLUTE.test(current) ? current : undefined);
  }

  private async browse(path?: string): Promise<void> {
    const res = await this.bridge.api<DirListing>(`/fs/list${path ? `?path=${encodeURIComponent(path)}` : ''}`);
    if (!res.ok) return path ? this.browse() : this.fail(res.error, res.status === 401);
    const { data } = res;
    this.$('browser').hidden = false;
    const where = this.$('where');
    where.textContent = data.path || 'Choose a folder';
    where.dataset.path = data.path;
    where.dataset.parent = data.parent ?? '';
    this.$<HTMLButtonElement>('up').disabled = !data.path;
    this.$<HTMLButtonElement>('use').disabled = !data.path;
    this.$<HTMLButtonElement>('use').textContent = data.isProject ? 'Use ✓' : 'Use';
    const join = (dir: string) => (data.path ? `${data.path.replace(/[\\/]+$/, '')}${data.path.includes('\\') ? '\\' : '/'}${dir}` : dir);
    this.$('dirs').replaceChildren(
      ...data.dirs.map((dir) => {
        const item = document.createElement('li');
        const button = Object.assign(document.createElement('button'), { textContent: `📁 ${dir}` });
        button.addEventListener('click', () => void this.browse(join(dir)));
        item.append(button);
        return item;
      }),
    );
  }

  /** Returns why the message can't be sent yet, or '' when it can. */
  problem(): string {
    const path = this.value('path');
    if (!this.targets.length) return 'Select an element first';
    if (!path) return 'Choose the project folder';
    if (!ABSOLUTE.test(path)) return 'Project folder must be an absolute path';
    const missing = this.targets.some((t) => {
      try {
        return !document.querySelector(t.selector);
      } catch {
        return true;
      }
    });
    return missing ? 'A selected element is no longer on the page' : '';
  }

  private validate(): void {
    const problem = this.problem();
    const hint = this.$('hint');
    hint.textContent = problem;
    hint.dataset.state = problem ? 'bad' : '';
    this.$<HTMLButtonElement>('send').disabled = Boolean(problem) || this.busy || !this.config || !this.value('input');
  }

  private autosize(): void {
    const input = this.$<HTMLTextAreaElement>('input');
    input.style.height = 'auto';
    input.style.height = `${Math.min(input.scrollHeight, 200)}px`;
  }

  private async send(): Promise<void> {
    const box = this.$<HTMLTextAreaElement>('input');
    const instruction = box.value.trim();
    if (!instruction) return void box.focus();
    if (this.$<HTMLButtonElement>('send').disabled) {
      const problem = this.problem();
      if (problem) this.events.toast('error', problem);
      return;
    }
    const first = this.targets[0]!;
    const key = groupKey(this.targets);
    const followUp = this.chatting && this.sessionKey !== null && this.sentKey === key;
    const res = await this.bridge.api<DispatchResponse>('/dispatch', 'POST', {
      agent: this.value('agent'),
      mode: this.value('mode'),
      scope: this.value('scope'),
      origin: first.origin,
      url: first.url,
      pathname: first.pathname,
      selector: first.selector,
      elementKey: key,
      html: first.html,
      component: first.component,
      targets: this.targets.map((t) => ({ selector: t.selector, elementKey: t.elementKey, html: t.html, component: t.component })),
      stack: this.page?.stack ?? null,
      instruction,
      workspacePath: this.value('path'),
      model: this.value('model') || null,
      bypass: this.checked('bypass'),
      sessionKey: this.chatting ? this.sessionKey : null,
      followUp,
    });
    if (!res.ok) return this.fail(res.error, res.status === 401);
    box.value = '';
    this.autosize();
    this.sessionKey = res.data.sessionKey;
    this.sentKey = key;
    this.runMode = this.value('mode') === 'terminal' ? 'terminal' : 'background';
    this.enterChat();
    this.append('prompt', instruction);
    this.follow(res.data.dispatchId);
    if (this.checked('collapse')) {
      box.blur();
      this.setMinimized(true);
    }
  }

  snapshot(): Snapshot | null {
    if (!this.chatting) return null;
    const entries = Array.from(this.$('log').children as HTMLCollectionOf<HTMLElement>).map((e) => [e.dataset.level ?? '', e.textContent ?? ''] as [string, string]);
    return { selectors: this.targets.map((t) => t.selector), path: this.value('path'), sessionKey: this.sessionKey, entries, minimized: this.minimized };
  }

  restore(snapshot: Snapshot): void {
    this.$<HTMLInputElement>('path').value = snapshot.path;
    this.onPath();
    this.sessionKey = snapshot.sessionKey;
    this.sentKey = groupKey(this.targets);
    this.enterChat();
    for (const [level, text] of snapshot.entries) this.append(level, text);
    this.append('status', 'Page reloaded to show the changes.');
    this.setBusy(false);
    if (snapshot.minimized) this.setMinimized(true);
  }

  private enterChat(): void {
    this.chatting = true;
    this.$('notice').hidden = true;
    this.$('log').hidden = false;
    this.$('new').hidden = false;
    this.$<HTMLTextAreaElement>('input').placeholder = 'Reply…';
  }

  private follow(dispatchId: string): void {
    this.run = dispatchId;
    this.agentText = null;
    this.lastReply = '';
    this.stopping = false;
    this.errorShown = false;
    let last = 0;
    let retries = 0;
    this.setBusy(true, 'Starting…');
    const connect = () => {
      this.disconnect = this.bridge.stream(
        dispatchId,
        last,
        (message) => {
          if (this.run !== dispatchId || !('event' in message) || message.event.seq <= last) return;
          last = message.event.seq;
          retries = 0;
          this.render(message.event);
        },
        () => {
          if (this.run !== dispatchId) return;
          if (retries++ < 5) return void setTimeout(connect, 400 * retries);
          this.render({ seq: last + 1, level: 'error', message: 'Lost connection to the daemon.' });
          this.render({ seq: last + 2, level: 'done', message: 'Disconnected', exitCode: null });
        },
      );
    };
    connect();
  }

  private render(event: RunEvent): void {
    switch (event.level) {
      case 'prompt':
        return;
      case 'status':
        this.setProgress(event.message);
        this.append('status', event.message);
        return;
      case 'stdout':
        if (!this.agentText) this.agentText = this.append('stdout', '');
        this.agentText.textContent += event.message;
        this.lastReply = this.agentText.textContent ?? '';
        this.scroll();
        return;
      case 'error':
        this.append('error', event.message);
        // One toast per run; later errors stay in the thread so a chatty agent can't flood the page.
        if (!this.errorShown && !this.stopping) this.events.toast('error', event.message);
        this.errorShown = true;
        return;
      case 'done':
        this.finish(event);
        return;
      default:
        this.append(event.level, event.message);
    }
  }

  private finish(event: RunEvent): void {
    const ok = event.exitCode === 0;
    this.run = null;
    this.disconnect?.();
    this.disconnect = null;
    this.setBusy(false);
    this.setDot(ok ? 'ok' : 'bad');
    if (this.minimized) this.unread = true;
    this.renderPill();
    if (this.stopping) {
      this.setDot('ok');
      this.events.toast('info', 'Stopped.');
      return;
    }
    if (this.runMode === 'terminal') {
      if (ok) this.events.toast('info', event.message || 'Opened in a terminal window.');
      else if (!this.errorShown) this.events.toast('error', event.message || 'Could not open a terminal.');
      return;
    }
    const reply = this.lastReply.trim().replace(/\s+/g, ' ');
    if (ok) this.events.toast('success', reply ? `Done: ${reply.length > 140 ? `${reply.slice(0, 140)}…` : reply}` : event.message || 'Finished');
    else if (!this.errorShown) this.events.toast('error', event.message || 'Failed');
    if (this.checked('notify')) {
      this.events.notify(ok ? 'dev-in-situ: reply ready' : 'dev-in-situ: run failed', (ok ? reply : '') || event.message || (ok ? 'Finished' : 'Failed'));
    }
  }

  private append(level: string, text: string): HTMLElement {
    if (level !== 'stdout') this.agentText = null;
    const entry = Object.assign(document.createElement('div'), { className: 'entry', textContent: text.replace(/\s+$/, '') });
    entry.dataset.level = level;
    this.$('log').append(entry);
    this.scroll();
    return entry;
  }

  private scroll(): void {
    const log = this.$('log');
    log.scrollTop = log.scrollHeight;
  }

  private setProgress(text: string): void {
    const progress = this.$('progress');
    progress.textContent = text;
    progress.hidden = !this.busy || !text;
    this.renderPill();
  }

  private setDot(state: 'ok' | 'bad' | 'busy'): void {
    this.$('dot').dataset.state = state;
    this.$('pill-dot').dataset.state = state;
  }

  private setBusy(busy: boolean, status = ''): void {
    this.setDot(busy ? 'busy' : 'ok');
    this.$('stop').hidden = !busy;
    this.$('send').hidden = busy;
    this.setProgress(status);
    this.validate();
  }

  private async stop(): Promise<void> {
    if (!this.run) return;
    this.stopping = true;
    await this.bridge.api(`/dispatch/${this.run}`, 'DELETE');
  }

  private async reset(): Promise<void> {
    await this.forget();
    this.chatting = false;
    this.$('log').hidden = true;
    this.$('log').replaceChildren();
    this.$('new').hidden = true;
    this.$<HTMLTextAreaElement>('input').placeholder = 'Describe the change…';
    this.validate();
    await this.checkSession();
    this.$('input').focus();
  }

  private fail(message: string, settingsProblem: boolean): void {
    this.setDot('bad');
    this.events.toast('error', message, settingsProblem ? { label: 'Open settings', run: () => this.bridge.openOptions() } : undefined);
    this.validate();
  }

  setMinimized(minimized: boolean): void {
    if (minimized === this.minimized) return;
    this.$('bar').dataset.min = String(minimized);
    if (!minimized) {
      this.unread = false;
      this.$('input').focus();
    }
    this.renderPill();
    this.layout();
    this.events.onMinimize(this, minimized);
  }

  close(): void {
    this.run = null;
    this.disconnect?.();
    window.removeEventListener('resize', this.onResize);
    this.host.remove();
  }

  /** Positions the host: centered at the bottom when docked, wherever it was dragged otherwise. */
  private layout(): void {
    const docked = this.checked('docked');
    this.$('bar').dataset.dock = docked ? 'bottom' : 'float';
    const set = (prop: string, value: string) => this.host.style.setProperty(prop, value, 'important');
    if (docked) {
      set('left', '50%');
      set('top', 'auto');
      set('bottom', '16px');
      set('transform', 'translateX(-50%)');
      set('width', this.minimized ? 'auto' : `min(760px, calc(100vw - ${MARGIN * 2}px))`);
      return;
    }
    set('bottom', 'auto');
    set('transform', 'none');
    set('width', this.minimized ? 'auto' : `min(${FLOAT_WIDTH}px, calc(100vw - ${MARGIN * 2}px))`);
    const pos = this.position ?? { left: window.innerWidth - FLOAT_WIDTH - MARGIN * 2, top: window.innerHeight - 320 };
    this.moveTo(pos.left, pos.top);
  }

  private moveTo(left: number, top: number): void {
    const rect = this.host.getBoundingClientRect();
    const x = Math.max(MARGIN, Math.min(left, window.innerWidth - (rect.width || FLOAT_WIDTH) - MARGIN));
    const y = Math.max(MARGIN, Math.min(top, window.innerHeight - (rect.height || 200) - MARGIN));
    this.position = { left: Math.round(x), top: Math.round(y) };
    this.host.style.setProperty('left', `${this.position.left}px`, 'important');
    this.host.style.setProperty('top', `${this.position.top}px`, 'important');
  }
}
