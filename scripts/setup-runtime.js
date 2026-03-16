#!/usr/bin/env node
/**
 * setup-runtime.js
 *
 * 将所有 Python 依赖装进内置嵌入式 Python，无需用户手动执行任何 pip/poetry 命令。
 *
 * 原理：
 *   - 将嵌入式 Python 的 bin/ 目录置于 PATH 最前方
 *   - POETRY_VIRTUALENVS_CREATE=false → poetry 直接把包装进嵌入式 Python 的 site-packages
 *   - backend/poetry.toml 也声明了 create=false，双重保险
 *
 * 安装顺序：
 *   0. 若嵌入式 Python 不存在，自动下载 standalone Python
 *      macOS: python-build-standalone (astral-sh/python-build-standalone) 3.12
 *      Windows: python.org 嵌入式包 3.10（rvc-python 兼容性）
 *   1. backend/pyproject.toml 的所有依赖（通过内置 pip）
 *   2. 各引擎的 pip_packages（通过 setup-engines.py）
 */

"use strict";

const { execSync } = require("child_process");
const path = require("path");
const fs = require("fs");
const https = require("https");
const http = require("http");

const ROOT = path.resolve(__dirname, "..");
const BACKEND_DIR = path.join(ROOT, "backend");

// ─── 嵌入式 Python 版本配置 ────────────────────────────────────────────────────

// macOS: python-build-standalone，固定 release 日期 + Python 版本
const MAC_PBS_RELEASE  = "20250317";
const MAC_PY_VERSION   = "3.12.9";

// Windows: python.org 嵌入式包
const WIN_PY_VERSION   = "3.10.11";

// ─── 下载工具 ─────────────────────────────────────────────────────────────────

function download(url, destPath) {
  return new Promise((resolve, reject) => {
    console.log(`  下载: ${url}`);
    const file = fs.createWriteStream(destPath);
    const protocol = url.startsWith("https") ? https : http;

    function doGet(u) {
      protocol.get(u, (res) => {
        if (res.statusCode === 301 || res.statusCode === 302) {
          doGet(res.headers.location);
          return;
        }
        if (res.statusCode !== 200) {
          reject(new Error(`HTTP ${res.statusCode}: ${u}`));
          return;
        }
        const total = parseInt(res.headers["content-length"] || "0", 10);
        let received = 0;
        let lastPct = -1;
        res.on("data", (chunk) => {
          received += chunk.length;
          if (total > 0) {
            const pct = Math.floor(received * 100 / total);
            if (pct !== lastPct && pct % 10 === 0) {
              process.stdout.write(`\r  ${pct}% (${(received / 1024 / 1024).toFixed(1)} MB)`);
              lastPct = pct;
            }
          }
        });
        res.pipe(file);
        file.on("finish", () => { file.close(); process.stdout.write("\n"); resolve(); });
      }).on("error", reject);
    }
    doGet(url);
  });
}

// ─── macOS standalone Python 下载 ────────────────────────────────────────────

async function downloadMacPython(destDir) {
  const arch = process.arch === "arm64" ? "aarch64" : "x86_64";
  const filename = `cpython-${MAC_PY_VERSION}+${MAC_PBS_RELEASE}-${arch}-apple-darwin-install_only.tar.gz`;
  const url = `https://github.com/astral-sh/python-build-standalone/releases/download/${MAC_PBS_RELEASE}/${filename}`;
  const tmpTar = path.join(ROOT, "runtime", "_python_tmp.tar.gz");

  fs.mkdirSync(path.join(ROOT, "runtime"), { recursive: true });
  await download(url, tmpTar);

  console.log("  解压 standalone Python...");
  // 解压到临时目录，再移动到目标位置
  const tmpExtract = path.join(ROOT, "runtime", "_python_extract_tmp");
  fs.mkdirSync(tmpExtract, { recursive: true });
  execSync(`tar -xzf "${tmpTar}" -C "${tmpExtract}"`);
  fs.unlinkSync(tmpTar);

  // python-build-standalone install_only 解压后为 python/ 目录
  const extractedPython = path.join(tmpExtract, "python");
  if (!fs.existsSync(extractedPython)) {
    throw new Error(`解压后未找到 python/ 目录，请检查 ${tmpExtract}`);
  }
  fs.mkdirSync(path.dirname(destDir), { recursive: true });
  fs.renameSync(extractedPython, destDir);
  fs.rmSync(tmpExtract, { recursive: true, force: true });

  console.log(`  ✓ macOS standalone Python ${MAC_PY_VERSION} 已就绪: ${destDir}`);
}

