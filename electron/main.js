const { app, BrowserWindow, dialog, ipcMain, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const http = require('http');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..');
const BACKEND_DIR = path.join(ROOT, 'backend');
const PORT = 8000;
const STATUS_URL = `http://127.0.0.1:${PORT}/status`;

let mainWindow = null;
let backend = null;       // the backend process, only if File Genie started it
let backendLog = '';      // the last bit of backend output, shown if startup fails
let pythonUsed = '';
let quitting = false;

// ---------- Backend: find Python, start it, wait for it, stop it ----------

// Reads one KEY=value line from the project-root .env (used for FG_PYTHON).
function readRootEnv(key) {
  try {
    const text = fs.readFileSync(path.join(ROOT, '.env'), 'utf8');
    const match = text.match(new RegExp('^\\s*' + key + '\\s*=\\s*(.+?)\\s*$', 'm'));
    return match ? match[1].replace(/^["']|["']$/g, '') : null;
  } catch (err) {
    return null;
  }
}

// Order: FG_PYTHON (environment or .env), then a venv inside the project, then plain "python".
function findPython() {
  const candidates = [
    process.env.FG_PYTHON,
    readRootEnv('FG_PYTHON'),
    path.join(BACKEND_DIR, 'venv', 'Scripts', 'python.exe'),
    path.join(ROOT, 'venv', 'Scripts', 'python.exe'),
    path.join(ROOT, '.venv', 'Scripts', 'python.exe'),
  ];
  return candidates.find((p) => p && fs.existsSync(p)) || 'python';
}

// True if something is already answering on the backend port.
function pingBackend() {
  return new Promise((resolve) => {
    const req = http.get(STATUS_URL, { timeout: 1500 }, (res) => {
      res.resume();
      resolve(true);
    });
    req.on('timeout', () => { req.destroy(); resolve(false); });
    req.on('error', () => resolve(false));
  });
}

function startBackend() {
  pythonUsed = findPython();
  backend = spawn(
    pythonUsed,
    ['-m', 'uvicorn', 'main:app', '--host', '127.0.0.1', '--port', String(PORT)],
    { cwd: BACKEND_DIR, windowsHide: true }
  );
  const keep = (chunk) => { backendLog = (backendLog + chunk.toString()).slice(-4000); };
  backend.stdout.on('data', keep);
  backend.stderr.on('data', keep);
  backend.on('error', (err) => { backendLog += '\n' + err.message; backend = null; });
  backend.on('exit', () => { backend = null; });
}

function stopBackend() {
  if (!backend) return;
  const pid = backend.pid;
  backend = null;
  try {
    if (process.platform === 'win32') {
      spawn('taskkill', ['/pid', String(pid), '/T', '/F'], { windowsHide: true });
    } else {
      process.kill(pid);
    }
  } catch (err) {
    // already gone
  }
}

// Waits until the backend answers. Gives up early if we started it and it died.
async function waitForBackend(timeoutMs, startedByUs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline && !quitting) {
    if (await pingBackend()) return true;
    if (startedByUs && backend === null) return false;
    await new Promise((r) => setTimeout(r, 700));
  }
  return false;
}

// ---------- Window ----------

function escapeHtml(text) {
  return String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// A simple message page shown while the backend starts, or if it can't.
function showMessage(title, detail) {
  if (!mainWindow) return;
  const html = '<!doctype html><meta charset="utf-8"><title>File Genie</title>' +
    '<body style="margin:0;height:100vh;display:grid;place-items:center;background:#fff;color:#111827;font-family:Segoe UI,sans-serif">' +
    '<div style="max-width:560px;text-align:center;padding:24px">' +
    '<h2 style="margin:0 0 8px;font-weight:600">' + escapeHtml(title) + '</h2>' +
    '<p style="margin:0;color:#6B7280;font-size:13px;white-space:pre-wrap;text-align:left">' + escapeHtml(detail) + '</p>' +
    '</div></body>';
  mainWindow.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
}

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
  mainWindow.on('closed', () => { mainWindow = null; });
}

async function boot() {
  createWindow();
  showMessage('Starting File Genie…', 'Getting the backend ready. The first start can take a little while.');

  let startedByUs = false;
  if (!(await pingBackend())) {
    startBackend();
    startedByUs = true;
  }

  const ready = await waitForBackend(startedByUs ? 120000 : 5000, startedByUs);
  if (!mainWindow || quitting) return;

  if (ready) {
    mainWindow.loadFile(path.join(ROOT, 'frontend', 'index.html'));
  } else {
    showMessage(
      "File Genie couldn't start its backend",
      'Python used: ' + (pythonUsed || 'none') + '\n\n' +
      (backendLog.trim() || 'No output. Check that Python and the backend packages are installed.') + '\n\n' +
      'Tip: add FG_PYTHON=C:\\path\\to\\python.exe to the .env file in the project folder.'
    );
  }
}

// ---------- Folder picker and file actions (called from the page) ----------

// Only plain documents are opened directly. Script and code files (.py, .js, .html ...)
// could be run by Windows instead of opened, so those can only be shown in their folder.
const OPENABLE = new Set(['.pdf', '.docx', '.pptx', '.txt', '.md', '.csv']);

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

ipcMain.handle('pick-folder', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Choose a folder',
    properties: ['openDirectory'],
  });
  if (result.canceled || result.filePaths.length === 0) {
    return null;
  }
  return result.filePaths[0];
});

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

ipcMain.handle('reveal-file', (_event, filePath) => {
  const problem = checkPath(filePath);
  if (problem) return { ok: false, message: problem };
  shell.showItemInFolder(filePath);
  return { ok: true };
});

// ---------- App lifecycle ----------

if (!app.requestSingleInstanceLock()) {
  app.quit(); // File Genie is already open
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
  app.whenReady().then(boot);
}

app.on('window-all-closed', () => app.quit());
app.on('before-quit', () => { quitting = true; stopBackend(); });