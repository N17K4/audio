/**
 * electron-builder afterPack 钩子
 * 1. Windows 嵌入式 Python 的 _pth 文件会限制 sys.path，
 *    打包后自动追加 backend 目录，确保 `import config` 等能正常找到。
 * 2. fairseq 0.12.2 在 Python 3.12 下存在 dataclass / hydra 兼容问题，
 *    这里直接修补打包产物中的 embedded site-packages，避免最终产物翻车。
 */
const fs = require('fs');
const path = require('path');

function patchFairseqPy312(sitePackagesDir) {
  const fairseqDir = path.join(sitePackagesDir, 'fairseq');
  if (!fs.existsSync(fairseqDir)) {
    console.log(`[afterPack] 未找到 fairseq，跳过 Python 3.12 兼容修补: ${sitePackagesDir}`);
    return;
  }

  const initPy = path.join(fairseqDir, '__init__.py');
  if (fs.existsSync(initPy)) {
    let text = fs.readFileSync(initPy, 'utf-8');
    if (text.includes('hydra_init()') && !text.includes('pass  # Py3.12 兼容跳过')) {
      text = text.replace(
        'hydra_init()',
        'try:\n    hydra_init()\nexcept Exception:\n    pass  # Py3.12 兼容跳过'
      );
    }
    const bulkImports = text.match(/^import fairseq\.\S+.*$/gm) || [];
    if (bulkImports.length > 0) {
      const block = bulkImports.join('\n');
      const loop =
        'for _m in ' + JSON.stringify(bulkImports.map((line) => line.replace('import ', '').replace('  # noqa', '').trim())) + ':\n' +
        '    try:\n' +
        '        import importlib as _il; _il.import_module(_m)\n' +
        '    except Exception:\n' +
        '        pass\n';
      text = text.replace(block, loop);
    }
    fs.writeFileSync(initPy, text, 'utf-8');
  }

  const patchMutableDefaults = (pyFile) => {
    if (!fs.existsSync(pyFile)) return;
    let text = fs.readFileSync(pyFile, 'utf-8');
    text = text.replace(
      /^(\s+\w+:\s+\w+)\s*=\s*(\w+)\(\)$/gm,
      (full, prefix, typename) => {
        if (/^[A-Z]/.test(typename) && !['Optional', 'List', 'Dict', 'Tuple', 'Any'].includes(typename)) {
          return `${prefix} = field(default_factory=${typename})`;
        }
        return full;
      }
    );
    text = text.replace(/field\(default=([A-Z]\w+)\(\)\)/g, 'field(default_factory=$1)');
    fs.writeFileSync(pyFile, text, 'utf-8');
  };

  patchMutableDefaults(path.join(fairseqDir, 'dataclass', 'configs.py'));
  patchMutableDefaults(path.join(fairseqDir, 'models', 'transformer', 'transformer_config.py'));
  console.log(`[afterPack] 已应用 fairseq Python 3.12 兼容补丁: ${fairseqDir}`);
}

function patchWindowsPythonPath(context) {
  if (context.electronPlatformName !== 'win32') return;

  const pythonDir = path.join(context.appOutDir, 'resources', 'runtime', 'python', 'win');
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
  // python.exe: resources/runtime/python/win/
  // backend:    resources/backend/
  const backendRelPath = path.join('..', '..', '..', 'backend');

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
}

function verifyEngineResources(context) {
  const platform = context.electronPlatformName;
  const resourcesDir = platform === 'darwin'
    ? path.join(context.appOutDir, 'AI Workshop.app', 'Contents', 'Resources')
    : path.join(context.appOutDir, 'resources');

  const engineDir = path.join(resourcesDir, 'runtime', 'engine');
  console.log(`[afterPack] ── 验证 extraResources (${platform}) ──`);

  if (!fs.existsSync(engineDir)) {
    console.log(`[afterPack] ✗ runtime/engine 目录不存在: ${engineDir}`);
    return;
  }

  // 列出 engine/ 下的顶层目录
  const engines = fs.readdirSync(engineDir);
  console.log(`[afterPack] runtime/engine/ 子目录: [${engines.join(', ')}]`);

  // 详细检查 facefusion
  const ffDir = path.join(engineDir, 'facefusion');
  if (!fs.existsSync(ffDir)) {
    console.log(`[afterPack] ✗ facefusion 目录不存在!`);
  } else {
    const ffEntries = fs.readdirSync(ffDir);
    console.log(`[afterPack] facefusion/ 内容: [${ffEntries.join(', ')}]`);
    const sentinel = path.join(ffDir, 'facefusion', '__init__.py');
    console.log(`[afterPack] facefusion/facefusion/__init__.py 存在: ${fs.existsSync(sentinel)}`);
  }

  // 检查源码目录（打包前）
  const projectRoot = path.resolve(__dirname, '..');
  const srcEngineDir = path.join(projectRoot, 'runtime', 'engine', 'facefusion');
  if (fs.existsSync(srcEngineDir)) {
    const srcEntries = fs.readdirSync(srcEngineDir);
    console.log(`[afterPack] 源 facefusion/ 内容: [${srcEntries.join(', ')}]`);
  }
}

exports.default = async function afterPack(context) {
  patchWindowsPythonPath(context);
  verifyEngineResources(context);

  if (context.electronPlatformName === 'win32') {
    patchFairseqPy312(path.join(context.appOutDir, 'resources', 'runtime', 'python', 'win', 'Lib', 'site-packages'));
    return;
  }

  if (context.electronPlatformName === 'darwin') {
    patchFairseqPy312(path.join(context.appOutDir, 'AI Workshop.app', 'Contents', 'Resources', 'runtime', 'python', 'mac', 'lib', 'python3.12', 'site-packages'));
  }
};
