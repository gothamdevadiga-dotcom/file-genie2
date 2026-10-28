const { app, BrowserWindow, dialog, ipcMain, shell } = require('electron');
const path = require('path');
const fs = require('fs');

let mainWindow = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, 'preload.js'),
    },
  });

  mainWindow.loadFile(path.join(__dirname, '..', 'frontend', 'index.html'));
}

// Only plain documents are opened directly. Script and code files (.py, .js, .html ...)
// could be run by Windows instead of opened, so those can only be shown in their folder.
const OPENABLE = new Set(['.pdf', '.docx', '.pptx', '.txt', '.md', '.csv']);

// Returns a message if the path can't be used, or null if it is a real file.
function checkPath(filePath) {
  if (typeof filePath !== 'string' || !path.isAbsolute(filePath)) {
    return 'That is not a full file path.';
  }
  let info;
  try {
    info = fs.statSync(filePath);
  } catch (err) {
    return 'The file is no longer at that location. It may have been moved or deleted.';
  }
  if (!info.isFile()) {
    return 'That path is not a file.';
  }
  return null;
}

// The page asks for a folder; only this file is allowed to open the Windows dialog.
// It returns the chosen folder path, or null if the person cancels.
ipcMain.handle('pick-folder', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Choose a folder to scan',
    properties: ['openDirectory'],
  });
  if (result.canceled || result.filePaths.length === 0) {
    return null;
  }
  return result.filePaths[0];
});

// Opens a document in the app Windows normally uses for it (a PDF reader, Word, ...).
ipcMain.handle('open-file', async (_event, filePath) => {
  const problem = checkPath(filePath);
  if (problem) return { ok: false, message: problem };

  if (!OPENABLE.has(path.extname(filePath).toLowerCase())) {
    return {
      ok: false,
      message: 'For safety, File Genie only opens documents (PDF, Word, PowerPoint, text, CSV). Use Show in folder for code files.',
    };
  }

  const error = await shell.openPath(filePath); // returns '' when it worked
  return error ? { ok: false, message: error } : { ok: true };
});

// Shows the file highlighted in Windows File Explorer.
ipcMain.handle('reveal-file', (_event, filePath) => {
  const problem = checkPath(filePath);
  if (problem) return { ok: false, message: problem };
  shell.showItemInFolder(filePath);
  return { ok: true };
});

app.whenReady().then(createWindow);