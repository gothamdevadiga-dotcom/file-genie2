const { contextBridge, ipcRenderer } = require('electron');

// The page can only call what is listed here. It gets no access to Node or the file system.
contextBridge.exposeInMainWorld('fileGenie', {
  pickFolder: () => ipcRenderer.invoke('pick-folder'),
  openFile: (filePath) => ipcRenderer.invoke('open-file', filePath),
  revealFile: (filePath) => ipcRenderer.invoke('reveal-file', filePath),
});