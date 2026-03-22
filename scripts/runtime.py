#!/usr/bin/env python3
"""
嵌入式 Python 运行环境构建 — 下载嵌入式 Python + 安装 backend 依赖 + 全部引擎。

基础引擎：Fish Speech、GPT-SoVITS、RVC、Seed-VC、Faster Whisper、FaceFusion
额外引擎：LivePortrait、Flux、SD、WAN、GOT-OCR、Whisper

用法（开发全量）：
    python3 scripts/runtime.py

用法（只安装指定引擎，供 main.js app:downloadEngine 调用）：
    python3 scripts/runtime.py --engine fish_speech
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
import tarfile
import tempfile
import urllib.request
import zipfile
from pathlib import Path

# Windows 控制台 UTF-8
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")


# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# 配置常量
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

# python-build-standalone 版本（macOS / Windows 共用）
PBS_RELEASE = "20250317"
PBS_PY_VERSION = "3.12.9"

# 基础引擎集合（step 3 安装，含嵌入式 Python + backend 依赖）
BASE_ENGINES = {"fish_speech", "gpt_sovits", "seed_vc", "rvc", "faster_whisper", "facefusion"}

# 额外引擎集合（step 4 安装，需嵌入式 Python 已就绪）
EXTRA_ENGINES = {"whisper", "got_ocr", "liveportrait", "wan", "flux", "sd"}

# PyPI 镜像源（通过 --pypi-mirror 设置）
PYPI_MIRROR = ""


def _pip_mirror_args() -> list[str]:
    """返回 pip install 的镜像参数。"""
    return ["-i", PYPI_MIRROR] if PYPI_MIRROR else []


# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# 工具函数
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

_IS_TTY: bool = sys.stdout.isatty()
_LAST_PCT: list[int] = [-1]


def _reporthook(count: int, block_size: int, total_size: int) -> None:
    if total_size <= 0:
        return
    mb = count * block_size / 1024 / 1024
    pct = min(100, int(count * block_size * 100 / total_size))
    if _IS_TTY:
        print(f"\r  {pct}% ({mb:.1f} MB)", end="", flush=True)
    elif pct // 10 != _LAST_PCT[0]:
        _LAST_PCT[0] = pct // 10
        print(f"  {pct}% ({mb:.1f} MB)", flush=True)


def get_embedded_python(root: Path) -> str:
    """返回嵌入式 Python 可执行路径，找不到返回空串。

    Linux（含 Docker）：直接返回当前解释器，无需嵌入式 Python。
    """
    if platform.system() == "Linux":
        return sys.executable
    if platform.system() == "Windows":
        p = root / "runtime" / "python" / "win" / "python.exe"
    else:
        p = root / "runtime" / "python" / "mac" / "bin" / "python3"
    return str(p) if p.exists() else ""



# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# 第一步：下载嵌入式 Python
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

def _download_pbs_python(dest_dir: Path) -> None:
    """下载 python-build-standalone 到 dest_dir（macOS / Windows 共用）。"""
    system = platform.system()
    if system == "Linux":
        # Linux / Docker：使用系统 Python，无需下载 python-build-standalone
        print("  [pbs] Linux 环境，跳过嵌入式 Python 下载")
        return
    if system == "Darwin":
        import struct
        arch = "aarch64" if struct.calcsize("P") * 8 == 64 and platform.machine() == "arm64" else "x86_64"
        triple = f"{arch}-apple-darwin"
    elif system == "Windows":
        triple = "x86_64-pc-windows-msvc"
    else:
        raise RuntimeError(f"不支持的平台: {system}")

    filename = f"cpython-{PBS_PY_VERSION}+{PBS_RELEASE}-{triple}-install_only.tar.gz"
    url = f"https://github.com/astral-sh/python-build-standalone/releases/download/{PBS_RELEASE}/{filename}"
    runtime_dir = dest_dir.parent.parent  # runtime/python/{mac|win} -> runtime/
    runtime_dir.mkdir(parents=True, exist_ok=True)
    tmp_tar = runtime_dir / "_python_tmp.tar.gz"

    print(f"  下载: cpython-{PBS_PY_VERSION} ({triple})")
    urllib.request.urlretrieve(url, str(tmp_tar), _reporthook)
    if _IS_TTY:
        print()

    print("  解压 standalone Python...")
    tmp_extract = runtime_dir / "_python_extract_tmp"
    tmp_extract.mkdir(parents=True, exist_ok=True)
    with tarfile.open(tmp_tar, "r:gz") as tf:
        tf.extractall(tmp_extract)
    tmp_tar.unlink()

    extracted_python = tmp_extract / "python"
    if not extracted_python.exists():
        raise RuntimeError(f"解压后未找到 python/ 目录: {tmp_extract}")

    dest_dir.parent.mkdir(parents=True, exist_ok=True)
    if dest_dir.exists():
        shutil.rmtree(dest_dir)
    shutil.move(str(extracted_python), str(dest_dir))
    shutil.rmtree(tmp_extract, ignore_errors=True)

    # pip 在 python-build-standalone 中已内置，直接装 huggingface_hub
    if system == "Windows":
        py_exe = dest_dir / "python.exe"
    else:
        py_exe = dest_dir / "bin" / "python3"
    print(f"  ✓ standalone Python {PBS_PY_VERSION} 已就绪: {dest_dir}")
    print("  装 huggingface_hub 到嵌入式 Python...")
    subprocess.run(
        [str(py_exe), "-m", "pip", "install", "-q", *_pip_mirror_args(), "huggingface-hub", "requests", "tqdm"],
        check=False,
    )


def ensure_embedded_python(project_root: Path) -> str:
    """确保嵌入式 Python 存在，返回可执行路径。"""
    py = get_embedded_python(project_root)
    if py:
        return py

    system = platform.system()
    if system == "Linux":
        # Linux / Docker：使用系统 Python，无需下载嵌入式版本
        return sys.executable
    elif system == "Darwin":
        dest = project_root / "runtime" / "python" / "mac"
    elif system == "Windows":
        dest = project_root / "runtime" / "python" / "win"
    else:
        print(f"✗ 不支持的平台: {system}")
        sys.exit(1)

    print(f"\n[setup] standalone Python 不存在，开始下载 {PBS_PY_VERSION}...")
    _download_pbs_python(dest)

    py = get_embedded_python(project_root)
    if not py:
        print("✗ Python 下载后仍找不到可执行文件")
        sys.exit(1)
    return py

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# 第二步：安装 backend 依赖
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

_PARSE_PYPROJECT_SCRIPT = """\
try:
    import tomllib
except ImportError:
    import tomli as tomllib
import sys, json
with open(sys.argv[1], 'rb') as f:
    data = tomllib.load(f)
deps = data['tool']['poetry']['dependencies']
for name, spec in deps.items():
    if name == 'python':
        continue
    if isinstance(spec, str):
        ver = spec.replace('^', '>=').replace('~', '~=')
        print(f'{name}{ver}' if ver != '*' else name)
    elif isinstance(spec, dict):
        version = spec.get('version', '').replace('^', '>=').replace('~', '~=')
        extras = spec.get('extras', [])
        pkg = f'{name}[{",".join(extras)}]' if extras else name
        print(f'{pkg}{version}' if version else pkg)
