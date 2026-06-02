# AGENTS.md — Agent4

## Stack

- Electron 28 — plain JS, no bundler/TypeScript/build step
- `nodeIntegration: true`, `contextIsolation: false`
- Dark theme: `#1e1e1e` background, `#d4d4d4` text (VS Code-like)
- Built-in terminal at bottom: xterm.js + node-pty (real shell via pty.spawn)
- Agent engine runs in **main process** (Ollama API calls + shell execution)

## How it works

1. User types a coding instruction in the chat input
2. Agent sends it to Ollama (`minimax-m2.5:cloud`) with a system prompt
3. LLM responds with `<shell>` tags containing commands to execute
4. Agent executes commands in the workspace (`box4/test_server_data/`)
5. Results are sent back to Ollama for next-step decisions
6. Loop continues until LLM outputs `<end/>`

## Architecture

- `main.js` — Electron main process: agent engine (Ollama client, shell executor), IPC handlers
- `index.html` — Renderer: chat UI + xterm terminal, communicates with main process via `ipcRenderer.invoke`

## Workspace

The agent writes code into `box4/test_server_data/`. When box4 server + client are running, files automatically sync to `box4/test_client_data/`.

## Commands

| Command | Action |
|---|---|
| `npm start` | Launch the Electron app |
| `npm run rebuild` | Rebuild native modules (`node-pty`) for Electron's ABI |

No test, lint, typecheck, or codegen tooling exists. `run.sh` does `npm install && npm run rebuild && npm start`.

## Known pitfalls

- **Ollama must be running** at `http://localhost:11434` before starting the app
- **`node-pty` native module** — must be rebuilt after install or Electron version change
- **`fetch` in main process** — available in Node 18+ (Electron 28), calls `localhost:11434/api/generate`
- **`process.env.SHELL`** may be undefined in some environments; falls back to `/bin/bash`
- **DevTools open automatically** at launch (`win.webContents.openDevTools()`)