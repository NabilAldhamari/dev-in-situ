import css from './panel.css?raw';
import { applyHostBarrier } from './host-barrier.js';
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
} from '../../shared/types.js';

export interface Bridge {
  api<T>(path: string, method?: 'GET' | 'POST' | 'DELETE', body?: unknown): Promise<ApiResult<T>>;
  stream(dispatchId: string, since: number, onMessage: (m: StreamMessage) => void, onEnd: () => void): () => void;
  saveSettings(patch: Partial<Settings>): void;
  openOptions(): void;
}

export interface Snapshot {
  selector: string;
  path: string;
  sessionKey: string | null;
  entries: [string, string][];
}

export interface PanelEvents {
  onClose(panel: Panel): void;
  onPick(panel: Panel): void;
}

const TEMPLATE = `
<div class="panel" data-min="false">
  <div class="header" data-ref="header">
    <span class="dot" data-ref="dot"></span>
    <span class="brand">dev-in-situ</span>
    <span class="stack" data-ref="stack"></span>
    <button class="icon" data-ref="pick" title="Pick another element">⌖</button>
    <button class="icon" data-ref="minimize" title="Minimize (Esc)">–</button>
    <button class="icon" data-ref="settings" title="Settings">⚙</button>
    <button class="icon" data-ref="close" title="Close">✕</button>
  </div>
  <div class="body">
    <div class="banner" data-ref="banner" hidden><span data-ref="banner-text"></span><button data-ref="banner-action" hidden>Open settings</button></div>
    <div class="stackv" data-ref="compose">
      <label>Project folder
        <div class="row">
          <input class="mono" data-ref="path" list="dis-recent" placeholder="/path/to/your/project" spellcheck="false">
          <button class="btn flex" data-ref="browse">Browse</button>
        </div>
        <datalist id="dis-recent" data-ref="recent"></datalist>
      </label>
      <div class="browser" data-ref="browser" hidden>
        <div class="where"><button class="btn flex" data-ref="up" title="Up">↑</button><span data-ref="where"></span><button class="btn primary flex" data-ref="use">Use</button></div>
        <ul data-ref="dirs"></ul>
      </div>
      <label>Element
        <input class="mono" data-ref="selector" spellcheck="false">
        <span class="hint" data-ref="target-hint"></span>
      </label>
      <label>What should change?
        <textarea data-ref="instruction" rows="3" placeholder="e.g. make this button green and round the corners"></textarea>
      </label>
      <div class="row">
        <label>Agent <select data-ref="agent"></select></label>
        <label>Run
          <select data-ref="mode">
            <option value="background">Here, as a chat</option>
            <option value="terminal">In a terminal window</option>
          </select>
        </label>
      </div>
      <details>
        <summary>More options</summary>
        <label>Conversation
          <select data-ref="scope">
            <option value="element">Continue per element</option>
            <option value="page">Continue per page</option>
            <option value="new">Always start fresh</option>
          </select>
        </label>
        <label>Model <input data-ref="model" spellcheck="false"></label>
        <label class="check"><input type="checkbox" data-ref="bypass"> Skip all permission prompts</label>
      </details>
      <div class="notice" data-ref="notice" hidden><span data-ref="notice-text"></span><button data-ref="fresh">Start fresh</button></div>
    </div>
    <div class="log" data-ref="log" hidden></div>
    <div class="progress" data-ref="progress" hidden></div>
    <textarea data-ref="reply" rows="2" placeholder="Reply to continue…" hidden></textarea>
  </div>
  <div class="footer">
    <span class="hint" data-ref="footer-hint"></span>
    <button class="btn" data-ref="new" hidden>New chat</button>
    <button class="btn" data-ref="stop" hidden>Stop</button>
    <button class="btn primary" data-ref="send">Send</button>
  </div>
</div>`;

const MARGIN = 12;
const ABSOLUTE = /^([a-zA-Z]:[\\/]|[\\/]|~[\\/]?)/;
let zIndex = 2147483000;