"""


def install_backend_deps(project_root: Path, py: str) -> bool:
    """用嵌入式 Python 的 pip 安装 backend 依赖。

    优先使用预生成的 requirements.txt（由 poetry export 生成），
    找不到时回退到解析 pyproject.toml。
    """
    req_file = project_root / "backend" / "requirements.txt"

    if req_file.exists():
        # 优先使用预生成的 requirements.txt
        reqs = [line.strip() for line in req_file.read_text(encoding="utf-8").splitlines()
                if line.strip() and not line.strip().startswith("#")]
        if not reqs:
            print("  ⚠ requirements.txt 为空")
            return True
        print(f"  使用 requirements.txt（{len(reqs)} 个依赖）")
        r = subprocess.run(
            [py, "-m", "pip", "install", "-r", str(req_file), *_pip_mirror_args(), "--quiet"],
            text=True, timeout=600,
        )
        if r.returncode != 0:
            print("  ✗ backend 依赖安装失败")
            return False
        print("  ✓ backend 依赖安装完成")
        return True

    # 回退：尝试用 poetry export 生成 requirements.txt
    pyproject = project_root / "backend" / "pyproject.toml"
    if not pyproject.exists():
        print(f"  ⚠ {pyproject} 不存在，跳过 backend 依赖安装")
        return True

    print("  requirements.txt 不存在，尝试 poetry export 生成...")
    export_result = subprocess.run(
        ["poetry", "export", "-f", "requirements.txt", "--without-hashes",
         "-o", str(req_file)],
        capture_output=True, text=True, cwd=str(project_root / "backend"),
    )
    if export_result.returncode == 0 and req_file.exists():
        print("  ✓ 已通过 poetry export 生成 requirements.txt")
        return install_backend_deps(project_root, py)  # 递归调用，走 req_file 分支

    # 最终回退：直接解析 pyproject.toml
    print("  poetry export 不可用，回退到解析 pyproject.toml")
    result = subprocess.run(
        [py, "-c", _PARSE_PYPROJECT_SCRIPT, str(pyproject)],
        capture_output=True, text=True,
    )
    if result.returncode != 0:
        print(f"  ✗ 解析 pyproject.toml 失败: {result.stderr.strip()[:300]}")
        return False

    reqs = [line.strip() for line in result.stdout.strip().split("\n") if line.strip()]
    if not reqs:
        print("  ⚠ pyproject.toml 无依赖")
        return True

    print(f"  共 {len(reqs)} 个 backend 依赖")
    tmp_req_file = project_root / "backend" / "_requirements_tmp.txt"
    tmp_req_file.write_text("\n".join(reqs), encoding="utf-8")
    try:
        r = subprocess.run(
            [py, "-m", "pip", "install", "-r", str(tmp_req_file), *_pip_mirror_args(), "--quiet"],
            text=True, timeout=600,
        )
        if r.returncode != 0:
            print("  ✗ backend 依赖安装失败")
            return False
        print("  ✓ backend 依赖安装完成")
        return True
    finally:
        tmp_req_file.unlink(missing_ok=True)


# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# 安装引擎 pip_packages（通用）
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

def setup_pip_packages(engine_name: str, packages: list[str], py: str) -> bool:
    """安装引擎的 pip_packages 到嵌入式 Python。"""
    if not packages:
        return True
    all_ok = True
    for pkg in packages:
        module_name = pkg.replace("-", "_").split("==")[0].split(">=")[0].split("[")[0]
        check = subprocess.run([py, "-c", f"import {module_name}"], capture_output=True)
        if check.returncode == 0:
            print(f"  ✓ {pkg}  (已安装)")
            continue
        print(f"  [pip] 安装 {pkg} ...")
        result = subprocess.run(
            [py, "-m", "pip", "install", pkg, *_pip_mirror_args(), "--quiet"],
            capture_output=True, text=True, timeout=600,
        )
        if result.returncode == 0:
            print(f"    ✓ 安装成功: {pkg}")
        else:
            print(f"    ✗ 安装失败: {result.stderr.strip()[:200]}")
            all_ok = False
    return all_ok


# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# RVC 引擎安装
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

def _patch_fairseq_for_py312(py: str) -> None:
    """修补 fairseq 以兼容 Python 3.12 + 新版 omegaconf。"""
    # fairseq 在未修补前无法 import（hydra_init 崩溃），
    # 改用 importlib.util.find_spec 获取路径（不触发 __init__.py 执行）。
    result = subprocess.run(
        [py, "-c",
         "import importlib.util, os; spec = importlib.util.find_spec('fairseq');"
         "print(os.path.dirname(spec.origin)) if spec and spec.origin else exit(1)"],
        capture_output=True, text=True,
    )
    if result.returncode != 0:
        return
    fairseq_dir = Path(result.stdout.strip())

    init_py = fairseq_dir / "__init__.py"
    if init_py.exists():
        text = init_py.read_text(encoding="utf-8")
        if "hydra_init()" in text and "try:\n    hydra_init()" not in text:
            text = text.replace(
                "hydra_init()",
                "try:\n    hydra_init()\nexcept Exception:\n    pass  # Py3.12 兼容跳过",
            )
        bulk_imports = re.findall(r"^import fairseq\.\S+.*$", text, re.MULTILINE)
        if bulk_imports:
            modules = [b.replace("import ", "").replace("  # noqa", "").strip() for b in bulk_imports]
            loop = (
                "for _m in "
                + repr(modules)
                + ":\n"
                "    try:\n"
                "        import importlib as _il; _il.import_module(_m)\n"
                "    except Exception:\n"
                "        pass\n"
            )
            # 逐行删除原始 import 语句，避免空行导致 block 匹配失败
            for imp_line in bulk_imports:
                text = text.replace(imp_line + "\n", "", 1)
            # 在 hydra_init 块之后插入循环
            hydra_marker = "    pass  # Py3.12 兼容跳过\n"
            if hydra_marker in text:
                text = text.replace(hydra_marker, hydra_marker + "\n" + loop)
        init_py.write_text(text, encoding="utf-8")

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

    print("    ✓ fairseq Python 3.12 兼容补丁已应用")


def _install_fairseq_windows(py: str) -> bool:
    """Windows 专用：下载 fairseq 0.12.2 源码，注入 monkey-patch 禁用所有 C 扩展后安装。"""
    _FAIRSEQ_SDIST = (
        "https://files.pythonhosted.org/packages/source/f/fairseq/fairseq-0.12.2.tar.gz"
    )
    _INJECT = """\
# === 以下由安装器注入：强制纯 Python 安装（禁用所有 C/Cython 扩展）===
import setuptools as _st_inject
_orig_st_setup = _st_inject.setup
def _no_ext_setup(**kw):
    kw.pop('ext_modules', None)
    return _orig_st_setup(**kw)
