const { app } = require('electron');
const path = require('path');
const fs = require('fs');
const net = require('net');
const http = require('http');
const { PROJECT_ROOT } = require('./paths');

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

function waitFrontendReady(url, timeoutMs) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    function poll() {
      const req = http.get(url, { timeout: 3000 }, (res) => {
        let body = '';
        res.on('data', d => { body += d; });
        res.on('end', () => {
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

function readManifest() {
  try {
    const mp = app.isPackaged
      ? path.join(process.resourcesPath, 'app', 'backend', 'wrappers', 'manifest.json')
      : path.join(PROJECT_ROOT, 'backend', 'wrappers', 'manifest.json');
    return JSON.parse(fs.readFileSync(mp, 'utf-8'));
  } catch { return {}; }
}

function findRvcBaseModelDirs() {
  const isMac = process.platform === 'darwin';
  const resRoot = app.isPackaged ? process.resourcesPath : PROJECT_ROOT;
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

module.exports = {
  getDirSize,
  dirExists,
  getAvailablePort,
  waitBackendReady,
  waitFrontendReady,
  fetchRuntimeInfo,
  readManifest,
  findRvcBaseModelDirs,
};
