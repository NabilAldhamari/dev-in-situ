export type Level = 'status' | 'prompt' | 'stdout' | 'stderr' | 'error' | 'done';

export interface RunEvent {
  seq: number;
  level: Level;
  message: string;
  exitCode?: number | null;
  session?: string | null;
}

interface Run {
  events: RunEvent[];
  listeners: Set<(event: RunEvent) => void>;
  finished: boolean;
}

const MAX_RUNS = 50;
const MAX_EVENTS = 5000;

export class RunLog {
  private readonly runs = new Map<string, Run>();

  open(id: string): void {
    this.runs.set(id, { events: [], listeners: new Set(), finished: false });
    while (this.runs.size > MAX_RUNS) {
      const oldest = [...this.runs.entries()].find(([, run]) => run.finished)?.[0] ?? this.runs.keys().next().value!;
      this.runs.delete(oldest);
    }
  }

  has(id: string): boolean {
    return this.runs.has(id);
  }

  emit(id: string, level: Level, message: string, extra: Partial<RunEvent> = {}): void {
    const run = this.runs.get(id);
    if (!run || run.finished) return;
    const last = run.events.at(-1);
    const event: RunEvent = { ...extra, seq: (last?.seq ?? 0) + 1, level, message };
    run.events.push(event);
    if (run.events.length > MAX_EVENTS) run.events.splice(1, run.events.length - MAX_EVENTS);
    if (level === 'done') run.finished = true;
    for (const listener of run.listeners) listener(event);
  }

  subscribe(id: string, since: number, listener: (event: RunEvent) => void): (() => void) | null {
    const run = this.runs.get(id);
    if (!run) return null;
    for (const event of run.events) if (event.seq > since) listener(event);
    if (run.finished) return () => {};
    run.listeners.add(listener);
    return () => run.listeners.delete(listener);
  }
}