_st_inject.setup = _no_ext_setup
def cythonize(*_a, **_kw): return []
class Extension:
    def __init__(self, *_a, **_kw): pass
try:
    import numpy as _np_check  # noqa: F401
except ImportError:
    import types as _types, sys as _sys
    _np_fake = _types.ModuleType('numpy')
    _np_fake.get_include = lambda: ''
    _sys.modules['numpy'] = _np_fake
# === 注入结束 ===
"""

    print("  [fairseq] 下载源码包（Windows 纯 Python 模式）...")
    with tempfile.TemporaryDirectory() as tmpdir:
        tarball = Path(tmpdir) / "fairseq.tar.gz"
        try:
            urllib.request.urlretrieve(_FAIRSEQ_SDIST, str(tarball))
        except Exception as e:
            print(f"    ✗ 下载失败: {e}")
            return False

        try:
            with tarfile.open(tarball, "r:gz") as tf:
                tf.extractall(tmpdir)
        except Exception as e:
            print(f"    ✗ 解压失败: {e}")
            return False

        candidates = [p for p in Path(tmpdir).iterdir() if p.is_dir() and p.name.startswith("fairseq")]
        if not candidates:
            print("    ✗ 解压后未找到 fairseq 目录")
            return False
        fairseq_src = candidates[0]

        setup_py = fairseq_src / "setup.py"
        if setup_py.exists():
            original = setup_py.read_text(encoding="utf-8")
            patched = re.sub(r"^(from|import)\s+Cython[^\n]*\n", "", original, flags=re.MULTILINE)
            setup_py.write_text(_INJECT + patched, encoding="utf-8")

        r = subprocess.run(
            [py, "-m", "pip", "install", str(fairseq_src),
             "--no-build-isolation", "--no-deps", "--quiet"],
            capture_output=True, text=True, timeout=600,
        )
        if r.returncode != 0:
            print(f"    ✗ 安装失败: {r.stderr.strip()[-400:]}")
            return False

        print("    ✓ fairseq 安装成功（纯 Python 模式）")
        return True


def _install_rvc_python(py: str) -> bool:
    def pip(*args: str) -> bool:
        r = subprocess.run(
            [py, "-m", "pip", "install", *args, *_pip_mirror_args(), "--quiet"],
            capture_output=True, text=True, timeout=600,
        )
        if r.returncode != 0:
            print(f"    ✗ pip install {' '.join(args)} 失败: {r.stderr.strip()[:200]}")
        return r.returncode == 0

    pip("setuptools<72")
    print("  [pip] 安装 fairseq (--no-deps) ...")
    if platform.system() == "Windows":
        if not _install_fairseq_windows(py):
            return False
    elif not pip("fairseq==0.12.2", "--no-deps"):
        return False
    _patch_fairseq_for_py312(py)
    pip("bitarray")
    print("  [pip] 安装 rvc-python==0.1.5 (--no-deps) ...")
    if not pip("rvc-python==0.1.5", "--no-deps"):
        return False
    return True


def setup_rvc_engine(project_root: Path) -> bool:
    """安装 rvc-python。"""
    py = get_embedded_python(project_root)
    if not py:
        print("  [rvc] 嵌入式 Python 未找到，跳过 RVC 安装")
        return False

    check = subprocess.run(
        [py, "-c", "from rvc_python.infer import RVCInference"],
        capture_output=True,
    )
    rvc_ok = check.returncode == 0
    if rvc_ok:
        print("  ✓ rvc-python  (已安装)")
    else:
        print("  ✗ rvc-python  (未安装)")
        rvc_ok = _install_rvc_python(py)
        if rvc_ok:
            print("    ✓ rvc-python 安装完成")
        else:
            print("    ✗ rvc-python 安装失败，RVC 功能不可用")

    return rvc_ok


# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# Fish Speech 引擎源码
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

_FISH_SPEECH_TAG = "v1.5.0"
_FISH_SPEECH_REPO = "https://github.com/fishaudio/fish-speech"

_FISH_SPEECH_RM_DIRS = [
    "tools/server", "tools/webui", "tools/sensevoice",
    "fish_speech/datasets", "fish_speech/callbacks",
    "fish_speech/models/dac",
]
_FISH_SPEECH_KEEP = ["fish_speech", "tools", ".project-root"]

_FISH_SPEECH_UTILS_INIT = """\
from .context import autocast_exclude_mps
from .logger import RankedLogger
from .utils import set_seed

__all__ = ["autocast_exclude_mps", "RankedLogger", "set_seed"]
"""

_FISH_SPEECH_LOGGER = """\
import logging
from typing import Mapping, Optional


class RankedLogger(logging.LoggerAdapter):
    \"\"\"推理专用轻量 logger（去除 lightning_utilities 依赖）。\"\"\"

    def __init__(
        self,
        name: str = __name__,
        rank_zero_only: bool = True,
        extra: Optional[Mapping[str, object]] = None,
    ) -> None:
        logger = logging.getLogger(name)
        super().__init__(logger=logger, extra=extra)
        self.rank_zero_only = rank_zero_only

    def log(self, level: int, msg: str, rank: Optional[int] = None, *args, **kwargs) -> None:
        if self.isEnabledFor(level):
            msg, kwargs = self.process(msg, kwargs)
            self.logger.log(level, msg, *args, **kwargs)
"""

_FISH_SPEECH_UTILS = """\
import random
import numpy as np
import torch
from .logger import RankedLogger

log = RankedLogger(__name__, rank_zero_only=True)


def set_seed(seed: int):
    if seed < 0:
        seed = -seed
    if seed > (1 << 31):
        seed = 1 << 31
    random.seed(seed)
    np.random.seed(seed)
    torch.manual_seed(seed)
    if torch.cuda.is_available():
        torch.cuda.manual_seed(seed)
        torch.cuda.manual_seed_all(seed)
    if torch.backends.cudnn.is_available():
        torch.backends.cudnn.deterministic = True
        torch.backends.cudnn.benchmark = False
"""


def _patch_fish_speech_reference_loader(engine_dir: Path) -> None:
    """修复 torchaudio 2.10.0+ 移除 list_audio_backends() 的兼容性问题。"""
    target = engine_dir / "tools" / "inference_engine" / "reference_loader.py"
    if not target.exists():
        return
    text = target.read_text(encoding="utf-8")
    # 原始代码直接调用 torchaudio.list_audio_backends()，在 torchaudio ≥2.10 会 AttributeError
    old_pattern = "backends = torchaudio.list_audio_backends()"
    if old_pattern not in text:
        return  # 已修复或代码结构不同
    patched = text.replace(
        """        backends = torchaudio.list_audio_backends()
        if "ffmpeg" in backends:
            self.backend = "ffmpeg"
        else:
            self.backend = "soundfile\"""",
        """        # torchaudio 2.10+ 移除了 list_audio_backends；新 dispatcher 模式下无需显式 backend。
        list_backends = getattr(torchaudio, "list_audio_backends", None)
        if callable(list_backends):
            backends = list_backends()
            if "ffmpeg" in backends:
                self.backend = "ffmpeg"
            else:
                self.backend = "soundfile"
        else:
            self.backend = None""",
    )
    if patched != text:
        target.write_text(patched, encoding="utf-8")
        print("  ✓ reference_loader.py torchaudio 兼容补丁已应用")


