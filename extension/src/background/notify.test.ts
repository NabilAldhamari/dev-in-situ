import { describe, expect, it, vi } from 'vitest';
import { createNotifier } from './notify.js';

function setup() {
  const notifications = { create: vi.fn(), clear: vi.fn() };
  const focus = { focusTab: vi.fn() };
  return { notifications, focus, notifier: createNotifier(notifications, focus, 'icon.png') };
}

describe('createNotifier', () => {
  it('creates a basic notification tied to the tab', () => {
    const { notifications, notifier } = setup();
    const id = notifier.notify(7, 'dev-in-situ: reply ready', 'Done.');
    expect(id).toMatch(/^dev-in-situ:7:\d+$/);
    expect(notifications.create).toHaveBeenCalledWith(id, { type: 'basic', iconUrl: 'icon.png', title: 'dev-in-situ: reply ready', message: 'Done.', priority: 1 });
  });

  it('gives each notification its own id and trims long text', () => {
    const { notifications, notifier } = setup();
    const a = notifier.notify(1, 't', 'x'.repeat(1000));
    const b = notifier.notify(1, 't', '');
    expect(a).not.toBe(b);
    expect(notifications.create.mock.calls[0]![1].message).toHaveLength(300);
    expect(notifications.create.mock.calls[1]![1].message).toBe(' ');
  });

  it('focuses the tab and clears the notification on click', async () => {
    const { notifications, focus, notifier } = setup();
    const id = notifier.notify(42, 't', 'm');
    expect(await notifier.clicked(id)).toBe(true);
    expect(notifications.clear).toHaveBeenCalledWith(id);
    expect(focus.focusTab).toHaveBeenCalledWith(42);
  });

  it('ignores other notifications and tabless ones', async () => {
    const { focus, notifier } = setup();
    expect(await notifier.clicked('someone-else')).toBe(false);
    expect(await notifier.clicked(notifier.notify(undefined, 't', 'm'))).toBe(true);
    expect(focus.focusTab).not.toHaveBeenCalled();
  });
});
