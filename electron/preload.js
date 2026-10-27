const { contextBridge, ipcRenderer } = require('electron');

// The page can only call what is listed here. It gets no access to Node or the file system.
contextBridge.exposeInMainWorld('fileGenie', {
  pickFolder: () => ipcRenderer.invoke('pick-folder'),
});