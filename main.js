const { app, BrowserWindow, Menu, ipcMain, desktopCapturer, shell, dialog } = require('electron');
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
console.log = (...a) => { _origLog(...a); electronLog('INFO', ...a); };
console.error = (...a) => { _origErr(...a); electronLog('ERROR', ...a); };

let pyProcess = null;
let backendBaseUrl = 'http://127.0.0.1:8000';

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

// ─── 磁盘大小计算 ─────────────────────────────────────────────────────────────
function getDirSize(dirPath) {
  let total = 0;
  try {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(dirPath, entry.name);
      try {
        if (entry.isDirectory()) {
          total += getDirSize(full);
        } else {
          total += fs.statSync(full).size;
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
  const hfEndpoint = (opts && opts.hfEndpoint) ? opts.hfEndpoint.trim() : '';
  const ckptDir = getCheckpointsDir();
  fs.mkdirSync(ckptDir, { recursive: true });

  const scriptPath = path.join(__dirname, 'scripts', 'download_checkpoints.py');
  const isMac = process.platform === 'darwin';
  const pyPath = app.isPackaged
    ? (isMac
        ? path.join(process.resourcesPath, 'runtime', 'mac', 'python', 'bin', 'python3')
        : path.join(process.resourcesPath, 'runtime', 'win', 'python', 'python.exe'))
    : (isMac
        ? path.join(__dirname, 'runtime', 'mac', 'python', 'bin', 'python3')
        : path.join(__dirname, 'runtime', 'win', 'python', 'python.exe'));

  const env = {
    ...process.env,
    RESOURCES_ROOT: app.isPackaged ? process.resourcesPath : __dirname,
    CHECKPOINTS_DIR: ckptDir,
    ...(hfEndpoint ? { HF_ENDPOINT: hfEndpoint } : {}),
  };

  downloadProc = spawn(pyPath, [scriptPath, '--json-progress'], { env, shell: false });

  downloadProc.stdout.on('data', (data) => {
    const lines = data.toString().split('\n').filter(Boolean);
    for (const line of lines) {
      try {
        const msg = JSON.parse(line);
        if (setupGuideWin && !setupGuideWin.isDestroyed()) {
          setupGuideWin.webContents.send('setup:progress', msg);
        }
      } catch { /* 非 JSON 行忽略 */ }
    }
  });
  downloadProc.stderr.on('data', (data) => {
    if (setupGuideWin && !setupGuideWin.isDestroyed()) {
      setupGuideWin.webContents.send('setup:progress',
        { type: 'log', message: data.toString().trim() });
    }
  });
  downloadProc.on('close', (code) => {
    downloadProc = null;
    if (setupGuideWin && !setupGuideWin.isDestroyed()) {
      setupGuideWin.webContents.send('setup:done', { exitCode: code });
    }
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
  const win = new BrowserWindow({
    width: 1100,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

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
      ...(app.isPackaged ? {
        RESOURCES_ROOT: process.resourcesPath,
        CHECKPOINTS_DIR: getCheckpointsDir(),
      } : {}),
    },
  });

  // Python 子进程输出只打到终端，不写 electron.log
  // backend 日志由 Python 自身通过 logging 写入 backend.log
  pyProcess.stdout.on('data', (data) => { process.stdout.write(`[Backend] ${data}`); });
  pyProcess.stderr.on('data', (data) => { process.stderr.write(`[Backend] ${data}`); });
  pyProcess.on('error', (err) => console.error('[Python Spawn Error]:', err));

  // 生产模式：等 backend 就绪 → 检测模型 → 若缺失则弹引导窗口
  if (!isDev) {
    try {
      await waitBackendReady(backendBaseUrl, 90000);
      const runtimeInfo = await fetchRuntimeInfo(backendBaseUrl);
      const missingEngines = Object.entries(runtimeInfo.engines || {})
        .filter(([, v]) => !v.ready)
        .map(([name, v]) => ({ engine: name, files: v.missing_checkpoints || [] }));
      if (missingEngines.length > 0) {
        await openSetupGuideWindow(missingEngines);
      }
    } catch (err) {
      console.error('[Setup] 检测模型状态失败:', err.message);
    }
  }

  if (isDev) {
    await win.loadURL('http://localhost:3000');
  } else {
    await win.loadFile(path.join(__dirname, 'frontend', 'out', 'index.html'));
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

  const rows = [
    {
      key: 'python',
      label: `Python 运行时 (${runtimePlatform})`,
      sub: `runtime/${runtimePlatform}/`,
      size: measureRes(`runtime/${runtimePlatform}`),
      deletable: false,
    },
    {
      key: 'fish_speech_engine',
      label: 'Fish Speech 引擎源码',
      sub: 'runtime/fish_speech/engine/',
      size: measureRes('runtime/fish_speech/engine'),
      deletable: false,
    },
    {
      key: 'fish_speech_ckpt',
      label: 'Fish Speech 模型',
      sub: 'checkpoints/fish_speech/',
      size: measureCkpt('fish_speech'),
      deletable: false,
    },
    {
      key: 'seed_vc_engine',
      label: 'Seed-VC 引擎源码',
      sub: 'runtime/seed_vc/engine/',
      size: measureRes('runtime/seed_vc/engine'),
      deletable: false,
    },
    {
      key: 'seed_vc_ckpt',
      label: 'Seed-VC 模型',
      sub: 'checkpoints/seed_vc/',
      size: measureCkpt('seed_vc'),
      deletable: false,
    },
    {
      key: 'whisper_engine',
      label: 'Whisper 引擎',
      sub: 'runtime/whisper/',
      size: measureRes('runtime/whisper'),
      deletable: false,
    },
    {
      key: 'whisper_ckpt',
      label: 'Whisper 模型',
      sub: 'checkpoints/whisper/',
      size: measureCkpt('whisper'),
      deletable: false,
    },
    {
      key: 'hf_cache',
      label: 'HuggingFace 缓存',
      sub: 'checkpoints/hf_cache/',
      size: (() => {
        // hf_cache 目录：Seed-VC / Fish Speech 等通过 HF hub 下载时产生
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
    {
      key: 'rvc_ckpt',
      label: 'RVC 基础模型',
      sub: 'runtime/*/rvc_python/base_model/',
      size: (() => {
        // rvc-python 把 hubert_base.pt / rmvpe.pt 存在嵌入式 Python 的 site-packages 里
        const baseDir = path.join(resRoot, 'runtime', runtimePlatform, 'python');
        if (!dirExists(baseDir)) return 0;
        // 递归找 rvc_python/base_model 目录
        const found = [];
        const walk = (d, depth) => {
          if (depth > 6) return;
          try {
            for (const f of fs.readdirSync(d)) {
              const fp = path.join(d, f);
              if (f === 'base_model' && path.basename(path.dirname(fp)) === 'rvc_python') { found.push(fp); return; }
              if (fs.statSync(fp).isDirectory()) walk(fp, depth + 1);
            }
          } catch { /**/ }
        };
        walk(baseDir, 0);
        return found.reduce((s, p) => s + getDirSize(p), 0);
      })(),
      deletable: false,
    },
    {
      key: 'models',
      label: '音色包',
      sub: 'models/',
      size: measureApp('models'),
      deletable: false,
    },
    {
      key: 'logs',
      label: '日志',
      sub: 'logs/',
      size: (() => {
        const d = getLogDir();
        return dirExists(d) ? getDirSize(d) : 0;
      })(),
      deletable: false,
    },
  ];

  return rows;
});

// ─── IPC：删除模型 ────────────────────────────────────────────────────────────
ipcMain.handle('app:deleteModels', (_event, engine) => {
  const ckptDir = path.join(getCheckpointsDir(), engine);
  if (!dirExists(ckptDir)) {
    return { ok: true, note: '目录不存在，无需删除' };
  }
  try {
    fs.rmSync(ckptDir, { recursive: true, force: true });
    fs.mkdirSync(ckptDir, { recursive: true }); // 重建空目录
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
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
