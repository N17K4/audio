#!/usr/bin/env python3
"""安装基础 ML 依赖 — 所有引擎必需的包（torch、torchaudio、transformers 等）。

Base 引擎：Fish Speech、RVC、Seed-VC、Faster Whisper、FaceFusion

运行模式（本地开发）：
    python scripts/ml_base.py
    python scripts/ml_base.py --pypi-mirror https://pypi.tuna.tsinghua.edu.cn/simple

用户首次启动（由 main.js 调用）：
    python scripts/ml_base.py \
        --target /path/to/userData/python-packages \
        [--pypi-mirror https://pypi.tuna.tsinghua.edu.cn/simple] \
        [--json-progress]
"""

from __future__ import annotations

import argparse
import json
import os
import platform
import re
import subprocess
import sys
from pathlib import Path

# Windows 控制台 UTF-8
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")

# 基础引擎集合（默认安装，所有环境都需要）
BASE_ENGINES = {
    "facefusion",
    "faster_whisper",
    "fish_speech",
    "rvc",
    "seed_vc",
}


def get_embedded_python(root: Path) -> str:
    """返回嵌入式 Python 可执行路径，找不到返回空串。"""
    if platform.system() == "Windows":
        p = root / "runtime" / "win" / "python" / "python.exe"
    else:
        p = root / "runtime" / "mac" / "python" / "bin" / "python3"
    return str(p) if p.exists() else ""


def _emit(obj: dict, json_progress: bool) -> None:
    if json_progress:
        print(json.dumps(obj, ensure_ascii=False), flush=True)
    else:
        t = obj.get("type")
        if t == "log":
            print(obj.get("message", ""), flush=True)
        elif t == "phase":
            print(f"\n=== {obj.get('label', '')} ===", flush=True)


def _dedup_packages(packages: list[str]) -> list[str]:
    seen: dict[str, str] = {}
    for pkg in packages:
        name = re.split(r"[>=<!\[;\s]", pkg)[0].lower().replace("-", "_")
        existing = seen.get(name)
        if existing is None:
            seen[name] = pkg
        elif re.search(r"[>=<!]", pkg) and not re.search(r"[>=<!]", existing):
            seen[name] = pkg  # 有版本号的优先
    return list(seen.values())


def _exact_version_spec(pkg: str) -> str | None:
    m = re.match(r"^\s*([A-Za-z0-9_.-]+)==([^\s;]+)\s*$", pkg)
    if not m:
        return None
    return m.group(2)


def _installed_dist_version(py: str, target: str, dist_name: str) -> str:
    env = {**os.environ, "PYTHONPATH": target} if target else None
    code = (
        "import importlib.metadata as m; "
        f"print(m.version({dist_name!r}))"
    )
    r = subprocess.run([py, "-c", code], capture_output=True, text=True, env=env)
    return r.stdout.strip() if r.returncode == 0 else ""


def _embedded_dist_version(py: str, dist_name: str) -> str:
    code = (
        "import importlib.metadata as m; "
        f"print(m.version({dist_name!r}))"
    )
    r = subprocess.run([py, "-c", code], capture_output=True, text=True)
    return r.stdout.strip() if r.returncode == 0 else ""


def align_torch_stack_versions(packages: list[str], py: str) -> list[str]:
    """将运行时 torch 栈与 embedded Python 自带版本对齐，避免混装。"""
    pinned: dict[str, str] = {}
    for dist_name in ("torch", "torchaudio", "torchvision"):
        version = _embedded_dist_version(py, dist_name)
        if version:
            pinned[dist_name] = f"{dist_name}=={version}"

    if not pinned:
        return packages

    normalized = []
    seen = set()
    for pkg in packages:
        name = re.split(r"[>=<!\[;\s]", pkg)[0].lower().replace("-", "_")
        if name in pinned:
            if name not in seen:
                normalized.append(pinned[name])
                seen.add(name)
            continue
        normalized.append(pkg)

    for name in ("torch", "torchaudio", "torchvision"):
        if name in pinned and name not in seen:
            normalized.append(pinned[name])
            seen.add(name)
    return normalized


