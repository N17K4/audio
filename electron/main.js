const { app, BrowserWindow, Menu, ipcMain, desktopCapturer, shell, dialog, session, systemPreferences } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

const { PROJECT_ROOT, LOGS_DIR, CACHE_DIR, getCheckpointsDir, getUserPackagesDir, getResRoot } = require('./paths');
const { electronLog, frontendLog } = require('./logger');
const state = require('./state');
const { getAvailablePort, waitBackendReady, waitFrontendReady, fetchRuntimeInfo } = require('./utils');
const { openHealthCheckWindow, openSetupGuideWindow } = require('./windows');
const { registerSetupIpc } = require('./ipc-setup');
const { registerAppIpc } = require('./ipc-app');

// 开発モード：main.js / preload.js 変動で自動再起動
if (!app.isPackaged) {
  require('electron-reload')(
    [
      path.join(__dirname, '*.js'),
    ],
    {
      electron: process.execPath,
      forceHardReset: true,
      hardResetMethod: 'exit',
    }
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

// ─── IPC ハンドラ登録 ─────────────────────────────────────────────────────────
registerSetupIpc();
registerAppIpc();

// ─── メインウィンドウ作成 ─────────────────────────────────────────────────────
async function createWindow() {
  // macOS 麦克风権限
  session.defaultSession.setPermissionCheckHandler((_wc, permission) => {
    if (permission === 'media' || permission === 'microphone' || permission === 'audioCapture') {
      return true;
    }
    return null;
  });
  session.defaultSession.setPermissionRequestHandler((_wc, permission, callback) => {
    if (permission === 'media' || permission === 'microphone' || permission === 'audioCapture') {
      callback(true);
    } else {
      callback(false);
    }
  });
  if (process.platform === 'darwin') {
    systemPreferences.askForMediaAccess('microphone').catch(() => {});
  }

  const iconPath = process.platform === 'win32'
    ? path.join(PROJECT_ROOT, 'assets', 'icon.png')
    : path.join(PROJECT_ROOT, 'assets', 'icon.icns');
  if (process.platform === 'darwin' && app.dock) {
    app.dock.setIcon(path.join(PROJECT_ROOT, 'assets', 'icon.png'));
  }
  const win = new BrowserWindow({
    width: 1100,
    height: 800,
    title: 'AI Workshop',
    icon: iconPath,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
    },
  });
  state.mainWindow = win;
  win.on('page-title-updated', e => e.preventDefault());

  function openLogFile(filename) {
    const logPath = path.join(LOGS_DIR, filename);
    let content = '';
    if (!fs.existsSync(logPath)) {
      content = `（${filename} 暂不存在，该文件会在首次写入日志后生成）\n\n路径：${logPath}`;
    } else {
      try {
        content = fs.readFileSync(logPath, 'utf-8');
      } catch (e) {
        content = `读取失败：${e.message}`;
      }
    }
    const logWin = new BrowserWindow({ width: 900, height: 650, title: filename, parent: win });
    const escaped = content
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
      body{margin:0;background:#1e1e1e;color:#d4d4d4;font:13px/1.6 "Menlo","Consolas",monospace}
      pre{padding:16px;white-space:pre-wrap;word-break:break-all}
    </style></head><body><pre>${escaped}</pre></body></html>`;
    logWin.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
    logWin.setMenuBarVisibility(false);
  }

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

  const isDev = !app.isPackaged;
  const backendPort = process.env.BACKEND_PORT || String(await getAvailablePort());
  state.backendBaseUrl = `http://127.0.0.1:${backendPort}`;

  let pyCmd;
  let pyArgs;
  let cwd;

  if (isDev) {
    pyCmd = 'mise';
    pyArgs = ['exec', '--', 'poetry', 'run', 'uvicorn', 'main:app',
      '--reload', '--reload-dir', '.',
      '--host', '127.0.0.1', '--port', backendPort,
    ];
    cwd = path.join(PROJECT_ROOT, 'backend');
  } else {
    const isMac = process.platform === 'darwin';
    pyCmd = isMac
      ? path.join(process.resourcesPath, 'runtime', 'python', 'mac', 'bin', 'python3')
      : path.join(process.resourcesPath, 'runtime', 'python', 'win', 'python.exe');
    pyArgs = [path.join(PROJECT_ROOT, 'backend', 'main.py')];
    cwd = PROJECT_ROOT;
  }

  // ── 防御：清理 python-packages/ 中与嵌入式 Python 冲突的包 ──
  const mlPkgDir = app.isPackaged
    ? getUserPackagesDir()
    : path.join(PROJECT_ROOT, 'runtime', 'ml');
  if (fs.existsSync(mlPkgDir)) {
    const protectedPrefixes = [
      'pydantic_core', 'pydantic-', 'pydantic.',
      'fastapi', 'starlette', 'uvicorn',
      'httpx', 'httpcore', 'anyio', 'sniffio',
      'typing_extensions', 'annotated_types',
    ];
    try {
      for (const name of fs.readdirSync(mlPkgDir)) {
        const lower = name.toLowerCase().replace(/-/g, '_');
        const isConflict = protectedPrefixes.some(prefix => {
          const p = prefix.replace(/-/g, '_');
          return lower === p || lower.startsWith(p + '-') || lower.startsWith(p + '.');
        });
        if (isConflict) {
          const fullPath = path.join(mlPkgDir, name);
          try {
            fs.rmSync(fullPath, { recursive: true, force: true });
            console.log(`[cleanup] 删除冲突包: ${name}`);
          } catch (e) {
            console.warn(`[cleanup] 删除失败: ${name}`, e.message);
          }
        }
      }
    } catch (e) {
      console.warn('[cleanup] 扫描 python-packages 失败:', e.message);
    }
  }

  // ── 統一環境変数 ──
  const resRoot = getResRoot();
  const backendEnv = {
    ...process.env,
    BACKEND_HOST: '127.0.0.1',
    BACKEND_PORT: backendPort,
    RESOURCES_ROOT: resRoot,
    CHECKPOINTS_DIR: getCheckpointsDir(),
    PYTHONPATH: [path.join(PROJECT_ROOT, 'backend'), mlPkgDir].join(path.delimiter),
    PYTHONIOENCODING: 'utf-8',
    ...(LOGS_DIR ? { LOGS_DIR } : {}),
    CACHE_DIR,
  };

  console.log(`Start backend: ${pyCmd} ${pyArgs.join(' ')}`);
  console.log(`Backend URL: ${state.backendBaseUrl}`);

  state.pyProcess = spawn(pyCmd, pyArgs, {
    cwd,
    shell: isDev,
    env: backendEnv,
  });

  state.pyProcess.stdout.on('data', (data) => {
    try { process.stdout.write(`[Backend] ${data}`); } catch { /**/ }
    electronLog('INFO', '[Backend]', data.toString().trim());
  });
  state.pyProcess.stderr.on('data', (data) => {
    try { process.stderr.write(`[Backend] ${data}`); } catch { /**/ }
    electronLog('ERROR', '[Backend stderr]', data.toString().trim());
  });
  state.pyProcess.on('error', (err) => console.error('[Python Spawn Error]:', err));
  state.pyProcess.on('exit', (code, signal) => {
    if (code !== 0) console.error(`[Backend] exited code=${code} signal=${signal}`);
  });

  if (isDev) {
    const frontendPort = 3000;
    const frontendUrl = `http://localhost:${frontendPort}`;
    console.log(`[UI] Waiting for frontend dev server at ${frontendUrl} ...`);
    try {
      await waitFrontendReady(frontendUrl, 60000);
      console.log(`[UI] Frontend ready, loading ${frontendUrl}`);
    } catch (err) {
      console.error(`[UI] ${err.message}, loading anyway`);
    }
    await win.loadURL(frontendUrl);
    win.setTitle(`AI Workshop (Dev · backend:${backendPort})`);
  } else {
    await win.loadFile(path.join(PROJECT_ROOT, 'frontend', 'out', 'index.html'));
  }

  // 生産モード：backend 就緒後にモデル検出 → 不足時は引導ウィンドウ
  if (!isDev) {
    waitBackendReady(state.backendBaseUrl, 90000)
      .then(() => fetchRuntimeInfo(state.backendBaseUrl))
      .then((runtimeInfo) => {
        const missingEngines = Object.entries(runtimeInfo.engines || {})
          .filter(([, v]) => !v.ready)
          .map(([name, v]) => ({ engine: name, files: v.missing_checkpoints || [] }));
        if (missingEngines.length > 0) {
          openSetupGuideWindow(missingEngines);
        }
      })
      .catch((err) => {
        console.error('[Setup] 检测模型状态失败:', err.message);
      });
  }
}

// ─── 残りの IPC ハンドラ ─────────────────────────────────────────────────────
ipcMain.handle('desktop-capturer:get-sources', async () => {
  const sources = await desktopCapturer.getSources({ types: ['screen'] });
  return sources.map((s) => ({ id: s.id, name: s.name }));
});

ipcMain.handle('backend:get-base-url', async () => state.backendBaseUrl);

ipcMain.on('log:renderer', (_event, level, message) => {
  if (frontendLog) frontendLog(level, message);
});

ipcMain.handle('dialog:selectDir', async () => {
  const result = await dialog.showOpenDialog({ properties: ['openDirectory'] });
  return result.canceled ? '' : (result.filePaths[0] || '');
});

app.on('before-quit', () => {
  if (state.downloadProc) { state.downloadProc.kill(); state.downloadProc = null; }
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
    if (state.pyProcess) {
      spawn('taskkill', ['/pid', state.pyProcess.pid, '/f', '/t']);
    }
    app.quit();
  }
});

app.whenReady().then(createWindow);