def _patch_fish_speech_generate(engine_dir: Path) -> None:
    """修复 MPS torch.isin dtype 不匹配问题。"""
    target1 = engine_dir / "tools" / "llama" / "generate.py"
    if target1.exists():
        text = target1.read_text(encoding="utf-8")
        patched = text.replace(
            "semantic_ids_tensor = torch.tensor(semantic_ids, device=codebooks.device)",
            "semantic_ids_tensor = torch.tensor(semantic_ids, device=codebooks.device, dtype=codebooks.dtype)",
        )
        if patched != text:
            target1.write_text(patched, encoding="utf-8")
            print("  ✓ generate.py MPS dtype 补丁已应用")

    target2 = engine_dir / "fish_speech" / "models" / "text2semantic" / "llama.py"
    if target2.exists():
        text = target2.read_text(encoding="utf-8")
        patched = text.replace(
            "self.semantic_token_ids, device=inp.device\n        )",
            "self.semantic_token_ids, device=inp.device, dtype=inp.dtype\n        )",
        )
        if patched != text:
            target2.write_text(patched, encoding="utf-8")
            print("  ✓ llama.py MPS dtype 补丁已应用")


def setup_fish_speech_engine(project_root: Path) -> bool:
    """克隆 fish-speech v1.5.0 并精简到推理所需文件。"""
    engine_dir = project_root / "runtime" / "engine" / "fish_speech"
    sentinel = engine_dir / "tools" / "inference_engine" / "__init__.py"

    if sentinel.exists():
        print(f"  ✓ fish_speech engine 已存在（{sentinel}）")
        return True

    print(f"  [fish_speech] 克隆 @ {_FISH_SPEECH_TAG} ...")
    tmp_dir = project_root / "runtime" / "engine" / "fish_speech_tmp"
    if tmp_dir.exists():
        shutil.rmtree(tmp_dir)

    r = subprocess.run(
        ["git", "clone", "--depth", "1", "--branch", _FISH_SPEECH_TAG,
         _FISH_SPEECH_REPO, str(tmp_dir)],
        capture_output=True, text=True,
    )
    if r.returncode != 0:
        print(f"  ✗ 克隆失败: {r.stderr.strip()[:300]}")
        return False

    engine_dir.mkdir(parents=True, exist_ok=True)

    for item in _FISH_SPEECH_KEEP:
        src = tmp_dir / item
        dst = engine_dir / item
        if src.is_dir():
            if dst.exists():
                shutil.rmtree(dst)
            shutil.copytree(src, dst)
        elif src.is_file():
            shutil.copy2(src, dst)

    for rel in _FISH_SPEECH_RM_DIRS:
        p = engine_dir / rel
        if p.exists():
            shutil.rmtree(p)

    utils_dir = engine_dir / "fish_speech" / "utils"
    for fname in ["braceexpand.py", "instantiators.py",
                  "logging_utils.py", "rich_utils.py"]:
        (utils_dir / fname).unlink(missing_ok=True)
    (utils_dir / "__init__.py").write_text(_FISH_SPEECH_UTILS_INIT, encoding="utf-8")
    (utils_dir / "logger.py").write_text(_FISH_SPEECH_LOGGER, encoding="utf-8")
    (utils_dir / "utils.py").write_text(_FISH_SPEECH_UTILS, encoding="utf-8")

    _patch_fish_speech_generate(engine_dir)
    _patch_fish_speech_reference_loader(engine_dir)

    shutil.rmtree(tmp_dir, ignore_errors=True)
    shutil.rmtree(engine_dir / ".git", ignore_errors=True)
    n = sum(1 for _ in engine_dir.rglob("*") if _.is_file())
    print(f"  ✓ fish_speech engine 就绪（{n} 个文件）")
    return True


# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# Seed-VC 引擎源码
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

_SEED_VC_REPO = "https://github.com/Plachtaa/seed-vc"
_SEED_VC_COMMIT = "51383efd921027683c89e5348211d93ff12ac2a8"

_SEED_VC_RM = [
    "modules/openvoice", "modules/astral_quantization", "modules/v2",
    "modules/bigvgan/alias_free_activation/cuda",
    "configs/v2", "configs/astral_quantization",
    "inference_v2.py", "seed_vc_wrapper.py",
]
_SEED_VC_KEEP = ["modules", "configs", "hf_utils.py", "inference.py"]


def _patch_seed_vc_inference(engine_dir: Path) -> None:
    """在 engine/inference.py 插入兼容性补丁。"""
    inf = engine_dir / "inference.py"
    if not inf.exists():
        return
    src = inf.read_text(encoding="utf-8")
    shim = (
        "\n# 兼容性修复：部分版本的 transformers 从 huggingface_hub 顶层导入 is_offline_mode，\n"
        "# 新版本 huggingface_hub (>=0.26) 已将其移除，在此补充以避免 ImportError。\n"
        "try:\n"
        "    import huggingface_hub as _hf_hub\n"
        "    if not hasattr(_hf_hub, 'is_offline_mode'):\n"
        "        _hf_hub.is_offline_mode = lambda: bool(int(os.environ.get('HF_HUB_OFFLINE', '0')))\n"
        "except Exception:\n"
        "    pass\n"
    )
    marker = "os.environ['HF_HUB_CACHE'] = './checkpoints/hf_cache'"
    if marker in src and shim.strip() not in src:
        src = src.replace(marker, marker + shim, 1)
        inf.write_text(src, encoding="utf-8")
        print("  ✓ seed_vc engine/inference.py 已补丁（is_offline_mode shim）")

    # bigvgan/_from_pretrained 兼容性修复
    bigvgan_file = engine_dir / "modules" / "bigvgan" / "bigvgan.py"
    if bigvgan_file.exists():
        bsrc = bigvgan_file.read_text(encoding="utf-8")
        if "proxies: Optional[Dict]," in bsrc or "resume_download: bool," in bsrc:
            bsrc = bsrc.replace("proxies: Optional[Dict],", "proxies: Optional[Dict] = None,")
            bsrc = bsrc.replace("resume_download: bool,", "resume_download: bool = False,")
            bigvgan_file.write_text(bsrc, encoding="utf-8")
            print("  ✓ seed_vc modules/bigvgan/bigvgan.py 已补丁（proxies/resume_download 可选化）")

    # MPS BigVGAN 修复
    inf_src = inf.read_text(encoding="utf-8")
    old_bigvgan_device = "        bigvgan_model = bigvgan_model.eval().to(device)\n        vocoder_fn = bigvgan_model"
    new_bigvgan_device = (
        "        # MPS 不支持 conv_transpose1d output_channels > 65536（BigVGAN 大通道数会触发此限制）\n"
        "        # 保持 BigVGAN 在 CPU 上运行；扩散推理仍在 MPS 上，只有 vocoder 在 CPU\n"
        "        bigvgan_device = torch.device(\"cpu\") if device.type == \"mps\" else device\n"
        "        bigvgan_model = bigvgan_model.eval().to(bigvgan_device)\n"
        "        vocoder_fn = bigvgan_model"
    )
    old_vocoder_call = "        vc_wave = vocoder_fn(vc_target.float()).squeeze()"
    new_vocoder_call = (
        "        _vocoder_device = next(vocoder_fn.parameters()).device\n"
        "        vc_wave = vocoder_fn(vc_target.float().to(_vocoder_device)).squeeze()"
    )
    changed = False
    if old_bigvgan_device in inf_src:
        inf_src = inf_src.replace(old_bigvgan_device, new_bigvgan_device)
        changed = True
    if old_vocoder_call in inf_src:
        inf_src = inf_src.replace(old_vocoder_call, new_vocoder_call)
        changed = True
    if changed:
        inf.write_text(inf_src, encoding="utf-8")
        print("  ✓ seed_vc engine/inference.py 已补丁（BigVGAN MPS CPU fallback）")