def install_packages(packages: list[str], py: str, target: str, mirror: str, json_progress: bool) -> bool:
    """安装包列表。target 为空时直接 pip install，否则 pip install --target。"""
    if target:
        Path(target).mkdir(parents=True, exist_ok=True)
    env = {**os.environ, "PYTHONPATH": target} if target else None
    all_ok = True

    for pkg in packages:
        module_name = pkg.replace("-", "_").split("==")[0].split(">=")[0].split("[")[0]
        dist_name = re.split(r"[>=<!\[;\s]", pkg)[0]
        exact_version = _exact_version_spec(pkg)
        if exact_version:
            installed_version = _installed_dist_version(py, target, dist_name)
            if installed_version == exact_version:
                _emit({"type": "log", "message": f"  ✓ {pkg}  (已安装)"}, json_progress)
                continue
        else:
            check = subprocess.run([py, "-c", f"import {module_name}"], capture_output=True, env=env)
            if check.returncode == 0:
                _emit({"type": "log", "message": f"  ✓ {pkg}  (已安装)"}, json_progress)
                continue

        _emit({"type": "log", "message": f"  安装 {pkg}…"}, json_progress)
        cmd = [py, "-m", "pip", "install", pkg, "--quiet"]
        if target:
            cmd += ["--target", target, "--upgrade"]
        if mirror:
            cmd += ["--index-url", mirror, "--extra-index-url", "https://pypi.org/simple"]

        r = subprocess.run(cmd, capture_output=True, text=True, timeout=1200)
        if r.returncode == 0:
            _emit({"type": "log", "message": f"  ✓ {pkg}"}, json_progress)
        else:
            err = r.stderr.strip()[:300]
            _emit({"type": "log", "message": f"  ✗ {pkg} 失败: {err}"}, json_progress)
            all_ok = False

    return all_ok


def main():
    """安装基础 ML 包。"""
    parser = argparse.ArgumentParser(description="安装基础 ML 运行库")
    parser.add_argument("--target", default="", help="pip install --target 目录；省略则装到 local_data/python-packages/（开发模式）")
    parser.add_argument("--pypi-mirror", default="", dest="pypi_mirror", help="PyPI 镜像地址")
    parser.add_argument("--json-progress", action="store_true", dest="json_progress", help="输出 JSON Lines 进度")
    args = parser.parse_args()

    project_root = Path(__file__).resolve().parent.parent

    # 开发模式（无 --target）：默认装到 local_data/python-packages/，不污染嵌入式 Python
    if not args.target:
        args.target = str(project_root / "local_data" / "python-packages")
    resources_root_env = os.getenv("RESOURCES_ROOT", "")
    resources_root = Path(resources_root_env).resolve() if resources_root_env else project_root

    manifest_path = resources_root / "wrappers" / "manifest.json"
    if not manifest_path.exists():
        manifest_path = project_root / "wrappers" / "manifest.json"
    if not manifest_path.exists():
        _emit({"type": "log", "message": f"✗ 找不到 manifest.json"}, args.json_progress)
        return 1

    manifest = json.loads(manifest_path.read_text(encoding="utf-8-sig"))
    engines: dict = {k: v for k, v in manifest.get("engines", {}).items() if k in BASE_ENGINES}

    py = get_embedded_python(resources_root) or get_embedded_python(project_root)
    if not py:
        _emit({"type": "log", "message": "✗ 嵌入式 Python 未找到，请先运行 pnpm run setup"}, args.json_progress)
        return 1

    phase_label = "1/2 正在安装运行库…" if args.json_progress else "安装 runtime_pip_packages"
    _emit({"type": "phase", "label": phase_label}, args.json_progress)
    if args.target:
        _emit({"type": "log", "message": f"目标目录：{args.target}"}, args.json_progress)
    else:
        _emit({"type": "log", "message": f"嵌入式 Python：{py}"}, args.json_progress)
    if args.pypi_mirror:
        _emit({"type": "log", "message": f"PyPI 镜像：{args.pypi_mirror}"}, args.json_progress)

    all_pkgs: list[str] = []
    for cfg in engines.values():
        all_pkgs.extend(cfg.get("runtime_pip_packages", []))

    packages = _dedup_packages(all_pkgs)
    packages = align_torch_stack_versions(packages, py)
    if not packages:
        _emit({"type": "log", "message": "无需安装运行时包"}, args.json_progress)
        return 0

    _emit({"type": "log", "message": f"共 {len(packages)} 个包待安装"}, args.json_progress)
    ok = install_packages(packages, py, args.target, args.pypi_mirror, args.json_progress)

    if ok:
        _emit({"type": "log", "message": "✓ 运行库安装完成"}, args.json_progress)
        return 0
    else:
        _emit({"type": "log", "message": "✗ 部分包安装失败，请检查日志"}, args.json_progress)
        return 1


if __name__ == "__main__":
    sys.exit(main())
