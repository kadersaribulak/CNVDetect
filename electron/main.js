const { app, BrowserWindow, ipcMain, dialog } = require('electron')
const path = require('path')
const { spawn } = require('child_process')
const fs = require('fs')

const isDev = !app.isPackaged
let win, backend

function startBackend() {
  const backendDir = isDev
    ? path.join(__dirname, '..', 'backend')
    : path.join(process.resourcesPath, 'backend')
  const py = process.platform === 'win32' ? 'python' : 'python3'
  backend = spawn(py, ['-m', 'uvicorn', 'main:app', '--port', '8765', '--host', '127.0.0.1'], {
    cwd: backendDir, stdio: 'pipe'
  })
  backend.stderr.on('data', d => console.log('[backend]', d.toString()))
}

function createWindow() {
  win = new BrowserWindow({
    width: 1360, height: 860, minWidth: 900, minHeight: 620,
    backgroundColor: '#f0f3f8',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true, nodeIntegration: false
    },
    title: 'CNVDetect', show: false
  })
  win.once('ready-to-show', () => win.show())
  isDev ? setTimeout(() => win.loadURL('http://localhost:5173'), 1500)
        : win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'))
}

ipcMain.handle('dialog:openFolder', async (_, opts = {}) => {
  const r = await dialog.showOpenDialog(win, { title: opts.title || 'Klasör Seç', properties: ['openDirectory', 'createDirectory'] })
  return r.canceled ? null : r.filePaths[0]
})
ipcMain.handle('dialog:openFile', async (_, opts = {}) => {
  const r = await dialog.showOpenDialog(win, { title: opts.title || 'Dosya Seç', filters: opts.filters || [{ name: 'Tüm', extensions: ['*'] }], properties: ['openFile'] })
  return r.canceled ? null : r.filePaths[0]
})
ipcMain.handle('dialog:saveFile', async (_, opts = {}) => {
  const r = await dialog.showSaveDialog(win, { title: opts.title || 'Kaydet', defaultPath: opts.defaultPath || 'file.txt', filters: opts.filters || [{ name: 'Tüm', extensions: ['*'] }] })
  return r.canceled ? null : r.filePath
})
ipcMain.handle('fs:writeFile', async (_, { filePath, content }) => {
  try { fs.writeFileSync(filePath, content, 'utf-8'); return { ok: true } }
  catch (e) { return { ok: false, error: e.message } }
})
ipcMain.handle('fs:readFile', async (_, filePath) => {
  try { return { ok: true, content: fs.readFileSync(filePath, 'utf-8') } }
  catch (e) { return { ok: false, error: e.message } }
})

app.whenReady().then(() => { startBackend(); createWindow() })
app.on('window-all-closed', () => { if (backend) backend.kill(); if (process.platform !== 'darwin') app.quit() })
app.on('before-quit', () => { if (backend) backend.kill() })
