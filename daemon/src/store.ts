import fs from 'node:fs';
import path from 'node:path';
import { STATE_FILE, writeJsonAtomic } from './config.js';

export type Scope = 'page' | 'element' | 'new';

export interface SessionRecord {
  agent: string;
  session: string;
  workspacePath: string;
  turns: number;
  updatedAt: string;
}

interface State {
  sessions: Record<string, SessionRecord>;
  projects: Record<string, string>;
  recent: string[];
}

const MAX_RECENT = 20;
const MAX_SESSIONS = 500;

export function sessionKey(input: { origin: string; pathname: string; scope: Scope; elementKey?: string | null; now?: number }): string {
  const page = `${input.origin}${input.pathname.replace(/\/+$/, '') || '/'}`;
  if (input.scope === 'page') return page;
  const anchor = `${page}::${input.elementKey ?? ''}`;
  return input.scope === 'element' ? anchor : `${anchor}::${input.now ?? Date.now()}`;
}

export class Store {
  private state: State;

  constructor(private readonly file: string = STATE_FILE) {
    let loaded: Partial<State> = {};
    try {
      loaded = JSON.parse(fs.readFileSync(file, 'utf8')) as Partial<State>;
    } catch {}
    this.state = {
      sessions: loaded.sessions ?? {},
      projects: loaded.projects ?? {},
      recent: Array.isArray(loaded.recent) ? loaded.recent : [],
    };
  }

  session(agent: string, key: string): SessionRecord | null {
    return this.state.sessions[`${agent}::${key}`] ?? null;
  }

  saveSession(agent: string, key: string, session: string, workspacePath: string): void {
    const id = `${agent}::${key}`;
    const turns = (this.state.sessions[id]?.turns ?? 0) + 1;
    this.state.sessions[id] = { agent, session, workspacePath, turns, updatedAt: new Date().toISOString() };
    const ids = Object.keys(this.state.sessions);
    if (ids.length > MAX_SESSIONS) {
      ids
        .sort((a, b) => this.state.sessions[a]!.updatedAt.localeCompare(this.state.sessions[b]!.updatedAt))
        .slice(0, ids.length - MAX_SESSIONS)
        .forEach((old) => delete this.state.sessions[old]);
    }
    this.flush();
  }

  forgetSession(agent: string, key: string): void {
    delete this.state.sessions[`${agent}::${key}`];
    this.flush();
  }

  project(origin: string): string | null {
    return this.state.projects[origin] ?? null;
  }

  recent(): string[] {
    return [...this.state.recent];
  }

  rememberProject(origin: string, workspacePath: string): void {
    const resolved = path.resolve(workspacePath);
    this.state.projects[origin] = resolved;
    this.state.recent = [resolved, ...this.state.recent.filter((p) => p !== resolved)].slice(0, MAX_RECENT);
    this.flush();
  }

  private flush(): void {
    writeJsonAtomic(this.file, this.state);
  }
}
