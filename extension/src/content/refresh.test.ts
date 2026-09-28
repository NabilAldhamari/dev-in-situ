import { describe, expect, it } from 'vitest';
import { RefreshWatcher } from './refresh.js';

function setup(stamps: (number | null)[], canReload = () => true) {
  let reloads = 0;
  const watcher = new RefreshWatcher({
    poll: async () => (stamps.length ? stamps.shift()! : null),
    canReload,
    reload: () => void (reloads += 1),
  });
  return { watcher, reloads: () => reloads };
}

describe('RefreshWatcher', () => {
  it('reloads only when the stamp changes', async () => {
    const { watcher, reloads } = setup([0, 0, 3, 3]);
    for (let i = 0; i < 4; i += 1) await watcher.tick();
    expect(reloads()).toBe(1);
  });

  it('holds a change until reloading is allowed', async () => {
    let busy = true;
    const { watcher, reloads } = setup([1, 2, 2, 2], () => !busy);
    await watcher.tick();
    await watcher.tick();
    await watcher.tick();
    expect(reloads()).toBe(0);
    busy = false;
    await watcher.tick();
    expect(reloads()).toBe(1);
  });

  it('ignores failed polls', async () => {
    const { watcher, reloads } = setup([1, null, 1]);
    for (let i = 0; i < 3; i += 1) await watcher.tick();
    expect(reloads()).toBe(0);
  });
});
