const path = require('path');
const fs = require('fs');
const { LOGS_DIR } = require('./paths');

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

function downloadLogFilename(prefix = 'download') {
  const now = new Date();
  const ts = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0'),
    '-',
    String(now.getHours()).padStart(2, '0'),
    String(now.getMinutes()).padStart(2, '0'),
    String(now.getSeconds()).padStart(2, '0'),
  ].join('');
  return `${prefix}-${ts}.log`;
}

const electronLog = createFileLogger('electron.log');
const frontendLog = createFileLogger('frontend.log');

// 主进程 console → electron.log
const _origLog = console.log.bind(console);
const _origErr = console.error.bind(console);
console.log = (...a) => { try { _origLog(...a); } catch { /**/ } electronLog('INFO', ...a); };
console.error = (...a) => { try { _origErr(...a); } catch { /**/ } electronLog('ERROR', ...a); };

// 防止 EPIPE 崩溃主进程
process.on('uncaughtException', (err) => {
  if (err.code === 'EPIPE') return;
  electronLog('ERROR', '[uncaughtException]', err.stack || err.message);
  _origErr('[uncaughtException]', err);
});

module.exports = {
  createFileLogger,
  createAppendLogger,
  downloadLogFilename,
  electronLog,
  frontendLog,
};