def setup_seed_vc_engine(project_root: Path) -> bool:
    """克隆 seed-vc 并精简到推理所需文件。"""
    engine_dir = project_root / "runtime" / "engine" / "seed_vc"
    sentinel = engine_dir / "inference.py"

    if sentinel.exists():
        print(f"  ✓ seed_vc engine 已存在（{sentinel}）")
        return True

    print(f"  [seed_vc] 获取 @ {_SEED_VC_COMMIT[:8]} ...")
    tmp_dir = project_root / "runtime" / "engine" / "seed_vc_tmp"
    if tmp_dir.exists():
        shutil.rmtree(tmp_dir)
    tmp_dir.mkdir(parents=True)

    for cmd in [
        ["git", "init", str(tmp_dir)],
        ["git", "-C", str(tmp_dir), "remote", "add", "origin", _SEED_VC_REPO],
        ["git", "-C", str(tmp_dir), "fetch", "--depth", "1", "origin", _SEED_VC_COMMIT],
        ["git", "-C", str(tmp_dir), "checkout", "FETCH_HEAD"],
    ]:
        r = subprocess.run(cmd, capture_output=True, text=True)
        if r.returncode != 0:
            print(f"  ✗ 失败（{' '.join(cmd[-2:])}）: {r.stderr.strip()[:300]}")
            shutil.rmtree(tmp_dir, ignore_errors=True)
            return False

    engine_dir.mkdir(parents=True, exist_ok=True)
    for item in _SEED_VC_KEEP:
        src = tmp_dir / item
        dst = engine_dir / item
        if src.is_dir():
            if dst.exists():
                shutil.rmtree(dst)
            shutil.copytree(src, dst)
        elif src.is_file():
            shutil.copy2(src, dst)

    for rel in _SEED_VC_RM:
        p = engine_dir / rel
        if p.is_dir():
            shutil.rmtree(p, ignore_errors=True)
        elif p.is_file():
            p.unlink(missing_ok=True)

    shutil.rmtree(tmp_dir, ignore_errors=True)
    shutil.rmtree(engine_dir / ".git", ignore_errors=True)
    _patch_seed_vc_inference(engine_dir)
    n = sum(1 for _ in engine_dir.rglob("*") if _.is_file())
    print(f"  ✓ seed_vc engine 就绪（{n} 个文件）")
    return True


# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# GPT-SoVITS 引擎源码
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

_GPT_SOVITS_REPO = "https://github.com/RVC-Boss/GPT-SoVITS"
_GPT_SOVITS_TAG = "20250606v2pro"  # main 禁止、必ず tag/commit を指定

# 只保留推理必须的目录/文件，其余全部丢弃
_GPT_SOVITS_KEEP = [
    "GPT_SoVITS",
    "tools",
    "inference_cli.py",
    "api.py",
    "api_v2.py",
    "config.py",
    "requirements.txt",
]

_GPT_SOVITS_RM = [
    "GPT_SoVITS/pretrained_models",
    "GPT_SoVITS/configs",
    "tools/asr",
    "tools/uvr5",
    "tools/slicer",
    ".github",
    "docs",
    "Dockerfile",
]


def setup_gpt_sovits_engine(project_root: Path) -> bool:
    """克隆 GPT-SoVITS 并精简到推理所需文件。"""
    engine_dir = project_root / "runtime" / "engine" / "gpt_sovits"
    sentinel = engine_dir / "GPT_SoVITS"

    if sentinel.exists():
        print(f"  ✓ gpt_sovits engine 已存在（{sentinel}）")
        return True

    print(f"  [gpt_sovits] 克隆 @ {_GPT_SOVITS_TAG} ...")
    tmp_dir = project_root / "runtime" / "engine" / "gpt_sovits_tmp"
    if tmp_dir.exists():
        shutil.rmtree(tmp_dir)

    r = subprocess.run(
        ["git", "clone", "--depth", "1", "--branch", _GPT_SOVITS_TAG,
         _GPT_SOVITS_REPO, str(tmp_dir)],
        capture_output=True, text=True,
    )
    if r.returncode != 0:
        print(f"  ✗ 克隆失败: {r.stderr.strip()[:300]}")
        shutil.rmtree(tmp_dir, ignore_errors=True)
        return False

    engine_dir.mkdir(parents=True, exist_ok=True)

    for item in _GPT_SOVITS_KEEP:
        src = tmp_dir / item
        dst = engine_dir / item
        if src.is_dir():
            if dst.exists():
                shutil.rmtree(dst)
            shutil.copytree(src, dst)
        elif src.is_file():
            shutil.copy2(src, dst)

    for rel in _GPT_SOVITS_RM:
        p = engine_dir / rel
        if p.is_dir():
            shutil.rmtree(p, ignore_errors=True)
        elif p.is_file():
            p.unlink(missing_ok=True)

    shutil.rmtree(tmp_dir, ignore_errors=True)
    shutil.rmtree(engine_dir / ".git", ignore_errors=True)
    n = sum(1 for _ in engine_dir.rglob("*") if _.is_file())
    print(f"  ✓ gpt_sovits engine 就绪（{n} 个文件）")
    return True


# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# FaceFusion 引擎源码
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

_FACEFUSION_REPO = "https://github.com/facefusion/facefusion"
_FACEFUSION_TAG = "3.5.4"
_FACEFUSION_KEEP = ["facefusion", "facefusion.py", "requirements.txt"]
_FACEFUSION_RM = [".github", "tests", "docs", "assets"]


