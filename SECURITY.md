# Security policy

dev-in-situ starts processes on your machine, so we take reports seriously.

## Reporting a vulnerability

Please report privately through [GitHub security advisories](https://github.com/NabilAldhamari/dev-in-situ/security/advisories/new) rather than a public issue. Include steps to reproduce and the affected version. We aim to reply within a few days.

## Supported versions

Only the latest release on `main` receives fixes.

## Threat model in brief

- The daemon binds to `127.0.0.1`, checks the `Host` header, and accepts browser requests only from extension origins.
- Every request needs the random token in `~/.dev-in-situ/token`, compared in constant time.
- Web pages cannot call the daemon or change the agent config.
- Agents run with `shell: false`; page content is passed as a single argument and never interpreted by a shell.
