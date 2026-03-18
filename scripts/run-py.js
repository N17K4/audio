#!/usr/bin/env node
/**
 * 跨平台运行 Python 脚本（使用嵌入式 Python）
 * 用法: node scripts/run-py.js ml_base.py [args...]
 */

const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');

const PROJECT_ROOT = path.dirname(path.dirname(__filename));

// 获取嵌入式 Python 路径
function getPythonPath() {
  const platform = os.platform();
  if (platform === 'darwin') {
    return path.join(PROJECT_ROOT, 'runtime', 'mac', 'python', 'bin', 'python3');
  } else if (platform === 'win32') {
    return path.join(PROJECT_ROOT, 'runtime', 'win', 'python', 'python.exe');
  } else {
    return path.join(PROJECT_ROOT, 'runtime', 'linux', 'python', 'bin', 'python3');
  }
}

const pyPath = getPythonPath();
const scriptName = process.argv[2];
const args = process.argv.slice(3);

if (!scriptName) {
  console.error('用法: node scripts/run-py.js <script> [args...]');
  process.exit(1);
}

const scriptPath = path.join(PROJECT_ROOT, 'scripts', scriptName);

try {
  execFileSync(pyPath, [scriptPath, ...args], {
    stdio: 'inherit',
    env: {
      ...process.env,
      PYTHONPATH: path.join(PROJECT_ROOT, 'backend')
    }
  });
} catch (err) {
  process.exit(err.status || 1);
}
