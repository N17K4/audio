#!/usr/bin/env python3
"""安装所有进阶 ML 依赖 — RAG、Agent、LoRA（用户按需手动安装）。

Extra 引擎：RAG、Agent、LoRA（FineTune）

运行模式（本地开发）：
    python scripts/ml_extra.py
    python scripts/ml_extra.py --pypi-mirror https://pypi.tuna.tsinghua.edu.cn/simple

用户首次启动（由 main.js 调用）：
    python scripts/ml_extra.py \
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

# 所有进阶功能需要的引擎
EXTRA_ENGINES = {
    "rag_engine",      # RAG 知识库
    "agent_engine",    # Agent 智能体
    "finetune_engine", # LoRA 微调
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


def _group_by_namespace(packages: list[str]) -> list[list[str]]:
    """将共享 namespace 的包（如 llama-index-*）分到同一组，其余每个包单独一组。
    pip install --target 对 namespace package 有 bug：逐个安装时后装的会覆盖前装的子目录。
    同一组的包必须在一次 pip install 中安装才能共存。"""
    ns_groups: dict[str, list[str]] = {}
    singles: list[list[str]] = []
    for pkg in packages:
        name = re.split(r"[>=<!\[;\s]", pkg)[0].lower()
        # llama-index-core, llama-index-embeddings-ollama 等共享 llama_index namespace
        if name.startswith("llama-index"):
            ns_groups.setdefault("llama-index", []).append(pkg)
        else:
            singles.append([pkg])
    result: list[list[str]] = []
    for group in ns_groups.values():
        result.append(group)
    result.extend(singles)
    return result


def install_packages(packages: list[str], py: str, target: str, mirror: str, json_progress: bool) -> bool:
    """安装包列表。target 为空时直接 pip install，否则 pip install --target。
    共享 namespace 的包会合并成一次 pip install 调用，避免目录覆盖问题。"""
    if target:
        Path(target).mkdir(parents=True, exist_ok=True)
    env = {**os.environ, "PYTHONPATH": target} if target else None
    all_ok = True

    groups = _group_by_namespace(packages)
    for group in groups:
        # 检查哪些包需要安装
        to_install = []
        for pkg in group:
            module_name = pkg.replace("-", "_").split("==")[0].split(">=")[0].split("[")[0]
            check = subprocess.run([py, "-c", f"import {module_name}"], capture_output=True, env=env)
            if check.returncode == 0:
                _emit({"type": "log", "message": f"  ✓ {pkg}  (已安装)"}, json_progress)
            else:
                to_install.append(pkg)

        if not to_install:
            continue

        for pkg in to_install:
            _emit({"type": "log", "message": f"  安装 {pkg}…"}, json_progress)

        cmd = [py, "-m", "pip", "install"] + to_install + ["--quiet"]
        if target:
            cmd += ["--target", target, "--upgrade"]
        if mirror:
            cmd += ["--index-url", mirror, "--extra-index-url", "https://pypi.org/simple"]

        r = subprocess.run(cmd, capture_output=True, text=True, timeout=1200)
        if r.returncode == 0:
            for pkg in to_install:
                _emit({"type": "log", "message": f"  ✓ {pkg}"}, json_progress)
        else:
            err = r.stderr.strip()[:300]
            for pkg in to_install:
                _emit({"type": "log", "message": f"  ✗ {pkg} 失败: {err}"}, json_progress)
            all_ok = False

    return all_ok


def main():
    """安装进阶 ML 包。"""
    parser = argparse.ArgumentParser(description="安装进阶 ML 运行库")
    parser.add_argument("--group", default="", choices=["rag", "agent", "lora"], help="仅安装指定功能的依赖（默认安装全部）")
    parser.add_argument("--target", default="", help="pip install --target 目录；省略则直接装入嵌入式 Python（开发模式）")
    parser.add_argument("--pypi-mirror", default="", dest="pypi_mirror", help="PyPI 镜像地址")
    parser.add_argument("--json-progress", action="store_true", dest="json_progress", help="输出 JSON Lines 进度")
    args = parser.parse_args()

    # 如果指定了 --group，只安装该组的引擎
    group_engines_map = {
        "rag": {"rag_engine"},
        "agent": {"agent_engine"},
        "lora": {"finetune_engine"},
    }
    engines_to_install = group_engines_map.get(args.group) if args.group else EXTRA_ENGINES

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
    engines: dict = {k: v for k, v in manifest.get("engines", {}).items() if k in engines_to_install}

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