def setup_facefusion_engine(project_root: Path) -> bool:
    """克隆 FaceFusion 并精简到推理所需文件。"""
    engine_dir = project_root / "runtime" / "engine" / "facefusion"
    sentinel = engine_dir / "facefusion.py"

    if sentinel.exists():
        print(f"  ✓ facefusion engine 已存在（{sentinel}）")
        return True

    print(f"  [facefusion] 克隆 @ {_FACEFUSION_TAG} ...")
    tmp_dir = project_root / "runtime" / "engine" / "facefusion_tmp"
    if tmp_dir.exists():
        shutil.rmtree(tmp_dir)

    r = subprocess.run(
        ["git", "clone", "--depth", "1", "--branch", _FACEFUSION_TAG,
         _FACEFUSION_REPO, str(tmp_dir)],
        capture_output=True, text=True,
    )
    if r.returncode != 0:
        print(f"  ✗ clone 失败: {r.stderr.strip()[:300]}")
        shutil.rmtree(tmp_dir, ignore_errors=True)
        return False

    engine_dir.mkdir(parents=True, exist_ok=True)
    for item in _FACEFUSION_KEEP:
        src = tmp_dir / item
        dst = engine_dir / item
        if src.is_dir():
            if dst.exists():
                shutil.rmtree(dst)
            shutil.copytree(src, dst)
        elif src.is_file():
            shutil.copy2(src, dst)

    for rel in _FACEFUSION_RM:
        p = engine_dir / rel
        if p.is_dir():
            shutil.rmtree(p, ignore_errors=True)
        elif p.is_file():
            p.unlink(missing_ok=True)

    shutil.rmtree(tmp_dir, ignore_errors=True)
    shutil.rmtree(engine_dir / ".git", ignore_errors=True)
    n = sum(1 for _ in engine_dir.rglob("*") if _.is_file())
    print(f"  ✓ facefusion engine 就绪（{n} 个文件）")
    return True


# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# LivePortrait 引擎源码
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

_LIVEPORTRAIT_REPO = "https://github.com/KlingAIResearch/LivePortrait"
_LIVEPORTRAIT_COMMIT = "49784e879821538ecda5c8e4ca0472f4cb6236cf"
_LIVEPORTRAIT_KEEP = ["liveportrait", "inference.py", "src", "configs"]
_LIVEPORTRAIT_RM = ["assets", "docs", "scripts", ".github"]


def setup_liveportrait_engine(project_root: Path) -> bool:
    """克隆 LivePortrait 并精简到推理所需文件。"""
    engine_dir = project_root / "runtime" / "engine" / "liveportrait"
    sentinel = engine_dir / "liveportrait" / "__init__.py"

    if sentinel.exists():
        print(f"  ✓ liveportrait engine 已存在（{sentinel}）")
        return True

    print(f"  [liveportrait] 克隆 @ {_LIVEPORTRAIT_COMMIT[:8]} ...")
    sys.stdout.flush()
    tmp_dir = project_root / "runtime" / "engine" / "liveportrait_tmp"
    if tmp_dir.exists():
        shutil.rmtree(tmp_dir)
    tmp_dir.mkdir(parents=True, exist_ok=True)

    cmds = [
        ["git", "-C", str(tmp_dir), "init"],
        ["git", "-C", str(tmp_dir), "remote", "add", "origin", _LIVEPORTRAIT_REPO],
        ["git", "-C", str(tmp_dir), "fetch", "--depth", "1", "origin", _LIVEPORTRAIT_COMMIT],
        ["git", "-C", str(tmp_dir), "checkout", "FETCH_HEAD"],
    ]
    for cmd in cmds:
        print(f"  $ {' '.join(cmd)}")
        sys.stdout.flush()
        r = subprocess.run(cmd, capture_output=False, text=True)
        if r.returncode != 0:
            print(f"  ✗ 命令失败（exit {r.returncode}）")
            shutil.rmtree(tmp_dir, ignore_errors=True)
            return False

    engine_dir.mkdir(parents=True, exist_ok=True)

    for item in _LIVEPORTRAIT_KEEP:
        src = tmp_dir / item
        dst = engine_dir / item
        if src.is_dir():
            if dst.exists():
                shutil.rmtree(dst)
            shutil.copytree(src, dst)
        elif src.is_file():
            shutil.copy2(src, dst)

    for rel in _LIVEPORTRAIT_RM:
        p = engine_dir / rel
        if p.is_dir():
            shutil.rmtree(p, ignore_errors=True)
        elif p.is_file():
            p.unlink(missing_ok=True)

    shutil.rmtree(tmp_dir, ignore_errors=True)
    shutil.rmtree(engine_dir / ".git", ignore_errors=True)
    n = sum(1 for _ in engine_dir.rglob("*") if _.is_file())
    print(f"  ✓ liveportrait engine 就绪（{n} 个文件）")
    return True


# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# Flux 引擎依赖
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

def setup_flux_engine(project_root: Path, packages: list[str], py: str) -> bool:
    """安装 Flux GGUF 推理依赖。"""
    print("  [flux] 安装 Flux GGUF 推理依赖")
    all_ok = True
    for pkg in packages:
        module_name = pkg.replace("-", "_").split("==")[0].split(">=")[0].split("[")[0]
        check = subprocess.run([py, "-c", f"import {module_name}"], capture_output=True)
        if check.returncode == 0:
            print(f"  ✓ {pkg}  (已安装)")
            continue
        print(f"  [pip] 安装 {pkg} ...")
        result = subprocess.run(
            [py, "-m", "pip", "install", pkg, *_pip_mirror_args(), "--quiet"],
            capture_output=True, text=True, timeout=600,
        )
        if result.returncode == 0:
            print(f"    ✓ 安装成功: {pkg}")
        else:
            print(f"    ✗ 安装失败: {result.stderr.strip()[:200]}")
            all_ok = False

    test_script = (
        "from diffusers import FluxTransformer2DModel\n"
        "try:\n"
        "    from diffusers.quantizers.gguf import GGUFQuantizationConfig\n"
        "    print('gguf_quant: ok')\n"
        "except ImportError:\n"
        "    print('gguf_quant: not available (diffusers may need upgrade)')\n"
    )
    check = subprocess.run([py, "-c", test_script], capture_output=True, text=True)
    if check.returncode == 0:
        print(f"  ✓ Flux diffusers GGUF 支持验证通过")
        print(f"    {check.stdout.strip()}")
    else:
        print(f"  ⚠ Flux 验证警告: {check.stderr.strip()[:200]}")
    return all_ok


# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# FFmpeg / Pandoc 下载
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

