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
 *   1. backend/pyproject.toml 的所有依赖（通过 poetry install）
 *   2. 各引擎的 requirements.txt（fish_speech / seed_vc / rvc，若 engine/ 已克隆）
 */

"use strict";

const { execSync } = require("child_process");
const path = require("path");
const fs = require("fs");

const ROOT = path.resolve(__dirname, "..");
const BACKEND_DIR = path.join(ROOT, "backend");

// ─── 找嵌入式 Python 目录 ──────────────────────────────────────────────────────

function getEmbeddedPythonBinDir() {
  if (process.platform === "win32") {
    const dir = path.join(ROOT, "runtime", "win", "python");
    if (!fs.existsSync(path.join(dir, "python.exe"))) {
      console.error(
        "[setup-runtime] 错误：runtime/win/python/python.exe 不存在。\n" +
          "请先将 Windows 嵌入式 Python 放置于 runtime/win/python/。"
      );
      process.exit(1);
    }
    return dir; // Windows：python.exe 在根目录
  } else {
    const binDir = path.join(ROOT, "runtime", "mac", "python", "bin");
    if (!fs.existsSync(path.join(binDir, "python3")) &&
        !fs.existsSync(path.join(binDir, "python"))) {
      console.error(
        "[setup-runtime] 错误：runtime/mac/python/bin/python3 不存在。\n" +
          "请先将 macOS 嵌入式 Python 放置于 runtime/mac/python/。"
      );
      process.exit(1);
    }
    return binDir;
  }
}

// ─── 获取嵌入式 pip 可执行路径（仅用于安装引擎 requirements.txt）─────────────

function getEmbeddedPip(binDir) {
  if (process.platform === "win32") {
    // Windows：Scripts/pip.exe 或 pip.exe
    const candidates = [
      path.join(binDir, "Scripts", "pip.exe"),
      path.join(binDir, "pip.exe"),
    ];
    for (const p of candidates) {
      if (fs.existsSync(p)) return p;
    }
    // fallback：用 python -m pip
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

const platform = process.platform === "win32" ? "win" : "mac";
console.log(`\n[setup-runtime] 平台：${platform}`);

const binDir = getEmbeddedPythonBinDir();
console.log(`[setup-runtime] 嵌入式 Python bin：${binDir}`);

// 把嵌入式 Python 加到 PATH 最前方，poetry 优先找到它
const patchedEnv = {
  ...process.env,
  PATH: `${binDir}${path.delimiter}${process.env.PATH}`,
  // poetry 读此变量，禁止建 venv，直接装进上面 PATH 里的 Python
  POETRY_VIRTUALENVS_CREATE: "false",
};

// 1. 通过内置 pip 安装 backend 依赖
// 原因：poetry 用自己的 Python 解析 ABI tag，无法匹配内置 Python 的平台；
//       内置 pip 能正确识别自身 ABI，选到正确的 wheel（如 torch 的 arm64/macosx 包）
// 方案：用内置 Python 的 tomllib 解析 pyproject.toml，生成 requirements.txt，再由内置 pip 安装
console.log("\n[setup-runtime] 1/2 通过内置 pip 安装 backend 依赖...");

const pyExe = process.platform === "win32"
  ? path.join(binDir, "python.exe")
  : path.join(binDir, "python3");

// 用内置 Python 解析 pyproject.toml → 输出 pip 可用的依赖列表
const parseScript = `
import tomllib, sys, json
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
  const { execSync } = require("child_process");
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
