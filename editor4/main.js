const { app, BrowserWindow, Menu, ipcMain, dialog } = require('electron');
const fs = require('fs');

function createWindow() {
  const win = new BrowserWindow({
    width: 1000,
    height: 700,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  });
  win.loadFile('index.html');
  win.webContents.openDevTools();
  return win;
}

app.setName('Editor4');

ipcMain.handle('dialog:openDirectory', () => dialog.showOpenDialog({ properties: ['openDirectory'] }));
ipcMain.handle('dialog:saveFile', () => dialog.showSaveDialog({ properties: ['saveFile'] }));
ipcMain.handle('fs:readdir', (_e, dirPath) =>
  fs.promises.readdir(dirPath, { withFileTypes: true }).then(entries =>
    entries.map(e => ({ name: e.name, isDirectory: e.isDirectory(), isFile: e.isFile() }))
  )
);
ipcMain.handle('fs:readFile', (_e, filePath) => fs.promises.readFile(filePath, 'utf8'));
ipcMain.handle('fs:writeFile', (_e, filePath, content) => { fs.writeFileSync(filePath, content, 'utf8'); });
ipcMain.handle('fs:stat', (_e, filePath) => fs.promises.stat(filePath).then(s => ({ isDirectory: s.isDirectory() })));

app.whenReady().then(() => {
  const win = createWindow();

  const menuTemplate = [
    {
      label: 'Editor4',
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { label: 'Quit', accelerator: 'Cmd+Q', click: () => app.quit() }
      ]
    },
    {
      label: 'File',
      submenu: [
        { label: 'Open...', accelerator: 'Cmd+O', click: () => win.webContents.executeJavaScript('openFolder()') },
        { label: 'Save', accelerator: 'Cmd+S', click: () => win.webContents.executeJavaScript('saveFile()') },
        { label: 'Save As...', accelerator: 'Cmd+Shift+S', click: () => win.webContents.executeJavaScript('saveFileAs()') },
        { label: 'Close', accelerator: 'Cmd+W', click: () => win.webContents.executeJavaScript('closeEditor()') }
      ]
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' }, { role: 'redo' }, { type: 'separator' },
        { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }
      ]
    },
    { label: 'Selection', submenu: [{ label: 'Placeholder' }] },
    { label: 'Help', submenu: [{ role: 'about' }] }
  ];

  const menu = Menu.buildFromTemplate(menuTemplate);
  Menu.setApplicationMenu(menu);
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});