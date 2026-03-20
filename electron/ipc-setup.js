const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const { getCheckpointsDir, getUserPackagesDir, getResRoot, PROJECT_ROOT } = require('./paths');
const { createAppendLogger, downloadLogFilename } = require('./logger');
const state = require('./state');
const { STAGE_SCRIPTS } = require('./constants');
const { openAutoDownloadWindow } = require('./windows');

function registerSetupIpc() {

ipcMain.handle('setup:startDownload', (_event, opts) => {
  const hfEndpoint   = (opts && opts.hfEndpoint)  ? opts.hfEndpoint.trim()  : '';
  const pypiMirror   = (opts && opts.pypiMirror)  ? opts.pypiMirror.trim()  : '';
  const stage        = (opts && opts.stage)        ? opts.stage              : null;
  const resRoot      = getResRoot();
  const isMac        = process.platform === 'darwin';
  const ckptDir      = getCheckpointsDir();
  const userPkgDir   = getUserPackagesDir();
  fs.mkdirSync(ckptDir,    { recursive: true });
  fs.mkdirSync(userPkgDir, { recursive: true });

  const embeddedPyPath = isMac
    ? path.join(resRoot, 'runtime', 'python', 'mac', 'bin', 'python3')
    : path.join(resRoot, 'runtime', 'python', 'win', 'python.exe');
  const systemPyPath = isMac ? 'python3' : 'python';

  const env = {
    ...process.env,
    RESOURCES_ROOT: resRoot,
    CHECKPOINTS_DIR: ckptDir,
    PYTHONPATH: [path.join(PROJECT_ROOT, 'backend'), userPkgDir].join(path.delimiter),
    PYTHONIOENCODING: 'utf-8',
    ...(hfEndpoint ? { HF_ENDPOINT: hfEndpoint } : {}),
  };
  const setupLog = createAppendLogger(downloadLogFilename());
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
    if (state.setupGuideWin && !state.setupGuideWin.isDestroyed()) {
      state.setupGuideWin.webContents.send('setup:progress', msg);
    }
  }

  function spawnScript(stageName, pyPath, scriptPath, args, onClose) {
    setupLog.write('INFO', `[${stageName}] spawn ${pyPath} ${[scriptPath, ...args].join(' ')}`);
    const proc = spawn(pyPath, [scriptPath, ...args], { env, shell: false });
    proc.stdout.on('data', (data) => {
      const text = data.toString();
      text.split('\n').filter(Boolean).forEach(line => {
        try {
          sendProgress(JSON.parse(line));
        } catch {
          setupLog.write('STDOUT', `[${stageName}] ${line}`);
          sendProgress({ type: 'log', message: line });
        }
      });
    });
    proc.stderr.on('data', (data) => {
      const text = data.toString();
      text.split('\n').filter(Boolean).forEach(line => {
        setupLog.write('STDERR', `[${stageName}] ${line}`);
      });
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
    const scripts = STAGE_SCRIPTS[stage];
    setupLog.write('INFO', `stage=${stage} scripts=${scripts.map(s => s.script).join(', ')}`);

    async function runStageScripts() {
      for (const info of scripts) {
        const scriptPath = path.join(PROJECT_ROOT, info.script);
        const pyPath = info.useSystemPython ? systemPyPath : embeddedPyPath;

        const isSetupScript = info.script.includes('runtime.py');
        const args = [];
        if (!isSetupScript) args.push('--json-progress');
        if (info.script.includes('ml_base') || info.script.includes('ml_extra')) {
          args.unshift('--target', userPkgDir);
        }
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
          if (state.setupGuideWin && !state.setupGuideWin.isDestroyed()) {
            state.setupGuideWin.webContents.send('setup:done', { exitCode: code });
          }
          state.downloadProc = null;
          return;
        }
        sendProgress({ type: 'log', message: `✓ ${info.script} 完成` });
      }

      setupLog.write('INFO', `stage=${stage} all scripts success`);
      setupLog.close();
      if (state.setupGuideWin && !state.setupGuideWin.isDestroyed()) {
        state.setupGuideWin.webContents.send('setup:done', { exitCode: 0 });
      }
      state.downloadProc = null;
    }

    const downloadProcs = [];
    state.downloadProc = {
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
    state.downloadProc = null;
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
    if (state.setupGuideWin && !state.setupGuideWin.isDestroyed()) {
      state.setupGuideWin.webContents.send('setup:done', { exitCode: finalCode });
    }
  }

  const runtimeDepsScript = path.join(PROJECT_ROOT, 'scripts', 'ml_base.py');
  const downloadScript   = path.join(PROJECT_ROOT, 'scripts', 'checkpoints_base.py');

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
  state.downloadProc = {
    kill: () => { downloadProcs.forEach(p => { try { p.kill(); } catch {} }); },
  };

  return { ok: true };
});

ipcMain.handle('setup:cancelDownload', (_event) => {
  const senderWin = BrowserWindow.fromWebContents(_event.sender);
  const dualEntry = state.dualDownloadWins.find(d => d.win === senderWin);
  if (dualEntry && dualEntry.proc) {
    try { dualEntry.proc.kill(); } catch {}
    dualEntry.proc = null;
    return { ok: true };
  }
  if (state.downloadProc) { state.downloadProc.kill(); state.downloadProc = null; }
  return { ok: true };
});

// ─── 双窗口并行下载（全部重装）─────────────────────────────────────────────
ipcMain.handle('setup:startDualDownload', async (_event, opts) => {
  const hfEndpoint = (opts && opts.hfEndpoint) ? opts.hfEndpoint.trim() : '';
  const pypiMirror = (opts && opts.pypiMirror) ? opts.pypiMirror.trim() : '';

  if (state.setupGuideWin && !state.setupGuideWin.isDestroyed()) {
    state.setupGuideWin.close();
    state.setupGuideWin = null;
  }

  const { screen } = require('electron');
  const primaryDisplay = screen.getPrimaryDisplay();
  const { width: screenW, height: screenH } = primaryDisplay.workAreaSize;
  const winW = Math.min(620, Math.floor(screenW / 2) - 20);
  const winH = 420;
  const y = Math.floor((screenH - winH) / 2);

  const autoOpts = { hfEndpoint, pypiMirror };

  const mlWin = openAutoDownloadWindow('ML 依赖安装', 'ml_only', autoOpts);
  mlWin.setBounds({ x: Math.floor(screenW / 2) - winW - 10, y, width: winW, height: winH });

  const ckptWin = openAutoDownloadWindow('模型权重下载', 'checkpoints_only', autoOpts);
  ckptWin.setBounds({ x: Math.floor(screenW / 2) + 10, y, width: winW, height: winH });

  state.dualDownloadWins = [
    { win: mlWin, proc: null },
    { win: ckptWin, proc: null },
  ];

  mlWin.on('closed', () => { state.dualDownloadWins = state.dualDownloadWins.filter(d => d.win !== mlWin); });
  ckptWin.on('closed', () => { state.dualDownloadWins = state.dualDownloadWins.filter(d => d.win !== ckptWin); });

  return { ok: true };
});

// ─── 单窗口自动下载（双窗口模式中每个窗口各自启动下载）────────────────────
ipcMain.handle('setup:startAutoDownload', (_event, opts) => {
  const mode       = opts.mode;
  const hfEndpoint = (opts.hfEndpoint || '').trim();
  const pypiMirror = (opts.pypiMirror || '').trim();
  const resRoot    = getResRoot();
  const isMac      = process.platform === 'darwin';
  const ckptDir    = getCheckpointsDir();
  const userPkgDir = getUserPackagesDir();
  fs.mkdirSync(ckptDir,    { recursive: true });
  fs.mkdirSync(userPkgDir, { recursive: true });

  const embeddedPyPath = isMac
    ? path.join(resRoot, 'runtime', 'python', 'mac', 'bin', 'python3')
    : path.join(resRoot, 'runtime', 'python', 'win', 'python.exe');

  const env = {
    ...process.env,
    RESOURCES_ROOT: resRoot,
    CHECKPOINTS_DIR: ckptDir,
    PYTHONPATH: [path.join(PROJECT_ROOT, 'backend'), userPkgDir].join(path.delimiter),
    PYTHONIOENCODING: 'utf-8',
    ...(hfEndpoint ? { HF_ENDPOINT: hfEndpoint } : {}),
  };

  const suffix = mode === 'ml_only' ? 'ml' : 'ckpt';
  const setupLog = createAppendLogger(downloadLogFilename(`download-${suffix}`));
  setupLog.write('INFO', `startAutoDownload mode=${mode}`);

  const senderWin = BrowserWindow.fromWebContents(_event.sender);

  function sendProgress(msg) {
    try { setupLog.write('PROGRESS', JSON.stringify(msg)); } catch {}
    if (senderWin && !senderWin.isDestroyed()) {
      senderWin.webContents.send('setup:progress', msg);
    }
  }

  function spawnAndTrack(stageName, pyPath, scriptPath, args) {
    setupLog.write('INFO', `[${stageName}] spawn ${pyPath} ${[scriptPath, ...args].join(' ')}`);
    const proc = spawn(pyPath, [scriptPath, ...args], { env, shell: false });
    proc.stdout.on('data', (data) => {
      data.toString().split('\n').filter(Boolean).forEach(line => {
        try { sendProgress(JSON.parse(line)); } catch {
          setupLog.write('STDOUT', `[${stageName}] ${line}`);
          sendProgress({ type: 'log', message: line });
        }
      });
    });
    proc.stderr.on('data', (data) => {
      data.toString().split('\n').filter(Boolean).forEach(line => {
        setupLog.write('STDERR', `[${stageName}] ${line}`);
      });
    });
    proc.on('error', (err) => {
      setupLog.write('ERROR', `[${stageName}] spawn error: ${err.message}`);
      sendProgress({ type: 'log', message: `启动失败: ${err.message}` });
    });
    return proc;
  }

  sendProgress({ type: 'log', message: `详细日志：${setupLog.path}` });

  if (mode === 'ml_only') {
    const scriptPath = path.join(PROJECT_ROOT, 'scripts', 'ml_base.py');
    const args = ['--target', userPkgDir, '--json-progress'];
    if (pypiMirror) args.push('--pypi-mirror', pypiMirror);

    const proc = spawnAndTrack('ml-base', embeddedPyPath, scriptPath, args);
    const entry = state.dualDownloadWins.find(d => d.win === senderWin);
    if (entry) entry.proc = proc;

    proc.on('close', (code) => {
      setupLog.write('INFO', `[ml-base] close code=${code}`);
      setupLog.close();
      if (senderWin && !senderWin.isDestroyed()) {
        senderWin.webContents.send('setup:done', { exitCode: code || 0 });
      }
    });
  } else {
    const scriptPath = path.join(PROJECT_ROOT, 'scripts', 'checkpoints_base.py');
    const args = ['--json-progress'];
    if (hfEndpoint) args.push('--hf-endpoint', hfEndpoint);
    if (pypiMirror) args.push('--pypi-mirror', pypiMirror);

    const proc = spawnAndTrack('checkpoints', embeddedPyPath, scriptPath, args);
    const entry = state.dualDownloadWins.find(d => d.win === senderWin);
    if (entry) entry.proc = proc;

    proc.on('close', (code) => {
      setupLog.write('INFO', `[checkpoints] close code=${code}`);
      setupLog.close();
      if (senderWin && !senderWin.isDestroyed()) {
        senderWin.webContents.send('setup:done', { exitCode: code || 0 });
      }
    });
  }

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

ipcMain.handle('setup:closeWindow', (_event) => {
  const senderWin = BrowserWindow.fromWebContents(_event.sender);
  const dualEntry = state.dualDownloadWins.find(d => d.win === senderWin);
  if (dualEntry) {
    if (dualEntry.proc) { try { dualEntry.proc.kill(); } catch {} }
    if (senderWin && !senderWin.isDestroyed()) senderWin.close();
    return { ok: true };
  }
  if (state.setupGuideWin && !state.setupGuideWin.isDestroyed()) state.setupGuideWin.close();
  return { ok: true };
});

} // end registerSetupIpc

module.exports = { registerSetupIpc };
