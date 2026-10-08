import type { ApiResult, Message, Settings, StreamMessage } from '../shared/types.js';
import { STREAM_PORT } from '../shared/types.js';
import { Controller } from './controller.js';
import { ask } from './probe.js';
import type { Bridge } from './ui/panel.js';

const send = <T>(message: Message): Promise<T> => chrome.runtime.sendMessage(message) as Promise<T>;

const bridge: Bridge = {
  api: <T>(path: string, method: 'GET' | 'POST' | 'DELETE' = 'GET', body?: unknown) =>
    send<ApiResult<T>>({ type: 'api', method, path, body }).catch((err: Error) => ({ ok: false as const, status: 0, error: err.message })),
  stream(dispatchId, since, onMessage, onEnd) {
    let port: chrome.runtime.Port;
    try {
      port = chrome.runtime.connect({ name: STREAM_PORT });
    } catch {
      setTimeout(onEnd, 0);
      return () => {};
    }
    port.onMessage.addListener((m: StreamMessage) => onMessage(m));
    port.onDisconnect.addListener(onEnd);
    port.postMessage({ dispatchId, since });
    return () => port.disconnect();
  },
  saveSettings: (patch) => void send({ type: 'saveSettings', patch }).catch(() => {}),
  openOptions: () => void send({ type: 'openOptions' }).catch(() => {}),
};

const controller = new Controller({
  bridge,
  loadSettings: () => send<Settings>({ type: 'settings' }),
  notify: (title, message) => void send({ type: 'notify', title, message }).catch(() => {}),
  ask: (kind, target) => ask(kind, target),
});

chrome.runtime.onMessage.addListener((message: Message) => {
  if (message.type === 'toggle') controller.toggle();
});
chrome.storage.onChanged.addListener((changes) => {
  if (changes.settings) controller.setSettings(changes.settings.newValue as Settings);
});
void controller.init();
