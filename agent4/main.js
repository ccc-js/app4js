const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const http = require('http');

const WORKSPACE = path.resolve(__dirname, '..', 'box4', 'test_server_data');
const MODEL = "minimax-m2.5:cloud";
const MAX_TURNS = 5;

let mainWin;

function createWindow() {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  });
  win.loadFile('index.html');
  win.webContents.openDevTools();
  return win;
}

app.setName('Agent4');

// --- Agent engine in main process ---

const conversationHistory = [];
const keyInfo = [];

function callOllama(prompt, system = "") {
  return new Promise((resolve) => {
    const fullPrompt = system ? `${system}\n\n${prompt}` : prompt;
    const payload = JSON.stringify({
      model: MODEL,
      prompt: fullPrompt,
      stream: false
    });

    const opts = {
      hostname: '127.0.0.1',
      port: 11434,
      path: '/api/generate',
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }
    };

    const req = http.request(opts, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try {
          const result = JSON.parse(body);
          resolve((result.response || "").trim());
        } catch (e) {
          resolve(`Error: parse failed - ${e.message}`);
        }
      });
    });

    req.on('error', (e) => resolve(`Error: ${e.message}`));
    req.write(payload);
    req.end();
  });
}

function buildContext() {
  const parts = [];
  if (keyInfo.length > 0) {
    const items = keyInfo.map(k => `  <item>${k}</item>`).join("\n");
    parts.push(`<memory>\n${items}\n</memory>`);
  }
  if (conversationHistory.length > 0) {
    const recent = conversationHistory.slice(-MAX_TURNS * 2);
    parts.push("<history>\n" + recent.join("\n") + "\n</history>");
  }
  return parts.join("\n\n");
}

async function executeCommand(cmd) {
  return new Promise((resolve) => {
    const proc = spawn(cmd, { shell: true, cwd: WORKSPACE });
    let stdout = "", stderr = "";
    proc.stdout.on("data", d => stdout += d.toString());
    proc.stderr.on("data", d => stderr += d.toString());
    proc.on("close", () => resolve({ stdout, stderr }));
    proc.on("error", (e) => resolve({ stdout, stderr: e.message }));
    setTimeout(() => {
      proc.kill();
      resolve({ stdout, stderr: "(timeout)" });
    }, 30000);
  });
}

function sendToRenderer(channel, data) {
  if (mainWin && !mainWin.isDestroyed()) {
    mainWin.webContents.send(channel, data);
  }
}

const SYSTEM_PROMPT = `你是 Jarvis，一個有用的 AI 助理，專門在 workspace 中寫程式。

你的 workspace 路徑是：${WORKSPACE}

重要規則：
1. 當你需要執行 shell 命令時，必須用 <shell> 標籤包住命令
2. <shell> 標籤內可以是多行命令（用 && 或 ; 連接）
3. 所有命令都在 workspace 目錄下執行
4. 當你完成所有操作後，用 <end/> 結束你的回覆

流程：
- 如果需要執行命令，輸出 <shell>...</shell>
- 執行完後我會顯示結果
- 如果還需要更多命令，繼續輸出 <shell>
- 當完成所有操作後，輸出 <end/> 表示結束`;

async function runAgent(userInput) {
  const context = buildContext();
  const fullPrompt = context
    ? `${context}\n\n<user>${userInput}</user>`
    : `<user>${userInput}</user>`;

  sendToRenderer('agent:thinking', true);

  let response = await callOllama(fullPrompt, SYSTEM_PROMPT);
  let finalResponse = response;
  let toolResult;

  while (true) {
    if (response.includes("<end/>")) {
      finalResponse = response.split("<end/>")[0].trim();
      break;
    }

    const shellRegex = /<shell>([\s\S]*?)<\/shell>/g;
    const matches = response.match(shellRegex);
    if (!matches) {
      finalResponse = response;
      break;
    }

    const allOutputs = [];
    for (const match of matches) {
      const cmd = match.replace(/<\/?shell>/g, "").trim();
      sendToRenderer('agent:cmd', { cmd, status: 'running' });
      const result = await executeCommand(cmd);
      const output = (result.stdout + result.stderr) || "(no output)";
      allOutputs.push(`$ ${cmd}\n${output}`);
      sendToRenderer('agent:cmd', { cmd, output, status: 'done' });
    }

    toolResult = (toolResult || "") + "\n" + allOutputs.join("\n");

    const followUp = `<context>${context}</context>
<user>${userInput}</user>
<assistant>${response}</assistant>
<output>
${allOutputs.join("\n")}
</output>
如果需要更多命令就輸出 <shell>。否則，輸出 <end/> 表示結束：`;

    response = await callOllama(followUp, SYSTEM_PROMPT);
  }

  sendToRenderer('agent:thinking', false);

  conversationHistory.push(`  <user>${userInput}</user>`);
  conversationHistory.push(`  <assistant>${finalResponse}</assistant>`);
  if (toolResult) {
    conversationHistory.push(`  <tool>${toolResult.slice(0, 500)}</tool>`);
  }
  while (conversationHistory.length > MAX_TURNS * 4) {
    conversationHistory.shift();
  }

  return finalResponse;
}

// --- IPC handlers ---

ipcMain.handle('workspace:path', () => WORKSPACE);

ipcMain.handle('agent:run', async (_event, userInput) => {
  try {
    const result = await runAgent(userInput);
    return { success: true, response: result };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

// --- App lifecycle ---

app.whenReady().then(() => {
  mainWin = createWindow();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});