#!/usr/bin/env python3
"""安装基础运行依赖。

Base 引擎：Fish Speech、GPT-SoVITS、RVC、Seed-VC、Faster Whisper、FaceFusion

运行模式（本地开发）：
    python scripts/ml_base.py
    python scripts/ml_base.py --pypi-mirror https://pypi.tuna.tsinghua.edu.cn/simple

用户首次启动（由 main.js 调用）：
    python scripts/ml_base.py \
        --target /path/to/userData/python-packages \
        [--pypi-mirror https://pypi.tuna.tsinghua.edu.cn/simple] \
        [--json-progress]

说明：
    用户首次启动时，这个脚本会安装两类依赖到外部包目录：
    1) runtime_pip_packages：torch、torchaudio、transformers 等重型运行库
    2) pip_packages：faster-whisper、rvc-python 等轻量但运行必需的包

这样打包产物即使没有在构建机提前执行完整 setup，也能完成默认引擎的首启安装。
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
import tempfile
from concurrent.futures import ThreadPoolExecutor, as_completed
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
    "gpt_sovits",
    "rvc",
    "seed_vc",
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


def _eval_platform_marker(pkg: str) -> bool:
    """评估包的平台标记（如 '; sys_platform != "win32"'），返回当前平台是否应安装。"""
    if ";" not in pkg:
        return True
    marker_part = pkg.split(";", 1)[1].strip()
    # 简单解析 sys_platform 条件
    if "sys_platform" in marker_part:
        current = sys.platform
        if "!=" in marker_part:
            val = re.search(r"!=\s*['\"]([^'\"]+)['\"]", marker_part)
            if val:
                return current != val.group(1)
        elif "==" in marker_part:
            val = re.search(r"==\s*['\"]([^'\"]+)['\"]", marker_part)
            if val:
                return current == val.group(1)
    return True


def _dedup_packages(packages: list[str]) -> list[str]:
    seen: dict[str, str] = {}
    for pkg in packages:
        # 评估平台标记，跳过不适用当前平台的包
        if not _eval_platform_marker(pkg):
            continue
        name = re.split(r"[>=<!\[;\s]", pkg)[0].lower().replace("-", "_")
        # 嵌入式 Python 自带的包不需要装到 --target，跳过
        if name in _EMBEDDED_PROTECTED_PACKAGES:
            continue
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
    if target:
        # --target 模式：只检查 target 目录中的 .dist-info，不查嵌入式 Python
        return _dist_version_in_target(target, dist_name)
    env = {**os.environ, "PYTHONPATH": target} if target else None
    code = (
        "import importlib.metadata as m; "
        f"print(m.version({dist_name!r}))"
    )
    r = subprocess.run([py, "-c", code], capture_output=True, text=True, env=env)
    return r.stdout.strip() if r.returncode == 0 else ""


def _dist_version_in_target(target: str, dist_name: str) -> str:
    """直接扫描 target 目录中的 .dist-info 目录，提取版本号。
    不依赖 Python import，避免嵌入式 Python 自带包干扰判断。"""
    target_path = Path(target)
    if not target_path.exists():
        return ""
    normalized = dist_name.lower().replace("-", "_")
    for item in target_path.iterdir():
        if not item.name.endswith(".dist-info"):
            continue
        # 格式: {name}-{version}.dist-info
        name_lower = item.name.lower().replace("-", "_")
        # 提取包名和版本: torch-2.5.1.dist_info → torch, 2.5.1
        m = re.match(r"^(.+?)[-_](\d[\w.]*?)\.dist.info$", name_lower)
        if m and m.group(1) == normalized:
            return m.group(2)
    return ""


def _is_importable_in_target(target: str, module_name: str) -> bool:
    """检查模块是否存在于 target 目录中（包目录、.py 文件、或编译扩展 .pyd/.so）。"""
    target_path = Path(target)
    if not target_path.exists():
        return False
    # 包目录
    if (target_path / module_name).is_dir():
        return True
    # 单文件 .py 模块
    if (target_path / f"{module_name}.py").is_file():
        return True
    # 编译扩展（.pyd on Windows, .so on Unix），文件名格式如 parselmouth.cp312-win_amd64.pyd
    for f in target_path.iterdir():
        if f.name.startswith(module_name + ".") and f.suffix in (".pyd", ".so"):
            return True
    return False


# pip 包名 → 实际 import 模块名的映射（仅针对名称不一致的包）
_PKG_TO_MODULE: dict[str, str] = {
    "faiss_cpu": "faiss",
    "ffmpeg_python": "ffmpeg",
    "praat_parselmouth": "parselmouth",
    "rvc_python": "rvc",
    "faster_whisper": "faster_whisper",
    "hydra_core": "hydra",
    "scikit_learn": "sklearn",
    "pillow": "PIL",
    "pyyaml": "yaml",
}


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


# 这些包的 PyPI 元数据声明了过时的硬依赖（如 faiss-cpu==1.7.3），
# 但实际运行所需的依赖已在 manifest.json 的 runtime_pip_packages 中单独列出。
# 必须使用 --no-deps 安装以避免版本冲突。
_NO_DEPS_PACKAGES = {"rvc-python"}

# 嵌入式 Python 的 site-packages 已包含这些包（pip_packages 阶段安装）。
# 如果 runtime_pip_packages 的 transitive dependency 把它们安装到 --target 目录，
# PYTHONPATH 会导致 --target 里的版本优先加载，与嵌入式版本不一致而崩溃。
# 安装完成后从 --target 目录中删除这些包，确保运行时总是使用嵌入式版本。
_EMBEDDED_PROTECTED_PACKAGES = {
    "pydantic", "pydantic_core",
    "fastapi", "starlette",
    "uvicorn", "httpx", "httpcore",
    "anyio", "sniffio",
    "annotated_types",
}
# 注意: typing_extensions / numpy は torch が必要とするバージョンと
# 嵌入式 Python 同梱バージョンが異なる場合があるため、ここに含めない。
# numpy: torch は numpy 2.x の C API 向けにコンパイルされており、
#         1.26.x にダウングレードするとメモリアクセス違反（segfault）が発生する。
# typing_extensions: torch が 4.x の新機能を使用するため、古いバージョンでは
#         from torch.amp import autocast が失敗する。


def _cleanup_protected_packages(target: str, json_progress: bool) -> None:
    """从 --target 目录中删除嵌入式 Python 已有的包，避免 PYTHONPATH 版本冲突。"""
    if not target:
        return
    target_path = Path(target)
    if not target_path.exists():
        return
    removed = []
    for item in target_path.iterdir():
        # 匹配包目录（如 pydantic_core/）和 dist-info 目录（如 pydantic_core-2.x.dist-info/）
        name_lower = item.name.lower().replace("-", "_")
        base_name = name_lower.split(".")[0]  # 处理 .dist-info 等
        # 也匹配 dist-info: pydantic_core-2.27.2.dist-info → pydantic_core
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


_ML_ONLY_PACKAGES = {"numpy", "numpy.libs"}
# 注意: typing_extensions は pip が依存するため嵌入式 Python から削除してはならない。
# PYTHONPATH で ML target のバージョンが優先されるため、嵌入式側に残しても問題ない。


def _cleanup_embedded_ml_packages(py: str, json_progress: bool) -> None:
    """嵌入式 Python の site-packages から ML 専用パッケージを削除。

    numpy / typing_extensions は backend 依赖の transitive dependency として
    嵌入式 Python に入るが、ML target（torch 等）が別バージョンを必要とする。
    嵌入式側を削除して PYTHONPATH で ML target のバージョンを優先させる。
    - numpy: torch は 2.x の C API 向けコンパイル、1.x だと segfault
    - typing_extensions: torch が 4.x の新機能を使用
    """
    # Windows: python.exe は runtime/python/win/python.exe（parent = win/）
    # macOS:   python3.12 は runtime/python/mac/bin/python3.12（parent.parent = mac/）
    py_path = Path(py).resolve()
    search_roots = [py_path.parent, py_path.parent.parent]
    candidates = []
    for root in search_roots:
        for sub in ["lib", "Lib"]:
            found = list((root / sub).rglob("site-packages")) if (root / sub).exists() else []
            if found:
                candidates = found
                break
        if candidates:
            break
    if not candidates:
        return

    site_packages = candidates[0]
    removed = []
    for item in site_packages.iterdir():
        name_lower = item.name.lower().replace("-", "_")
        base = name_lower.split(".")[0]
        dist_match = re.match(r"^([a-z0-9_]+?)[-_]\d", name_lower)
        pkg_name = dist_match.group(1) if dist_match else base
        if pkg_name in _ML_ONLY_PACKAGES or name_lower in _ML_ONLY_PACKAGES:
            try:
                if item.is_dir():
                    shutil.rmtree(item)
                else:
                    item.unlink()
                removed.append(item.name)
            except OSError:
                pass
    if removed:
        _emit({"type": "log", "message": f"  清理嵌入式 Python ML 冲突包: {', '.join(removed)}"}, json_progress)


def _actual_pkg_version(target: str, pkg_name: str) -> str:
    """读取 target 目录中包的实际 version.py，返回版本号。
    比 dist-info 更可靠：pip --upgrade 可能替换了包目录但留下旧的 dist-info。"""
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
    """检查 --target 目录中 torch 栈版本是否与嵌入式 Python 一致，不一致时强制重装。

    pip install --target --upgrade 安装其他包时，transitive dependency 可能将 torch/torchaudio
    升级到最新版，导致 ABI 不兼容（如 _aoti_torch_abi_version 符号缺失）。
    通过读取 version.py（而非 dist-info）检测实际版本，避免 dist-info 残留导致误判。
    """
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

    # 强制重装正确版本（--force-reinstall 确保覆盖 .so 文件）
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

    # 清理残留的旧版 dist-info（如 torch-2.10.0.dist-info）
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


def _cleanup_duplicate_dist_info(target: str, json_progress: bool) -> None:
    """清理 target 目录中的重复 dist-info。

    pip install --target --upgrade 安装新版包时会替换模块目录，
    但往往不删除旧版的 .dist-info，导致 importlib.metadata 返回错误版本。
    对每个包只保留最新版本的 dist-info。
    """
    target_path = Path(target)
    if not target_path.exists():
        return
    # 收集所有 dist-info：{normalized_name: [(version_str, path), ...]}
    dist_map: dict[str, list[tuple[str, Path]]] = {}
    for item in target_path.iterdir():
        if not item.name.endswith(".dist-info") or not item.is_dir():
            continue
        m = re.match(r"^(.+?)[-_](\d[\w.]*?)\.dist.info$", item.name.lower().replace("-", "_"))
        if m:
            name = m.group(1)
            version = m.group(2)
            dist_map.setdefault(name, []).append((version, item))
    removed = []
    for name, versions in dist_map.items():
        if len(versions) <= 1:
            continue
        # 按版本排序，保留最新
        from packaging.version import Version, InvalidVersion
        valid = []
        for ver_str, path in versions:
            try:
                valid.append((Version(ver_str), path))
            except InvalidVersion:
                valid.append((Version("0"), path))
        valid.sort(key=lambda x: x[0], reverse=True)
        for _, old_path in valid[1:]:
            try:
                shutil.rmtree(old_path)
                removed.append(old_path.name)
            except OSError:
                pass
    if removed:
        _emit({"type": "log", "message":
               f"  清理重复 dist-info: {', '.join(removed)}"}, json_progress)


def _ensure_pip_updated(py: str, json_progress: bool) -> None:
    """尝试升级 pip，避免旧版 pip 在 Windows 上的已知 bug（长路径、依赖解析异常等）。"""
    r = subprocess.run(
        [py, "-m", "pip", "install", "--upgrade", "pip", "--quiet"],
        capture_output=True, text=True, timeout=120,
    )
    if r.returncode == 0:
        _emit({"type": "log", "message": "  ✓ pip 已更新到最新版"}, json_progress)


def install_packages(packages: list[str], py: str, target: str, mirror: str, json_progress: bool) -> bool:
    """并行下载 + 逐个安装。单个失败不影响其他包。"""
    if target:
        Path(target).mkdir(parents=True, exist_ok=True)
    env = {**os.environ, "PYTHONPATH": target} if target else None

    # Windows 旧版 pip 存在长路径等 bug，先升级
    if platform.system() == "Windows":
        _ensure_pip_updated(py, json_progress)
    no_deps_names = {n.lower().replace("-", "_") for n in _NO_DEPS_PACKAGES}

    # ── 筛选需要安装的包 ──────────────────────────────────────────────────
    # --target 模式：只检查 target 目录，不受嵌入式 Python 自带包干扰
    # 无 target：检查全局 Python 环境
    total = len(packages)
    to_install: list[str] = []
    for idx, pkg in enumerate(packages, 1):
        tag = f"[{idx}/{total}]"
        raw_module = pkg.replace("-", "_").split("==")[0].split(">=")[0].split("[")[0]
        module_name = _PKG_TO_MODULE.get(raw_module.lower(), raw_module)
        dist_name = re.split(r"[>=<!\[;\s]", pkg)[0]
        exact_version = _exact_version_spec(pkg)
        if exact_version:
            if _installed_dist_version(py, target, dist_name) == exact_version:
                _emit({"type": "log", "message": f"  {tag} ✓ {pkg}  (已安装)"}, json_progress)
                continue
        elif target:
            if _is_importable_in_target(target, module_name):
                _emit({"type": "log", "message": f"  {tag} ✓ {pkg}  (已安装)"}, json_progress)
                continue
        else:
            check = subprocess.run([py, "-c", f"import {module_name}"], capture_output=True, env=env)
            if check.returncode == 0:
                _emit({"type": "log", "message": f"  {tag} ✓ {pkg}  (已安装)"}, json_progress)
                continue
        to_install.append(pkg)

    if not to_install:
        return True

    # ── Phase 1: 并行下载 wheel 到临时缓存目录 ───────────────────────────
    cache_dir = tempfile.mkdtemp(prefix="ml_pip_cache_")
    download_failed: dict[str, str] = {}  # pkg → error message

    def _download_one(pkg: str) -> tuple[str, bool, str]:
        cmd = [py, "-m", "pip", "download", pkg, "--no-deps",
               "-d", cache_dir, "--quiet"]
        if mirror:
            cmd += ["--index-url", mirror, "--extra-index-url", "https://pypi.org/simple"]
        r = subprocess.run(cmd, capture_output=True, text=True, timeout=600)
        return (pkg, r.returncode == 0, r.stderr.strip()[:300])

    n_to_install = len(to_install)
    _emit({"type": "log", "message": f"  并行下载 {n_to_install} 个包…"}, json_progress)
    max_workers = min(4, n_to_install)
    with ThreadPoolExecutor(max_workers=max_workers) as pool:
        futures = {pool.submit(_download_one, pkg): pkg for pkg in to_install}
        for future in as_completed(futures):
            pkg, ok, err = future.result()
            if not ok:
                _emit({"type": "log", "message": f"  ✗ {pkg} 下载失败: {err}"}, json_progress)
                download_failed[pkg] = err
    _emit({"type": "log", "message": f"  下载完成，开始安装…"}, json_progress)

    # ── Phase 2: 从本地缓存逐个安装（快速、故障隔离）─────────────────────
    # 生成 constraints 文件，锁定关键包版本，防止 transitive dep 升级
    constraints_file = os.path.join(cache_dir, "_constraints.txt")
    _constraints = []
    for dist_name in ("torch", "torchaudio", "torchvision"):
        ver = _embedded_dist_version(py, dist_name)
        if ver:
            _constraints.append(f"{dist_name}=={ver}")
    # manifest 中带版本上限的包也加入 constraints，防止 peft 等拉升 transformers
    for pkg in packages:
        m = re.match(r"^([A-Za-z0-9_-]+).*(<=\d[^\s,]*).*$", pkg)
        if m:
            dist_name = m.group(1).lower().replace("-", "_")
            if dist_name not in ("torch", "torchaudio", "torchvision"):
                _constraints.append(pkg)
    if _constraints:
        Path(constraints_file).write_text("\n".join(_constraints) + "\n")
        _emit({"type": "log", "message": f"  版本锁定：{', '.join(_constraints)}"}, json_progress)

    all_ok = True
    for inst_idx, pkg in enumerate(to_install, 1):
        inst_tag = f"[{inst_idx}/{n_to_install}]"
        if pkg in download_failed:
            all_ok = False
            continue
        dist_name = re.split(r"[>=<!\[;\s]", pkg)[0]
        cmd = [py, "-m", "pip", "install", pkg,
               "--find-links", cache_dir, "--quiet"]
        if dist_name.lower().replace("-", "_") in no_deps_names:
            cmd.append("--no-deps")
        if target:
            cmd += ["--target", target, "--upgrade"]
        if _constraints:
            cmd += ["--constraint", constraints_file]
        if mirror:
            cmd += ["--index-url", mirror, "--extra-index-url", "https://pypi.org/simple"]
        r = subprocess.run(cmd, capture_output=True, text=True, timeout=600)
        if r.returncode == 0:
            _emit({"type": "log", "message": f"  {inst_tag} ✓ {pkg}"}, json_progress)
        else:
            # pip 返回非零但包可能已安装（Windows 长路径 bug、依赖解析警告等）
            raw_module = pkg.replace("-", "_").split("==")[0].split(">=")[0].split("[")[0]
            mod = _PKG_TO_MODULE.get(raw_module.lower(), raw_module)
            exact_ver = _exact_version_spec(pkg)
            actually_ok = False
            if exact_ver:
                actually_ok = _installed_dist_version(py, target, dist_name) == exact_ver
            elif target:
                actually_ok = _is_importable_in_target(target, mod)
            else:
                chk = subprocess.run([py, "-c", f"import {mod}"], capture_output=True, env=env)
                actually_ok = chk.returncode == 0
            if actually_ok:
                _emit({"type": "log", "message": f"  {inst_tag} ✓ {pkg}  (pip 警告但已安装)"}, json_progress)
            else:
                err = r.stderr.strip()[:300]
                _emit({"type": "log", "message": f"  {inst_tag} ✗ {pkg} 安装失败: {err}"}, json_progress)
                all_ok = False

    # ── Phase 3: 修复 torch 栈版本（万一 constraints 未能完全阻止）─────────
    if target:
        _repair_torch_stack(py, target, mirror, json_progress)

    # ── Phase 4: 清理重复 dist-info（pip --upgrade 留下旧版 metadata）──────
    if target:
        _cleanup_duplicate_dist_info(target, json_progress)

    # ── 清理临时缓存 ──────────────────────────────────────────────────────
    shutil.rmtree(cache_dir, ignore_errors=True)

    # ── 汇总失败项 ────────────────────────────────────────────────────────
    if not all_ok:
        failed = [p for p in to_install if p in download_failed]
        # 也检查安装阶段失败的
        for pkg in to_install:
            if pkg not in download_failed:
                dist_name = re.split(r"[>=<!\[;\s]", pkg)[0]
                raw_module = pkg.replace("-", "_").split("==")[0].split(">=")[0].split("[")[0]
                module_name = _PKG_TO_MODULE.get(raw_module.lower(), raw_module)
                exact_ver = _exact_version_spec(pkg)
                if exact_ver:
                    if _installed_dist_version(py, target, dist_name) != exact_ver:
                        failed.append(pkg)
                elif target:
                    if not _is_importable_in_target(target, module_name):
                        failed.append(pkg)
                else:
                    chk = subprocess.run([py, "-c", f"import {module_name}"],
                                         capture_output=True, env=env)
                    if chk.returncode != 0:
                        failed.append(pkg)
        if failed:
            _emit({"type": "log", "message": f"  ══ 失败汇总: {', '.join(failed)}"}, json_progress)

    return all_ok


def _remove_pkg_from_target(target: str, pkg_name: str, json_progress: bool) -> None:
    """--target ディレクトリから不要なパッケージを削除する。"""
    target_path = Path(target)
    if not target_path.exists():
        return
    normalized = pkg_name.lower().replace("-", "_")
    removed = []
    for item in target_path.iterdir():
        name_lower = item.name.lower().replace("-", "_")
        if name_lower == normalized or name_lower.startswith(normalized + "-") or name_lower.startswith(normalized + "."):
            try:
                if item.is_dir():
                    shutil.rmtree(item)
                else:
                    item.unlink()
                removed.append(item.name)
            except OSError:
                pass
    if removed:
        _emit({"type": "log", "message": f"  削除: {', '.join(removed)}"}, json_progress)


def _verify_numpy_pyd(py: str, target: str, mirror: str, json_progress: bool) -> None:
    """Windows: numpy C 拡張（.pyd）が --target に正しくインストールされたか検証。

    pip install --target で numpy wheel を展開した際、.pyd ファイルが欠落する
    ケースがある（アンチウイルス、パス長、pip バグ等）。
    欠落時は --force-reinstall で再インストールする。
    """
    core_dir = Path(target) / "numpy" / "_core"
    if not core_dir.is_dir():
        return  # numpy 自体が未インストール

    pyd_files = list(core_dir.glob("*.pyd"))
    if pyd_files:
        return  # 正常

    _emit({"type": "log", "message": "  ⚠ numpy C 拡張（.pyd）が欠落、強制再インストール…"}, json_progress)

    # 壊れた numpy を削除してから再インストール
    numpy_dir = Path(target) / "numpy"
    numpy_libs = Path(target) / "numpy.libs"
    for d in [numpy_dir, numpy_libs]:
        if d.exists():
            shutil.rmtree(d, ignore_errors=True)
    # dist-info も削除
    for di in Path(target).glob("numpy-*.dist-info"):
        shutil.rmtree(di, ignore_errors=True)

    mirror_args = ["-i", mirror] if mirror else []
    cmd = [
        py, "-m", "pip", "install", "numpy>=2.2,<2.3",
        "--target", target, "--force-reinstall", "--no-deps", "-q",
        *mirror_args,
    ]
    r = subprocess.run(cmd, capture_output=True, text=True, timeout=600)
    # 再検証
    pyd_after = list(core_dir.glob("*.pyd")) if core_dir.exists() else []
    if pyd_after:
        _emit({"type": "log", "message": f"  ✓ numpy C 拡張を修復（{len(pyd_after)} 個の .pyd）"}, json_progress)
    else:
        _emit({"type": "log", "message": "  ✗ numpy C 拡張の修復に失敗。アンチウイルスソフトが .pyd をブロックしている可能性があります"}, json_progress)


def _patch_torchaudio_torchcodec(target: str, json_progress: bool) -> None:
    """torchaudio 2.6+ の torchcodec デフォルト呼び出しを soundfile fallback に置換。

    torchaudio._torchcodec.load_with_torchcodec() が torchcodec を import して失敗するため、
    ImportError 時に soundfile で読み込むフォールバックを注入する。
    __init__.py は書き換えない（_load_impl 等の存在しない関数への参照を避ける）。
    """
    tc_py = Path(target) / "torchaudio" / "_torchcodec.py"
    if not tc_py.exists():
        return
    text = tc_py.read_text(encoding="utf-8")
    if "soundfile fallback" in text:
        return  # 既にパッチ済み

    # load_with_torchcodec の ImportError raise を soundfile fallback に置換
    old = (
        'raise ImportError(\n'
        '            "TorchCodec is required for load_with_torchcodec.'
    )
    new = (
        '# soundfile fallback（torchcodec unavailable）\n'
        '            import soundfile as _sf, torch as _torch, numpy as _np\n'
        '            _data, _sr = _sf.read(str(filepath))\n'
        '            if _data.ndim == 1: _data = _data.reshape(1, -1)\n'
        '            else: _data = _data.T\n'
        '            return _torch.from_numpy(_np.array(_data, copy=True)).float(), _sr  # soundfile fallback'
    )
    if old in text:
        text = text.replace(old, new)
        tc_py.write_text(text, encoding="utf-8")
        _emit({"type": "log", "message": "  ✓ torchaudio: torchcodec → soundfile fallback パッチ適用"}, json_progress)
    else:
        # 既に壊れた _load_impl パッチが __init__.py に適用されている場合を修復
        ta_init = Path(target) / "torchaudio" / "__init__.py"
        if ta_init.exists():
            init_text = ta_init.read_text(encoding="utf-8")
            fixed = False
            if "return _load_impl(" in init_text:
                init_text = init_text.replace("return _load_impl(", "return load_with_torchcodec(")
                fixed = True
            if "return _save_impl(" in init_text:
                init_text = init_text.replace("return _save_impl(", "return save_with_torchcodec(")
                fixed = True
            if fixed:
                ta_init.write_text(init_text, encoding="utf-8")
                _emit({"type": "log", "message": "  ✓ torchaudio: 壊れた _load_impl パッチを修復"}, json_progress)


def _patch_fairseq_in_target(target: str, json_progress: bool) -> None:
    """--target にインストールされた fairseq に Python 3.12 兼容パッチを適用。

    fairseq 0.12.2 は Python 3.12 の dataclass 厳格化と hydra 初期化に非互換。
    1) __init__.py: hydra_init() を try/except で囲み、bulk import をループ化
    2) dataclass configs: mutable default を default_factory に変換
    """
    fairseq_dir = Path(target) / "fairseq"
    if not fairseq_dir.is_dir():
        return

    init_py = fairseq_dir / "__init__.py"
    if init_py.exists():
        text = init_py.read_text(encoding="utf-8")
        changed = False

        # hydra_init() を try/except で囲む
        if "hydra_init()" in text and "try:\n    hydra_init()" not in text:
            text = text.replace(
                "hydra_init()",
                "try:\n    hydra_init()\nexcept Exception:\n    pass  # Py3.12 兼容跳过",
            )
            changed = True

        # bulk import を安全なループに変換
        bulk_imports = re.findall(r"^import fairseq\.\S+.*$", text, re.MULTILINE)
        if bulk_imports:
            modules = [b.replace("import ", "").replace("  # noqa", "").strip() for b in bulk_imports]
            loop = (
                "for _m in " + repr(modules) + ":\n"
                "    try:\n"
                "        import importlib as _il; _il.import_module(_m)\n"
                "    except Exception:\n"
                "        pass\n"
            )
            for imp_line in bulk_imports:
                text = text.replace(imp_line + "\n", "", 1)
            hydra_marker = "    pass  # Py3.12 兼容跳过\n"
            if hydra_marker in text:
                text = text.replace(hydra_marker, hydra_marker + "\n" + loop)
            changed = True

        if changed:
            init_py.write_text(text, encoding="utf-8")

    # mutable default を default_factory に変換
    def _fix_mutable_defaults(py_file: Path) -> None:
        if not py_file.exists():
            return
        text = py_file.read_text(encoding="utf-8")
        pattern1 = r'^(\s+\w+:\s+\w+)\s*=\s*(\w+)\(\)$'
        def _rep1(m: re.Match) -> str:
            prefix, typename = m.group(1), m.group(2)
            if typename[0].isupper() and typename not in ("Optional", "List", "Dict", "Tuple", "Any"):
                return f"{prefix} = field(default_factory={typename})"
            return m.group(0)
        text = re.sub(pattern1, _rep1, text, flags=re.MULTILINE)
        text = re.sub(r'field\(default=([A-Z]\w+)\(\)\)', r'field(default_factory=\1)', text)
        py_file.write_text(text, encoding="utf-8")

    for rel in ["dataclass/configs.py", "models/transformer/transformer_config.py"]:
        _fix_mutable_defaults(fairseq_dir / rel)

    _emit({"type": "log", "message": "  ✓ fairseq Python 3.12 兼容パッチ適用済み"}, json_progress)


def _install_rvc_to_target(py: str, target: str, pypi_mirror: str, json_progress: bool) -> bool:
    """fairseq + rvc-python を --target に安装する（RVC 用）。

    fairseq は C 拡張ビルドが困難（特に Windows）なため、
    ソースから C 拡張を無効化してインストールする。
    """
    mirror_args = ["-i", pypi_mirror] if pypi_mirror else []
    target_args = ["--target", target, "--no-warn-script-location"] if target else []

    # fairseq がインストール済みか確認
    fairseq_exists = _is_importable_in_target(target, "fairseq") if target else False
    if fairseq_exists:
        _emit({"type": "log", "message": "  ✓ fairseq 已存在，跳过安装"}, json_progress)
    else:
        _emit({"type": "log", "message": "  安装 fairseq==0.12.2（纯 Python 模式）…"}, json_progress)
        # setuptools<72 は fairseq ビルドに必要
        subprocess.run(
            [py, "-m", "pip", "install", "setuptools<72", *target_args, *mirror_args, "-q"],
            capture_output=True, text=True, timeout=300,
        )
        # fairseq ソースをダウンロードして C 拡張を無効化してインストール
        _FAIRSEQ_SDIST = "https://files.pythonhosted.org/packages/source/f/fairseq/fairseq-0.12.2.tar.gz"
        _INJECT = (
            "# === 安装器注入：强制纯 Python 安装 ===\n"
            "import setuptools as _st_inject\n"
            "_orig_st_setup = _st_inject.setup\n"
            "def _no_ext_setup(**kw):\n"
            "    kw.pop('ext_modules', None)\n"
            "    return _orig_st_setup(**kw)\n"
            "_st_inject.setup = _no_ext_setup\n"
            "def cythonize(*_a, **_kw): return []\n"
            "class Extension:\n"
            "    def __init__(self, *_a, **_kw): pass\n"
            "try:\n"
            "    import numpy as _np_check\n"
            "except ImportError:\n"
            "    import types as _types, sys as _sys\n"
            "    _np_fake = _types.ModuleType('numpy')\n"
            "    _np_fake.get_include = lambda: ''\n"
            "    _sys.modules['numpy'] = _np_fake\n"
            "# === 注入结束 ===\n"
        )
        with tempfile.TemporaryDirectory() as tmpdir:
            tarball = Path(tmpdir) / "fairseq.tar.gz"
            try:
                import urllib.request
                urllib.request.urlretrieve(_FAIRSEQ_SDIST, str(tarball))
                with __import__("tarfile").open(tarball, "r:gz") as tf:
                    tf.extractall(tmpdir)
                candidates = [p for p in Path(tmpdir).iterdir() if p.is_dir() and p.name.startswith("fairseq")]
                if not candidates:
                    _emit({"type": "log", "message": "  ✗ fairseq 解压后目录未找到"}, json_progress)
                    return False
                fairseq_src = candidates[0]
                setup_py = fairseq_src / "setup.py"
                if setup_py.exists():
                    original = setup_py.read_text(encoding="utf-8")
                    patched = re.sub(r"^(from|import)\s+Cython[^\n]*\n", "", original, flags=re.MULTILINE)
                    setup_py.write_text(_INJECT + patched, encoding="utf-8")
                r = subprocess.run(
                    [py, "-m", "pip", "install", str(fairseq_src),
                     "--no-build-isolation", "--no-deps", *target_args, "-q"],
                    capture_output=True, text=True, timeout=600,
                )
                if r.returncode != 0:
                    _emit({"type": "log", "message": f"  ✗ fairseq 安装失败: {r.stderr.strip()[-300:]}"}, json_progress)
                    return False
                _emit({"type": "log", "message": "  ✓ fairseq 安装成功"}, json_progress)
            except Exception as e:
                _emit({"type": "log", "message": f"  ✗ fairseq 安装异常: {e}"}, json_progress)
                return False

    # fairseq Python 3.12 兼容パッチ（インストール済みでも常に適用 — 前回パッチ未適用の可能性）
    _patch_fairseq_in_target(target, json_progress)

    # bitarray（fairseq 依赖）
    subprocess.run(
        [py, "-m", "pip", "install", "bitarray", *target_args, *mirror_args, "--no-deps", "-q"],
        capture_output=True, text=True, timeout=300,
    )

    # rvc-python
    if _is_importable_in_target(target, "rvc") if target else False:
        _emit({"type": "log", "message": "  ✓ rvc-python 已存在，跳过"}, json_progress)
    else:
        r = subprocess.run(
            [py, "-m", "pip", "install", "rvc-python==0.1.5", "--no-deps", *target_args, *mirror_args, "-q"],
            capture_output=True, text=True, timeout=300,
        )
        if r.returncode != 0:
            _emit({"type": "log", "message": f"  ✗ rvc-python 安装失败: {r.stderr.strip()[-200:]}"}, json_progress)
            return False
        _emit({"type": "log", "message": "  ✓ rvc-python 安装成功"}, json_progress)

    return True


def main():
    """安装基础 ML 包。"""
    parser = argparse.ArgumentParser(description="安装基础 ML 运行库")
    parser.add_argument("--target", default="", help="pip install --target 目录；省略则装到 runtime/ml/（开发模式）")
    parser.add_argument("--pypi-mirror", default="", dest="pypi_mirror", help="PyPI 镜像地址")
    parser.add_argument("--json-progress", action="store_true", dest="json_progress", help="输出 JSON Lines 进度")
    args = parser.parse_args()

    project_root = Path(__file__).resolve().parent.parent

    # 开发模式（无 --target）：默认装到 runtime/ml/，不污染嵌入式 Python
    if not args.target:
        args.target = str(project_root / "runtime" / "ml")
    resources_root = project_root

    manifest_path = resources_root / "backend" / "wrappers" / "manifest.json"
    if not manifest_path.exists():
        manifest_path = project_root / "backend" / "wrappers" / "manifest.json"
    if not manifest_path.exists():
        _emit({"type": "log", "message": f"✗ 找不到 manifest.json"}, args.json_progress)
        return 1

    manifest = json.loads(manifest_path.read_text(encoding="utf-8-sig"))
    engines: dict = {k: v for k, v in manifest.get("engines", {}).items() if k in BASE_ENGINES}

    py = get_embedded_python(resources_root) or get_embedded_python(project_root)
    if not py:
        _emit({"type": "log", "message": "✗ 嵌入式 Python 未找到，请先运行 pnpm run setup"}, args.json_progress)
        return 1

    phase_label = "1/2 正在安装运行依赖…" if args.json_progress else "安装运行依赖"
    _emit({"type": "phase", "label": phase_label}, args.json_progress)
    if args.target:
        _emit({"type": "log", "message": f"目标目录：{args.target}"}, args.json_progress)
    else:
        _emit({"type": "log", "message": f"嵌入式 Python：{py}"}, args.json_progress)
    if args.pypi_mirror:
        _emit({"type": "log", "message": f"PyPI 镜像：{args.pypi_mirror}"}, args.json_progress)

    # Windows 前置依赖：loguru が win32-setctime を要求するため、先にインストール
    if platform.system() == "Windows":
        _emit({"type": "log", "message": "安装 Windows 前置依赖: win32-setctime"}, args.json_progress)
        pre_cmd = [py, "-m", "pip", "install", "win32-setctime>=1.0.0",
                   "--target", args.target, "--no-warn-script-location", "-q"]
        if args.pypi_mirror:
            pre_cmd += ["-i", args.pypi_mirror]
        subprocess.run(pre_cmd, capture_output=True, text=True, timeout=120)

    all_pkgs: list[str] = list(manifest.get("shared_runtime_pip_packages", []))
    for cfg in engines.values():
        all_pkgs.extend(cfg.get("runtime_pip_packages", []))

    packages = _dedup_packages(all_pkgs)
    packages = align_torch_stack_versions(packages, py)
    if not packages:
        _emit({"type": "log", "message": "无需安装运行时包"}, args.json_progress)
        return 0

    _emit({"type": "log", "message": f"共 {len(packages)} 个包待安装"}, args.json_progress)
    ok = install_packages(packages, py, args.target, args.pypi_mirror, args.json_progress)

    # 清理 transitive dependency 中与嵌入式 Python 冲突的包
    _cleanup_protected_packages(args.target, args.json_progress)

    # 嵌入式 Python の site-packages から ML 専用パッケージを削除
    # （numpy/typing_extensions は torch とバージョン競合するため、ML target のみ保持）
    _cleanup_embedded_ml_packages(py, args.json_progress)

    # Windows: numpy C 拡張（.pyd）が欠落していないか検証し、欠落時は強制再インストール
    if platform.system() == "Windows" and args.target:
        _verify_numpy_pyd(py, args.target, args.pypi_mirror, args.json_progress)

    # Windows: torchaudio 2.10 が torchcodec をデフォルト backend にするが、
    # FFmpeg shared DLL がないとハングする。torchaudio のソースを直接パッチして
    # torchcodec 呼び出しを soundfile fallback に置換する。
    if platform.system() == "Windows" and args.target:
        _patch_torchaudio_torchcodec(args.target, args.json_progress)

    # macOS: 移除 quarantine 属性，防止 .so 文件被系统策略拒绝加载
    if platform.system() == "Darwin" and args.target:
        subprocess.run(
            ["xattr", "-dr", "com.apple.quarantine", args.target],
            capture_output=True, timeout=60,
        )

    # ── RVC 特殊依赖：fairseq + rvc-python（--no-deps 安装） ────────────────
    # runtime.py の pip_packages 段階で嵌入式 Python にインストールされるはずだが、
    # macOS CI からのクロスビルドでは Windows 嵌入式 Python に入らないため、
    # ユーザー初回起動の ML インストール段階でも --target に入れる。
    if "rvc" in engines:
        _emit({"type": "log", "message": "安装 RVC 依赖（fairseq + rvc-python）…"}, args.json_progress)
        _rvc_ok = _install_rvc_to_target(py, args.target, args.pypi_mirror, args.json_progress)
        if not _rvc_ok:
            ok = False

    # NLTK データダウンロード（GPT-SoVITS の英語テキスト処理に必要）
    _emit({"type": "log", "message": "下载 NLTK 数据…"}, args.json_progress)
    nltk_data_dir = str(Path(args.target) / "nltk_data") if args.target else ""
    # Windows パスにバックスラッシュが含まれるため -c 文字列ではなくスクリプトファイルで実行
    nltk_script = (
        "import sys, os\n"
        "target = sys.argv[1]\n"
        "dl_dir = sys.argv[2]\n"
        "sys.path.insert(0, target)\n"
        "import nltk\n"
        "os.makedirs(dl_dir, exist_ok=True)\n"
        "nltk.data.path.insert(0, dl_dir)\n"
        "nltk.download('averaged_perceptron_tagger_eng', download_dir=dl_dir)\n"
    )
    nltk_tmp = Path(tempfile.mktemp(suffix=".py"))
    nltk_tmp.write_text(nltk_script, encoding="utf-8")
    try:
        nltk_cmd = [py, str(nltk_tmp), args.target, nltk_data_dir] if nltk_data_dir else [
            py, "-c", "import nltk; nltk.download('averaged_perceptron_tagger_eng')"
        ]
        nltk_result = subprocess.run(nltk_cmd, capture_output=True, text=True, timeout=120)
        if nltk_result.returncode == 0:
            _emit({"type": "log", "message": "✓ NLTK 数据下载完成"}, args.json_progress)
        else:
            _emit({"type": "log", "message": f"⚠ NLTK 数据下载失败: {nltk_result.stderr[:200]}"}, args.json_progress)
    finally:
        nltk_tmp.unlink(missing_ok=True)

    if ok:
        _emit({"type": "log", "message": "✓ 运行库安装完成"}, args.json_progress)
        return 0
    else:
        _emit({"type": "log", "message": "✗ 部分包安装失败，请检查日志"}, args.json_progress)
        return 1


if __name__ == "__main__":
    sys.exit(main())
