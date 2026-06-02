# AGENTS.md — Editor4

## Stack

- Electron 28 — plain JS, no bundler/TypeScript/build step
- `nodeIntegration: true`, `contextIsolation: false`
- Dark theme: `#1e1e1e` background, `#d4d4d4` text (VS Code-like)
- Built-in terminal at bottom: xterm.js + node-pty (real shell via pty.spawn)

## Known pitfalls

- **`remote` module does not exist** in Electron 28+. Use `ipcMain`/`ipcRenderer` IPC handlers for dialog, fs, and any main-process operation.
- **`src/` is empty** — not a source root; all code is in `main.js` (main process) and `index.html` (renderer with inline `<script>`).
- Menu actions invoke renderer functions via `win.webContents.executeJavaScript('openFolder()')` — ensure the target function is set on `window`.
- **`node-pty` is a native module** — after `npm install` or changing Electron version, run `npm run rebuild` to recompile it for Electron's ABI.

## Commands

| Command | Action |
|---|---|
| `npm start` | Launch the Electron app |
| `npm run rebuild` | Rebuild native modules (`node-pty`) for Electron's ABI |

No test, lint, typecheck, or codegen tooling exists. `run.sh` does `npm install && npm run rebuild && npm start`.