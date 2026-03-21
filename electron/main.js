const { app, BrowserWindow, Menu, ipcMain, session, systemPreferences } = require('electron');
const path = require('path');
const fs = require('fs');
const net = require('net');
const http = require('http');
const { spawn } = require('child_process');

// ─── パス定数 ─────────────────────────────────────────────────────────────────
const PROJECT_ROOT = path.join(__dirname, '..');
const resRoot = () => app.isPackaged ? process.resourcesPath : PROJECT_ROOT;

// ─── 状態 ─────────────────────────────────────────────────────────────────────
let pyProcess = null;
let backendBaseUrl = 'http://127.0.0.1:8000';
let mainWindow = null;

// ─── ユーティリティ ───────────────────────────────────────────────────────────
function getAvailablePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      const port = typeof addr === 'object' && addr ? addr.port : null;
      server.close(() => { if (port) resolve(port); else reject(new Error('Failed to allocate backend port')); });
    });
  });
}

function waitFrontendReady(url, timeoutMs) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    function poll() {
      const req = http.get(url, { timeout: 3000 }, (res) => {
        let body = '';
        res.on('data', d => { body += d; });
        res.on('end', () => {
          const ct = res.headers['content-type'] || '';
          if (res.statusCode === 200 && (ct.includes('text/html') || body.includes('<'))) return resolve();
          if (Date.now() - start > timeoutMs) return reject(new Error('Frontend dev server 启动超时'));
          setTimeout(poll, 800);
        });
      });
      req.on('error', () => {
        if (Date.now() - start > timeoutMs) return reject(new Error('Frontend dev server 启动超时'));
        setTimeout(poll, 800);
      });
    }
    poll();
  });
}

// ─── 开発モード：自動再起動 ───────────────────────────────────────────────────
if (!app.isPackaged) {
  require('electron-reload')(
    [path.join(__dirname, '*.js')],
    { electron: process.execPath, forceHardReset: true, hardResetMethod: 'exit' }
  );
}

// 强制 Chromium UI 语言为中文
app.commandLine.appendSwitch('lang', 'zh-CN');

// ─── 单实例互斥：杀掉旧实例 ──────────────────────────────────────────────────
(function killPreviousInstance() {
  const os = require('os');
  const { execSync } = require('child_process');
  const pidFile = path.join(os.tmpdir(), 'ai-workshop-main.pid');

  try {
    const oldPid = parseInt(fs.readFileSync(pidFile, 'utf-8').trim(), 10);
    if (oldPid && oldPid !== process.pid) {
      try {
        process.kill(oldPid, 0);
        if (process.platform === 'win32') {
          execSync(`taskkill /F /T /PID ${oldPid}`, { stdio: 'ignore' });
        } else {
          execSync(`kill -9 ${oldPid} 2>/dev/null; true`, { shell: true, stdio: 'ignore' });
        }
      } catch { /**/ }
    }
  } catch { /**/ }

  try {
    if (process.platform === 'win32') {
      execSync('taskkill /F /FI "IMAGENAME eq uvicorn.exe" 2>nul', { stdio: 'ignore' });
    } else {
      execSync(
        "pkill -f 'uvicorn main:app' 2>/dev/null; pkill -f 'backend/main\\.py' 2>/dev/null; pkill -f 'fish_speech_worker\\.py' 2>/dev/null; pkill -f 'seed_vc_worker\\.py' 2>/dev/null; true",
        { shell: true, stdio: 'ignore' }
      );
    }
  } catch { /**/ }

  try { fs.writeFileSync(pidFile, String(process.pid), 'utf-8'); } catch { /**/ }
  app.on('before-quit', () => { try { fs.unlinkSync(pidFile); } catch { /**/ } });
}());