// ─── Windows 嵌入式 Python 下载 ──────────────────────────────────────────────

async function downloadWinPython(destDir) {
  const url = `https://www.python.org/ftp/python/${WIN_PY_VERSION}/python-${WIN_PY_VERSION}-embed-amd64.zip`;
  const tmpZip = path.join(ROOT, "runtime", "_python_tmp.zip");

  fs.mkdirSync(destDir, { recursive: true });
  await download(url, tmpZip);

  console.log("  解压 Windows 嵌入式 Python...");
  execSync(`powershell -Command "Expand-Archive -Path '${tmpZip}' -DestinationPath '${destDir}' -Force"`);
  fs.unlinkSync(tmpZip);

  // 启用 site-packages 并添加 backend 到 sys.path
  const pthFile = path.join(destDir, `python${WIN_PY_VERSION.replace(/\./g, "").slice(0, 3)}._pth`);
  if (fs.existsSync(pthFile)) {
    let content = fs.readFileSync(pthFile, "utf8");
    content = content.replace("#import site", "import site");
    content += "\n../../../app/backend\n";
    fs.writeFileSync(pthFile, content);
  }

  // 安装 pip
  const getPipUrl = "https://bootstrap.pypa.io/get-pip.py";
  const getPipPath = path.join(ROOT, "get-pip.py");
  await download(getPipUrl, getPipPath);
  const pyExe = path.join(destDir, "python.exe");
  execSync(`"${pyExe}" "${getPipPath}" --quiet`);
  fs.unlinkSync(getPipPath);
  execSync(`"${pyExe}" -m pip install setuptools wheel tomli --quiet`);

  console.log(`  ✓ Windows 嵌入式 Python ${WIN_PY_VERSION} 已就绪: ${destDir}`);
}

// ─── 找嵌入式 Python 目录（若不存在则下载）────────────────────────────────────

async function ensureEmbeddedPython() {
  if (process.platform === "win32") {
    const dir = path.join(ROOT, "runtime", "win", "python");
    const exe = path.join(dir, "python.exe");
    if (!fs.existsSync(exe)) {
      console.log(`\n[setup-runtime] Windows 嵌入式 Python 不存在，开始下载 ${WIN_PY_VERSION}...`);
      await downloadWinPython(dir);
    }
    return dir;
  } else {
    const dir    = path.join(ROOT, "runtime", "mac", "python");
    const binDir = path.join(dir, "bin");
    const exe    = path.join(binDir, "python3");
    if (!fs.existsSync(exe)) {
      console.log(`\n[setup-runtime] macOS standalone Python 不存在，开始下载 ${MAC_PY_VERSION}...`);
      await downloadMacPython(dir);
    }
    return binDir;
  }
}

// ─── 获取嵌入式 pip 可执行路径 ────────────────────────────────────────────────

function getEmbeddedPip(binDir) {
  if (process.platform === "win32") {
    const candidates = [
      path.join(binDir, "Scripts", "pip.exe"),
      path.join(binDir, "pip.exe"),
    ];
    for (const p of candidates) {
      if (fs.existsSync(p)) return p;
    }
    return null;
  } else {
    const candidates = [
      path.join(binDir, "pip3"),
      path.join(binDir, "pip"),
    ];
    for (const p of candidates) {
      if (fs.existsSync(p)) return p;
    }
    return null;
  }
}

