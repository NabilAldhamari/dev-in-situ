export type RunMode = 'background' | 'terminal';
export type Scope = 'element' | 'page' | 'new';
export type RefreshMode = 'auto' | 'always' | 'off';

export interface Settings {
  daemonUrl: string;
  token: string;
  agent: string;
  mode: RunMode;
  scope: Scope;
  bypass: boolean;
  refresh: RefreshMode;
  refreshSeconds: number;
}

export const DEFAULT_SETTINGS: Settings = {
  daemonUrl: 'http://127.0.0.1:4141',
  token: '',
  agent: '',
  mode: 'background',
  scope: 'element',
  bypass: false,
  refresh: 'auto',
  refreshSeconds: 2,
};

export interface ComponentHint {
  name: string | null;
  file: string | null;
  line: number | null;
  framework: string;
}

export interface PageInfo {
  stack: string[];
  hmr: boolean;
}

export interface Target {
  selector: string;
  elementKey: string;
  tagName: string;
  html: string;
  component: ComponentHint | null;
  url: string;
  origin: string;
  pathname: string;
  rect: { top: number; left: number; width: number; height: number };
}

export interface AgentInfo {
  id: string;
  command: string;
  model: string;
  available: boolean;
}

export interface ConfigResponse {
  config: { defaultAgent: string; timeoutMinutes: number; terminal: string; agents: Record<string, unknown> };
  agents: AgentInfo[];
  file: string;
}

export interface DirListing {
  path: string;
  parent: string | null;
  dirs: string[];
  isProject: boolean;
}

export interface SessionInfo {
  sessionKey: string;
  session: { turns: number; updatedAt: number } | null;
}

export interface DispatchResponse {
  dispatchId: string;
  sessionKey: string;
  resumed: boolean;
}

export type Level = 'status' | 'prompt' | 'stdout' | 'stderr' | 'error' | 'done';

export interface RunEvent {
  seq: number;
  level: Level;
  message: string;
  exitCode?: number | null;
}

export type ApiResult<T> = { ok: true; data: T } | { ok: false; error: string; status: number };

export type Message =
  | { type: 'api'; method?: 'GET' | 'POST' | 'DELETE'; path: string; body?: unknown }
  | { type: 'settings' }
  | { type: 'saveSettings'; patch: Partial<Settings> }
  | { type: 'openOptions' }
  | { type: 'toggle' };

export const STREAM_PORT = 'dev-in-situ-stream';

export type StreamMessage = { event: RunEvent } | { ping: true };
