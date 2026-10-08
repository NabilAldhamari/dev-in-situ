# Changelog

All notable changes to this project are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added
- Select several elements at once: hold Ctrl (⌘ on a Mac) while clicking, then let go. One chat bar covers them all, and the agent gets every element in one prompt.
- The popover is now a chat bar docked to the bottom of the page, laid out like the usual AI chat apps: element chips, a prompt box that sends on Enter, an agent picker, and options behind one button. It can be undocked to float.
- The bar follows the site's light or dark look, then the system setting, with a translucent, blurred background. Settings can force light or dark.
- Success and error messages appear as toasts, and a browser notification arrives when the agent replies or fails.
- After sending, the bar shrinks to a pill so the page is free to use. This can be turned off.
- End-to-end test that loads the built extension in Chromium against a real daemon (`npm run e2e --prefix extension`), run in CI on Linux.

### Changed
- Minimizing the bar hides the outlines of all selected elements; opening it again brings them back.
- The daemon accepts a `targets` list in `/dispatch`. The single-element fields still work.

### Fixed
- While picking, the outline no longer sticks to the old element after the page scrolls, and a click selects the element that is actually under the pointer.
- Picking no longer blocks dragging the page's scrollbar.

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
