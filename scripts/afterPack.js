/**
 * electron-builder afterPack 钩子
 * Windows 嵌入式 Python 的 _pth 文件会限制 sys.path，
 * 打包后自动追加 backend 目录，确保 `import config` 等能正常找到。
 */
const fs = require('fs');
const path = require('path');
const glob = require('glob');

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'win32') return;

  const pythonDir = path.join(context.appOutDir, 'resources', 'runtime', 'win', 'python');
  if (!fs.existsSync(pythonDir)) {
    console.log('[afterPack] Windows Python 目录不存在，跳过 _pth 修补');
    return;
  }

  // 找 python3XX._pth 文件
  const pthFiles = fs.readdirSync(pythonDir).filter(f => f.endsWith('._pth'));
  if (pthFiles.length === 0) {
    console.log('[afterPack] 未找到 ._pth 文件，跳过');
    return;
  }

  // backend 相对于 python.exe 所在目录的路径
  // python.exe: resources/runtime/win/python/
  // backend:    resources/app/backend/
  const backendRelPath = path.join('..', '..', '..', 'app', 'backend');

  for (const pthFile of pthFiles) {
    const pthPath = path.join(pythonDir, pthFile);
    const content = fs.readFileSync(pthPath, 'utf-8');
    if (content.includes(backendRelPath)) {
      console.log(`[afterPack] ${pthFile} 已包含 backend 路径，跳过`);
      continue;
    }
    fs.writeFileSync(pthPath, content.trimEnd() + '\n' + backendRelPath + '\n', 'utf-8');
    console.log(`[afterPack] 已写入 backend 路径到 ${pthFile}`);
  }
};
