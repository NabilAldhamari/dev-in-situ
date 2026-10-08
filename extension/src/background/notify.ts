export interface NotificationsApi {
  create(id: string, options: { type: 'basic'; iconUrl: string; title: string; message: string; priority?: number }): unknown;
  clear(id: string): unknown;
}

export interface FocusApi {
  focusTab(tabId: number): Promise<void> | void;
}

const PREFIX = 'dev-in-situ:';

/** Shows a system notification for a tab and brings that tab forward when it is clicked. */
export function createNotifier(notifications: NotificationsApi, focus: FocusApi, iconUrl: string) {
  let counter = 0;
  return {
    notify(tabId: number | undefined, title: string, message: string): string {
      const id = `${PREFIX}${tabId ?? 'none'}:${++counter}`;
      notifications.create(id, { type: 'basic', iconUrl, title: title.slice(0, 120), message: message.slice(0, 300) || ' ', priority: 1 });
      return id;
    },
    async clicked(id: string): Promise<boolean> {
      if (!id.startsWith(PREFIX)) return false;
      notifications.clear(id);
      const tabId = Number(id.slice(PREFIX.length).split(':')[0]);
      if (Number.isInteger(tabId)) await focus.focusTab(tabId);
      return true;
    },
  };
}
