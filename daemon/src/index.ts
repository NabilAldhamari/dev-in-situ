#!/usr/bin/env node
import { CONFIG_FILE, HOST, NAME, PORT, TOKEN_FILE, VERSION, loadConfig, readOrCreateToken } from './config.js';
import { createServer } from './server.js';
import { Store } from './store.js';

const token = readOrCreateToken();
const { app, close } = createServer({ config: loadConfig(), token, store: new Store() });

const server = app.listen(PORT, HOST, () => {
  process.stdout.write(
    [
      `${NAME} ${VERSION} listening on http://${HOST}:${PORT}`,
      `token:  ${token}`,
      `        (also in ${TOKEN_FILE})`,
      `agents: ${CONFIG_FILE}`,
      '',
    ].join('\n'),
  );
});

server.on('error', (err: NodeJS.ErrnoException) => {
  process.stderr.write(
    err.code === 'EADDRINUSE' ? `Port ${PORT} is busy. Is ${NAME} already running? Set DEV_IN_SITU_PORT to use another.\n` : `${err.message}\n`,
  );
  process.exit(1);
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    close();
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 2000).unref();
  });
}
