const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('electron', {
  isElectron: true,
  openFolder:  (opts) => ipcRenderer.invoke('dialog:openFolder', opts),
  openFile:    (opts) => ipcRenderer.invoke('dialog:openFile', opts),
  saveFile:    (opts) => ipcRenderer.invoke('dialog:saveFile', opts),
  writeFile:   (filePath, content) => ipcRenderer.invoke('fs:writeFile', { filePath, content }),
  readFile:    (filePath) => ipcRenderer.invoke('fs:readFile', filePath),
})
