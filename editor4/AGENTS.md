# AGENTS.md — Editor4

## Stack

- Electron 28 — plain JS, no bundler/TypeScript/build step
- `nodeIntegration: true`, `contextIsolation: false`

## Known pitfalls

- **`remote` module does not exist** in Electron 28+. Use `ipcMain`/`ipcRenderer` IPC handlers for dialog, fs, and any main-process operation.
- **`src/` is empty** — not a source root; all code is in `main.js` (main process) and `index.html` (renderer with inline `<script>`).
- Menu actions invoke renderer functions via `win.webContents.executeJavaScript('openFolder()')` — ensure the target function is set on `window`.

## Commands

| Command | Action |
|---|---|
| `npm start` | Launch the Electron app |

No test, lint, typecheck, or codegen tooling exists. `run.sh` does `npm install && npm start`.