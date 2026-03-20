const { app } = require('electron');
const path = require('path');
const fs = require('fs');

// electron/ サブディレクトリから一つ上がプロジェクトルート
const PROJECT_ROOT = path.join(__dirname, '..');

// dev:  <项目根>/logs/
// prod: .app 同级目录（Mac）或 exe 所在目录（Win）下的 logs/
function _resolveLogsDir() {
  if (app.isPackaged) {
    const exeDir = path.dirname(app.getPath('exe'));
    const container = process.platform === 'darwin'
      ? path.join(exeDir, '..', '..', '..')
      : exeDir;
    return path.join(container, 'logs');
  }
  return path.join(PROJECT_ROOT, 'logs');
}

const LOGS_DIR = _resolveLogsDir();
fs.mkdirSync(LOGS_DIR, { recursive: true });

const CACHE_DIR = path.join(path.dirname(LOGS_DIR), 'cache');
fs.mkdirSync(CACHE_DIR, { recursive: true });

function getLogDir() {
  return LOGS_DIR;
}

// dev:  <项目根>/runtime/checkpoints/
// prod: process.resourcesPath/runtime/checkpoints/
function getCheckpointsDir() {
  const resRoot = app.isPackaged ? process.resourcesPath : PROJECT_ROOT;
  return path.join(resRoot, 'runtime', 'checkpoints');
}

// dev:  <项目根>/runtime/ml/
// prod: process.resourcesPath/runtime/ml/
function getUserPackagesDir() {
  const resRoot = app.isPackaged ? process.resourcesPath : PROJECT_ROOT;
  return path.join(resRoot, 'runtime', 'ml');
}

function getResRoot() {
  return app.isPackaged ? process.resourcesPath : PROJECT_ROOT;
}

module.exports = {
  PROJECT_ROOT,
  LOGS_DIR,
  CACHE_DIR,
  getLogDir,
  getCheckpointsDir,
  getUserPackagesDir,
  getResRoot,
};
