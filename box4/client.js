const fs = require('fs');
const path = require('path');
const chokidar = require('chokidar');
const WebSocket = require('ws');

const SERVER_URL = process.argv[2] || process.env.SERVER_URL || 'ws://localhost:3000';
const DATA_DIR = path.resolve(process.argv[3] || 'client_data');

fs.mkdirSync(DATA_DIR, { recursive: true });

console.log(`[Client] Connecting to ${SERVER_URL}`);
console.log(`[Client] Data dir: ${DATA_DIR}`);

function relativePath(absPath) {
  return path.relative(DATA_DIR, absPath);
}

function isHidden(filePath) {
  const relative = relativePath(filePath);
  return relative.split(path.sep).some(part => part.startsWith('.'));
}

async function getFileTree(dir) {
  const tree = {};
  if (!fs.existsSync(dir)) return tree;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;
    const fullPath = path.join(dir, entry.name);
    const relPath = relativePath(fullPath);
    if (entry.isDirectory()) {
      tree[relPath] = { isDirectory: true };
      const subTree = await getFileTree(fullPath);
      Object.assign(tree, subTree);
    } else {
      const stat = fs.statSync(fullPath);
      tree[relPath] = { isDirectory: false, size: stat.size, mtime: stat.mtimeMs };
    }
  }
  return tree;
}

function readFilesMap(dir, tree) {
  const files = {};
  for (const relPath of Object.keys(tree)) {
    if (!tree[relPath].isDirectory) {
      const absPath = path.join(dir, relPath);
      files[relPath] = fs.readFileSync(absPath).toString('base64');
    }
  }
  return files;
}

function applyFileChange(relPath, contentBase64) {
  const absPath = path.join(DATA_DIR, relPath);
  fs.mkdirSync(path.dirname(absPath), { recursive: true });
  const buf = Buffer.from(contentBase64, 'base64');
  fs.writeFileSync(absPath, buf);
}

function applyDelete(relPath, isDirectory) {
  const absPath = path.join(DATA_DIR, relPath);
  if (isDirectory) {
    fs.rmSync(absPath, { recursive: true, force: true });
  } else {
    try { fs.unlinkSync(absPath); } catch {}
  }
}

let ws;
let watcherState = null;
let reconnectTimer = null;

function connect() {
  ws = new WebSocket(SERVER_URL);

  ws.on('open', async () => {
    console.log('[Client] Connected to server');
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }

    const tree = await getFileTree(DATA_DIR);
    const files = readFilesMap(DATA_DIR, tree);
    ws.send(JSON.stringify({ type: 'init-tree', tree, files }));
  });

  ws.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }

    switch (msg.type) {
      case 'init-done': {
        if (watcherState) watcherState.watcher.close();
        watcherState = startWatcher();
        console.log('[Client] Sync initialized, watching for changes...');
        break;
      }

      case 'server-file': {
        if (!watcherState) {
          applyFileChange(msg.path, msg.content);
        }
        break;
      }

      case 'add':
      case 'change': {
        if (!watcherState) break;
        const absPath = path.join(DATA_DIR, msg.path);
        watcherState.syncing.add(absPath);
        applyFileChange(msg.path, msg.content);
        setTimeout(() => watcherState.syncing.delete(absPath), 500);
        console.log(`[Client] Synced ${msg.type}: ${msg.path}`);
        break;
      }

      case 'delete': {
        if (!watcherState) break;
        const absPath = path.join(DATA_DIR, msg.path);
        watcherState.syncing.add(absPath);
        applyDelete(msg.path, msg.isDirectory);
        setTimeout(() => watcherState.syncing.delete(absPath), 500);
        console.log(`[Client] Synced delete: ${msg.path}`);
        break;
      }

      case 'add-dir': {
        if (!watcherState) break;
        const absPath = path.join(DATA_DIR, msg.path);
        watcherState.syncing.add(absPath);
        fs.mkdirSync(absPath, { recursive: true });
        setTimeout(() => watcherState.syncing.delete(absPath), 500);
        console.log(`[Client] Synced add-dir: ${msg.path}`);
        break;
      }
    }
  });

  ws.on('close', () => {
    console.log('[Client] Disconnected, reconnecting in 2s...');
    if (watcherState) watcherState.watcher.close();
    watcherState = null;
    reconnectTimer = setTimeout(connect, 2000);
  });

  ws.on('error', (err) => {
    console.error('[Client] WebSocket error:', err.message);
    ws.close();
  });
}

function startWatcher() {
  const syncing = new Set();

  const watcher = chokidar.watch(DATA_DIR, {
    ignored: (p) => {
      if (p === DATA_DIR) return false;
      return isHidden(p);
    },
    persistent: true,
    ignoreInitial: true,
    awaitWriteFinish: { stabilityThreshold: 200, pollInterval: 100 },
  });

  watcher
    .on('add', (filePath) => {
      if (syncing.has(filePath)) return;
      const relPath = relativePath(filePath);
      console.log(`[Client] File added locally: ${relPath}`);
      ws.send(JSON.stringify({ type: 'add', path: relPath, content: readFileContent(filePath) }));
    })
    .on('change', (filePath) => {
      if (syncing.has(filePath)) return;
      const relPath = relativePath(filePath);
      console.log(`[Client] File changed locally: ${relPath}`);
      ws.send(JSON.stringify({ type: 'change', path: relPath, content: readFileContent(filePath) }));
    })
    .on('unlink', (filePath) => {
      if (syncing.has(filePath)) return;
      const relPath = relativePath(filePath);
      console.log(`[Client] File deleted locally: ${relPath}`);
      ws.send(JSON.stringify({ type: 'delete', path: relPath, isDirectory: false }));
    })
    .on('addDir', (dirPath) => {
      if (syncing.has(dirPath)) return;
      const relPath = relativePath(dirPath);
      if (relPath === '') return;
      console.log(`[Client] Dir added locally: ${relPath}`);
      ws.send(JSON.stringify({ type: 'add-dir', path: relPath }));
    })
    .on('unlinkDir', (dirPath) => {
      if (syncing.has(dirPath)) return;
      const relPath = relativePath(dirPath);
      if (relPath === '') return;
      console.log(`[Client] Dir deleted locally: ${relPath}`);
      ws.send(JSON.stringify({ type: 'delete', path: relPath, isDirectory: true }));
    });

  return { watcher, syncing };
}

function readFileContent(absPath) {
  return fs.readFileSync(absPath).toString('base64');
}

connect();