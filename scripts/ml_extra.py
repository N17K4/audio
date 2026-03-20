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
import shutil
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
        p = root / "runtime" / "python" / "win" / "python.exe"
    else:
        p = root / "runtime" / "python" / "mac" / "bin" / "python3"
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


# 嵌入式 Python 已有的包——防止 transitive dependency 覆盖导致版本冲突
_EMBEDDED_PROTECTED_PACKAGES = {
    "pydantic", "pydantic_core",
    "fastapi", "starlette",
    "uvicorn", "httpx", "httpcore",
    "anyio", "sniffio",
    "typing_extensions",
    "annotated_types",
}


def _cleanup_protected_packages(target: str, json_progress: bool) -> None:
    """从 --target 目录中删除嵌入式 Python 已有的包，避免 PYTHONPATH 版本冲突。"""
    if not target:
        return
    target_path = Path(target)
    if not target_path.exists():
        return
    removed = []
    for item in target_path.iterdir():
        name_lower = item.name.lower().replace("-", "_")
        base_name = name_lower.split(".")[0]
        dist_match = re.match(r"^([a-z0-9_]+?)[-_]\d", name_lower)
        pkg_name = dist_match.group(1) if dist_match else base_name
        if pkg_name in _EMBEDDED_PROTECTED_PACKAGES:
            try:
                if item.is_dir():
                    shutil.rmtree(item)
                else:
                    item.unlink()
                removed.append(item.name)
            except OSError:
                pass
    if removed:
        _emit({"type": "log", "message": f"  清理与嵌入式 Python 冲突的包: {', '.join(removed)}"}, json_progress)


def _embedded_dist_version(py: str, dist_name: str) -> str:
    code = (
        "import importlib.metadata as m; "
        f"print(m.version({dist_name!r}))"
    )
    r = subprocess.run([py, "-c", code], capture_output=True, text=True)
    return r.stdout.strip() if r.returncode == 0 else ""


def _dist_version_in_target(target: str, dist_name: str) -> str:
    """扫描 target 目录中的 .dist-info 目录，提取版本号。"""
    target_path = Path(target)
    if not target_path.exists():
        return ""
    normalized = dist_name.lower().replace("-", "_")
    for item in target_path.iterdir():
        if not item.name.endswith(".dist-info"):
            continue
        name_lower = item.name.lower().replace("-", "_")
        m = re.match(r"^(.+?)[-_](\d[\w.]*?)\.dist.info$", name_lower)
        if m and m.group(1) == normalized:
            return m.group(2)
    return ""


def _actual_pkg_version(target: str, pkg_name: str) -> str:
    """读取 target 目录中包的实际 version.py，返回版本号。"""
    version_py = Path(target) / pkg_name / "version.py"
    if not version_py.exists():
        return ""
    try:
        for line in version_py.read_text().splitlines():
            m = re.match(r"^__version__\s*=\s*['\"]([^'\"]+)['\"]", line)
            if m:
                return m.group(1)
    except Exception:
        pass
    return ""


def _repair_torch_stack(py: str, target: str, mirror: str, json_progress: bool) -> None:
    """检查 --target 目录中 torch 栈版本是否与嵌入式 Python 一致，不一致时强制重装。"""
    pinned: dict[str, str] = {}
    for dist_name in ("torch", "torchaudio", "torchvision"):
        expected = _embedded_dist_version(py, dist_name)
        if not expected:
            continue
        actual = _actual_pkg_version(target, dist_name)
        if actual and actual != expected:
            pinned[dist_name] = f"{dist_name}=={expected}"
            _emit({"type": "log", "message":
                   f"  ⚠ {dist_name} 版本不一致：target={actual} embedded={expected}，将修复"},
                  json_progress)

    if not pinned:
        return

    pkgs = list(pinned.values())
    _emit({"type": "log", "message": f"  修复 torch 栈版本：{', '.join(pkgs)}"}, json_progress)
    cmd = [py, "-m", "pip", "install"] + pkgs + [
        "--target", target, "--upgrade", "--force-reinstall", "--quiet",
    ]
    if mirror:
        cmd += ["--index-url", mirror, "--extra-index-url", "https://pypi.org/simple"]
    r = subprocess.run(cmd, capture_output=True, text=True, timeout=600)
    if r.returncode == 0:
        _emit({"type": "log", "message": f"  ✓ torch 栈版本已修复"}, json_progress)
    else:
        _emit({"type": "log", "message":
               f"  ✗ torch 栈修复失败: {r.stderr.strip()[:300]}"}, json_progress)

    # 清理残留的旧版 dist-info
    target_path = Path(target)
    for dist_name, pinned_spec in pinned.items():
        expected_ver = pinned_spec.split("==")[1]
        for item in target_path.iterdir():
            if not item.name.endswith(".dist-info"):
                continue
            name_lower = item.name.lower().replace("-", "_")
            m = re.match(r"^(.+?)[-_](\d[\w.]*?)\.dist.info$", name_lower)
            if m and m.group(1) == dist_name and m.group(2) != expected_ver:
                try:
                    shutil.rmtree(item)
                    _emit({"type": "log", "message": f"  清理残留: {item.name}"}, json_progress)
                except OSError:
                    pass


