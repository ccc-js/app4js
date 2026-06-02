const fs = require('fs');
const path = require('path');
const chokidar = require('chokidar');
const { WebSocketServer } = require('ws');

const PORT = parseInt(process.argv[2], 10) || process.env.PORT || 3000;
const DATA_DIR = path.resolve(process.argv[3] || 'server_data');

fs.mkdirSync(DATA_DIR, { recursive: true });

const wss = new WebSocketServer({ port: PORT });
console.log(`[Server] Listening on ws://localhost:${PORT}`);
console.log(`[Server] Data dir: ${DATA_DIR}`);

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

function readFileContent(absPath) {
  return fs.readFileSync(absPath).toString('base64');
}

function sendJSON(ws, obj) {
  if (ws.readyState === ws.OPEN) {
    ws.send(JSON.stringify(obj));
  }
}

async function handleInitSync(ws) {
  const serverTree = await getFileTree(DATA_DIR);
  sendJSON(ws, { type: 'init-sync', tree: serverTree });

  ws.send(JSON.stringify({ type: 'init-sync-start' }));
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

async function syncMissingFiles(ws, clientTree) {
  const serverTree = await getFileTree(DATA_DIR);

  for (const [relPath, info] of Object.entries(clientTree)) {
    if (!serverTree[relPath]) {
      continue;
    }
    if (!info.isDirectory && serverTree[relPath].mtime < info.mtime) {
      const absPath = path.join(DATA_DIR, relPath);
      if (fs.existsSync(absPath)) {
        applyFileChange(relPath, readFileContent(absPath));
      }
    }
  }

  for (const [relPath, info] of Object.entries(clientTree)) {
    if (!serverTree[relPath] && !info.isDirectory) {
      sendJSON(ws, { type: 'need-file', path: relPath });
    }
  }

  for (const [relPath, info] of Object.entries(serverTree)) {
    if (!info.isDirectory && (!clientTree[relPath] ||
        clientTree[relPath].mtime < info.mtime)) {
      const absPath = path.join(DATA_DIR, relPath);
      sendJSON(ws, { type: 'file', path: relPath, content: readFileContent(absPath) });
    }
  }
}

function startWatcher(ws) {
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
      console.log(`[Server] File added: ${relPath}`);
      sendJSON(ws, { type: 'add', path: relPath, content: readFileContent(filePath) });
    })
    .on('change', (filePath) => {
      if (syncing.has(filePath)) return;
      const relPath = relativePath(filePath);
      console.log(`[Server] File changed: ${relPath}`);
      sendJSON(ws, { type: 'change', path: relPath, content: readFileContent(filePath) });
    })
    .on('unlink', (filePath) => {
      if (syncing.has(filePath)) return;
      const relPath = relativePath(filePath);
      console.log(`[Server] File deleted: ${relPath}`);
      sendJSON(ws, { type: 'delete', path: relPath, isDirectory: false });
    })
    .on('addDir', (dirPath) => {
      if (syncing.has(dirPath)) return;
      const relPath = relativePath(dirPath);
      if (relPath === '') return;
      console.log(`[Server] Dir added: ${relPath}`);
      sendJSON(ws, { type: 'add-dir', path: relPath });
    })
    .on('unlinkDir', (dirPath) => {
      if (syncing.has(dirPath)) return;
      const relPath = relativePath(dirPath);
      if (relPath === '') return;
      console.log(`[Server] Dir deleted: ${relPath}`);
      sendJSON(ws, { type: 'delete', path: relPath, isDirectory: true });
    });

  return { watcher, syncing };
}

wss.on('connection', (ws) => {
  console.log('[Server] Client connected');
  let watcherState = null;

  ws.on('message', async (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }

    switch (msg.type) {
      case 'init-tree': {
        if (watcherState) watcherState.watcher.close();
        fs.rmSync(DATA_DIR, { recursive: true, force: true });
        fs.mkdirSync(DATA_DIR, { recursive: true });

        for (const [relPath, info] of Object.entries(msg.tree)) {
          if (info.isDirectory) {
            fs.mkdirSync(path.join(DATA_DIR, relPath), { recursive: true });
          } else {
            applyFileChange(relPath, msg.files[relPath]);
          }
        }

        const serverTree = await getFileTree(DATA_DIR);
        for (const [relPath, srvInfo] of Object.entries(serverTree)) {
          if (!msg.tree[relPath] && !srvInfo.isDirectory) {
            sendJSON(ws, { type: 'server-file', path: relPath, content: readFileContent(path.join(DATA_DIR, relPath)) });
          }
        }

        watcherState = startWatcher(ws);
        sendJSON(ws, { type: 'init-done' });
        console.log('[Server] Sync initialized, watching for changes...');
        break;
      }

      case 'add':
      case 'change': {
        if (!watcherState) break;
        watcherState.syncing.add(path.join(DATA_DIR, msg.path));
        applyFileChange(msg.path, msg.content);
        setTimeout(() => watcherState.syncing.delete(path.join(DATA_DIR, msg.path)), 500);
        console.log(`[Server] Received ${msg.type}: ${msg.path}`);
        break;
      }

      case 'delete': {
        if (!watcherState) break;
        watcherState.syncing.add(path.join(DATA_DIR, msg.path));
        applyDelete(msg.path, msg.isDirectory);
        setTimeout(() => watcherState.syncing.delete(path.join(DATA_DIR, msg.path)), 500);
        console.log(`[Server] Received delete: ${msg.path}`);
        break;
      }

      case 'add-dir': {
        if (!watcherState) break;
        watcherState.syncing.add(path.join(DATA_DIR, msg.path));
        fs.mkdirSync(path.join(DATA_DIR, msg.path), { recursive: true });
        setTimeout(() => watcherState.syncing.delete(path.join(DATA_DIR, msg.path)), 500);
        console.log(`[Server] Received add-dir: ${msg.path}`);
        break;
      }
    }
  });

  ws.on('close', () => {
    console.log('[Server] Client disconnected');
    if (watcherState) watcherState.watcher.close();
  });
});