// ─── 执行命令（继承 stdio，失败即退出）────────────────────────────────────────

function run(cmd, opts = {}) {
  console.log(`\n$ ${cmd}`);
  execSync(cmd, { stdio: "inherit", ...opts });
}

// ─── 主流程 ────────────────────────────────────────────────────────────────────

(async () => {
  const platform = process.platform === "win32" ? "win" : "mac";
  console.log(`\n[setup-runtime] 平台：${platform}`);

  // 0. 确保嵌入式 Python 存在
  const binDir = await ensureEmbeddedPython();
  console.log(`[setup-runtime] 嵌入式 Python bin：${binDir}`);

  const pyExe = process.platform === "win32"
    ? path.join(binDir, "python.exe")
    : path.join(binDir, "python3");

  // 把嵌入式 Python 加到 PATH 最前方
  const patchedEnv = {
    ...process.env,
    PATH: `${binDir}${path.delimiter}${process.env.PATH}`,
    POETRY_VIRTUALENVS_CREATE: "false",
  };

  // 1. 通过内置 pip 安装 backend 依赖
  // 原因：poetry 用自己的 Python 解析 ABI tag，无法匹配内置 Python 的平台；
  //       内置 pip 能正确识别自身 ABI，选到正确的 wheel（如 torch 的 arm64/macosx 包）
  console.log("\n[setup-runtime] 1/2 通过内置 pip 安装 backend 依赖...");

  const parseScript = `
try:
    import tomllib
except ImportError:
    import tomli as tomllib
import sys, json
with open(sys.argv[1], 'rb') as f:
    data = tomllib.load(f)
deps = data['tool']['poetry']['dependencies']
reqs = []
for name, spec in deps.items():
    if name == 'python':
        continue
    if isinstance(spec, str):
        ver = spec.replace('^', '>=').replace('~', '~=')
        reqs.append(f'{name}{ver}' if ver != '*' else name)
    elif isinstance(spec, dict):
        version = spec.get('version', '').replace('^', '>=').replace('~', '~=')
        extras = spec.get('extras', [])
        pkg = f'{name}[{",".join(extras)}]' if extras else name
        reqs.append(f'{pkg}{version}' if version else pkg)
print('\\n'.join(reqs))
`.trim();

  const pyprojectPath = path.join(BACKEND_DIR, "pyproject.toml");
  const reqsTmp = path.join(BACKEND_DIR, "_requirements_tmp.txt");
  const parseScriptPath = path.join(BACKEND_DIR, "_parse_deps.py");

  fs.writeFileSync(parseScriptPath, parseScript);
  try {
    const reqs = execSync(`"${pyExe}" "${parseScriptPath}" "${pyprojectPath}"`, { env: patchedEnv }).toString();
    fs.writeFileSync(reqsTmp, reqs);
    console.log("[setup-runtime] 依赖列表:\n" + reqs);
  } finally {
    fs.unlinkSync(parseScriptPath);
  }

  const pipBin = getEmbeddedPip(binDir);
  if (pipBin) {
    run(`"${pipBin}" install -r "${reqsTmp}"`, { env: patchedEnv });
  } else {
    run(`"${pyExe}" -m pip install -r "${reqsTmp}"`, { env: patchedEnv });
  }
  fs.unlinkSync(reqsTmp);

  // 2. 安装引擎 pip 包 + FFmpeg（从 manifest.json pip_packages 安装）
  console.log("\n[setup-runtime] 2/2 安装引擎 pip 包 + FFmpeg...");
  const setupEnginesScript = path.join(ROOT, "scripts", "setup-engines.py");
  run(`"${pyExe}" "${setupEnginesScript}"`, { env: patchedEnv });

  console.log("\n[setup-runtime] 全部完成 ✓");
})();