export class Panel {
  readonly host: HTMLElement;
  private readonly root: ShadowRoot;
  private readonly refs = new Map<string, HTMLElement>();
  private target!: Target;
  private settings!: Settings;
  private page: PageInfo | null = null;
  private config: ConfigResponse | null = null;
  private sessionKey: string | null = null;
  private chatting = false;
  private run: string | null = null;
  private disconnect: (() => void) | null = null;
  private agentText: HTMLElement | null = null;
  private drag: { x: number; y: number } | null = null;

  constructor(
    private readonly bridge: Bridge,
    private readonly events: PanelEvents,
  ) {
    this.host = document.createElement('dev-in-situ-panel');
    applyHostBarrier(this.host, { position: 'fixed', top: '12px', left: '12px', 'z-index': String(++zIndex), display: 'block' });
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

  private $<T extends HTMLElement = HTMLElement>(ref: string): T {
    return this.refs.get(ref) as T;
  }

  private value(ref: string): string {
    return this.$<HTMLInputElement>(ref).value.trim();
  }

  private wire(): void {
    const on = (ref: string, type: string, fn: (e: Event) => void) => this.$(ref).addEventListener(type, fn);
    on('close', 'click', () => this.events.onClose(this));
    on('minimize', 'click', () => this.setMinimized(true));
    on('settings', 'click', () => this.bridge.openOptions());
    on('pick', 'click', () => this.events.onPick(this));
    on('browse', 'click', () => void this.toggleBrowser());
    on('up', 'click', () => void this.browse(this.$('where').dataset.parent || undefined));
    on('use', 'click', () => {
      this.$<HTMLInputElement>('path').value = this.$('where').dataset.path ?? '';
      this.$('browser').hidden = true;
      this.validate();
    });
    on('path', 'input', () => this.validate());
    on('selector', 'input', () => this.validate());
    on('instruction', 'input', () => this.validate());
    on('agent', 'change', () => this.onPreference({ agent: this.value('agent') }));
    on('mode', 'change', () => this.onPreference({ mode: this.value('mode') as Settings['mode'] }));
    on('scope', 'change', () => this.onPreference({ scope: this.value('scope') as Settings['scope'] }));
    on('bypass', 'change', () => this.onPreference({ bypass: this.$<HTMLInputElement>('bypass').checked }));
    on('fresh', 'click', () => void this.forget());
    on('send', 'click', () => void this.send());
    on('stop', 'click', () => void this.stop());
    on('new', 'click', () => void this.reset(true));
    this.$('banner-action').addEventListener('click', () => this.bridge.openOptions());
    this.host.addEventListener('pointerdown', () => this.host.style.setProperty('z-index', String(++zIndex), 'important'));
    this.root.addEventListener('keydown', (event) => {
      const e = event as KeyboardEvent;
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        void this.send();
      } else if (e.key === 'Escape') {
        this.setMinimized(true);
      }
    });
    const header = this.$('header');
    header.addEventListener('pointerdown', (e) => {
      if ((e.target as HTMLElement).closest('button')) return;
      if (this.minimized) return this.setMinimized(false);
      const rect = this.host.getBoundingClientRect();
      this.drag = { x: e.clientX - rect.left, y: e.clientY - rect.top };
      header.setPointerCapture?.(e.pointerId);
    });
    header.addEventListener('pointermove', (e) => this.drag && this.moveTo(e.clientX - this.drag.x, e.clientY - this.drag.y));
    header.addEventListener('pointerup', () => (this.drag = null));
  }

  async open(target: Target, settings: Settings, page: PageInfo | null, cascade = 0): Promise<void> {
    this.settings = settings;
    this.page = page;
    (document.body ?? document.documentElement).append(this.host);
    this.retarget(target);
    this.$<HTMLSelectElement>('mode').value = settings.mode;
    this.$<HTMLSelectElement>('scope').value = settings.scope;
    this.$<HTMLInputElement>('bypass').checked = settings.bypass;
    this.renderStack();
    this.place(target.rect, cascade);
    this.$('instruction').focus();
    const [config, project] = await Promise.all([
      this.bridge.api<ConfigResponse>('/config'),
      this.bridge.api<{ path: string | null; recent: string[] }>(`/project?origin=${encodeURIComponent(target.origin)}`),
    ]);
    if (!config.ok) return this.fail(config.error, config.status === 401);
    this.config = config.data;
    this.renderAgents();
    if (project.ok) {
      const path = this.$<HTMLInputElement>('path');
      if (!path.value && project.data.path) path.value = project.data.path;
      this.$('recent').replaceChildren(...project.data.recent.map((p) => Object.assign(document.createElement('option'), { value: p })));
    }
    this.$('dot').dataset.state = 'ok';
    this.validate();
    if (!this.value('path')) this.$('path').focus();
    await this.checkSession();
  }