def download_ffmpeg(project_root: Path) -> bool:
    """下载 FFmpeg 静态二进制到 runtime/bin/{mac|win}/。"""
    system = platform.system()

    if system == "Darwin":
        bin_dir = project_root / "runtime" / "bin" / "mac"
        dest = bin_dir / "ffmpeg"
        url = "https://evermeet.cx/ffmpeg/getrelease/ffmpeg/zip"
    elif system == "Windows":
        bin_dir = project_root / "runtime" / "bin" / "win"
        dest = bin_dir / "ffmpeg.exe"
        url = "https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-win64-gpl.zip"
    else:
        print(f"  [ffmpeg] 不支持的平台: {system}，跳过")
        return True

    if dest.exists():
        size_mb = dest.stat().st_size / 1024 / 1024
        if size_mb < 10:
            print(f"  ✗ FFmpeg 文件异常（{size_mb:.1f} MB），重新下载")
            dest.unlink()
        else:
            print(f"  ✓ FFmpeg 已存在（{size_mb:.1f} MB）: {dest}")
            if system != "Windows":
                dest.chmod(0o755)
            return True

    print(f"  ✗ FFmpeg 未找到，下载中（~50-80 MB）...")
    bin_dir.mkdir(parents=True, exist_ok=True)
    tmp_archive = bin_dir / "_ffmpeg_tmp"

    try:
        urllib.request.urlretrieve(url, str(tmp_archive), _reporthook)
        if _IS_TTY:
            print()

        target_name = "ffmpeg.exe" if system == "Windows" else "ffmpeg"
        if url.endswith(".zip") or url.endswith("/zip"):
            def _extract_from_zip(zip_path: Path, out_path: Path) -> bool:
                with zipfile.ZipFile(zip_path, "r") as zf:
                    found = next(
                        (n for n in zf.namelist() if Path(n).name == target_name and not n.endswith("/")),
                        None,
                    )
                    if not found:
                        print(f"    ✗ 压缩包内未找到 {target_name}")
                        return False
                    with zf.open(found) as src_f, open(out_path, "wb") as dst_f:
                        dst_f.write(src_f.read())
                if zipfile.is_zipfile(out_path):
                    inner_zip = out_path.with_suffix("._inner.zip")
                    out_path.rename(inner_zip)
                    try:
                        if not _extract_from_zip(inner_zip, out_path):
                            return False
                    finally:
                        inner_zip.unlink(missing_ok=True)
                return True

            if not _extract_from_zip(tmp_archive, dest):
                return False
        else:
            with tarfile.open(tmp_archive) as tf:
                found_member = next(
                    (m for m in tf.getmembers() if Path(m.name).name == target_name and m.isfile()),
                    None,
                )
                if not found_member:
                    print("    ✗ 压缩包内未找到 ffmpeg")
                    return False
                f_obj = tf.extractfile(found_member)
                if f_obj:
                    with open(dest, "wb") as dst_f:
                        dst_f.write(f_obj.read())

        if not dest.exists() or dest.stat().st_size == 0:
            print("    ✗ 提取后文件缺失或为空")
            return False

        if system != "Windows":
            dest.chmod(0o755)

        print(f"    ✓ FFmpeg 下载完成（{dest.stat().st_size / 1024 / 1024:.1f} MB）")
        return True

    except Exception as e:
        print(f"    ✗ FFmpeg 下载失败: {e}")
        return False
    finally:
        if tmp_archive.exists():
            try:
                tmp_archive.unlink()
            except Exception:
                pass


def download_pandoc(project_root: Path) -> bool:
    """下载 pandoc 静态二进制到 runtime/bin/{mac|win}/。"""
    system = platform.system()
    machine = platform.machine().lower()
    version = "3.6.4"

    if system == "Darwin":
        bin_dir = project_root / "runtime" / "bin" / "mac"
        dest = bin_dir / "pandoc"
        arch = "arm64" if "arm" in machine or "aarch" in machine else "x86_64"
        url = f"https://github.com/jgm/pandoc/releases/download/{version}/pandoc-{version}-{arch}-macOS.zip"
        binary_in_zip = f"pandoc-{version}/bin/pandoc"
    elif system == "Windows":
        bin_dir = project_root / "runtime" / "bin" / "win"
        dest = bin_dir / "pandoc.exe"
        url = f"https://github.com/jgm/pandoc/releases/download/{version}/pandoc-{version}-windows-x86_64.zip"
        binary_in_zip = f"pandoc-{version}/pandoc.exe"
    else:
        print(f"  [pandoc] 不支持的平台: {system}，跳过")
        return True

    if dest.exists() and dest.stat().st_size > 1024 * 1024:
        print(f"  ✓ pandoc 已存在（{dest.stat().st_size / 1024 / 1024:.1f} MB）: {dest}")
        if system != "Windows":
            dest.chmod(0o755)
        return True

    print(f"  ✗ pandoc 未找到，下载中（~100-130 MB）...")
    bin_dir.mkdir(parents=True, exist_ok=True)
    tmp_archive = bin_dir / "_pandoc_tmp.zip"

    try:
        urllib.request.urlretrieve(url, str(tmp_archive), _reporthook)
        if _IS_TTY:
            print()
        with zipfile.ZipFile(tmp_archive, "r") as zf:
            if binary_in_zip not in zf.namelist():
                target_name = "pandoc.exe" if system == "Windows" else "pandoc"
                binary_in_zip = next(
                    (n for n in zf.namelist() if Path(n).name == target_name and not n.endswith("/")),
                    None,
                )
                if not binary_in_zip:
                    print("    ✗ 压缩包内未找到 pandoc 可执行文件")
                    return False
            with zf.open(binary_in_zip) as src_f, open(dest, "wb") as dst_f:
                dst_f.write(src_f.read())

        if not dest.exists() or dest.stat().st_size == 0:
            print("    ✗ 提取后文件缺失或为空")
            return False

        if system != "Windows":
            dest.chmod(0o755)

        print(f"    ✓ pandoc 下载完成（{dest.stat().st_size / 1024 / 1024:.1f} MB）")
        return True

    except Exception as e:
        print(f"    ✗ pandoc 下载失败: {e}")
        return False
    finally:
        if tmp_archive.exists():
            try:
                tmp_archive.unlink()
            except Exception:
                pass


# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# 引擎安装分发（统一入口）
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

def _install_engine(engine_name: str, engines: dict, py: str, project_root: Path) -> bool:
    """安装单个引擎的 pip_packages + 源码。返回是否成功。

    注意：大部分引擎的 pip_packages 已统一到 pyproject.toml，
    由 install_backend_deps() 通过 requirements.txt 安装。
    此处只处理 rvc-python 特殊安装流程。
    """
    cfg = engines.get(engine_name, {})
    packages: list[str] = cfg.get("pip_packages", [])
    ok = True

    # pip_packages — 只有 rvc 需要特殊流程（fairseq + --no-deps）
    if engine_name == "rvc":
        if not setup_rvc_engine(project_root):
            ok = False
    elif packages:
        # manifest 中仍有残留 pip_packages 的引擎（正常应为空）
        if not setup_pip_packages(engine_name, packages, py):
            ok = False

    # 引擎源码 setup
    engine_source_map = {
        "fish_speech": lambda: setup_fish_speech_engine(project_root),
        "gpt_sovits": lambda: setup_gpt_sovits_engine(project_root),
        "seed_vc": lambda: setup_seed_vc_engine(project_root),
        "facefusion": lambda: setup_facefusion_engine(project_root),
        "liveportrait": lambda: setup_liveportrait_engine(project_root),
    }
    source_fn = engine_source_map.get(engine_name)
    if source_fn and not source_fn():
        ok = False

    return ok


