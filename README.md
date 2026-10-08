<div align="center">

# dev-in-situ

**Point at it. Say what should change. Your AI coding agent edits the source.**

[![CI](https://github.com/NabilAldhamari/dev-in-situ/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/NabilAldhamari/dev-in-situ/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D22-339933?logo=node.js&logoColor=white)](package.json)
[![Manifest V3](https://img.shields.io/badge/Chrome-Manifest%20V3-4285F4?logo=googlechrome&logoColor=white)](extension/manifest.json)
[![Platforms](https://img.shields.io/badge/platform-Linux%20%7C%20macOS%20%7C%20Windows-lightgrey)](.github/workflows/ci.yml)
[![PRs welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](CONTRIBUTING.md)
[![GitHub stars](https://img.shields.io/github/stars/NabilAldhamari/dev-in-situ?style=social)](https://github.com/NabilAldhamari/dev-in-situ/stargazers)

[Quick start](#quick-start) · [The chat bar](#the-chat-bar) · [Agents](#agents) · [Security](#security) · [Contributing](CONTRIBUTING.md)

<img src="docs/screenshot.png" alt="Two sections selected with Ctrl-click stay outlined while the chat bar docked at the bottom shows a chip for each, the prompt box, project folder and agent picker" width="900">

<sub>Two elements picked with Ctrl-click. Both stay outlined while you write the request, and the chat bar shows a chip for each one it will send.</sub>

</div>

---

Click any element on a page you're developing (or several, with Ctrl/⌘), write what should change, and your local AI coding agent edits the source. It works with Claude Code, Codex, Gemini CLI, opencode, Antigravity, Kimi, GLM, local models through Ollama, and any other CLI you configure.

```
browser extension  ──►  local daemon (127.0.0.1:4141)  ──►  your agent CLI, run in your project folder
```

The extension never runs anything itself. It talks only to the daemon on your machine, and only the daemon starts agent processes.

## Quick start

You need Node 22+ and at least one agent CLI on your `PATH`, e.g. `claude`, `codex` or `gemini`.

**From a release (no build needed for the extension):** download `dev-in-situ-extension-<version>.zip` from the [latest release](https://github.com/NabilAldhamari/dev-in-situ/releases/latest) and unzip it. In step 1 below, load that folder instead of `extension/dist`. The daemon runs with `npx dev-in-situ` once it is published to npm, or from a clone as shown here.

```bash
git clone https://github.com/NabilAldhamari/dev-in-situ.git && cd dev-in-situ
npm run setup      # installs and builds everything
npm start          # starts the daemon and prints your token
```

1. Open `chrome://extensions` (or the equivalent page in Edge or Brave) and turn on **Developer mode**. Click **Load unpacked** and select `extension/dist`.
2. The settings page opens. Paste the token and click **Save & test**.
3. On any page, press **Ctrl+Shift+X** (**⌘+Shift+X** on a Mac) or click the toolbar icon. Then click an element. To select several, hold **Ctrl** (**⌘**) and click each one, then let go.
4. A chat bar opens at the bottom of the page with one chip per selected element. Pick your project folder once per site (📁 in the bar), describe the change and press **Enter**.

The bar works like any AI chat: your messages on the right, the agent's replies on the left, **Shift+Enter** for a new line, and a stop button while it works. After you send, it shrinks to a small pill so you can keep using the page. When the agent replies you get a toast and a browser notification; click the pill to read the reply and continue the conversation.

## The chat bar

| Control | Meaning |
|---|---|
| Element chips | The elements the agent is asked about. ✕ removes one, **＋** adds more (or hold Ctrl/⌘ while picking). |
| 📁 Project folder | The folder the agent works in. It is remembered per site. |
| Agent | Any agent from your config. Agents whose CLI isn't installed are marked *not found*. |
| Options → Run | **Here, as a chat** streams the agent's progress into the bar. **In a terminal window** opens a real terminal with the agent. |
| Options → Conversation | **Continue per selection** (default) or **Continue per page** carry the agent's memory over. **Always start fresh** does not. |
| Options → Model | Overrides the model for this run only. |
| Options → Skip all permission prompts | Passes the agent's "yolo" flag. Without it, agents may still edit files, but they ask before anything riskier. |
| Options → Minimize after sending | On by default, so the page is free to use while the agent works. |
| Options → Dock to the bottom | On by default. Turn it off to get a floating bar you can drag by its title. |
| Options → Browser notifications | A system notification when the agent replies or fails. |

The selected elements stay outlined while the bar is open. Minimizing (**Esc** or –) hides the outlines, and opening the bar again brings them all back.

The bar follows the site's light or dark look, falling back to your system setting, with a translucent, blurred background. You can force light or dark in settings.

## Auto-refresh

Pages with hot reload (Vite, webpack, Next.js dev, and so on) update by themselves. For every other page (plain HTML, PHP, Django, Rails, a static server), the extension checks the daemon every couple of seconds. When files in the project change, it reloads the page and keeps any open conversation open. You can change this in settings: **Auto** (the default), **Always** or **Never**.

## Agents

The daemon keeps its config in `~/.dev-in-situ/config.json`. You can edit it from the settings page or in any text editor, then restart the daemon. Each agent is either a **preset** plus overrides, or a fully custom **command**.

```json
{
  "defaultAgent": "claude",
  "timeoutMinutes": 30,
  "agents": {
    "claude": { "preset": "claude" },
    "codex": { "preset": "codex", "model": "gpt-5-codex" },
    "gemini": { "preset": "gemini" },
    "kimi": {
      "preset": "claude",
      "model": "kimi-k2-turbo-preview",
      "env": { "ANTHROPIC_BASE_URL": "https://api.moonshot.ai/anthropic", "ANTHROPIC_AUTH_TOKEN": "${KIMI_API_KEY}" }
    },
    "glm": {
      "preset": "claude",
      "model": "glm-4.6",
      "env": { "ANTHROPIC_BASE_URL": "https://api.z.ai/api/anthropic", "ANTHROPIC_AUTH_TOKEN": "${ZAI_API_KEY}" }
    },
    "gemma": {
      "preset": "claude",
      "model": "gemma3:27b",
      "env": { "ANTHROPIC_BASE_URL": "http://localhost:11434", "ANTHROPIC_AUTH_TOKEN": "ollama" }
    },
    "local-opencode": { "preset": "opencode", "model": "ollama/qwen3-coder" },
    "aider": {
      "command": "aider",
      "background": ["--yes-always", "--no-pretty", "{options}", "--message", "{prompt}"],
      "terminal": ["{options}", "--message", "{prompt}"],
      "modelFlag": ["--model", "{model}"]
    }
  }
}
```

The presets are `claude`, `codex`, `gemini`, `opencode` and `antigravity`. Any of these fields override a preset:

| Field | Meaning |
|---|---|
| `command` | Executable name or full path. |
| `background` / `terminal` | Argument templates for the two run modes. |
| `args` | Extra arguments added to every run. |
| `model`, `modelFlag` | Default model, and how the CLI takes one. |
| `env` | Extra environment variables. `${NAME}` is filled in from your environment, so keys stay out of the file. |
| `output` | `json` if the CLI streams JSON events (for live progress), otherwise `text`. |
| `resumeFlag`, `sessionFlag` | How the CLI continues or names a conversation. If you leave these out, every run starts fresh. |
| `editFlag`, `bypassFlag` | Flags used by default and when "Skip all permission prompts" is ticked. |

The templates accept these placeholders: `{prompt}`, `{options}` (model, permission and session flags), `{model}`, `{session}`, `{cwd}` and `{timeout}`. Arguments are passed straight to the process without going through a shell, so page content can never be run as a command.

Other settings: `timeoutMinutes` stops runs that take too long. `terminal` picks the terminal app (for example `wt`, `kitty` or `iTerm`). If you leave it empty, the daemon picks one for your OS.

Environment variables for the daemon:
- `DEV_IN_SITU_PORT` (default `4141`)
- `DEV_IN_SITU_HOME` (default `~/.dev-in-situ`)

## Keeping prompts small

The agent gets only what it needs: the selector, the component and source file if known, the detected stack, and a compact copy of the element's HTML. Comments, data URIs and long SVG paths are stripped, and the HTML is capped at 1.2 KB. Follow-up replies continue the agent's own session, so they send just your new message and don't repeat the context.

## Security

- The daemon listens on `127.0.0.1` only, checks the `Host` header, and accepts browser requests only from extension origins.
- Every request needs the random token stored in `~/.dev-in-situ/token`. The check runs in constant time.
- Web pages can't call the daemon. Only the extension can, and the page script can't change the agent config.
- Agents run with `shell: false`, and prompts are passed as single arguments.

## Development

```bash
npm run check      # typecheck, test and build both packages
npm run e2e --prefix extension    # end-to-end test: the built extension in Chromium against a real daemon
npm run dev --prefix extension    # rebuild the extension on change
npm run dev --prefix daemon       # restart the daemon on change
```

```
daemon/     Express bridge: agents.ts (presets, args, output parsing), server.ts (HTTP + SSE), runner.ts (processes, terminals)
extension/  MV3 extension: content/ (picker, chat bar, toasts, theme and stack detection), background/ (daemon relay), options/
```

CI runs typecheck, tests and a build on Linux, Windows and macOS for every push and pull request. The built extension is uploaded as a workflow artifact.

### Releasing

```bash
npm run version -- 0.4.0   # updates every version field
# move the Unreleased notes in CHANGELOG.md under the new version, commit, then:
git tag v0.4.0 && git push origin main v0.4.0
```

The tag triggers the Release workflow, which runs the checks and publishes the extension zip and the changelog notes as a GitHub Release.

## Contributing

Bug reports, agent presets and pull requests are welcome. See [CONTRIBUTING.md](CONTRIBUTING.md) for the dev setup, and please run `npm run check` before opening a PR. For security issues, follow [SECURITY.md](SECURITY.md) instead of filing a public issue.

## License

[MIT](LICENSE)
