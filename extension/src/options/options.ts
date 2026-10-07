import { loadSettings, request, saveSettings } from '../shared/daemon.js';
import type { ConfigResponse, Settings } from '../shared/types.js';

const $ = <T extends HTMLElement = HTMLInputElement>(id: string) => document.getElementById(id) as T;
const FIELDS = ['daemonUrl', 'token', 'agent', 'mode', 'scope', 'refresh', 'refreshSeconds', 'theme'] as const;
const CHECKS = ['bypass', 'docked', 'collapseOnSend', 'notify'] as const;

function say(id: string, text: string, ok: boolean): void {
  const el = $(id);
  el.textContent = text;
  el.dataset.state = ok ? 'ok' : 'bad';
}

function render(data: ConfigResponse, settings: Settings): void {
  $('file').textContent = data.file;
  $<HTMLTextAreaElement>('config').value = JSON.stringify(data.config, null, 2);
  $('agents').replaceChildren(
    ...data.agents.map((a) =>
      Object.assign(document.createElement('li'), {
        textContent: `${a.id}: ${a.available ? `ready (${a.command})` : `"${a.command}" not found on PATH`}${a.model ? ` · ${a.model}` : ''}`,
      }),
    ),
  );
  const select = $<HTMLSelectElement>('agent');
  select.replaceChildren(
    Object.assign(document.createElement('option'), { value: '', textContent: `Daemon default (${data.config.defaultAgent})` }),
    ...data.agents.map((a) => Object.assign(document.createElement('option'), { value: a.id, textContent: a.id })),
  );
  select.value = settings.agent;
}

async function connect(): Promise<void> {
  const settings = await loadSettings();
  const res = await request<ConfigResponse>(settings, '/config');
  if (!res.ok) return say('status', res.error, false);
  say('status', `Connected. ${res.data.agents.filter((a) => a.available).length} of ${res.data.agents.length} agents are ready.`, true);
  render(res.data, settings);
}

async function init(): Promise<void> {
  const settings = await loadSettings();
  for (const key of FIELDS) $(key).value = String(settings[key]);
  for (const key of CHECKS) $(key).checked = settings[key];
  for (const key of ['agent', 'mode', 'scope', 'refresh', 'refreshSeconds', 'theme', ...CHECKS]) {
    $(key).addEventListener('change', () => void save());
  }
  $('connect').addEventListener('click', async () => {
    await save();
    await connect();
  });
  $('saveConfig').addEventListener('click', async () => {
    let body: unknown;
    try {
      body = JSON.parse($<HTMLTextAreaElement>('config').value);
    } catch (err) {
      return say('configStatus', `Invalid JSON: ${(err as Error).message}`, false);
    }
    const current = await loadSettings();
    const res = await request<ConfigResponse>(current, '/config', { method: 'PUT', body });
    if (!res.ok) return say('configStatus', res.error, false);
    render(res.data, current);
    say('configStatus', 'Saved.', true);
  });
  if (settings.token) await connect();
}

async function save(): Promise<Settings> {
  const seconds = Math.min(60, Math.max(1, Number($('refreshSeconds').value) || 2));
  return saveSettings({
    daemonUrl: $('daemonUrl').value.trim() || 'http://127.0.0.1:4141',
    token: $('token').value.trim(),
    agent: $<HTMLSelectElement>('agent').value,
    mode: $<HTMLSelectElement>('mode').value as Settings['mode'],
    scope: $<HTMLSelectElement>('scope').value as Settings['scope'],
    bypass: $('bypass').checked,
    docked: $('docked').checked,
    collapseOnSend: $('collapseOnSend').checked,
    notify: $('notify').checked,
    theme: $<HTMLSelectElement>('theme').value as Settings['theme'],
    refresh: $<HTMLSelectElement>('refresh').value as Settings['refresh'],
    refreshSeconds: seconds,
  });
}

void init();
