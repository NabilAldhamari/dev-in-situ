# Contributing to dev-in-situ

Thanks for helping out. Bug reports, new agent presets, docs fixes and pull requests are all welcome.

## Dev setup

You need Node 22+.

```bash
git clone https://github.com/NabilAldhamari/dev-in-situ.git && cd dev-in-situ
npm run setup                     # install and build both packages
npm run dev --prefix daemon       # restart the daemon on change
npm run dev --prefix extension    # rebuild the extension on change
```

Load `extension/dist` as an unpacked extension in `chrome://extensions` and reload it after each rebuild.

## Layout

```
daemon/     Express bridge: agents.ts (presets, args, output parsing), server.ts (HTTP + SSE), runner.ts (processes, terminals)
extension/  MV3 extension: content/ (picker, popover, stack detection), background/ (daemon relay), options/
scripts/    setup and build helpers shared by both packages
```

## Before you open a pull request

- Run `npm run check`. It typechecks, tests and builds both packages, the same as CI.
- Add or update tests for behavior changes.
- Keep PRs focused. One fix or feature per PR is easier to review.
- Update the README if you change user-facing behavior, config fields or presets.
- Add a line under **Unreleased** in `CHANGELOG.md`.

## Adding an agent preset

Presets live in `daemon/src/agents.ts`. A good preset PR includes the CLI's JSON output parsing if it has one, the resume/session flags, and a README example.

## Security

Please don't report vulnerabilities in public issues. See [SECURITY.md](SECURITY.md).
