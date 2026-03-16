#!/usr/bin/env python3
"""
安装 manifest.json 中各引擎的 runtime_pip_packages（torch、torchaudio 等重型 ML 包）。

两种模式：
    # 开发模式：直接装入嵌入式 Python（pnpm run setup:ml）
    python scripts/install-runtime-deps.py \
        [--pypi-mirror https://pypi.tuna.tsinghua.edu.cn/simple]

    # 用户首次启动模式：装到 userData/python-packages/（由 Electron IPC 调用）
    python scripts/install-runtime-deps.py \
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


def install_packages(
    packages: list[str],
    py: str,
    target: str,        # 空串 = 装入嵌入式 Python 本身
    mirror: str,
    json_progress: bool,
) -> bool:
    """安装包列表。target 为空时直接 pip install，否则 pip install --target。"""
    if target:
        Path(target).mkdir(parents=True, exist_ok=True)
    env = {**os.environ, "PYTHONPATH": target} if target else None
    all_ok = True

    for pkg in packages:
        module_name = pkg.replace("-", "_").split("==")[0].split(">=")[0].split("[")[0]
        check = subprocess.run(
            [py, "-c", f"import {module_name}"],
            capture_output=True,
            env=env,
        )
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


def main() -> int:
    parser = argparse.ArgumentParser(description="安装 runtime_pip_packages")
    parser.add_argument(
        "--target", default="",
        help="pip install --target 目录；省略则直接装入嵌入式 Python（开发模式）",
    )
    parser.add_argument(
        "--pypi-mirror", default="", dest="pypi_mirror",
        help="PyPI 镜像地址，如 https://pypi.tuna.tsinghua.edu.cn/simple",
    )
    parser.add_argument(
        "--json-progress", action="store_true", dest="json_progress",
        help="输出 JSON Lines 进度（供 Electron IPC 使用）",
    )
    args = parser.parse_args()

    target = args.target
    mirror = args.pypi_mirror or ""
    json_progress = args.json_progress

    project_root = Path(__file__).resolve().parent.parent
    resources_root_env = os.getenv("RESOURCES_ROOT", "")
    resources_root = Path(resources_root_env).resolve() if resources_root_env else project_root

    manifest_path = resources_root / "wrappers" / "manifest.json"
    if not manifest_path.exists():
        manifest_path = project_root / "wrappers" / "manifest.json"
    if not manifest_path.exists():
        _emit({"type": "log", "message": f"✗ 找不到 manifest.json: {manifest_path}"}, json_progress)
        return 1

    manifest = json.loads(manifest_path.read_text(encoding="utf-8-sig"))
    engines: dict = manifest.get("engines", {})

    py = get_embedded_python(resources_root) or get_embedded_python(project_root)
    if not py:
        _emit({"type": "log", "message": "✗ 嵌入式 Python 未找到，请先运行 pnpm run setup"}, json_progress)
        return 1

    phase_label = "1/2 正在安装运行库…" if json_progress else "安装 runtime_pip_packages"
    _emit({"type": "phase", "label": phase_label}, json_progress)
    if target:
        _emit({"type": "log", "message": f"目标目录：{target}"}, json_progress)
    else:
        _emit({"type": "log", "message": f"嵌入式 Python：{py}"}, json_progress)
    if mirror:
        _emit({"type": "log", "message": f"PyPI 镜像：{mirror}"}, json_progress)

    all_pkgs: list[str] = []
    for cfg in engines.values():
        all_pkgs.extend(cfg.get("runtime_pip_packages", []))

    packages = _dedup_packages(all_pkgs)

    if not packages:
        _emit({"type": "log", "message": "无需安装运行时包"}, json_progress)
        return 0

    _emit({"type": "log", "message": f"共 {len(packages)} 个包待安装"}, json_progress)

    ok = install_packages(packages, py, target, mirror, json_progress)

    if ok:
        _emit({"type": "log", "message": "✓ 运行库安装完成"}, json_progress)
        return 0
    else:
        _emit({"type": "log", "message": "✗ 部分包安装失败，请检查日志"}, json_progress)
        return 1


if __name__ == "__main__":
    sys.exit(main())