// ─── メインウィンドウ作成 ─────────────────────────────────────────────────────
async function createWindow() {
  // macOS マイク権限
  session.defaultSession.setPermissionCheckHandler((_wc, permission) => {
    if (permission === 'media' || permission === 'microphone' || permission === 'audioCapture') return true;
    return null;
  });
  session.defaultSession.setPermissionRequestHandler((_wc, permission, callback) => {
    callback(permission === 'media' || permission === 'microphone' || permission === 'audioCapture');
  });
  if (process.platform === 'darwin') {
    systemPreferences.askForMediaAccess('microphone').catch(() => {});
  }

  const iconPath = process.platform === 'win32'
    ? path.join(resRoot(), 'assets', 'icon.png')
    : path.join(resRoot(), 'assets', 'icon.icns');
  if (process.platform === 'darwin' && app.dock) {
    app.dock.setIcon(path.join(resRoot(), 'assets', 'icon.png'));
  }
  const win = new BrowserWindow({
    width: 1100, height: 800, title: 'AI Workshop', icon: iconPath,
    webPreferences: { nodeIntegration: false, contextIsolation: true },
  });
  mainWindow = win;
  win.on('page-title-updated', e => e.preventDefault());

  const menu = Menu.buildFromTemplate([
    { role: 'appMenu' },
    { role: 'editMenu' },
    {
      label: '视图',
      submenu: [
        { label: '刷新窗口', accelerator: 'CmdOrCtrl+R', click: () => win.reload() },
        { label: '开发者工具', accelerator: 'F12', click: () => win.webContents.toggleDevTools() },
      ],
    },
  ]);
  Menu.setApplicationMenu(menu);

  // ── バックエンド起動 ──
  const isDev = !app.isPackaged;
  const backendPort = process.env.BACKEND_PORT || String(await getAvailablePort());
  backendBaseUrl = `http://127.0.0.1:${backendPort}`;

  let pyCmd, pyArgs, cwd;

  if (isDev) {
    pyCmd = 'mise';
    pyArgs = ['exec', '--', 'poetry', 'run', 'uvicorn', 'main:app',
      '--reload', '--reload-dir', '.',
      '--host', '127.0.0.1', '--port', backendPort,
    ];
    cwd = path.join(PROJECT_ROOT, 'backend');
  } else {
    const isMac = process.platform === 'darwin';
    const res = resRoot();
    pyCmd = isMac
      ? path.join(res, 'runtime', 'python', 'mac', 'bin', 'python3')
      : path.join(res, 'runtime', 'python', 'win', 'python.exe');
    pyArgs = [path.join(res, 'backend', 'main.py')];
    cwd = res;
  }

  // BACKEND_PORT: Electron が動的に割り当てたポート（backend は __file__ から他のパスを自力解決）
  const backendEnv = {
    ...process.env,
    BACKEND_PORT: backendPort,
  };

  console.log(`Start backend: ${pyCmd} ${pyArgs.join(' ')}`);
  console.log(`Backend URL: ${backendBaseUrl}`);

  pyProcess = spawn(pyCmd, pyArgs, { cwd, shell: isDev, env: backendEnv });

  pyProcess.stdout.on('data', (data) => { try { process.stdout.write(`[Backend] ${data}`); } catch { /**/ } });
  pyProcess.stderr.on('data', (data) => { try { process.stderr.write(`[Backend] ${data}`); } catch { /**/ } });
  pyProcess.on('error', (err) => console.error('[Python Spawn Error]:', err));
  pyProcess.on('exit', (code, signal) => { if (code !== 0) console.error(`[Backend] exited code=${code} signal=${signal}`); });

  // ── フロントエンド読み込み ──
  if (isDev) {
    const frontendUrl = 'http://localhost:3000';
    console.log(`[UI] Waiting for frontend dev server at ${frontendUrl} ...`);
    try { await waitFrontendReady(frontendUrl, 60000); } catch (err) { console.error(`[UI] ${err.message}, loading anyway`); }
    await win.loadURL(`${frontendUrl}?backendUrl=${encodeURIComponent(backendBaseUrl)}`);
    win.setTitle(`AI Workshop (Dev · backend:${backendPort})`);
  } else {
    await win.loadFile(path.join(PROJECT_ROOT, 'frontend', 'out', 'index.html'), {
      query: { backendUrl: backendBaseUrl },
    });
  }
}

// ─── ライフサイクル ───────────────────────────────────────────────────────────
app.on('before-quit', () => {
  try {
    const { execSync } = require('child_process');
    if (process.platform === 'win32') {
      execSync('taskkill /F /FI "IMAGENAME eq python3.exe" /FI "WINDOWTITLE eq *worker*" 2>nul', { stdio: 'ignore' });
    } else {
      execSync(
        "pkill -f 'fish_speech_worker\\.py' 2>/dev/null; pkill -f 'seed_vc_worker\\.py' 2>/dev/null; true",
        { shell: true, stdio: 'ignore' }
      );
    }
  } catch { /**/ }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    if (pyProcess) spawn('taskkill', ['/pid', pyProcess.pid, '/f', '/t']);
    app.quit();
  }
});

app.whenReady().then(createWindow);
