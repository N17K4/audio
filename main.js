const { app, BrowserWindow, Menu, ipcMain, desktopCapturer, shell, dialog, session, systemPreferences } = require('electron');
const path = require('path');
const fs = require('fs');
const net = require('net');
const http = require('http');
const { spawn } = require('child_process');

// 开发模式：监听 main.js / preload.js 变动自动重启 Electron
if (!app.isPackaged) {
  require('electron-reload')(
    [
      path.join(__dirname, 'main.js'),
      path.join(__dirname, 'preload.js'),
    ],
    {
      electron: process.execPath,
      forceHardReset: true,
      hardResetMethod: 'exit',
    }
  );
}

// 强制 Chromium UI 语言为中文（文件选择按钮等原生控件显示中文）
app.commandLine.appendSwitch('lang', 'zh-CN');

// ─── 单实例互斥：杀掉旧实例（dev ↔ dist 双向） ──────────────────────────────
// 策略：用 os.tmpdir()/ai-workshop-main.pid 记录主进程 PID，
//       每次启动先读取旧 PID → 杀掉 → 顺带清理孤儿后端进程 → 写入新 PID。
(function killPreviousInstance() {
  const os = require('os');
  const { execSync } = require('child_process');
  const pidFile = path.join(os.tmpdir(), 'ai-workshop-main.pid');

  // 1. 通过 PID 文件杀掉上一个 Electron 主进程
  try {
    const oldPid = parseInt(fs.readFileSync(pidFile, 'utf-8').trim(), 10);
    if (oldPid && oldPid !== process.pid) {
      try {
        process.kill(oldPid, 0); // 检查进程是否仍存在（抛 ESRCH 则已死）
        if (process.platform === 'win32') {
          execSync(`taskkill /F /T /PID ${oldPid}`, { stdio: 'ignore' });
        } else {
          execSync(`kill -9 ${oldPid} 2>/dev/null; true`, { shell: true, stdio: 'ignore' });
        }
      } catch { /* ESRCH: 进程已退出，忽略 */ }
    }
  } catch { /* PID 文件不存在或格式错误，忽略 */ }

  // 2. 清理孤儿后端进程（父进程死后 uvicorn/python 可能继续运行）
  try {
    if (process.platform === 'win32') {
      execSync('taskkill /F /FI "IMAGENAME eq uvicorn.exe" 2>nul', { stdio: 'ignore' });
    } else {
      execSync(
        "pkill -f 'uvicorn main:app' 2>/dev/null; pkill -f 'backend/main\\.py' 2>/dev/null; true",
        { shell: true, stdio: 'ignore' }
      );
    }
  } catch { /**/ }

  // 3. 写入当前 PID
  try { fs.writeFileSync(pidFile, String(process.pid), 'utf-8'); } catch { /**/ }

  // 4. 退出时清理 PID 文件，避免下次误杀不存在的 PID
  app.on('before-quit', () => { try { fs.unlinkSync(pidFile); } catch { /**/ } });
}());

// ─── 文件日志 ─────────────────────────────────────────────────────────────────
// dev:  <项目根>/logs/
// prod: .app 同级目录（Mac）或 exe 所在目录（Win）下的 logs/
//   electron.log  — Electron 主进程事件
//   backend.log   — Python FastAPI 日志（Python 自身写入）
//   frontend.log  — 前端渲染进程 JS 未处理异常（通过 IPC 写入）
function _resolveLogsDir() {
  if (app.isPackaged) {
    const exeDir = path.dirname(app.getPath('exe'));
    const container = process.platform === 'darwin'
      ? path.join(exeDir, '..', '..', '..')  // .app/Contents/MacOS → 上三级
      : exeDir;
    return path.join(container, 'logs');
  }
  return path.join(__dirname, 'logs');
}
const LOGS_DIR = _resolveLogsDir();
fs.mkdirSync(LOGS_DIR, { recursive: true });

function createFileLogger(filename) {
  const logPath = path.join(LOGS_DIR, filename);
  const stream = fs.createWriteStream(logPath, { flags: 'w', encoding: 'utf-8' });
  return function write(level, ...args) {
    const line = `${new Date().toISOString()} [${level}] ${args.join(' ')}\n`;
    stream.write(line);
  };
}

const electronLog = createFileLogger('electron.log');
let frontendLog = createFileLogger('frontend.log');

// 主进程 console → electron.log
const _origLog = console.log.bind(console);
const _origErr = console.error.bind(console);
console.log = (...a) => { try { _origLog(...a); } catch { /**/ } electronLog('INFO', ...a); };
console.error = (...a) => { try { _origErr(...a); } catch { /**/ } electronLog('ERROR', ...a); };

// 防止 EPIPE（前端断开连接时写 stdout/stderr）崩溃主进程
process.on('uncaughtException', (err) => {
  if (err.code === 'EPIPE') return; // 管道断开，忽略
  electronLog('ERROR', '[uncaughtException]', err.stack || err.message);
  _origErr('[uncaughtException]', err);
});

let pyProcess = null;
let backendBaseUrl = 'http://127.0.0.1:8000';
let mainWindow = null;

// ─── 日志目录入口（始终返回 <appDir>/logs/）──────────────────────────────────
function getLogDir() {
  return LOGS_DIR;
}

// ─── Checkpoint 目录 ───────────────────────────────────────────────────────
// dev:  <项目根>/checkpoints/（不变）
// prod: app.getPath('userData')/checkpoints/（跨版本持久，%AppData% 合规）
function getCheckpointsDir() {
  if (!app.isPackaged) {
    return path.join(__dirname, 'checkpoints');
  }
  return path.join(app.getPath('userData'), 'checkpoints');
}

