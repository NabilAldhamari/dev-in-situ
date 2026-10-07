// End-to-end test: the built extension in Chromium, talking to a real daemon that runs a fake agent.
// Run with `npm run e2e` after `npm run build` in both packages.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const here = path.dirname(fileURLToPath(import.meta.url));
const dist = path.resolve(here, '../dist');
const daemonEntry = path.resolve(here, '../../daemon/dist/index.js');
const shots = process.env.E2E_SCREENSHOTS ?? '';

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dis-e2e-home-'));
const project = fs.mkdtempSync(path.join(os.tmpdir(), 'dis-e2e-project-'));
const promptLog = path.join(project, 'prompts.log');
const agentScript = path.join(home, 'agent.mjs');
fs.writeFileSync(
  agentScript,
  `import fs from 'node:fs';
const prompt = process.argv.at(-1);
fs.appendFileSync(${JSON.stringify(promptLog)}, prompt + '\\n=====\\n');
await new Promise((r) => setTimeout(r, 300));
console.log('Aligned the selected elements.');
`,
);

const DARK_PAGE = `<!doctype html><html><body style="margin:0;background:#111;color:#eee;font:16px sans-serif">
  <section id="dark" style="height:300px;margin:20px;border:1px solid #333">Dark</section></body></html>`;

const PAGE = `<!doctype html><html><head><title>e2e</title><style>
  body { margin: 0; font: 16px sans-serif; background: #fff; }
  section { height: 400px; margin: 20px; border: 1px solid #ccc; display: grid; place-items: center; }
</style></head><body>
  <section id="one">One</section><section id="two">Two</section><section id="three">Three</section>
  <section id="four">Four</section><section id="five">Five</section>
</body></html>`;

let daemon;
let site;
let context;
let worker;
let daemonPort;
let sitePort;

const freePort = () =>
  new Promise((resolve) => {
    const s = http.createServer().listen(0, '127.0.0.1', () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });

async function waitFor(check, what, timeout = 10_000) {
  const end = Date.now() + timeout;
  for (;;) {
    const value = await check();
    if (value) return value;
    if (Date.now() > end) throw new Error(`Timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 100));
  }
}

before(async () => {
  daemonPort = await freePort();
  sitePort = await freePort();
  // The daemon remembers this project folder for the test site, as it would after a first run.
  fs.writeFileSync(
    path.join(home, 'state.json'),
    JSON.stringify({ sessions: {}, projects: { [`http://127.0.0.1:${sitePort}`]: project }, recent: [project] }),
  );
  fs.writeFileSync(
    path.join(home, 'config.json'),
    JSON.stringify({ defaultAgent: 'fake', timeoutMinutes: 1, agents: { fake: { command: process.execPath, background: [agentScript, '{prompt}'], output: 'text' } } }),
  );
  daemon = spawn(process.execPath, [daemonEntry], { env: { ...process.env, DEV_IN_SITU_HOME: home, DEV_IN_SITU_PORT: String(daemonPort) }, stdio: 'ignore' });
  await waitFor(() => fs.existsSync(path.join(home, 'token')), 'daemon token');
  const token = fs.readFileSync(path.join(home, 'token'), 'utf8').trim();

  site = http.createServer((req, res) => res.writeHead(200, { 'Content-Type': 'text/html' }).end(req.url.startsWith('/dark') ? DARK_PAGE : PAGE)).listen(sitePort, '127.0.0.1');

  context = await chromium.launchPersistentContext('', {
    channel: 'chromium',
    headless: true,
    viewport: { width: 1200, height: 800 },
    args: [`--disable-extensions-except=${dist}`, `--load-extension=${dist}`],
  });
  worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
  // Extension APIs are bound shortly after the worker starts.
  await waitFor(() => worker.evaluate(() => Boolean(globalThis.chrome?.storage?.local)).catch(() => false), 'extension APIs');
  await worker.evaluate(
    async ({ token, daemonUrl }) => {
      const { settings = {} } = await chrome.storage.local.get('settings');
      await chrome.storage.local.set({ settings: { ...settings, token, daemonUrl, refresh: 'off' } });
    },
    { token, daemonUrl: `http://127.0.0.1:${daemonPort}` },
  );
  // The settings page opens on install; close it.
  for (const p of context.pages()) if (p.url().startsWith('chrome-extension://')) await p.close();
});

after(async () => {
  await context?.close();
  site?.close();
  daemon?.kill();
});

let visits = 0;
async function openSite(pathname = '/') {
  const page = await context.newPage();
  await page.goto(`http://127.0.0.1:${sitePort}${pathname}?visit=${++visits}`);
  await page.waitForFunction(() => document.readyState === 'complete');
  await page.waitForTimeout(300);
  return page;
}

async function toggle(page) {
  const url = page.url();
  await worker.evaluate(async (url) => {
    const [tab] = await chrome.tabs.query({ url });
    await chrome.tabs.sendMessage(tab.id, { type: 'toggle' });
  }, url);
}

const center = async (page, selector) => {
  const box = await page.locator(selector).boundingBox();
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
};

async function shot(page, name) {
  if (shots) await page.screenshot({ path: path.join(shots, `${name}.png`) });
}

async function typeAndSend(page, text) {
  await page.waitForFunction(() => document.querySelector('dev-in-situ-panel'));
  // The prompt box has focus once the bar opens; wait for the agent list and project to load.
  await page.waitForTimeout(500);
  await page.keyboard.type(text);
  await page.keyboard.press('Enter');
}

test('Ctrl-click selects several elements, one chat bar sends them all, toast and notification follow', async () => {
  const page = await openSite();
  await toggle(page);
  const one = await center(page, '#one');
  await page.mouse.move(one.x, one.y);
  await page.keyboard.down('Control');
  await page.mouse.click(one.x, one.y);
  const two = await center(page, '#two');
  await page.mouse.click(two.x, two.y);
  await shot(page, '1-picking-two');
  await page.keyboard.up('Control');
  await page.waitForFunction(() => document.querySelector('dev-in-situ-panel'));
  await page.waitForTimeout(500);
  await shot(page, '2-chat-bar-open');
  // A white page gets the light bar (the host's default is dark, so this proves detection ran).
  assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('dev-in-situ-panel')).colorScheme), 'light');

  await typeAndSend(page, 'align these');
  await waitFor(() => fs.existsSync(promptLog) && fs.readFileSync(promptLog, 'utf8').includes('====='), 'agent run');
  const prompt = fs.readFileSync(promptLog, 'utf8');
  assert.match(prompt, /Change these 2 elements/);
  assert.match(prompt, /`#one`/);
  assert.match(prompt, /`#two`/);
  assert.match(prompt, /Task: align these/);

  await page.waitForFunction(() => document.querySelector('dev-in-situ-toasts'), null, { timeout: 10_000 });
  await page.waitForTimeout(300);
  await shot(page, '3-minimized-with-toast');
  const notes = await waitFor(
    () => worker.evaluate(() => new Promise((r) => chrome.notifications.getAll((all) => r(Object.keys(all))))).then((ids) => (ids.length ? ids : null)),
    'browser notification',
  );
  assert.equal(notes.length, 1);
  assert.match(notes[0], /^dev-in-situ:\d+:/);

  // The page is usable while the bar is minimized: a normal click reaches it.
  await page.locator('#three').scrollIntoViewIfNeeded();
  const three = await center(page, '#three');
  const reached = page.evaluate(() => new Promise((r) => {
    document.querySelector('#three').addEventListener('click', () => r(true), { once: true });
    setTimeout(() => r(false), 2000);
  }));
  await page.mouse.click(three.x, three.y);
  assert.equal(await reached, true);
  const pending = await worker.evaluate(() => new Promise((r) => chrome.notifications.getAll((all) => r(Object.keys(all)))));
  for (const id of pending) await worker.evaluate((id) => chrome.notifications.clear(id), id);
  await page.close();
});