  retarget(target: Target): void {
    this.target = target;
    this.$<HTMLInputElement>('selector').value = target.selector;
    const c = target.component;
    this.$('target-hint').textContent = c?.name
      ? `${c.name}${c.file ? ` — ${c.file}${c.line ? `:${c.line}` : ''}` : ` (${c.framework})`}`
      : `<${target.tagName.toLowerCase()}>`;
    this.validate();
    if (this.config) void this.checkSession();
  }

  setPage(page: PageInfo | null): void {
    this.page = page;
    this.renderStack();
  }

  private renderStack(): void {
    const stack = this.page?.stack.join(' · ') ?? '';
    this.$('stack').textContent = this.minimized && this.busy ? this.$('progress').textContent ?? '' : stack;
    this.$('stack').title = stack ? `Detected: ${stack}` : '';
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

  private onPreference(patch: Partial<Settings>): void {
    this.settings = { ...this.settings, ...patch };
    this.bridge.saveSettings(patch);
    if ('agent' in patch) this.renderModel();
    this.validate();
    if ('agent' in patch || 'scope' in patch) void this.checkSession();
  }

  private sessionQuery(): string {
    const t = this.target;
    const q = new URLSearchParams({ agent: this.value('agent'), scope: this.value('scope'), origin: t.origin, pathname: t.pathname, elementKey: t.elementKey });
    return q.toString();
  }

  private async checkSession(): Promise<void> {
    if (this.chatting) return;
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

  private validate(): void {
    const path = this.value('path');
    const selector = this.value('selector');
    let matches = 0;
    try {
      matches = selector ? document.querySelectorAll(selector).length : 0;
    } catch {}
    const problem = this.chatting
      ? ''
      : !path
        ? 'Choose the project folder for this site'
        : !ABSOLUTE.test(path)
          ? 'Project folder must be an absolute path'
          : !matches
            ? 'Selector matches nothing on this page'
            : '';
    const hint = this.$('footer-hint');
    const isMac = /mac/i.test(navigator.platform);
    hint.textContent = problem || `${isMac ? '⌘' : 'Ctrl'}+Enter to send`;
    hint.dataset.state = problem ? 'bad' : '';
    this.$<HTMLButtonElement>('send').disabled = Boolean(problem) || this.busy || !this.config;
  }

  private async send(): Promise<void> {
    if (this.$<HTMLButtonElement>('send').disabled) return;
    const box = this.$<HTMLTextAreaElement>(this.chatting ? 'reply' : 'instruction');
    const instruction = box.value.trim();
    if (!instruction) return box.focus();
    const t = this.target;
    const followUp = this.chatting && this.sessionKey !== null;
    const res = await this.bridge.api<DispatchResponse>('/dispatch', 'POST', {
      agent: this.value('agent'),
      mode: this.value('mode'),
      scope: this.value('scope'),
      origin: t.origin,
      url: t.url,
      pathname: t.pathname,
      selector: this.value('selector'),
      elementKey: t.elementKey,
      html: t.html,
      component: t.component,
      stack: this.page?.stack ?? null,
      instruction,
      workspacePath: this.value('path'),
      model: this.value('model') || null,
      bypass: this.$<HTMLInputElement>('bypass').checked,
      sessionKey: this.chatting ? this.sessionKey : null,
      followUp,
    });
    if (!res.ok) return this.fail(res.error, res.status === 401);
    this.hideBanner();
    box.value = '';
    this.sessionKey = res.data.sessionKey;
    this.enterChat();
    this.append('prompt', instruction);
    this.follow(res.data.dispatchId);
  }

  snapshot(): Snapshot | null {
    if (!this.chatting) return null;
    const entries = Array.from(this.$('log').children as HTMLCollectionOf<HTMLElement>).map((e) => [e.dataset.level ?? '', e.textContent ?? ''] as [string, string]);
    return { selector: this.value('selector'), path: this.value('path'), sessionKey: this.sessionKey, entries };
  }

  restore(snapshot: Snapshot): void {
    this.$<HTMLInputElement>('path').value = snapshot.path;
    this.$<HTMLInputElement>('selector').value = snapshot.selector;
    this.sessionKey = snapshot.sessionKey;
    this.enterChat();
    for (const [level, text] of snapshot.entries) this.append(level, text);
    this.append('status', 'Page reloaded to show the changes.');
    this.setBusy(false);
  }

  private enterChat(): void {
    this.chatting = true;
    this.$('compose').hidden = true;
    this.$('log').hidden = false;
    this.$('reply').hidden = false;
    this.$<HTMLButtonElement>('send').textContent = 'Reply';
  }

  private follow(dispatchId: string): void {
    this.run = dispatchId;
    this.agentText = null;
    let last = 0;
    let retries = 0;
    this.setBusy(true, 'Starting…');
    const connect = () => {
      this.disconnect = this.bridge.stream(
        dispatchId,
        last,
        (message) => {
          if (!('event' in message) || message.event.seq <= last) return;
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
        this.scroll();
        return;
      case 'done':
        this.append('done', event.message);
        this.run = null;
        this.disconnect?.();
        this.disconnect = null;
        this.setBusy(false);
        return;
      default:
        this.agentText = null;
        this.append(event.level, event.message);
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
    progress.hidden = !this.busy;
    this.renderStack();
  }

  private setBusy(busy: boolean, status = ''): void {
    this.$('dot').dataset.state = busy ? 'busy' : 'ok';
    this.$('stop').hidden = !busy;
    this.$('new').hidden = busy || !this.chatting;
    this.setProgress(status);
    this.validate();
    if (!busy) this.$('reply').focus();
  }

  private async stop(): Promise<void> {
    if (this.run) await this.bridge.api(`/dispatch/${this.run}`, 'DELETE');
  }

  private async reset(forget: boolean): Promise<void> {
    if (forget) await this.forget();
    this.chatting = false;
    this.$('compose').hidden = false;
    this.$('log').hidden = true;
    this.$('log').replaceChildren();
    this.$('reply').hidden = true;
    this.$('new').hidden = true;
    this.$<HTMLButtonElement>('send').textContent = 'Send';
    this.validate();
    await this.checkSession();
    this.$('instruction').focus();
  }

  private fail(message: string, settingsProblem: boolean): void {
    this.$('dot').dataset.state = 'bad';
    this.$('banner').hidden = false;
    this.$('banner-text').textContent = message;
    this.$('banner-action').hidden = !settingsProblem;
    this.validate();
  }

  private hideBanner(): void {
    this.$('banner').hidden = true;
  }

  get minimized(): boolean {
    return this.root.querySelector<HTMLElement>('.panel')!.dataset.min === 'true';
  }

  setMinimized(minimized: boolean): void {
    this.root.querySelector<HTMLElement>('.panel')!.dataset.min = String(minimized);
    this.$('minimize').hidden = minimized;
    this.renderStack();
    if (!minimized) this.moveTo(this.host.getBoundingClientRect().left, this.host.getBoundingClientRect().top);
  }

  close(): void {
    this.run = null;
    this.disconnect?.();
    this.host.remove();
  }

  private moveTo(left: number, top: number): void {
    const rect = this.host.getBoundingClientRect();
    const x = Math.max(MARGIN, Math.min(left, window.innerWidth - (rect.width || 380) - MARGIN));
    const y = Math.max(MARGIN, Math.min(top, window.innerHeight - (rect.height || 420) - MARGIN));
    this.host.style.setProperty('left', `${Math.round(x)}px`, 'important');
    this.host.style.setProperty('top', `${Math.round(y)}px`, 'important');
  }

  private place(rect: Target['rect'], cascade: number): void {
    const width = 380;
    let left = rect.left + rect.width + MARGIN;
    if (left + width > window.innerWidth - MARGIN) left = rect.left - width - MARGIN;
    this.moveTo(left + cascade * 24, rect.top + cascade * 24);
  }
}
