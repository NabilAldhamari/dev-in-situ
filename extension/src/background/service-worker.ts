import { allowedFromPage, loadSettings, request, saveSettings, stream } from '../shared/daemon.js';
import { type Message, STREAM_PORT, type StreamMessage } from '../shared/types.js';

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

async function handle(message: Message): Promise<unknown> {
  switch (message.type) {
    case 'settings':
      return loadSettings();
    case 'saveSettings':
      return saveSettings(message.patch);
    case 'openOptions':
      return chrome.runtime.openOptionsPage();
    case 'api': {
      const method = message.method ?? 'GET';
      if (!allowedFromPage(method, message.path)) return { ok: false, status: 403, error: 'Not allowed' };
      return request(await loadSettings(), message.path, { method, body: message.body });
    }
    default:
      return null;
  }
}

chrome.runtime.onMessage.addListener((message: Message, _sender, reply) => {
  handle(message).then(reply, (err: Error) => reply({ ok: false, status: 0, error: err.message }));
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
