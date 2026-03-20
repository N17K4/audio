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

  // 2. 清理孤儿后端进程 + worker 进程（父进程死后可能继续运行）
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

// ─── 通用缓存（与 logs 同级）─────────────────────────────────────────────────
const CACHE_DIR = path.join(path.dirname(LOGS_DIR), 'cache');
fs.mkdirSync(CACHE_DIR, { recursive: true });

function createFileLogger(filename) {
  const logPath = path.join(LOGS_DIR, filename);
  const stream = fs.createWriteStream(logPath, { flags: 'w', encoding: 'utf-8' });
  return function write(level, ...args) {
    const line = `${new Date().toISOString()} [${level}] ${args.join(' ')}\n`;
    stream.write(line);
  };
}

function createAppendLogger(filename) {
  const logPath = path.join(LOGS_DIR, filename);
  const stream = fs.createWriteStream(logPath, { flags: 'a', encoding: 'utf-8' });
  return {
    path: logPath,
    write(level, ...args) {
      const line = `${new Date().toISOString()} [${level}] ${args.join(' ')}\n`;
      stream.write(line);
    },
    close() {
      try { stream.end(); } catch { /**/ }
    },
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
// dev:  <项目根>/runtime/checkpoints/
// prod: process.resourcesPath/runtime/checkpoints/
function getCheckpointsDir() {
  const resRoot = app.isPackaged ? process.resourcesPath : __dirname;
  return path.join(resRoot, 'runtime', 'checkpoints');
}

// ─── 运行时 ML 包目录（torch 等 ML 包首次启动后安装于此）────────────────
// dev:  <项目根>/runtime/ml/
// prod: process.resourcesPath/runtime/ml/
function getUserPackagesDir() {
  const resRoot = app.isPackaged ? process.resourcesPath : __dirname;
  return path.join(resRoot, 'runtime', 'ml');
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

// ─── Frontend Dev Server 就绪检测（TCP → HTTP 二段階確認）────────────────
function waitFrontendReady(url, timeoutMs) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    function poll() {
      const req = http.get(url, { timeout: 3000 }, (res) => {
        let body = '';
        res.on('data', d => { body += d; });
        res.on('end', () => {
          // TCP 通だが HTTP が HTML を返しているか確認
          const ct = res.headers['content-type'] || '';
          if (res.statusCode === 200 && (ct.includes('text/html') || body.includes('<'))) {
            console.log(`[UI] Frontend HTTP ready (status=${res.statusCode} content-type=${ct})`);
            return resolve();
          }
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

function openSetupGuideWindow(missingEngines, stage) {
  return new Promise((resolve) => {
    setupGuideWin = new BrowserWindow({
      width: 680,
      height: 520,
      title: stage ? '重新安装' : '首次使用 — 下载 AI 模型',
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
          ? path.join(process.resourcesPath, 'app', 'backend', 'wrappers', 'manifest.json')
          : path.join(__dirname, 'backend', 'wrappers', 'manifest.json');
        manifest = JSON.parse(fs.readFileSync(mp, 'utf-8'));
      } catch {}
      setupGuideWin.webContents.send('setup:info', { missingEngines, manifest, stage: stage || null });
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
  const stage        = (opts && opts.stage)        ? opts.stage              : null;
  const resRoot      = app.isPackaged ? process.resourcesPath : __dirname;
  const isMac        = process.platform === 'darwin';
  const ckptDir      = getCheckpointsDir();
  const userPkgDir   = getUserPackagesDir();
  fs.mkdirSync(ckptDir,    { recursive: true });
  fs.mkdirSync(userPkgDir, { recursive: true });

  // 嵌入式 Python 路径
  const embeddedPyPath = isMac
    ? path.join(resRoot, 'runtime', 'python', 'mac', 'bin', 'python3')
    : path.join(resRoot, 'runtime', 'python', 'win', 'python.exe');
  // 系统 Python 路径（setup 阶段使用，因为嵌入式 Python 可能尚未安装）
  const systemPyPath = isMac ? 'python3' : 'python';

  const env = {
    ...process.env,
    RESOURCES_ROOT: resRoot,
    CHECKPOINTS_DIR: ckptDir,
    PYTHONPATH: [path.join(__dirname, 'backend'), userPkgDir].join(path.delimiter),
    PYTHONIOENCODING: 'utf-8',
    ...(hfEndpoint ? { HF_ENDPOINT: hfEndpoint } : {}),
  };
  const setupLog = createAppendLogger('setup-download.log');
  setupLog.write('INFO', '═══════════════════════════════════════════════════════════');
  setupLog.write('INFO', `setup:startDownload pid=${process.pid} stage=${stage || '(first-boot)'}`);
  setupLog.write('INFO', `checkpoints_dir=${ckptDir}`);
  setupLog.write('INFO', `python_packages_dir=${userPkgDir}`);
  setupLog.write('INFO', `hf_endpoint=${hfEndpoint || '(empty)'}`);
  setupLog.write('INFO', `pypi_mirror=${pypiMirror || '(empty)'}`);
  setupLog.write('INFO', `resources_root=${resRoot}`);
  setupLog.write('INFO', `log_file=${setupLog.path}`);

  function sendProgress(msg) {
    try { setupLog.write('PROGRESS', JSON.stringify(msg)); } catch { /**/ }
    if (setupGuideWin && !setupGuideWin.isDestroyed()) {
      setupGuideWin.webContents.send('setup:progress', msg);
    }
  }

  function spawnScript(stageName, pyPath, scriptPath, args, onClose) {
    setupLog.write('INFO', `[${stageName}] spawn ${pyPath} ${[scriptPath, ...args].join(' ')}`);
    const proc = spawn(pyPath, [scriptPath, ...args], { env, shell: false });
    proc.stdout.on('data', (data) => {
      const text = data.toString();
      text.split('\n').filter(Boolean).forEach(line => {
        setupLog.write('STDOUT', `[${stageName}] ${line}`);
        try {
          sendProgress(JSON.parse(line));
        } catch {
          // 非 JSON 输出（如 setup 脚本的普通文本）也转发到引导页
          sendProgress({ type: 'log', message: line });
        }
      });
    });
    proc.stderr.on('data', (data) => {
      const text = data.toString();
      text.split('\n').filter(Boolean).forEach(line => {
        setupLog.write('STDERR', `[${stageName}] ${line}`);
      });
      sendProgress({ type: 'log', message: text.toString().trim() });
    });
    proc.on('error', (err) => {
      setupLog.write('ERROR', `[${stageName}] spawn error: ${err.stack || err.message}`);
      sendProgress({ type: 'log', message: `[${stageName}] 启动失败: ${err.message}` });
    });
    proc.on('close', (code, signal) => {
      setupLog.write('INFO', `[${stageName}] close code=${String(code)} signal=${String(signal || '')}`);
      onClose(code, signal);
    });
    return proc;
  }

  sendProgress({ type: 'log', message: `详细日志：${setupLog.path}` });

  // ── 按阶段执行脚本 ─────────────────────────────────────────────────────
  if (stage && STAGE_SCRIPTS[stage]) {
    // 指定阶段：顺序执行该阶段的所有脚本
    const scripts = STAGE_SCRIPTS[stage];
    setupLog.write('INFO', `stage=${stage} scripts=${scripts.map(s => s.script).join(', ')}`);

    async function runStageScripts() {
      for (const info of scripts) {
        const scriptPath = path.join(resRoot, info.script);
        const pyPath = info.useSystemPython ? systemPyPath : embeddedPyPath;

        // 构建脚本参数
        const isSetupScript = info.script.includes('runtime.py');
        const args = [];
        if (!isSetupScript) args.push('--json-progress');
        // ml 脚本需要 --target 参数
        if (info.script.includes('ml_base') || info.script.includes('ml_extra')) {
          args.unshift('--target', userPkgDir);
        }
        // 全部脚本支持 --pypi-mirror；checkpoint 脚本额外支持 --hf-endpoint
        if (pypiMirror) args.push('--pypi-mirror', pypiMirror);
        if (info.script.includes('checkpoint') && hfEndpoint) args.push('--hf-endpoint', hfEndpoint);

        sendProgress({ type: 'log', message: `▶ 运行脚本: ${info.script}` });
        const code = await new Promise((resolve) => {
          const proc = spawnScript(stage, pyPath, scriptPath, args, (c) => resolve(c));
          downloadProcs.push(proc);
        });

        if (code !== 0) {
          setupLog.write('ERROR', `[${stage}] ${info.script} failed exitCode=${code}`);
          sendProgress({ type: 'log', message: `✗ ${info.script} 失败 (exitCode=${code})` });
          setupLog.close();
          if (setupGuideWin && !setupGuideWin.isDestroyed()) {
            setupGuideWin.webContents.send('setup:done', { exitCode: code });
          }
          downloadProc = null;
          return;
        }
        sendProgress({ type: 'log', message: `✓ ${info.script} 完成` });
      }

      setupLog.write('INFO', `stage=${stage} all scripts success`);
      setupLog.close();
      if (setupGuideWin && !setupGuideWin.isDestroyed()) {
        setupGuideWin.webContents.send('setup:done', { exitCode: 0 });
      }
      downloadProc = null;
    }

    const downloadProcs = [];
    downloadProc = {
      kill: () => { downloadProcs.forEach(p => { try { p.kill(); } catch {} }); },
    };
    runStageScripts();
    return { ok: true };
  }

  // ── 默认（首次启动）：并行执行 ml_base + checkpoints_base ──────────────
  setupLog.write('INFO', 'parallel start: ml-base + checkpoints');

  const enginesArgs = ['--target', userPkgDir, '--json-progress'];
  if (pypiMirror) enginesArgs.push('--pypi-mirror', pypiMirror);

  const dlArgs = ['--json-progress'];
  if (hfEndpoint) dlArgs.push('--hf-endpoint', hfEndpoint);
  if (pypiMirror) dlArgs.push('--pypi-mirror', pypiMirror);

  let mlDone = false, ckptDone = false;
  let mlCode = null, ckptCode = null;
  const downloadProcs = [];

  function onBothDone() {
    if (!mlDone || !ckptDone) return;
    downloadProc = null;
    const finalCode = (mlCode === 0 && ckptCode === 0) ? 0 : 1;
    const summary = [];
    if (mlCode !== 0) summary.push(`pip安装(exitCode=${mlCode})`);
    if (ckptCode !== 0) summary.push(`模型下载(exitCode=${ckptCode})`);
    if (summary.length) {
      const msg = `部分任务失败: ${summary.join(', ')}`;
      setupLog.write('ERROR', msg);
      sendProgress({ type: 'log', message: `✗ ${msg}` });
    } else {
      setupLog.write('INFO', 'all parallel tasks success');
    }
    setupLog.close();
    if (setupGuideWin && !setupGuideWin.isDestroyed()) {
      setupGuideWin.webContents.send('setup:done', { exitCode: finalCode });
    }
  }

  const runtimeDepsScript = path.join(__dirname, 'scripts', 'ml_base.py');
  const downloadScript   = path.join(__dirname, 'scripts', 'checkpoints_base.py');

  const proc1 = spawnScript('ml-base', embeddedPyPath, runtimeDepsScript, enginesArgs, (code) => {
    mlCode = code;
    mlDone = true;
    if (code !== 0) {
      setupLog.write('ERROR', `[ml-base] failed exitCode=${String(code)}`);
      sendProgress({ type: 'log', message: `✗ pip安装阶段失败 (exitCode=${code})，模型下载继续进行` });
    } else {
      setupLog.write('INFO', '[ml-base] success');
      sendProgress({ type: 'log', message: '✓ pip安装完成' });
    }
    onBothDone();
  });

  const proc2 = spawnScript('checkpoints', embeddedPyPath, downloadScript, dlArgs, (code) => {
    ckptCode = code;
    ckptDone = true;
    if (code !== 0) {
      setupLog.write('ERROR', `[checkpoints] failed exitCode=${String(code)}`);
      sendProgress({ type: 'log', message: `✗ 模型下载阶段失败 (exitCode=${code})，pip安装继续进行` });
    } else {
      setupLog.write('INFO', '[checkpoints] success');
      sendProgress({ type: 'log', message: '✓ 模型下载完成' });
    }
    onBothDone();
  });

  downloadProcs.push(proc1, proc2);
  downloadProc = {
    kill: () => { downloadProcs.forEach(p => { try { p.kill(); } catch {} }); },
  };

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
  let useShell = false;

  if (isDev) {
    // 开发模式：使用 mise exec + poetry run 确保使用正确的 Python 版本和虚拟环境
    pyCmd = 'mise';
    pyArgs = ['exec', '--', 'poetry', 'run', 'uvicorn', 'main:app',
      '--reload', '--reload-dir', '.',
      '--host', '127.0.0.1', '--port', backendPort,
    ];
    cwd = path.join(__dirname, 'backend');
  } else {
    const isMac = process.platform === 'darwin';
    pyCmd = isMac
      ? path.join(process.resourcesPath, 'runtime', 'python', 'mac', 'bin', 'python3')
      : path.join(process.resourcesPath, 'runtime', 'python', 'win', 'python.exe');
    pyArgs = [path.join(__dirname, 'backend', 'main.py')];
    cwd = __dirname;
  }

  // ── 防御：清理 python-packages/ 中与嵌入式 Python 冲突的包 ──
  // transitive dependency（如 pydantic_core）可能被 pip install --target 引入，
  // 导致 PYTHONPATH 优先加载版本不一致的包，FastAPI/pydantic 启动崩溃。
  // 开发/生产统一处理，确保行为一致。
  const mlPkgDir = app.isPackaged
    ? getUserPackagesDir()
    : path.join(__dirname, 'runtime', 'ml');
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

  // ── 统一环境变量（开发/生产仅目录不同，逻辑完全一致）──
  const resRoot = app.isPackaged ? process.resourcesPath : __dirname;
  const backendEnv = {
    ...process.env,
    BACKEND_HOST: '127.0.0.1',
    BACKEND_PORT: backendPort,
    RESOURCES_ROOT: resRoot,
    CHECKPOINTS_DIR: getCheckpointsDir(),
    PYTHONPATH: [path.join(__dirname, 'backend'), mlPkgDir].join(path.delimiter),
    PYTHONIOENCODING: 'utf-8',
    ...(LOGS_DIR ? { LOGS_DIR } : {}),
    CACHE_DIR,
  };

  console.log(`Start backend: ${pyCmd} ${pyArgs.join(' ')}`);
  console.log(`Backend URL: ${backendBaseUrl}`);

  pyProcess = spawn(pyCmd, pyArgs, {
    cwd,
    shell: isDev, // 开发模式需要 shell 来执行 mise exec
    env: backendEnv,
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

  if (isDev) {
    // 开发模式：等 Next.js dev server HTTP 就绪后再加载，避免白屏
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
    const mp = app.isPackaged
      ? path.join(resRoot, 'app', 'backend', 'wrappers', 'manifest.json')
      : path.join(resRoot, 'backend', 'wrappers', 'manifest.json');
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

  // 测量嵌入式 Python site-packages 中的指定包目录
  const sitePackagesBase = isMac
    ? path.join(resRoot, `runtime/python/${runtimePlatform}/lib`)
    : path.join(resRoot, `runtime/python/${runtimePlatform}/Lib/site-packages`);
  const measureSitePackages = (...pkgNames) => {
    let total = 0;
    // macOS: lib/python3.12/site-packages/   — 需要先找到 python 版本目录
    let spDir = sitePackagesBase;
    if (isMac) {
      try {
        const pyVer = fs.readdirSync(sitePackagesBase).find(n => n.startsWith('python'));
        if (pyVer) spDir = path.join(sitePackagesBase, pyVer, 'site-packages');
      } catch { /**/ }
    }
    for (const pkg of pkgNames) {
      // 包目录可能是 foo/ 或 foo-version.dist-info/
      try {
        for (const entry of fs.readdirSync(spDir)) {
          if (entry === pkg || entry.startsWith(pkg + '-') || entry.replace(/-/g, '_') === pkg) {
            const fp = path.join(spDir, entry);
            if (fs.statSync(fp).isDirectory()) total += getDirSize(fp);
          }
        }
      } catch { /**/ }
    }
    return total;
  };

  const rows = [
    // ════════════════════════════════════════════════════════════════════════
    // setup（pnpm run runtime）— 基础 + 扩展环境统一
    // ════════════════════════════════════════════════════════════════════════
    { key: 'python',             label: `Python 运行时（${runtimePlatform}）`,       sub: path.join(resRoot, `runtime/python/${runtimePlatform}`),     size: measureRes(`runtime/python/${runtimePlatform}`) + measureRes(`runtime/bin/${runtimePlatform}`),       estimatedSizeMb: 200,  stage: 'setup',
      desc: `来源: GitHub Releases (python-build-standalone)｜包含嵌入式 Python 3.12 解释器 + fastapi/uvicorn/httpx 等后端依赖 + FFmpeg (~70 MB) + Pandoc (~25 MB)` },
    { key: 'fish_speech_engine', label: _engLabel('fish_speech', '引擎源码'),        sub: path.join(resRoot, 'runtime/engine/fish_speech'),     size: measureRes('runtime/engine/fish_speech'),                                                           estimatedSizeMb: 5,    stage: 'setup',
      desc: `来源: HuggingFace｜回退: git clone fishaudio/fish-speech tag v1.5.0｜pip: huggingface_hub, loguru, soundfile, tiktoken 等` },
    { key: 'gpt_sovits_engine',  label: _engLabel('gpt_sovits', '引擎源码'),        sub: path.join(resRoot, 'runtime/engine/gpt_sovits'),      size: measureRes('runtime/engine/gpt_sovits'),                                                            estimatedSizeMb: 10,   stage: 'setup',
      desc: `来源: HuggingFace｜回退: git clone｜pip: cn2an, pypinyin, jieba, wordsegment, g2p_en, LangSegment` },
    { key: 'seed_vc_engine',     label: _engLabel('seed_vc', '引擎源码'),           sub: path.join(resRoot, 'runtime/engine/seed_vc'),         size: measureRes('runtime/engine/seed_vc'),                                                               estimatedSizeMb: 5,    stage: 'setup',
      desc: `来源: HuggingFace｜回退: git clone commit 51383efd｜pip: huggingface_hub, setuptools, wheel` },
    { key: 'flux_pip',           label: _engLabel('flux', 'pip 依赖'),              sub: '嵌入式 Python site-packages',                        size: measureSitePackages('gguf'),                                                                        estimatedSizeMb: 20,   stage: 'setup',
      desc: `来源: PyPI｜安装包: gguf, diffusers>=0.32, accelerate, sentencepiece, protobuf` },
    { key: 'got_ocr_pip',        label: _engLabel('got_ocr', 'pip 依赖'),           sub: '嵌入式 Python site-packages',                        size: measureSitePackages('verovio', 'pymupdf', 'fitz'),                                                  estimatedSizeMb: 15,   stage: 'setup',
      desc: `来源: PyPI｜安装包: transformers>=4.48, tiktoken, verovio, pymupdf` },
    { key: 'liveportrait_engine', label: _engLabel('liveportrait', '引擎 + pip'),   sub: path.join(resRoot, 'runtime/engine/liveportrait'),     size: measureRes('runtime/engine/liveportrait') + measureSitePackages('onnxruntime', 'pykalman'),          estimatedSizeMb: 50,   stage: 'setup',
      desc: `来源: HuggingFace｜回退: git clone｜pip: imageio, av, omegaconf, onnxruntime, scikit-image, pykalman` },
    { key: 'sd_pip',             label: _engLabel('sd', 'pip 依赖'),                sub: '嵌入式 Python site-packages',                        size: measureSitePackages('diffusers', 'accelerate', 'safetensors'),                                       estimatedSizeMb: 10,   stage: 'setup',
      desc: `来源: PyPI｜安装包: diffusers>=0.21, accelerate, safetensors` },
    { key: 'wan_pip',            label: _engLabel('wan', 'pip 依赖'),               sub: '嵌入式 Python site-packages',                        size: measureSitePackages('imageio', 'imageio_ffmpeg'),                                                   estimatedSizeMb: 5,    stage: 'setup',
      desc: `来源: PyPI｜安装包: diffusers>=0.30, accelerate, imageio, imageio-ffmpeg（部分与 sd/flux 共享）` },

    // ════════════════════════════════════════════════════════════════════════
    // ml_base（pnpm run ml）
    // ════════════════════════════════════════════════════════════════════════
    { key: 'python_packages', label: 'ML 依赖包（torch · torchaudio · transformers 等）', sub: getUserPackagesDir(), size: (() => { const d = getUserPackagesDir(); return dirExists(d) ? getDirSize(d) : 0; })(), estimatedSizeMb: 3000, stage: 'ml_base',
      desc: `来源: PyPI｜汇总 6 个基础引擎的 runtime_pip_packages 去重安装：torch, torchaudio, hydra-core, transformers, einops, librosa, scipy, soundfile, faiss-cpu, torchcrepe 等 (~20-30 包)。支持 PyPI 镜像加速` },

    // ════════════════════════════════════════════════════════════════════════
    // ml_extra（pnpm run ml:extra）
    // ════════════════════════════════════════════════════════════════════════
    { key: 'ml_extra_packages', label: 'ML 扩展包（RAG · Agent · LoRA）', sub: getUserPackagesDir() + '（与 ml_base 共享目录）', size: 0, estimatedSizeMb: 800, stage: 'ml_extra',
      desc: `来源: PyPI｜RAG 组: llama-index-core, faiss-cpu, llama-index-embeddings-ollama 等｜Agent 组: langgraph, langchain-core, duckduckgo-search｜LoRA 组: peft, trl, datasets, bitsandbytes, accelerate。支持按组单独安装` },

    // ════════════════════════════════════════════════════════════════════════
    // checkpoints_base（pnpm run checkpoints）
    // ════════════════════════════════════════════════════════════════════════
    { key: 'fish_speech_ckpt', label: _ckptLabel('fish_speech', '模型权重'), sub: path.join(ckptRoot, 'fish_speech'), size: measureCkpt('fish_speech'), estimatedSizeMb: 1000, stage: 'checkpoints_base',
      desc: `来源: HuggingFace (fishaudio/fish-speech-1.5)｜文件: model.pth (~500 MB), firefly-gan-vq-fsq 声码器 (~500 MB), config.json, tokenizer.tiktoken 等｜固定 commit SHA` },
    { key: 'gpt_sovits_ckpt',  label: _ckptLabel('gpt_sovits', '模型'),    sub: path.join(ckptRoot, 'gpt_sovits'),  size: measureCkpt('gpt_sovits'),  estimatedSizeMb: 3100, stage: 'checkpoints_base',
      desc: `来源: HuggingFace｜文件: chinese-hubert-base/ (~380 MB), chinese-roberta-wwm-ext-large/ (~1.3 GB), gsv-v2final-pretrained/s1bert25hz.ckpt (~600 MB), s2G2333k.pth (~800 MB)` },
    { key: 'seed_vc_ckpt',     label: _ckptLabel('seed_vc', '模型权重'),    sub: path.join(ckptRoot, 'seed_vc'),     size: measureCkpt('seed_vc'),     estimatedSizeMb: 200,  stage: 'checkpoints_base',
      desc: `来源: HuggingFace (Plachta/Seed-VC)｜文件: DiT_seed_v2_uvit_whisper_small_wavenet_bigvgan_pruned.pth (~200 MB) + config yml` },
    ...(() => {
      const baseDir = path.join(resRoot, 'runtime', 'python', runtimePlatform);
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
      return [{ key: 'rvc_ckpt', label: _ckptLabel('rvc', '预训练模型'), sub: found[0] || path.join(ckptRoot, 'rvc'), size: found.reduce((s, p) => s + getDirSize(p), 0) + measureCkpt('rvc'), estimatedSizeMb: 760, stage: 'checkpoints_base',
        desc: `来源: HuggingFace (lj1995/VoiceConversionWebUI)｜文件: hubert_base.pt (~360 MB), pretrained_v2/f0G40k.pth (~400 MB)｜macOS arm64 自动跳过 FAISS index` }];
    })(),
    { key: 'faster_whisper_ckpt', label: _ckptLabel('faster_whisper', '模型'), sub: path.join(ckptRoot, 'faster_whisper'), size: measureCkpt('faster_whisper'), estimatedSizeMb: 1500, stage: 'checkpoints_base',
      desc: `来源: HuggingFace (Systran/faster-whisper-*)｜预下载 large-v3 + base 模型｜CTranslate2 格式，推理速度快于原版 Whisper` },
    { key: 'facefusion_ckpt', label: _ckptLabel('facefusion', 'ONNX 模型'), sub: path.join(resRoot, 'runtime', 'engine', 'facefusion'), size: measureRes(path.join('runtime', 'engine', 'facefusion')), estimatedSizeMb: 540, stage: 'checkpoints_base',
      desc: `来源: HuggingFace｜文件: retinaface_10g.onnx (~16 MB), arcface_w600k_r50.onnx (~166 MB), 2dfan4.onnx (~93 MB), inswapper_128_fp16.onnx (~265 MB)` },
    { key: 'seed_vc_hf_root', label: 'Seed-VC 附属模型（bigvgan · whisper · rmvpe · campplus）', sub: ckptRoot, size: (() => { let t = 0; for (const n of ['models--lj1995--VoiceConversionWebUI', 'models--funasr--campplus']) { const d = path.join(ckptRoot, n); if (dirExists(d)) t += getDirSize(d); } t += measureHfCache('nvidia/bigvgan_v2_22khz_80band_256x', 'openai/whisper-small'); return t; })(), estimatedSizeMb: 2500, stage: 'checkpoints_base',
      desc: `来源: HuggingFace｜nvidia/bigvgan_v2_22khz_80band_256x 声码器 (~1.3 GB), openai/whisper-small 语义编码器 (~950 MB), funasr/campplus 说话人特征 (~25 MB), lj1995/VoiceConversionWebUI rmvpe F0 提取 (~200 MB)｜全部为 Seed-VC 离线推理必须，不可单独删除` },
    { key: 'voices', label: '内置音色（hutao-jp · Ayayaka · tsukuyomi 等）', sub: path.join(__dirname, 'user_data', 'rvc'), size: measureApp('user_data/rvc'), estimatedSizeMb: 325, stage: 'checkpoints_base',
      desc: `来源: HuggingFace｜RVC 格式音色: hutao-jp (.pth ~53 MB + .index ~65 MB), Ayayaka (.pth ~53 MB + .index ~101 MB), tsukuyomi (.pth ~53 MB)` },

    // ════════════════════════════════════════════════════════════════════════
    // checkpoints_extra（pnpm run checkpoints:extra）
    // ════════════════════════════════════════════════════════════════════════
    { key: 'cosyvoice_ckpt',    label: _ckptLabel('cosyvoice', '模型'),    sub: path.join(ckptRoot, 'cosyvoice'),                                      size: measureCkpt('cosyvoice'),                                             estimatedSizeMb: 3000, stage: 'checkpoints_extra',
      desc: `来源: HuggingFace｜CosyVoice 2 零样本语音克隆 TTS 模型权重（阿里通义实验室）` },
    { key: 'sd_ckpt',          label: _ckptLabel('sd', '模型'),          sub: path.join(ckptRoot, 'sd'),                                             size: (() => measureCkpt('sd') + measureHfCache('stabilityai/sd-turbo'))(),  estimatedSizeMb: 2300,  stage: 'checkpoints_extra',
      desc: `来源: HuggingFace (stabilityai/sd-turbo)｜SD-Turbo 完整模型｜无需 HF token` },
    { key: 'flux_ckpt',        label: _ckptLabel('flux', '模型'),        sub: path.join(ckptRoot, 'flux'),                                           size: (() => measureCkpt('flux') + measureHfCache('black-forest-labs/FLUX.1-schnell', 'city96/FLUX.1-schnell-gguf'))(), estimatedSizeMb: 16500, stage: 'checkpoints_extra',
      desc: `来源: HuggingFace｜GGUF Q4_K_S transformer (~6.5 GB) + FLUX.1-schnell base (T5-XXL + CLIP-L + VAE, ~10 GB)｜base 模型需 HF token` },
    { key: 'wan_ckpt',         label: _ckptLabel('wan', '模型'),         sub: path.join(ckptRoot, 'hf_cache', 'models--Wan-AI--Wan2.1-T2V-1.3B-Diffusers'), size: measureHfCache('Wan-AI/Wan2.1-T2V-1.3B-Diffusers'),              estimatedSizeMb: 15600, stage: 'checkpoints_extra',
      desc: `来源: HuggingFace (Wan-AI/Wan2.1-T2V-1.3B-Diffusers)｜文生视频模型：transformer ~5.3 GB + umt5-XXL 文本编码器 ~9.8 GB + VAE ~484 MB` },
    { key: 'got_ocr_ckpt',    label: _ckptLabel('got_ocr', '模型'),      sub: path.join(ckptRoot, 'hf_cache', 'models--stepfun-ai--GOT-OCR-2.0-hf'),  size: measureHfCache('stepfun-ai/GOT-OCR-2.0-hf'),                          estimatedSizeMb: 1500,  stage: 'checkpoints_extra',
      desc: `来源: HuggingFace (stepfun-ai/GOT-OCR-2.0-hf)｜通用 OCR 模型，支持中英日韩等多语种文档识别` },
    { key: 'liveportrait_ckpt', label: _ckptLabel('liveportrait', '模型'), sub: path.join(ckptRoot, 'hf_cache', 'models--KwaiVGI--LivePortrait'),      size: measureHfCache('KwaiVGI/LivePortrait'),                               estimatedSizeMb: 1800,  stage: 'checkpoints_extra',
      desc: `来源: HuggingFace (KwaiVGI/LivePortrait)｜面部动画驱动模型，用于口型同步和表情迁移` },
    { key: 'whisper_ckpt',     label: _ckptLabel('whisper', '模型'),      sub: path.join(ckptRoot, 'whisper'),                                        size: measureCkpt('whisper'),                                               estimatedSizeMb: 1500,  stage: 'checkpoints_extra',
      desc: `来源: HuggingFace (openai/whisper-large-v3)｜原版 Whisper 模型（当前默认引擎为 Faster Whisper，此为备选）` },

    // ════════════════════════════════════════════════════════════════════════
    // 缓存（不属于任何安装阶段，支持单独清空）
    // ════════════════════════════════════════════════════════════════════════
    // 注意：hf_cache 不再单独列为可清空项。其中的模型是各引擎离线推理必须的，
    // 由 checkpoints_base / checkpoints_extra 阶段管理（重装时会一并清除和重新下载）。
    // ── 临时文件 ────────────────────────────────────────────────────────────
    {
      key: 'cache',
      label: '缓存',
      sub: CACHE_DIR,
      size: (() => dirExists(CACHE_DIR) ? getDirSize(CACHE_DIR) : 0)(),
      clearable: true,
    },
    {
      key: 'logs',
      label: '日志文件',
      sub: getLogDir(),
      size: (() => {
        const d = getLogDir();
        return dirExists(d) ? getDirSize(d) : 0;
      })(),
      clearable: true,
    },
  ];

  return rows;
});

// ─── 统一清除逻辑：复用 CLEARABLE_DIRS + checkpoints ─────────────────────────
// 所有清除操作（模型页单独清空、重置页清除、pnpm clean）共享此逻辑
function _clearAllUserData() {
  const clearable = CLEARABLE_DIRS();
  const errors = [];
  const rmDir = (d) => {
    try {
      if (dirExists(d)) fs.rmSync(d, { recursive: true, force: true });
    } catch (err) { errors.push(`${d}: ${err.message}`); }
  };

  // 只清除 STAGE_CLEAR_KEYS 中定义的目录（不含运行环境）
  const keysToDelete = Object.values(STAGE_CLEAR_KEYS).flat();
  for (const key of keysToDelete) {
    if (key === 'seed_vc_hf_root') {
      const ckptRoot = getCheckpointsDir();
      for (const name of ['models--lj1995--VoiceConversionWebUI', 'models--funasr--campplus']) {
        rmDir(path.join(ckptRoot, name));
      }
    } else {
      const dir = clearable[key];
      if (dir) rmDir(dir);
    }
  }

  // 清除 checkpoints 整个目录
  rmDir(getCheckpointsDir());

  return errors.length > 0 ? { ok: false, error: errors.join('\n') } : { ok: true };
}

ipcMain.handle('app:clearUserData', () => {
  return _clearAllUserData();
});

ipcMain.handle('app:clearAndOpenSetup', async () => {
  const result = _clearAllUserData();
  if (!result.ok) return result;

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
// rvc_python/base_model/ 路径（嵌入式 Python 内）を検索して返す
function findRvcBaseModelDirs() {
  const isMac = process.platform === 'darwin';
  const resRoot = app.isPackaged ? process.resourcesPath : __dirname;
  const baseDir = path.join(resRoot, 'runtime', 'python', isMac ? 'mac' : 'win');
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
  if (dirExists(baseDir)) walk(baseDir, 0);
  return found;
}

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

  // FaceFusion 特殊处理：删 runtime/engine/facefusion/ 而非 checkpoints/facefusion/
  if (engine === 'facefusion') {
    const engineDir = path.join(resRoot, 'runtime', 'engine', 'facefusion');
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

  // RVC 特殊处理：模型文件在嵌入式 Python 的 rvc_python/base_model/ 目录
  if (engine === 'rvc') {
    for (const bmDir of findRvcBaseModelDirs()) {
      try {
        if (fs.existsSync(bmDir)) {
          fs.rmSync(bmDir, { recursive: true, force: true });
        }
      } catch (err) {
        errors.push(`${bmDir}: ${err.message}`);
      }
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
  const resRoot = app.isPackaged ? process.resourcesPath : __dirname;
  const isMac = process.platform === 'darwin';
  const runtimePlatform = isMac ? 'mac' : 'win';
  return {
    // 运行时环境
    python:           path.join(resRoot, `runtime/python/${runtimePlatform}`),
    python_packages:  getUserPackagesDir(),
    // 引擎源码
    fish_speech_engine:  path.join(resRoot, 'runtime/engine/fish_speech'),
    seed_vc_engine:      path.join(resRoot, 'runtime/engine/seed_vc'),
    gpt_sovits_engine:   path.join(resRoot, 'runtime/engine/gpt_sovits'),
    liveportrait_engine: path.join(resRoot, 'runtime/engine/liveportrait'),
    // 缓存
    seed_vc_hf_root: null,  // 特殊处理：多个子目录
    // checkpoint 目录（checkpoints_base + checkpoints_extra）
    fish_speech_ckpt:  path.join(ckptRoot, 'fish_speech'),
    gpt_sovits_ckpt:   path.join(ckptRoot, 'gpt_sovits'),
    seed_vc_ckpt:      path.join(ckptRoot, 'seed_vc'),
    rvc_ckpt:          path.join(ckptRoot, 'rvc'),
    faster_whisper_ckpt: path.join(ckptRoot, 'faster_whisper'),
    facefusion_ckpt:   path.join(resRoot, 'runtime', 'engine', 'facefusion'),
    cosyvoice_ckpt:    path.join(ckptRoot, 'cosyvoice'),
    sd_ckpt:           path.join(ckptRoot, 'sd'),
    flux_ckpt:         path.join(ckptRoot, 'flux'),
    wan_ckpt:          path.join(ckptRoot, 'hf_cache', 'models--Wan-AI--Wan2.1-T2V-1.3B-Diffusers'),
    got_ocr_ckpt:      path.join(ckptRoot, 'hf_cache', 'models--stepfun-ai--GOT-OCR-2.0-hf'),
    liveportrait_ckpt: path.join(ckptRoot, 'hf_cache', 'models--KwaiVGI--LivePortrait'),
    whisper_ckpt:      path.join(ckptRoot, 'whisper'),
    // 用户数据
    voices:           path.join(__dirname, 'user_data', 'rvc', 'user'),
    cache:            CACHE_DIR,
    // 日志
    logs:             LOGS_DIR,
  };
};

ipcMain.handle('app:clearDiskRow', (_event, key) => {
  const dirs = CLEARABLE_DIRS();
  if (!(key in dirs)) return { ok: false, error: `未知 key：${key}` };

  const errors = [];
  const rmDir = (d) => {
    try {
      if (dirExists(d)) fs.rmSync(d, { recursive: true, force: true });
    } catch (err) { errors.push(`${d}: ${err.message}`); }
  };

  // seed_vc_hf_root：多个子目录散落在 checkpoints/ 根目录 + hf_cache 目录下
  if (key === 'seed_vc_hf_root') {
    const ckptRoot = getCheckpointsDir();
    // checkpoints/ 根下的 HF 格式目录
    for (const name of ['models--lj1995--VoiceConversionWebUI', 'models--funasr--campplus']) {
      rmDir(path.join(ckptRoot, name));
    }
    // checkpoints/hf_cache/ 下的 Seed-VC 依赖模型
    for (const name of ['models--nvidia--bigvgan_v2_22khz_80band_256x', 'models--openai--whisper-small']) {
      rmDir(path.join(ckptRoot, 'hf_cache', name));
    }
    return errors.length > 0 ? { ok: false, error: errors.join('\n') } : { ok: true };
  }

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

// ─── IPC：按安装阶段重新安装 ─────────────────────────────────────────────────
// 每个 stage 对应 CLEARABLE_DIRS 中的一组 key + 重装脚本
const STAGE_CLEAR_KEYS = {
  ml_base:           ['python_packages'],
  ml_extra:          ['python_packages'],      // 与 ml_base 共享目录，清除时会一起清
  checkpoints_base:  ['fish_speech_ckpt', 'gpt_sovits_ckpt', 'seed_vc_ckpt', 'rvc_ckpt', 'faster_whisper_ckpt', 'facefusion_ckpt', 'seed_vc_hf_root', 'voices'],
  checkpoints_extra: ['cosyvoice_ckpt', 'sd_ckpt', 'flux_ckpt', 'wan_ckpt', 'got_ocr_ckpt', 'liveportrait_ckpt', 'whisper_ckpt'],
};

// stage → 脚本列表（按顺序执行），支持单脚本或多脚本
const STAGE_SCRIPTS = {
  setup:             [
    { script: 'scripts/runtime.py', useSystemPython: true },
  ],
  ml_base:           [{ script: 'scripts/ml_base.py',           useSystemPython: false }],
  ml_extra:          [{ script: 'scripts/ml_extra.py',          useSystemPython: false }],
  checkpoints_base:  [{ script: 'scripts/checkpoints_base.py',  useSystemPython: false }],
  checkpoints_extra: [{ script: 'scripts/checkpoints_extra.py', useSystemPython: false }],
};

ipcMain.handle('app:reinstallStage', (_event, stage) => {
  const keys = STAGE_CLEAR_KEYS[stage];
  const scripts = STAGE_SCRIPTS[stage];
  if (!keys || !scripts) return { ok: false, error: `未知阶段：${stage}` };

  // 1) 清除该阶段的所有目录
  const dirs = CLEARABLE_DIRS();
  for (const key of keys) {
    const d = dirs[key];
    if (d && dirExists(d)) {
      try { fs.rmSync(d, { recursive: true, force: true }); } catch { /**/ }
    }
  }

  // 2) 按顺序运行重装脚本（流式 progress 复用 downloadEngine 相同机制）
  const resRoot = app.isPackaged ? process.resourcesPath : __dirname;
  const isMac = process.platform === 'darwin';

  const userPkgDir = getUserPackagesDir();
  const ckptDir = getCheckpointsDir();
  fs.mkdirSync(userPkgDir, { recursive: true });
  fs.mkdirSync(ckptDir, { recursive: true });

  const env = {
    ...process.env,
    RESOURCES_ROOT: resRoot,
    CHECKPOINTS_DIR: ckptDir,
    PYTHONPATH: [path.join(__dirname, 'backend'), userPkgDir].join(path.delimiter),
    PYTHONIOENCODING: 'utf-8',
  };

  const setupLog = createAppendLogger('setup-download.log');
  setupLog.write('INFO', `reinstallStage stage=${stage} scripts=${scripts.map(s => s.script).join(', ')}`);

  function sendProgress(msg) {
    try { setupLog.write('PROGRESS', JSON.stringify(msg)); } catch { /**/ }
    if (mainWindow && !mainWindow.isDestroyed())
      mainWindow.webContents.send('engine:download:progress', msg);
  }

  // 顺序执行多个脚本
  async function runScripts() {
    for (const info of scripts) {
      const scriptPath = path.join(resRoot, info.script);
      let pyPath;
      if (info.useSystemPython) {
        pyPath = isMac ? 'python3' : 'python';
      } else {
        pyPath = isMac
          ? path.join(resRoot, 'runtime', 'python', 'mac', 'bin', 'python3')
          : path.join(resRoot, 'runtime', 'python', 'win', 'python.exe');
      }

      sendProgress({ type: 'log', message: `▶ 运行脚本: ${info.script}` });
      const code = await new Promise((resolve) => {
        const child = spawn(pyPath, [scriptPath], { env, shell: false });
        child.stdout.on('data', (chunk) => {
          for (const line of chunk.toString().split('\n')) {
            if (!line.trim()) continue;
            try { sendProgress(JSON.parse(line)); } catch { sendProgress({ type: 'log', message: line.trimEnd() }); }
          }
        });
        child.stderr.on('data', (data) => {
          for (const line of data.toString().split('\n')) {
            if (line.trim()) sendProgress({ type: 'log', message: line.trimEnd() });
          }
        });
        child.on('close', (c) => resolve(c));
        child.on('error', (err) => {
          setupLog.write('ERROR', `reinstallStage ${stage} ${info.script} error: ${err.message}`);
          resolve(-1);
        });
      });

      setupLog.write('INFO', `reinstallStage ${stage} ${info.script} exited code=${code}`);
      if (code !== 0) return { ok: false, exitCode: code };
    }
    return { ok: true };
  }

  return runScripts();
});

// ─── IPC：仅清除阶段目录（不重装） ──────────────────────────────────────────
ipcMain.handle('app:clearStage', (_event, stage) => {
  const keys = STAGE_CLEAR_KEYS[stage];
  if (!keys) return { ok: false, error: `未知阶段：${stage}` };

  const dirs = CLEARABLE_DIRS();
  const errors = [];
  for (const key of keys) {
    const d = dirs[key];
    if (d && dirExists(d)) {
      try { fs.rmSync(d, { recursive: true, force: true }); } catch (err) { errors.push(`${d}: ${err.message}`); }
    }
  }
  return errors.length > 0 ? { ok: false, error: errors.join('\n') } : { ok: true };
});

// ─── IPC：清除阶段数据后打开引导页（供模型管理"重新安装"使用）──────────────
ipcMain.handle('app:clearStageAndOpenSetup', async (_event, stage) => {
  const keys = STAGE_CLEAR_KEYS[stage];
  if (!keys) return { ok: false, error: `未知阶段：${stage}` };

  // 1) 清除该阶段目录
  const dirs = CLEARABLE_DIRS();
  for (const key of keys) {
    const d = dirs[key];
    if (d && dirExists(d)) {
      try { fs.rmSync(d, { recursive: true, force: true }); } catch { /**/ }
    }
  }

  // 2) 检测缺失引擎并打开引导页（传入 stage 以便引导页按阶段执行脚本）
  let missingEngines = [];
  try {
    const runtimeInfo = await fetchRuntimeInfo(backendBaseUrl);
    missingEngines = Object.entries(runtimeInfo.engines || {})
      .filter(([, v]) => !v.ready)
      .map(([name, v]) => ({ engine: name, files: v.missing_checkpoints || [] }));
  } catch {}

  openSetupGuideWindow(missingEngines, stage);
  return { ok: true };
});

// ─── IPC：下载单个引擎 checkpoint ────────────────────────────────────────────
// 全引擎集合（统一由 runtime.py 处理）
const ALL_ENGINES = new Set([
  'fish_speech', 'gpt_sovits', 'seed_vc', 'rvc', 'faster_whisper', 'facefusion', 'voices',
  'agent_engine', 'finetune_engine', 'flux', 'got_ocr', 'liveportrait', 'rag_engine', 'sd', 'wan', 'whisper',
]);

// 需要 ML 依赖的引擎及其对应的 group（ml_extra.py --group）
const ML_INSTALL_GROUPS = {
  'rag_engine': 'rag',
  'agent_engine': 'agent',
  'finetune_engine': 'lora',
};

ipcMain.handle('app:downloadEngine', (_event, engine) => {
  const isMac = process.platform === 'darwin';
  const resRoot = app.isPackaged ? process.resourcesPath : __dirname;
  const pyPath = isMac
    ? path.join(resRoot, 'runtime', 'python', 'mac', 'bin', 'python3')
    : path.join(resRoot, 'runtime', 'python', 'win', 'python.exe');
  const ckptDir = getCheckpointsDir();
  const userPkgDir = getUserPackagesDir();
  fs.mkdirSync(ckptDir, { recursive: true });
  fs.mkdirSync(userPkgDir, { recursive: true });

  // 读取用户保存的镜像配置（与 setup guide 共享同一份 app-config.json）
  let hfEndpoint = '', pypiMirror = '';
  try {
    const cfgPath = path.join(app.getPath('userData'), 'app-config.json');
    const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf-8'));
    hfEndpoint = (cfg.hfEndpoint || '').trim();
    pypiMirror = (cfg.pypiMirror || '').trim();
  } catch { /**/ }

  // 复用 setup guide 相同的环境变量配置
  const env = {
    ...process.env,
    RESOURCES_ROOT: resRoot,
    CHECKPOINTS_DIR: ckptDir,
    PYTHONPATH: [path.join(__dirname, 'backend'), userPkgDir].join(path.delimiter),
    PYTHONIOENCODING: 'utf-8',
    ...(hfEndpoint ? { HF_ENDPOINT: hfEndpoint } : {}),
  };

  // 复用 setup-download.log 日志文件
  const setupLog = createAppendLogger('setup-download.log');
  setupLog.write('INFO', '═══════════════════════════════════════════════════════════');
  setupLog.write('INFO', `downloadEngine engine=${engine} pid=${process.pid}`);
  setupLog.write('INFO', `checkpoints_dir=${ckptDir}`);
  setupLog.write('INFO', `python_packages_dir=${userPkgDir}`);
  setupLog.write('INFO', `python=${pyPath}`);
  setupLog.write('INFO', `hf_endpoint=${hfEndpoint || '(empty)'}`);
  setupLog.write('INFO', `pypi_mirror=${pypiMirror || '(empty)'}`);

  function sendProgress(msg) {
    try { setupLog.write('PROGRESS', JSON.stringify(msg)); } catch { /**/ }
    if (mainWindow && !mainWindow.isDestroyed())
      mainWindow.webContents.send('engine:download:progress', msg);
  }

  function spawnScript(stageName, scriptPath, scriptArgs) {
    return new Promise((resolve) => {
      setupLog.write('INFO', `[${stageName}] spawn ${pyPath} ${[scriptPath, ...scriptArgs].join(' ')}`);
      const child = spawn(pyPath, [scriptPath, ...scriptArgs], { env, shell: false });
      child.stdout.on('data', (chunk) => {
        for (const line of chunk.toString().split('\n')) {
          if (!line.trim()) continue;
          setupLog.write('STDOUT', `[${stageName}] ${line}`);
          try {
            sendProgress(JSON.parse(line));
          } catch {
            sendProgress({ type: 'log', message: line.trimEnd() });
          }
        }
      });
      child.stderr.on('data', (data) => {
        for (const line of data.toString().split('\n')) {
          if (line.trim()) {
            setupLog.write('STDERR', `[${stageName}] ${line}`);
            sendProgress({ type: 'log', message: line.trimEnd() });
          }
        }
      });
      child.on('close', (code) => {
        setupLog.write('INFO', `[${stageName}] close code=${String(code)}`);
        resolve({ ok: code === 0, exitCode: code });
      });
      child.on('error', (err) => {
        setupLog.write('ERROR', `[${stageName}] spawn error: ${err.message}`);
        sendProgress({ type: 'log', message: `[${stageName}] 启动失败: ${err.message}` });
        resolve({ ok: false, error: err.message });
      });
    });
  }

  sendProgress({ type: 'log', message: `详细日志：${setupLog.path}` });

  return (async () => {
    // 第一步：如果需要 ML 依赖，先安装
    const mlGroup = ML_INSTALL_GROUPS[engine];
    if (mlGroup) {
      const groupLabel = { rag: 'RAG 知识库', agent: 'Agent 智能体', lora: 'LoRA 微调' }[mlGroup];
      sendProgress({ type: 'log', message: `▶ [${engine}] 安装 ${groupLabel} 依赖...` });
      const mlScript = path.join(__dirname, 'scripts', 'ml_extra.py');
      const mlArgs = ['--group', mlGroup, '--target', userPkgDir, '--json-progress'];
      if (pypiMirror) mlArgs.push('--pypi-mirror', pypiMirror);
      const mlResult = await spawnScript(`engine-ml-${engine}`, mlScript, mlArgs);
      if (!mlResult.ok) {
        sendProgress({ type: 'all_done', ok: false });
        setupLog.close();
        return mlResult;
      }
    }

    // 第二步：pip_packages + 引擎源码（runtime.py --engine）
    const setupScript = path.join(__dirname, 'scripts', 'runtime.py');
    sendProgress({ type: 'log', message: `▶ [${engine}] 安装引擎依赖 + 源码...` });
    const setupResult = await spawnScript(`engine-setup-${engine}`, setupScript, ['--engine', engine]);
    if (!setupResult.ok) {
      sendProgress({ type: 'all_done', ok: false });
      setupLog.close();
      return setupResult;
    }

    // 第三步：下载模型权重
    sendProgress({ type: 'log', message: `▶ [${engine}] 下载模型权重...` });
    const dlScript = path.join(__dirname, 'scripts', isExtraEngine ? 'checkpoints_extra.py' : 'checkpoints_base.py');
    const dlArgs = ['--engine', engine, '--json-progress'];
    if (hfEndpoint) dlArgs.push('--hf-endpoint', hfEndpoint);
    if (pypiMirror) dlArgs.push('--pypi-mirror', pypiMirror);
    const dlResult = await spawnScript(`engine-ckpt-${engine}`, dlScript, dlArgs);
    setupLog.close();
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
  // 清理 worker 子进程（backend 启动的孙进程，不会随 pyProcess 一起退出）
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
    if (pyProcess) {
      spawn('taskkill', ['/pid', pyProcess.pid, '/f', '/t']);
    }
    app.quit();
  }
});
