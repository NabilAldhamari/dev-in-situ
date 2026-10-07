import { allowedFromPage, loadSettings, request, saveSettings, stream } from '../shared/daemon.js';
import { type Message, STREAM_PORT, type StreamMessage } from '../shared/types.js';
import { createNotifier } from './notify.js';

const notifier = createNotifier(
  chrome.notifications,
  {
    async focusTab(tabId) {
      const tab = await chrome.tabs.update(tabId, { active: true }).catch(() => null);
      if (tab?.windowId !== undefined) await chrome.windows.update(tab.windowId, { focused: true }).catch(() => {});
    },
  },
  chrome.runtime.getURL('icons/icon-128.png'),
);
chrome.notifications.onClicked.addListener((id) => void notifier.clicked(id));

chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') void chrome.runtime.openOptionsPage();
});

async function toggle(tab?: chrome.tabs.Tab) {
  if (!tab?.id) return;
  try {
    await chrome.tabs.sendMessage(tab.id, { type: 'toggle' } satisfies Message);
  } catch {}
}

chrome.action.onClicked.addListener((tab) => void toggle(tab));
chrome.commands.onCommand.addListener(async (command) => {
  if (command !== 'toggle-inspector') return;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  await toggle(tab);
});

async function handle(message: Message, sender: chrome.runtime.MessageSender): Promise<unknown> {
  switch (message.type) {
    case 'settings':
      return loadSettings();
    case 'saveSettings':
      return saveSettings(message.patch);
    case 'openOptions':
      return chrome.runtime.openOptionsPage();
    case 'notify':
      return notifier.notify(sender.tab?.id, String(message.title), String(message.message));
    case 'api': {
      const method = message.method ?? 'GET';
      if (!allowedFromPage(method, message.path)) return { ok: false, status: 403, error: 'Not allowed' };
      return request(await loadSettings(), message.path, { method, body: message.body });
    }
    default:
      return null;
  }
}

chrome.runtime.onMessage.addListener((message: Message, sender, reply) => {
  handle(message, sender).then(reply, (err: Error) => reply({ ok: false, status: 0, error: err.message }));
  return true;
});

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== STREAM_PORT) return;
  const controller = new AbortController();
  port.onDisconnect.addListener(() => controller.abort());
  port.onMessage.addListener(async ({ dispatchId, since }: { dispatchId: string; since: number }) => {
    const post = (m: StreamMessage) => {
      try {
        port.postMessage(m);
      } catch {
        controller.abort();
      }
    };
    try {
      for await (const chunk of stream(await loadSettings(), dispatchId, since, controller.signal)) {
        if (chunk.pings) post({ ping: true });
        chunk.events.forEach((event) => post({ event }));
      }
    } catch {}
    if (!controller.signal.aborted) port.disconnect();
  });
});