// ─── 运行时 Python 包目录（torch 等 ML 包首次启动后安装于此）────────────────
// prod: app.getPath('userData')/python-packages/
function getUserPackagesDir() {
  return path.join(app.getPath('userData'), 'python-packages');
}

// ─── 磁盘大小计算 ─────────────────────────────────────────────────────────────
function getDirSize(dirPath, visitedInodes) {
  if (!visitedInodes) visitedInodes = new Set();
  let total = 0;
  try {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(dirPath, entry.name);
      try {
        if (entry.isDirectory()) {
          total += getDirSize(full, visitedInodes);
        } else {
          const stat = fs.statSync(full);
          if (!visitedInodes.has(stat.ino)) {
            visitedInodes.add(stat.ino);
            total += stat.size;
          }
        }
      } catch {}
    }
  } catch {}
  return total;
}

function dirExists(p) {
  try { return fs.statSync(p).isDirectory(); } catch { return false; }
}

// ─── 健康检查窗口 ─────────────────────────────────────────────────────────────
function openHealthCheckWindow(parentWin) {
  const url = `${backendBaseUrl}/health`;
  const win = new BrowserWindow({
    width: 520,
    height: 360,
    title: '健康检查',
    parent: parentWin,
    resizable: true,
    minimizable: false,
    maximizable: false,
  });
  win.setMenuBarVisibility(false);

  // 先显示"请求中"页面
  const loadingHtml = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
    body{margin:0;background:#1e1e1e;color:#d4d4d4;font:14px/1.6 "Menlo","Consolas",monospace;display:flex;align-items:center;justify-content:center;height:100vh}
    .url{color:#569cd6}
  </style></head><body><div>正在请求 <span class="url">${url}</span> …</div></body></html>`;
  win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(loadingHtml));

  // 异步发起 HTTP 请求
  http.get(url, { timeout: 5000 }, (res) => {
    let body = '';
    res.on('data', chunk => { body += chunk; });
    res.on('end', () => {
      let pretty = body;
      try { pretty = JSON.stringify(JSON.parse(body), null, 2); } catch {}
      const escaped = pretty.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      const statusColor = res.statusCode === 200 ? '#4ec9b0' : '#f48771';
      const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
        body{margin:0;background:#1e1e1e;color:#d4d4d4;font:13px/1.6 "Menlo","Consolas",monospace}
        .bar{padding:10px 16px;background:#252526;border-bottom:1px solid #3c3c3c;font-size:12px}
        .status{color:${statusColor};font-weight:bold}
        .url{color:#569cd6}
        pre{padding:16px;white-space:pre-wrap;word-break:break-all;margin:0}
      </style></head><body>
        <div class="bar">
          <span class="status">HTTP ${res.statusCode}</span>
          &nbsp;·&nbsp;<span class="url">${url}</span>
        </div>
        <pre>${escaped}</pre>
      </body></html>`;
      if (!win.isDestroyed()) win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
    });
  }).on('error', (err) => {
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
      body{margin:0;background:#1e1e1e;color:#f48771;font:13px/1.6 "Menlo","Consolas",monospace;padding:16px}
    </style></head><body><pre>请求失败：${err.message}\n\n地址：${url}</pre></body></html>`;
    if (!win.isDestroyed()) win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
  });
}

// ─── 概览窗口 ──────────────────────────────────────────────────────────────────
let overviewWin = null;

function openOverviewWindow() {
  if (overviewWin && !overviewWin.isDestroyed()) {
    overviewWin.focus();
    return;
  }
  overviewWin = new BrowserWindow({
    width: 640,
    height: 540,
    title: '应用概览 / 模型管理',
    resizable: true,
    minimizable: false,
    maximizable: false,
    webPreferences: {
      preload: path.join(__dirname, 'overview-preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
    },
  });
  overviewWin.setMenu(null);
  overviewWin.loadFile(path.join(__dirname, 'overview.html'));
  overviewWin.on('closed', () => { overviewWin = null; });
}

function getAvailablePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      const port = typeof addr === 'object' && addr ? addr.port : null;
      server.close(() => {
        if (port) resolve(port);
        else reject(new Error('Failed to allocate backend port'));
      });
    });
  });
}

// ─── Backend 就绪检测 ─────────────────────────────────────────────────────
function waitBackendReady(baseUrl, timeoutMs) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    function poll() {
      const req = http.get(`${baseUrl}/health`, { timeout: 3000 }, (res) => {
        res.resume();
        if (res.statusCode === 200) return resolve();
        if (Date.now() - start > timeoutMs) return reject(new Error('Backend 启动超时'));
        setTimeout(poll, 1500);
      });
      req.on('error', () => {
        if (Date.now() - start > timeoutMs) return reject(new Error('Backend 启动超时'));
        setTimeout(poll, 1500);
      });
    }
    poll();
  });
}

function fetchRuntimeInfo(baseUrl) {
  return new Promise((resolve) => {
    const req = http.get(`${baseUrl}/runtime/info`, { timeout: 5000 }, (res) => {
      let body = '';
      res.on('data', d => { body += d; });
      res.on('end', () => {
        try { resolve(JSON.parse(body)); } catch { resolve({ engines: {} }); }
      });
    });
    req.on('error', () => resolve({ engines: {} }));
  });
}

// ─── 首次下载引导窗口 ─────────────────────────────────────────────────────
let setupGuideWin = null;
let downloadProc = null;

function openSetupGuideWindow(missingEngines) {
  return new Promise((resolve) => {
    setupGuideWin = new BrowserWindow({
      width: 680,
      height: 520,
      title: '首次使用 — 下载 AI 模型',
      resizable: false,
      minimizable: false,
      maximizable: false,
      webPreferences: {
        preload: path.join(__dirname, 'setup-guide-preload.js'),
        nodeIntegration: false,
        contextIsolation: true,
      },
    });
    setupGuideWin.setMenu(null);
    setupGuideWin.loadFile(path.join(__dirname, 'setup-guide.html'));
    setupGuideWin.webContents.once('did-finish-load', () => {
      // 读取 manifest 获取文件大小信息
      let manifest = {};
      try {
        const mp = app.isPackaged
          ? path.join(process.resourcesPath, 'runtime', 'manifest.json')
          : path.join(__dirname, 'runtime', 'manifest.json');
        manifest = JSON.parse(fs.readFileSync(mp, 'utf-8'));
      } catch {}
      setupGuideWin.webContents.send('setup:info', { missingEngines, manifest });
    });
    setupGuideWin.on('closed', () => {
      setupGuideWin = null;
      resolve();
    });
  });
}

// ─── Setup IPC handlers ───────────────────────────────────────────────────

ipcMain.handle('setup:startDownload', (_event, opts) => {
  const hfEndpoint   = (opts && opts.hfEndpoint)  ? opts.hfEndpoint.trim()  : '';
  const pypiMirror   = (opts && opts.pypiMirror)  ? opts.pypiMirror.trim()  : '';
  const ckptDir      = getCheckpointsDir();
  const userPkgDir   = getUserPackagesDir();
  fs.mkdirSync(ckptDir,    { recursive: true });
  fs.mkdirSync(userPkgDir, { recursive: true });

  const isMac = process.platform === 'darwin';
  const pyPath = isMac
    ? path.join(app.isPackaged ? process.resourcesPath : __dirname, 'runtime', 'mac', 'python', 'bin', 'python3')
    : path.join(app.isPackaged ? process.resourcesPath : __dirname, 'runtime', 'win', 'python', 'python.exe');

  const env = {
    ...process.env,
    RESOURCES_ROOT: app.isPackaged ? process.resourcesPath : __dirname,
    CHECKPOINTS_DIR: ckptDir,
    ...(hfEndpoint ? { HF_ENDPOINT: hfEndpoint } : {}),
  };

  function sendProgress(msg) {
    if (setupGuideWin && !setupGuideWin.isDestroyed()) {
      setupGuideWin.webContents.send('setup:progress', msg);
    }
  }

  function spawnScript(scriptPath, args, onClose) {
    const proc = spawn(pyPath, [scriptPath, ...args], { env, shell: false });
    proc.stdout.on('data', (data) => {
      data.toString().split('\n').filter(Boolean).forEach(line => {
        try { sendProgress(JSON.parse(line)); } catch {}
      });
    });
    proc.stderr.on('data', (data) => {
      sendProgress({ type: 'log', message: data.toString().trim() });
    });
    proc.on('close', onClose);
    return proc;
  }

  const setupEnginesScript   = path.join(__dirname, 'scripts', 'setup-engines.py');
  const downloadScript       = path.join(__dirname, 'scripts', 'download_checkpoints.py');

  // 阶段1：安装 runtime_pip_packages（torch 等 ML 包）到 userData/python-packages/
  const enginesArgs = ['--runtime', '--target', userPkgDir, '--json-progress'];
  if (pypiMirror) enginesArgs.push('--pypi-mirror', pypiMirror);

  downloadProc = spawnScript(setupEnginesScript, enginesArgs, (code1) => {
    downloadProc = null;
    if (code1 !== 0) {
      if (setupGuideWin && !setupGuideWin.isDestroyed()) {
        setupGuideWin.webContents.send('setup:done', { exitCode: code1 });
      }
      return;
    }
    // 阶段2：下载 HuggingFace 模型
    const dlArgs = ['--json-progress'];
    if (hfEndpoint) dlArgs.push('--hf-endpoint', hfEndpoint);
    downloadProc = spawnScript(downloadScript, dlArgs, (code2) => {
      downloadProc = null;
      if (setupGuideWin && !setupGuideWin.isDestroyed()) {
        setupGuideWin.webContents.send('setup:done', { exitCode: code2 });
      }
    });
  });

  return { ok: true };
});

ipcMain.handle('setup:cancelDownload', () => {
  if (downloadProc) { downloadProc.kill(); downloadProc = null; }
  return { ok: true };
});

ipcMain.handle('setup:testHfConnectivity', () => {
  return new Promise((resolve) => {
    const https = require('https');
    const req = https.get('https://huggingface.co', { timeout: 5000 }, (res) => {
      res.resume();
      resolve({ reachable: res.statusCode < 500 });
    });
    req.on('error', () => resolve({ reachable: false }));
    req.setTimeout(5000, () => { req.destroy(); resolve({ reachable: false }); });
  });
});

ipcMain.handle('setup:saveConfig', (_event, cfg) => {
  const cfgPath = path.join(app.getPath('userData'), 'app-config.json');
  let existing = {};
  try { existing = JSON.parse(fs.readFileSync(cfgPath, 'utf-8')); } catch {}
  fs.writeFileSync(cfgPath, JSON.stringify({ ...existing, ...cfg }, null, 2), 'utf-8');
  return { ok: true };
});

ipcMain.handle('setup:loadConfig', () => {
  const cfgPath = path.join(app.getPath('userData'), 'app-config.json');
  try { return JSON.parse(fs.readFileSync(cfgPath, 'utf-8')); } catch { return {}; }
});

ipcMain.handle('setup:closeWindow', () => {
  if (setupGuideWin && !setupGuideWin.isDestroyed()) setupGuideWin.close();
  return { ok: true };
});

async function createWindow() {
  // ─── macOS 麦克风权限 ──────────────────────────────────────────────────────
  // Electron 默认拒绝所有 media 权限请求；需显式放行，否则 getUserMedia 返回
  // NotAllowedError（"permission denied by system"）。
  // setPermissionCheckHandler：同步判断权限是否已授予（Chromium 内部检查）
  // setPermissionRequestHandler：异步响应 JS 发起的权限申请弹窗
  session.defaultSession.setPermissionCheckHandler((_wc, permission) => {
    if (permission === 'media' || permission === 'microphone' || permission === 'audioCapture') {
      return true;
    }
    return null; // 其余权限走默认逻辑
  });
  session.defaultSession.setPermissionRequestHandler((_wc, permission, callback) => {
    if (permission === 'media' || permission === 'microphone' || permission === 'audioCapture') {
      callback(true);
    } else {
      callback(false);
    }
  });
  // macOS：向系统请求麦克风授权（首次运行会弹出系统权限对话框）
  if (process.platform === 'darwin') {
    systemPreferences.askForMediaAccess('microphone').catch(() => {});
  }

  const iconPath = process.platform === 'win32'
    ? path.join(__dirname, 'assets', 'icon.png')
    : path.join(__dirname, 'assets', 'icon.icns');
  if (process.platform === 'darwin' && app.dock) {
    app.dock.setIcon(path.join(__dirname, 'assets', 'icon.png'));
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
  mainWindow = win;
  win.on('page-title-updated', e => e.preventDefault());

  function openLogFile(filename) {
    const logPath = path.join(getLogDir(), filename);
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
  backendBaseUrl = `http://127.0.0.1:${backendPort}`;

  let pyCmd;
  let pyArgs;
  let cwd;

  if (isDev) {
    pyCmd = 'poetry';
    pyArgs = ['run', 'uvicorn', 'main:app',
      '--reload', '--reload-dir', '.',
      '--host', '127.0.0.1', '--port', backendPort,
    ];
    cwd = path.join(__dirname, 'backend');
  } else {
    const isMac = process.platform === 'darwin';
    pyCmd = isMac
      ? path.join(process.resourcesPath, 'runtime', 'mac', 'python', 'bin', 'python3')
      : path.join(process.resourcesPath, 'runtime', 'win', 'python', 'python.exe');
    pyArgs = [path.join(__dirname, 'backend', 'main.py')];
    cwd = __dirname;
  }

  console.log(`Start backend: ${pyCmd} ${pyArgs.join(' ')}`);
  console.log(`Backend URL: ${backendBaseUrl}`);

  pyProcess = spawn(pyCmd, pyArgs, {
    cwd,
    shell: false,
    env: {
      ...process.env,
      BACKEND_HOST: '127.0.0.1',
      BACKEND_PORT: backendPort,
      ...(LOGS_DIR ? { LOGS_DIR } : {}),
      // 打包后 runtime/ 在 Resources/ 下；checkpoints 在 userData（跨版本持久）
      // PYTHONPATH 指向 userData/python-packages/（torch 等 ML 包首次启动后安装于此）
      ...(app.isPackaged ? {
        RESOURCES_ROOT: process.resourcesPath,
        CHECKPOINTS_DIR: getCheckpointsDir(),
        PYTHONPATH: [path.join(__dirname, 'backend'), getUserPackagesDir()].join(path.delimiter),
      } : {}),
    },
  });

  // Python stdout/stderr 同时写 electron.log，方便排查启动失败
  pyProcess.stdout.on('data', (data) => {
    try { process.stdout.write(`[Backend] ${data}`); } catch { /**/ }
    electronLog('INFO', '[Backend]', data.toString().trim());
  });
  pyProcess.stderr.on('data', (data) => {
    try { process.stderr.write(`[Backend] ${data}`); } catch { /**/ }
    electronLog('ERROR', '[Backend stderr]', data.toString().trim());
  });
  pyProcess.on('error', (err) => console.error('[Python Spawn Error]:', err));
  pyProcess.on('exit', (code, signal) => {
    if (code !== 0) console.error(`[Backend] exited code=${code} signal=${signal}`);
  });

  // 立即加载前端页面，不等 backend，前端自己处理连接等待状态
  if (isDev) {
    await win.loadURL('http://localhost:3000');
  } else {
    await win.loadFile(path.join(__dirname, 'frontend', 'out', 'index.html'));
  }

  // 生产模式：后台等 backend 就绪 → 检测模型 → 若缺失则弹引导窗口
  if (!isDev) {
    waitBackendReady(backendBaseUrl, 90000)
      .then(() => fetchRuntimeInfo(backendBaseUrl))
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

// ─── IPC：磁盘占用 ────────────────────────────────────────────────────────────
ipcMain.handle('app:getDiskUsage', () => {
  // 打包后 runtime/checkpoints 在 Resources/（process.resourcesPath）
  // dev 模式两者都在项目根目录（__dirname）
  const resRoot = app.isPackaged ? process.resourcesPath : __dirname;
  const isMac = process.platform === 'darwin';
  const runtimePlatform = isMac ? 'mac' : 'win';

  const ckptRoot = getCheckpointsDir();

  // 读取 manifest.json — 单一数据源，存储版本号、大小、默认安装标志
  let _manifest = {};
  try {
    const mp = path.join(resRoot, 'runtime', 'manifest.json');
    _manifest = JSON.parse(fs.readFileSync(mp, 'utf-8'));
  } catch { /**/ }
  const _eng  = (k) => (_manifest.engines?.[k] || {});
  const _ui   = (k) => (_eng(k).ui   || {});
  const _ver  = (k) => (_eng(k).version || '');
  const _size = (k) => (_ui(k).size_display || '');
  // 版本以数字开头才加 "v" 前缀（避免 "vsd-turbo" 这类非语义化版本号）
  const _fmtVer = (v) => v ? (/^\d/.test(v) ? `v${v}` : v) : '';
  // 构建引擎行标签（不含版本，版本由前端 badge 展示）
  const _engLabel  = (k, suffix) => `${_ui(k).label || k} ${suffix}`.trim();
  // 构建权重行标签（只含体积，不含版本）
  const _ckptLabel = (k, suffix) => {
    const s = _size(k);
    const base = suffix ? `${_ui(k).label || k} ${suffix}` : (_ui(k).label || k);
    return `${base}${s ? `（${s}）` : ''}`;
  };
  const measureRes = (relPath) => {
    const full = path.join(resRoot, relPath);
    return dirExists(full) ? getDirSize(full) : 0;
  };
  const measureApp = (relPath) => {
    const full = path.join(__dirname, relPath);
    return dirExists(full) ? getDirSize(full) : 0;
  };
  const measureCkpt = (engine) => {
    const full = path.join(ckptRoot, engine);
    return dirExists(full) ? getDirSize(full) : 0;
  };
  // 测量 hf_cache/ 中指定 repo 的缓存大小（repoId 格式：owner/name）
  const measureHfCache = (...repoIds) => {
    let total = 0;
    for (const repoId of repoIds) {
      const d = path.join(ckptRoot, 'hf_cache', `models--${repoId.replace('/', '--')}`);
      if (dirExists(d)) total += getDirSize(d);
    }
    return total;
  };

  const rows = [
    // ── 运行时环境 ──────────────────────────────────────────────────────────
    {
      key: 'python',
      label: `Python 运行时（${runtimePlatform}）`,
      sub: path.join(resRoot, `runtime/${runtimePlatform}`),
      size: measureRes(`runtime/${runtimePlatform}`),
      deletable: false,
    },
    {
      key: 'python_packages',
      label: 'ML 依赖包（torch · torchaudio 等）',
      sub: getUserPackagesDir(),
      size: (() => { const d = getUserPackagesDir(); return dirExists(d) ? getDirSize(d) : 0; })(),
      deletable: false,
    },
    // ── TTS：Fish Speech ────────────────────────────────────────────────────
    {
      key: 'fish_speech_engine',
      label: _engLabel('fish_speech', '引擎'),
      sub: path.join(resRoot, 'runtime/fish_speech/engine'),
      size: measureRes('runtime/fish_speech/engine'),
      deletable: false,
    },
    {
      key: 'fish_speech_ckpt',
      label: _ckptLabel('fish_speech', '模型权重'),
      version: _fmtVer(_ver('fish_speech')),
      sub: path.join(ckptRoot, 'fish_speech'),
      size: measureCkpt('fish_speech'),
      engineKey: 'fish_speech',
      ready: measureCkpt('fish_speech') > 0,
      estimatedSizeMb: 1004,
      default_install: _ui('fish_speech').default_install,
      deletable: false,
    },
    // ── VC：Seed-VC + RVC ───────────────────────────────────────────────────
    {
      key: 'seed_vc_engine',
      label: _engLabel('seed_vc', '引擎'),
      sub: path.join(resRoot, 'runtime/seed_vc/engine'),
      size: measureRes('runtime/seed_vc/engine'),
      deletable: false,
    },
    {
      key: 'seed_vc_ckpt',
      label: _ckptLabel('seed_vc', '模型权重'),
      version: _fmtVer(_ver('seed_vc')),
      sub: path.join(ckptRoot, 'seed_vc'),
      size: measureCkpt('seed_vc'),
      engineKey: 'seed_vc',
      ready: measureCkpt('seed_vc') > 0,
      estimatedSizeMb: 2676,
      default_install: _ui('seed_vc').default_install,
      deletable: false,
    },
    ...(() => {
      const baseDir = path.join(resRoot, 'runtime', runtimePlatform, 'python');
      const found = [];
      const walkRvc = (d, depth) => {
        if (depth > 6) return;
        try {
          for (const f of fs.readdirSync(d)) {
            const fp = path.join(d, f);
            if (f === 'base_model' && path.basename(path.dirname(fp)) === 'rvc_python') { found.push(fp); return; }
            if (fs.statSync(fp).isDirectory()) walkRvc(fp, depth + 1);
          }
        } catch { /**/ }
      };
      if (dirExists(baseDir)) walkRvc(baseDir, 0);
      const rvcSize = found.reduce((s, p) => s + getDirSize(p), 0);
      // rvc checkpoint 目录（hubert_base.pt / pretrained_v2/ 下载到此）
      const rvcCkptSize = measureCkpt('rvc');
      const totalRvcSize = rvcSize + rvcCkptSize;
      return [{
        key: 'rvc_ckpt',
        label: _ckptLabel('rvc', '预训练模型'),
        version: _fmtVer(_ver('rvc')),
        sub: found[0] || path.join(ckptRoot, 'rvc'),
        size: totalRvcSize,
        engineKey: 'rvc',
        ready: totalRvcSize > 0,
        estimatedSizeMb: 1360,
        default_install: _ui('rvc').default_install,
        deletable: false,
      }];
    })(),
    // ── STT：Faster Whisper ──────────────────────────────────────────────────
    {
      key: 'faster_whisper_ckpt',
      label: _ckptLabel('faster_whisper', '模型'),
      version: _fmtVer(_ver('faster_whisper')),
      sub: path.join(ckptRoot, 'faster_whisper'),
      size: measureCkpt('faster_whisper'),
      engineKey: 'faster_whisper',
      ready: (() => {
        const modelBin = path.join(ckptRoot, 'faster_whisper', 'base', 'model.bin');
        try { return fs.statSync(modelBin).size > 50 * 1024 * 1024; } catch { return false; }
      })(),
      estimatedSizeMb: 150,
      default_install: _ui('faster_whisper').default_install,
      deletable: false,
    },
    // ── 图像生成：SD-Turbo ─────────────────────────────────────────────────
    {
      key: 'sd_ckpt',
      label: _ckptLabel('sd', '模型'),
      version: _fmtVer(_ver('sd')),
      sub: path.join(ckptRoot, 'sd'),
      size: (() => measureCkpt('sd') + measureHfCache('stabilityai/sd-turbo'))(),
      engineKey: 'sd',
      ready: measureHfCache('stabilityai/sd-turbo') > 200 * 1024 * 1024,
      estimatedSizeMb: 2300,
      default_install: _ui('sd').default_install,
      deletable: false,
    },
    // ── 图像生成：Flux（已禁用，保留入口方便手动安装）─────────────────────
    // {
    //   key: 'flux_ckpt',
    //   label: 'Flux.1-Schnell GGUF（图像生成 · ~30 GB · 已替换为 SD-Turbo）',
    //   sub: path.join(ckptRoot, 'flux'),
    //   size: (() => measureCkpt('flux') + measureHfCache('black-forest-labs/FLUX.1-schnell'))(),
    //   engineKey: 'flux',
    //   ready: (() => {
    //     const gguf = path.join(ckptRoot, 'flux', 'flux1-schnell-Q4_K_S.gguf');
    //     try { return fs.statSync(gguf).size > 5 * 1024 * 1024 * 1024; } catch { return false; }
    //   })(),
    //   estimatedSizeMb: 16667,
    //   deletable: false,
    // },
    // Wan 2.1 本地视频生成（~15.6 GB，暂不在此列出）
    // ── OCR：GOT-OCR ────────────────────────────────────────────────────────
    {
      key: 'got_ocr_ckpt',
      label: _ckptLabel('got_ocr', '模型'),
      version: _fmtVer(_ver('got_ocr')),
      sub: path.join(ckptRoot, 'hf_cache', 'models--stepfun-ai--GOT-OCR-2.0-hf'),
      size: (() => measureHfCache('stepfun-ai/GOT-OCR-2.0-hf'))(),
      engineKey: 'got_ocr',
      ready: measureHfCache('stepfun-ai/GOT-OCR-2.0-hf') > 0,
      estimatedSizeMb: 1500,
      default_install: _ui('got_ocr').default_install,
      deletable: false,
    },
    // ── 口型同步：LivePortrait ──────────────────────────────────────────────
    {
      key: 'liveportrait_ckpt',
      label: _ckptLabel('liveportrait', '模型'),
      version: _fmtVer(_ver('liveportrait')),
      sub: path.join(ckptRoot, 'hf_cache', 'models--KwaiVGI--LivePortrait'),
      size: measureHfCache('KwaiVGI/LivePortrait'),
      engineKey: 'liveportrait',
      ready: measureHfCache('KwaiVGI/LivePortrait') > 0,
      estimatedSizeMb: 1800,
      default_install: _ui('liveportrait').default_install,
      deletable: false,
    },
    // ── 换脸：FaceFusion ────────────────────────────────────────────────────
    {
      key: 'facefusion_ckpt',
      label: _ckptLabel('facefusion', ''),
      version: _fmtVer(_ver('facefusion')),
      sub: path.join(resRoot, 'runtime', 'facefusion', 'engine'),
      size: measureRes(path.join('runtime', 'facefusion', 'engine')),
      engineKey: 'facefusion',
      // 源码 + 所有必要模型均就绪才算安装完成
      ready: (() => {
        const sourceOk = dirExists(path.join(resRoot, 'runtime', 'facefusion', 'engine', 'facefusion'));
        const swapper = path.join(resRoot, 'runtime', 'facefusion', 'engine', '.assets', 'models', 'inswapper_128_fp16.onnx');
        try { return sourceOk && fs.statSync(swapper).size > 50 * 1024 * 1024; } catch { return false; }
      })(),
      estimatedSizeMb: 350,  // 源码 ~20 MB + 模型 ~330 MB（人脸检测/识别/关键点/换脸）
      default_install: _ui('facefusion').default_install,
      deletable: false,
    },
    // ── seed_vc 附属 HF cache（checkpoints/ 根目录下，非 hf_cache 子目录）───────
    {
      key: 'seed_vc_hf_root',
      label: 'Seed-VC 附属缓存（rmvpe · campplus）',
      sub: ckptRoot,
      size: (() => {
        let total = 0;
        for (const name of ['models--lj1995--VoiceConversionWebUI', 'models--funasr--campplus']) {
          const d = path.join(ckptRoot, name);
          if (dirExists(d)) total += getDirSize(d);
        }
        return total;
      })(),
      deletable: false,
    },
    // ── 共享缓存 ────────────────────────────────────────────────────────────
    {
      key: 'hf_cache',
      label: 'HuggingFace 模型缓存',
      sub: path.join(ckptRoot, 'hf_cache'),
      size: (() => {
        const d = path.join(ckptRoot, 'hf_cache');
        if (dirExists(d)) return getDirSize(d);
        // 兼容旧版：扫描 checkpoints/ 下所有 models--* 目录
        if (!dirExists(ckptRoot)) return 0;
        let total = 0;
        try {
          for (const name of fs.readdirSync(ckptRoot)) {
            if (name.startsWith('models--')) {
              const fp = path.join(ckptRoot, name);
              if (fs.statSync(fp).isDirectory()) total += getDirSize(fp);
            }
          }
        } catch { /**/ }
        return total;
      })(),
      deletable: false,
    },
    // ── 用户数据 ────────────────────────────────────────────────────────────
    {
      key: 'voices',
      label: '音色包',
      sub: path.join(__dirname, 'models', 'voices', 'user'),
      size: (() => { const d = path.join(__dirname, 'models', 'voices', 'user'); return dirExists(d) ? getDirSize(d) : 0; })(),
      clearable: true,
      deletable: false,
    },
    // ── 临时文件 ────────────────────────────────────────────────────────────
    {
      key: 'audio_cache',
      label: '音频缓存',
      sub: path.join(require('os').tmpdir(), 'ai-workshop-temp', 'download'),
      size: (() => {
        const d = path.join(require('os').tmpdir(), 'ai-workshop-temp', 'download');
        return dirExists(d) ? getDirSize(d) : 0;
      })(),
      clearable: true,
      deletable: false,
    },
    {
      key: 'logs',
      label: '日志文件',
      sub: getLogDir(),
      size: (() => {
        const d = getLogDir();
        return dirExists(d) ? getDirSize(d) : 0;
      })(),
      deletable: false,
    },
  ];

  return rows;
});

// ─── IPC：清除用户数据 ────────────────────────────────────────────────────────
ipcMain.handle('app:clearUserData', () => {
  const dirs = [getCheckpointsDir(), getUserPackagesDir()];
  const errors = [];
  for (const dir of dirs) {
    try {
      if (dirExists(dir)) fs.rmSync(dir, { recursive: true, force: true });
    } catch (err) {
      errors.push(`${dir}: ${err.message}`);
    }
  }
  return errors.length > 0 ? { ok: false, error: errors.join('\n') } : { ok: true };
});

// ─── IPC：清除数据并重新打开下载引导 ─────────────────────────────────────────
ipcMain.handle('app:clearAndOpenSetup', async () => {
  const dirs = [getCheckpointsDir(), getUserPackagesDir()];
  const errors = [];
  for (const dir of dirs) {
    try {
      if (dirExists(dir)) fs.rmSync(dir, { recursive: true, force: true });
    } catch (err) {
      errors.push(`${dir}: ${err.message}`);
    }
  }
  if (errors.length > 0) return { ok: false, error: errors.join('\n') };

  // 重新检测缺失引擎（checkpoints 已清空，全部会报 missing）
  let missingEngines = [];
  try {
    const runtimeInfo = await fetchRuntimeInfo(backendBaseUrl);
    missingEngines = Object.entries(runtimeInfo.engines || {})
      .filter(([, v]) => !v.ready)
      .map(([name, v]) => ({ engine: name, files: v.missing_checkpoints || [] }));
  } catch {}

  openSetupGuideWindow(missingEngines);
  return { ok: true };
});

// ─── IPC：删除模型 ────────────────────────────────────────────────────────────
// 每个引擎关联的额外路径（相对于 checkpoints 根目录），卸载时一并删除
// seed_vc 卸载时额外清理的直接文件（checkpoints/ 根目录下）
// hf_cache 里的 bigvgan/whisper-small 不在此处删除——其他引擎（flux/wan 等）
// 可能共用同一个 hf_cache 目录，卸载 seed_vc 不应波及它们
const ENGINE_EXTRA_PATHS = {
  seed_vc: [
    'rmvpe.pt',
    'models--funasr--campplus',
    'models--lj1995--VoiceConversionWebUI',
  ],
  wan: [
    path.join('hf_cache', 'models--Wan-AI--Wan2.1-T2V-1.3B-Diffusers'),
  ],
  got_ocr: [
    path.join('hf_cache', 'models--stepfun-ai--GOT-OCR-2.0-hf'),
  ],
  sd: [
    path.join('hf_cache', 'models--stabilityai--sd-turbo'),
  ],
  flux: [
    // flux 直接 checkpoint 目录已由主删除逻辑清理（checkpoints/flux/）
    // 额外清理 hf_cache 里的文本编码器 / VAE
    path.join('hf_cache', 'models--black-forest-labs--FLUX.1-schnell'),
    path.join('hf_cache', 'models--city96--FLUX.1-schnell-gguf'),
  ],
  liveportrait: [
    path.join('hf_cache', 'models--KwaiVGI--LivePortrait'),
  ],
};

ipcMain.handle('app:deleteModels', (_event, engine) => {
  const ckptRoot = getCheckpointsDir();
  const resRoot = app.isPackaged ? process.resourcesPath : __dirname;
  const errors = [];

  // FaceFusion 特殊处理：删 runtime/facefusion/engine/ 而非 checkpoints/facefusion/
  if (engine === 'facefusion') {
    const engineDir = path.join(resRoot, 'runtime', 'facefusion', 'engine');
    if (dirExists(engineDir)) {
      try {
        fs.rmSync(engineDir, { recursive: true, force: true });
      } catch (err) {
        errors.push(`${engineDir}: ${err.message}`);
      }
    }
    return errors.length > 0 ? { ok: false, error: errors.join('\n') } : { ok: true };
  }

  // 删除主 checkpoint 目录
  const ckptDir = path.join(ckptRoot, engine);
  if (dirExists(ckptDir)) {
    try {
      fs.rmSync(ckptDir, { recursive: true, force: true });
    } catch (err) {
      errors.push(`${ckptDir}: ${err.message}`);
    }
  }

  // 删除引擎关联的额外路径
  const extras = ENGINE_EXTRA_PATHS[engine] || [];
  for (const rel of extras) {
    const fullPath = path.join(ckptRoot, rel);
    try {
      if (fs.existsSync(fullPath)) {
        fs.rmSync(fullPath, { recursive: true, force: true });
      }
    } catch (err) {
      errors.push(`${fullPath}: ${err.message}`);
    }
  }

  return errors.length > 0 ? { ok: false, error: errors.join('\n') } : { ok: true };
});

// ─── IPC：清空可清除目录 ──────────────────────────────────────────────────────
const CLEARABLE_DIRS = () => {
  const ckptRoot = getCheckpointsDir();
  return {
    hf_cache:    path.join(ckptRoot, 'hf_cache'),
    voices:      path.join(__dirname, 'models', 'voices', 'user'),
    audio_cache: path.join(require('os').tmpdir(), 'ai-workshop-temp', 'download'),
  };
};

ipcMain.handle('app:clearDiskRow', (_event, key) => {
  const dirs = CLEARABLE_DIRS();
  const targetDir = dirs[key];
  if (!targetDir) return { ok: false, error: `未知 key：${key}` };
  try {
    if (dirExists(targetDir)) {
      // 清空内容但保留目录
      for (const entry of fs.readdirSync(targetDir)) {
        fs.rmSync(path.join(targetDir, entry), { recursive: true, force: true });
      }
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

// ─── IPC：下载单个引擎 checkpoint ────────────────────────────────────────────
// 需要先克隆源码的引擎（setup-engines.py --engine <name>）
const ENGINES_NEED_SOURCE_SETUP = new Set(['liveportrait', 'fish_speech', 'seed_vc']);

ipcMain.handle('app:downloadEngine', (_event, engine) => {
  const isMac = process.platform === 'darwin';
  const resRoot = app.isPackaged ? process.resourcesPath : __dirname;
  const pyPath = isMac
    ? path.join(resRoot, 'runtime', 'mac', 'python', 'bin', 'python3')
    : path.join(resRoot, 'runtime', 'win', 'python', 'python.exe');
  const ckptDir = getCheckpointsDir();
  fs.mkdirSync(ckptDir, { recursive: true });

  const env = { ...process.env, RESOURCES_ROOT: resRoot, CHECKPOINTS_DIR: ckptDir };

  function sendProgress(msg) {
    if (mainWindow && !mainWindow.isDestroyed())
      mainWindow.webContents.send('engine:download:progress', msg);
  }

  function spawnScript(scriptPath, scriptArgs) {
    return new Promise((resolve) => {
      const child = spawn(pyPath, [scriptPath, ...scriptArgs], { env, shell: false });
      child.stdout.on('data', (chunk) => {
        for (const line of chunk.toString().split('\n')) {
          if (!line.trim()) continue;
          try {
            sendProgress(JSON.parse(line));
          } catch {
            // 非 JSON 行（setup-engines.py 的 print 输出）也当日志转发
            sendProgress({ type: 'log', message: line.trimEnd() });
          }
        }
      });
      child.stderr.on('data', (data) => {
        for (const line of data.toString().split('\n')) {
          if (line.trim()) sendProgress({ type: 'log', message: line.trimEnd() });
        }
      });
      child.on('close', (code) => resolve({ ok: code === 0, exitCode: code }));
      child.on('error', (err) => resolve({ ok: false, error: err.message }));
    });
  }

  return (async () => {
    // 第一步：如需克隆引擎源码，先跑 setup-engines.py --engine <name>
    if (ENGINES_NEED_SOURCE_SETUP.has(engine)) {
      sendProgress({ type: 'log', message: `▶ [${engine}] 克隆引擎源码...` });
      const setupScript = path.join(__dirname, 'scripts', 'setup-engines.py');
      const setupResult = await spawnScript(setupScript, ['--engine', engine]);
      if (!setupResult.ok) {
        sendProgress({ type: 'all_done', ok: false });
        return setupResult;
      }
    }
    // 第二步：下载模型权重（脚本自身会 emit all_done，无需再发）
    sendProgress({ type: 'log', message: `▶ [${engine}] 下载模型权重...` });
    const dlScript = path.join(__dirname, 'scripts', 'download_checkpoints.py');
    const dlResult = await spawnScript(dlScript, ['--engine', engine, '--json-progress']);
    return dlResult;
  })();
});

// ─── IPC：读取日志内容 ────────────────────────────────────────────────────────
ipcMain.handle('app:readLogFile', (_event, filename) => {
  const logPath = path.join(getLogDir(), filename);
  if (!fs.existsSync(logPath)) return { ok: false, content: `（${filename} 暂不存在）` };
  try {
    return { ok: true, content: fs.readFileSync(logPath, 'utf-8') };
  } catch (e) {
    return { ok: false, content: `读取失败：${e.message}` };
  }
});

// ─── IPC：打开日志目录 ────────────────────────────────────────────────────────
ipcMain.handle('app:openLogsDir', () => {
  const logDir = getLogDir();
  fs.mkdirSync(logDir, { recursive: true });
  shell.openPath(logDir);
});

ipcMain.handle('app:openDir', (_event, dirPath) => {
  if (dirPath) shell.openPath(dirPath);
});

ipcMain.handle('app:saveRecording', async (_event, filename, buffer) => {
  const dir = path.join(app.getPath('userData'), 'recordings');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, filename), Buffer.from(buffer));
  return dir;
});

app.whenReady().then(createWindow);

ipcMain.handle('desktop-capturer:get-sources', async () => {
  const sources = await desktopCapturer.getSources({ types: ['screen'] });
  return sources.map((s) => ({ id: s.id, name: s.name }));
});

ipcMain.handle('backend:get-base-url', async () => backendBaseUrl);

ipcMain.on('log:renderer', (_event, level, message) => {
  if (frontendLog) frontendLog(level, message);
});

ipcMain.handle('dialog:selectDir', async () => {
  const result = await dialog.showOpenDialog({ properties: ['openDirectory'] });
  return result.canceled ? '' : (result.filePaths[0] || '');
});

app.on('before-quit', () => {
  if (downloadProc) { downloadProc.kill(); downloadProc = null; }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    if (pyProcess) {
      spawn('taskkill', ['/pid', pyProcess.pid, '/f', '/t']);
    }
    app.quit();
  }
});