test('picking keeps following the pointer after the page scrolls', async () => {
  fs.rmSync(promptLog, { force: true });
  const page = await openSite();
  await toggle(page);
  const one = await center(page, '#one');
  await page.mouse.move(one.x, one.y);
  await page.mouse.wheel(0, 900);
  await page.waitForTimeout(400);
  await shot(page, '4-after-scroll');
  // Without moving the mouse, a click selects whatever is under it now, not the element from before the scroll.
  await page.mouse.click(one.x, one.y);
  const picked = await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.id, one);
  assert.notEqual(picked, 'one');
  await typeAndSend(page, 'scrolled');
  await waitFor(() => fs.existsSync(promptLog) && fs.readFileSync(promptLog, 'utf8').includes('====='), 'agent run');
  const prompt = fs.readFileSync(promptLog, 'utf8');
  assert.match(prompt, new RegExp('`#' + picked + '`'));
  await page.close();
});

test('the chat bar takes on the dark theme of a dark site', async () => {
  const page = await openSite('/dark');
  await toggle(page);
  const dark = await center(page, '#dark');
  await page.mouse.click(dark.x, dark.y);
  await page.waitForFunction(() => document.querySelector('dev-in-situ-panel'));
  await page.waitForTimeout(400);
  await shot(page, '5-dark-site');
  const scheme = await page.evaluate(() => getComputedStyle(document.querySelector('dev-in-situ-panel')).colorScheme);
  assert.equal(scheme, 'dark');
  // Escape minimizes to the pill, which is much narrower than the open bar.
  const width = () => page.evaluate(() => document.querySelector('dev-in-situ-panel').getBoundingClientRect().width);
  const open = await width();
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);
  await shot(page, '6-dark-minimized');
  const pill = await width();
  assert.ok(pill < open / 2, `pill ${pill}px should be much narrower than the bar ${open}px`);
  await page.close();
});
