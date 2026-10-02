# Changelog

All notable changes to this project are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [0.3.0] - 2026-10-02

### Added
- `npm run version -- <x.y.z>` updates every version field in one step.
- Release workflow: pushing a `v*` tag runs the checks and publishes a GitHub Release with an installable extension zip.
- The daemon package is ready to publish to npm as `dev-in-situ`.
- Privacy policy in `docs/PRIVACY.md`.

### Changed
- The daemon reports the version from its `package.json` instead of a hardcoded constant.
- Dependencies updated: express (qs advisories), vitest 5, jsdom 30, TypeScript 7, `@types/node` 26 and GitHub Actions v7.
- Dependabot now groups minor and patch updates so lockfiles stop conflicting.

### Fixed
- A run now always ends with a `done` event, even if saving its session fails.
- `listDirs` and `ChangeWatcher` tests no longer fail on empty home folders or on macOS file-event timing.

## [0.2.0]

Initial public release: element picker, popover chat, local daemon, agent presets for Claude Code, Codex, Gemini CLI, opencode and Antigravity, and auto-refresh.

[Unreleased]: https://github.com/NabilAldhamari/dev-in-situ/compare/v0.3.0...HEAD
[0.3.0]: https://github.com/NabilAldhamari/dev-in-situ/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/NabilAldhamari/dev-in-situ/releases/tag/v0.2.0
