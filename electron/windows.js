const { BrowserWindow } = require('electron');
const path = require('path');
const http = require('http');
const state = require('./state');
const { readManifest } = require('./utils');

let overviewWin = null;

function openHealthCheckWindow(parentWin) {
  const url = `${state.backendBaseUrl}/health`;
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

  const loadingHtml = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
    body{margin:0;background:#1e1e1e;color:#d4d4d4;font:14px/1.6 "Menlo","Consolas",monospace;display:flex;align-items:center;justify-content:center;height:100vh}
    .url{color:#569cd6}
  </style></head><body><div>正在请求 <span class="url">${url}</span> …</div></body></html>`;
  win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(loadingHtml));

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

function openSetupGuideWindow(missingEngines, stage) {
  return new Promise((resolve) => {
    state.setupGuideWin = new BrowserWindow({
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
    state.setupGuideWin.setMenu(null);
    state.setupGuideWin.loadFile(path.join(__dirname, 'setup-guide.html'));
    state.setupGuideWin.webContents.once('did-finish-load', () => {
      const manifest = readManifest();
      state.setupGuideWin.webContents.send('setup:info', { missingEngines, manifest, stage: stage || null });
    });
    state.setupGuideWin.on('closed', () => {
      state.setupGuideWin = null;
      resolve();
    });
  });
}

function openDualSetupConfigWindow() {
  return new Promise((resolve) => {
    state.setupGuideWin = new BrowserWindow({
      width: 680,
      height: 520,
      title: '重新下载全部 — 选择镜像源',
      resizable: false,
      minimizable: false,
      maximizable: false,
      webPreferences: {
        preload: path.join(__dirname, 'setup-guide-preload.js'),
        nodeIntegration: false,
        contextIsolation: true,
      },
    });
    state.setupGuideWin.setMenu(null);
    state.setupGuideWin.loadFile(path.join(__dirname, 'setup-guide.html'));
    state.setupGuideWin.webContents.once('did-finish-load', () => {
      const manifest = readManifest();
      state.setupGuideWin.webContents.send('setup:info', { missingEngines: [], manifest, stage: null, mode: 'dual' });
    });
    state.setupGuideWin.on('closed', () => {
      state.setupGuideWin = null;
      resolve();
    });
  });
}

function openAutoDownloadWindow(title, mode, opts) {
  const win = new BrowserWindow({
    width: 620,
    height: 420,
    title,
    resizable: false,
    minimizable: false,
    maximizable: false,
    webPreferences: {
      preload: path.join(__dirname, 'setup-guide-preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
    },
  });
  win.setMenu(null);
  win.loadFile(path.join(__dirname, 'setup-guide.html'));
  win.webContents.once('did-finish-load', () => {
    const manifest = readManifest();
    win.webContents.send('setup:info', { missingEngines: [], manifest, stage: null, mode, autoOpts: opts });
  });
  return win;
}

module.exports = {
  openHealthCheckWindow,
  openOverviewWindow,
  openSetupGuideWindow,
  openDualSetupConfigWindow,
  openAutoDownloadWindow,
};