# ML 専用パッケージを嵌入式 Python から削除（ML target との競合防止）
_ML_ONLY_PACKAGES = {"numpy", "numpy.libs"}
# typing_extensions は pip 等が依存するため嵌入式から削除してはならない


def _cleanup_embedded_ml_packages(py: str) -> None:
    """嵌入式 Python の site-packages から ML 専用パッケージを削除。

    numpy と typing_extensions は backend 依赖の transitive dependency として
    嵌入式 Python に入るが、ML target（torch 等）が別バージョンを必要とする。
    嵌入式側を削除して PYTHONPATH で ML target のバージョンを優先させる。
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
        # dist-info もマッチ: numpy-2.2.6.dist-info → numpy
        import re as _re
        dist_match = _re.match(r"^([a-z0-9_]+?)[-_]\d", name_lower)
        pkg_name = dist_match.group(1) if dist_match else base
        if pkg_name in _ML_ONLY_PACKAGES or name_lower in _ML_ONLY_PACKAGES:
            try:
                if item.is_dir():
                    import shutil
                    shutil.rmtree(item)
                else:
                    item.unlink()
                removed.append(item.name)
            except Exception:
                pass
    if removed:
        print(f"  清理嵌入式 Python ML 冲突包: {', '.join(removed)}")


# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# 主流程
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

def main_full_setup(project_root: Path) -> int:
    """全量 setup：下载 Python + backend 依赖 + 全部引擎 + FFmpeg + pandoc。"""
    manifest_path = project_root / "backend" / "wrappers" / "manifest.json"
    if not manifest_path.exists():
        print(f"✗ 找不到 manifest.json: {manifest_path}")
        return 1

    manifest = json.loads(manifest_path.read_text(encoding="utf-8-sig"))
    engines: dict = manifest.get("engines", {})

    # 1. 确保嵌入式 Python
    print("\n=== 1/5 嵌入式 Python ===")
    py = ensure_embedded_python(project_root)
    print(f"嵌入式 Python: {py}")

    all_ok = True

    # 2. 安装 backend 依赖
    print("\n=== 2/5 安装 backend 依赖 ===")
    if not install_backend_deps(project_root, py):
        all_ok = False

    # numpy / typing_extensions は backend 依赖の transitive dependency として
    # 嵌入式 Python の site-packages にインストールされるが、ML target（torch 等）は
    # 独自バージョンを必要とする。嵌入式側を削除して ML target のバージョンを優先させる。
    # （numpy: torch は 2.x の C API 向けコンパイル、1.x だと segfault）
    # （typing_extensions: torch は 4.x の新機能を使用）
    _cleanup_embedded_ml_packages(py)

    # 3. 安装基础引擎（rvc-python 特殊流程 + 源码 clone）
    print("\n=== 3/5 安装基础引擎 ===")
    for engine_name in sorted(BASE_ENGINES):
        print(f"\n▶ {engine_name}")
        if not _install_engine(engine_name, engines, py, project_root):
            all_ok = False

    # 4. 安装额外引擎（源码 clone）
    # 注意：pip_packages 已统一到 pyproject.toml，此处只处理源码 clone
    print("\n=== 4/5 安装额外引擎 ===")
    # 需要源码 clone 的额外引擎
    _EXTRA_ENGINES_WITH_SOURCE = {"liveportrait"}
    for engine_name in sorted(EXTRA_ENGINES):
        cfg = engines.get(engine_name, {})
        packages = cfg.get("pip_packages", [])
        # 跳过无 pip_packages 且无源码的引擎
        if not packages and engine_name not in _EXTRA_ENGINES_WITH_SOURCE:
            continue
        print(f"\n▶ {engine_name}")
        if not _install_engine(engine_name, engines, py, project_root):
            all_ok = False

    # 5. FFmpeg + pandoc
    print("\n=== 5/5 下载工具 ===")
    print("\n▶ ffmpeg")
    if not download_ffmpeg(project_root):
        all_ok = False
    print("\n▶ pandoc")
    if not download_pandoc(project_root):
        all_ok = False

    print()
    if all_ok:
        print("✓ 环境初始化完成")
        return 0
    else:
        print("✗ 部分步骤失败，请检查上方日志")
        return 1


def main_single_engine(engine: str, project_root: Path) -> int:
    """只安装指定引擎（pip_packages + 源码），供 main.js app:downloadEngine 调用。"""
    manifest_path = project_root / "backend" / "wrappers" / "manifest.json"
    if not manifest_path.exists():
        print(f"✗ 找不到 manifest.json")
        return 1

    manifest = json.loads(manifest_path.read_text(encoding="utf-8-sig"))
    engines: dict = manifest.get("engines", {})

    py = get_embedded_python(project_root)
    if not py:
        print("✗ 嵌入式 Python 未找到")
        return 1

    print(f"▶ setup engine: {engine}")
    ok = _install_engine(engine, engines, py, project_root)
    return 0 if ok else 1


def main_engines_only(project_root: Path) -> int:
    """仅 clone 引擎源码（Docker 构建用）。

    pip 依赖由 Dockerfile 单独安装，此处只执行引擎源码 clone + patch。
    """
    manifest_path = project_root / "backend" / "wrappers" / "manifest.json"
    if not manifest_path.exists():
        print(f"✗ 找不到 manifest.json: {manifest_path}")
        return 1

    manifest = json.loads(manifest_path.read_text(encoding="utf-8-sig"))
    engines: dict = manifest.get("engines", {})

    engine_source_map = {
        "fish_speech": lambda: setup_fish_speech_engine(project_root),
        "gpt_sovits": lambda: setup_gpt_sovits_engine(project_root),
        "seed_vc": lambda: setup_seed_vc_engine(project_root),
        "facefusion": lambda: setup_facefusion_engine(project_root),
        "liveportrait": lambda: setup_liveportrait_engine(project_root),
    }

    all_ok = True
    for name, fn in engine_source_map.items():
        print(f"\n▶ {name} (clone)")
        if not fn():
            all_ok = False

    if all_ok:
        print("\n✓ 引擎源码 clone 完成")
    else:
        print("\n✗ 部分引擎 clone 失败")
    return 0 if all_ok else 1


def main() -> int:
    parser = argparse.ArgumentParser(description="环境初始化（嵌入式 Python + backend + 全部引擎）")
    parser.add_argument("--engine", default="", help="只安装指定引擎（供 UI 按需调用）")
    parser.add_argument("--engines-only", action="store_true",
                        help="仅 clone 引擎源码，跳过 Python 下载和 pip 安装（Docker 构建用）")
    parser.add_argument("--pypi-mirror", default="", help="PyPI 镜像源（如 https://pypi.tuna.tsinghua.edu.cn/simple）")
    args = parser.parse_args()

    if args.pypi_mirror:
        global PYPI_MIRROR
        PYPI_MIRROR = args.pypi_mirror

    project_root = Path(__file__).resolve().parent.parent

    if args.engines_only:
        return main_engines_only(project_root)
    if args.engine:
        return main_single_engine(args.engine, project_root)
    return main_full_setup(project_root)


if __name__ == "__main__":
    sys.exit(main())
