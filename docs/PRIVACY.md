# Privacy policy

dev-in-situ collects no data and has no servers.

- The extension talks only to the daemon on your own machine (`127.0.0.1`). Nothing is sent to the author or to any third party by the extension.
- It stores your daemon token and settings in `chrome.storage` on your device.
- The selector, a trimmed copy of the picked element's HTML and your instruction are sent to the daemon, which passes them to the AI agent CLI you configured. That agent's own privacy terms apply to what it does next.
- The daemon keeps its token, config and session state in `~/.dev-in-situ` on your device.

Questions: open an issue at https://github.com/NabilAldhamari/dev-in-situ/issues.