def install_packages(packages: list[str], py: str, target: str, mirror: str, json_progress: bool) -> bool:
    """安装包列表。target 为空时直接 pip install，否则 pip install --target。
    共享 namespace 的包会合并成一次 pip install 调用，避免目录覆盖问题。"""
    if target:
        Path(target).mkdir(parents=True, exist_ok=True)
    env = {**os.environ, "PYTHONPATH": target} if target else None
    all_ok = True

    # 生成 constraints 文件，锁定 torch 栈版本，防止 transitive dep 升级
    import tempfile as _tmpmod
    constraints_file = ""
    _torch_constraints: list[str] = []
    for dist_name in ("torch", "torchaudio", "torchvision"):
        ver = _embedded_dist_version(py, dist_name)
        if ver:
            _torch_constraints.append(f"{dist_name}=={ver}")
    if _torch_constraints:
        _cf = _tmpmod.NamedTemporaryFile(mode="w", suffix=".txt", prefix="torch_constraints_", delete=False)
        _cf.write("\n".join(_torch_constraints) + "\n")
        _cf.close()
        constraints_file = _cf.name

    total = len(packages)
    pkg_seq = 0  # 全局序号计数器
    groups = _group_by_namespace(packages)
    for group in groups:
        # 检查哪些包需要安装
        to_install = []
        for pkg in group:
            pkg_seq += 1
            tag = f"[{pkg_seq}/{total}]"
            module_name = pkg.replace("-", "_").split("==")[0].split(">=")[0].split("[")[0]
            check = subprocess.run([py, "-c", f"import {module_name}"], capture_output=True, env=env)
            if check.returncode == 0:
                _emit({"type": "log", "message": f"  {tag} ✓ {pkg}  (已安装)"}, json_progress)
            else:
                to_install.append(pkg)

        if not to_install:
            continue

        cmd = [py, "-m", "pip", "install"] + to_install + ["--quiet"]
        if target:
            cmd += ["--target", target, "--upgrade"]
        if constraints_file:
            cmd += ["--constraint", constraints_file]
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

    # 清理临时 constraints 文件
    if constraints_file:
        try:
            os.unlink(constraints_file)
        except OSError:
            pass

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

    # 开发模式（无 --target）：默认装到 runtime/ml/，不污染嵌入式 Python
    if not args.target:
        args.target = str(project_root / "runtime" / "ml")

    resources_root_env = os.getenv("RESOURCES_ROOT", "")
    resources_root = Path(resources_root_env).resolve() if resources_root_env else project_root

    manifest_path = resources_root / "backend" / "wrappers" / "manifest.json"
    if not manifest_path.exists():
        manifest_path = project_root / "backend" / "wrappers" / "manifest.json"
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

    # 修复 torch 栈版本（transitive dep 可能将其升级到最新版）
    _repair_torch_stack(py, args.target, args.pypi_mirror, args.json_progress)

    # 清理 transitive dependency 中与嵌入式 Python 冲突的包
    _cleanup_protected_packages(args.target, args.json_progress)

    if ok:
        _emit({"type": "log", "message": "✓ 运行库安装完成"}, args.json_progress)
        return 0
    else:
        _emit({"type": "log", "message": "✗ 部分包安装失败，请检查日志"}, args.json_progress)
        return 1


if __name__ == "__main__":
    sys.exit(main())
