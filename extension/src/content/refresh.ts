export interface RefreshDeps {
  poll(): Promise<number | null>;
  canReload(): boolean;
  reload(): void;
}

export class RefreshWatcher {
  private last: number | null = null;
  private pending = false;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly deps: RefreshDeps) {}

  async tick(): Promise<void> {
    const stamp = await this.deps.poll().catch(() => null);
    if (stamp === null) return;
    if (this.last !== null && stamp !== this.last) this.pending = true;
    this.last = stamp;
    if (this.pending && this.deps.canReload()) {
      this.pending = false;
      this.deps.reload();
    }
  }

  start(seconds: number): void {
    this.stop();
    this.timer = setInterval(() => void this.tick(), Math.max(1, seconds) * 1000);
    void this.tick();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.last = null;
    this.pending = false;
  }

  get running(): boolean {
    return this.timer !== null;
  }
}
