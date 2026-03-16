#!/usr/bin/env python3
"""
安装各引擎 pip 依赖 + FFmpeg 静态二进制。
由 setup-runtime.js 在 pnpm run setup 阶段调用，与模型下载完全分离。

用法：
    # 构建期（CI/setup）：安装 pip_packages + FFmpeg
    python scripts/setup-engines.py

    # 首次启动：安装 runtime_pip_packages 到 userData，输出 JSON Lines 给 Electron
    python scripts/setup-engines.py --runtime --target /path/to/userData/python-packages \
        [--pypi-mirror https://pypi.tuna.tsinghua.edu.cn/simple] --json-progress
"""

from __future__ import annotations

import argparse
import json
import os
import platform
import re
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


def get_embedded_python(project_root: Path) -> str:
    """返回嵌入式 Python 可执行路径，找不到返回空串。"""
    if platform.system() == "Windows":
        p = project_root / "runtime" / "win" / "python" / "python.exe"
    else:
        p = project_root / "runtime" / "mac" / "python" / "bin" / "python3"
    return str(p) if p.exists() else ""


# ─── JSON Lines 输出（给 Electron IPC 用）────────────────────────────────────

def _emit(obj: dict, json_progress: bool) -> None:
    if json_progress:
        print(json.dumps(obj, ensure_ascii=False), flush=True)
    else:
        t = obj.get("type")
        if t == "log":
            print(obj.get("message", ""), flush=True)
        elif t == "phase":
            print(f"\n=== {obj.get('label', '')} ===", flush=True)


# ─── 包去重（合并多引擎列表，保留带版本号的规格）────────────────────────────

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


# ─── 构建期 pip 安装（安装到嵌入式 Python）────────────────────────────────────

def setup_pip_packages(engine_name: str, packages: list[str], py: str) -> bool:
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
            [py, "-m", "pip", "install", pkg, "--quiet"],
            capture_output=True, text=True, timeout=600,
        )
        if result.returncode == 0:
            print(f"    ✓ 安装成功: {pkg}")
        else:
            print(f"    ✗ 安装失败: {result.stderr.strip()[:200]}")
            all_ok = False
    return all_ok


# ─── 运行时 pip 安装（安装到 userData/python-packages/）──────────────────────

def install_to_target(
    packages: list[str],
    py: str,
    target: str,
    mirror: str,
    json_progress: bool,
) -> bool:
    """将包安装到指定目录（--target），逐包输出进度。"""
    Path(target).mkdir(parents=True, exist_ok=True)
    all_ok = True
    env = {**__import__('os').environ, "PYTHONPATH": target}
    for pkg in packages:
        module_name = pkg.replace("-", "_").split("==")[0].split(">=")[0].split("[")[0]
        check = subprocess.run([py, "-c", f"import {module_name}"], capture_output=True, env=env)
        if check.returncode == 0:
            _emit({"type": "log", "message": f"  ✓ {pkg}  (已安装)"}, json_progress)
            continue
        _emit({"type": "log", "message": f"  安装 {pkg}…"}, json_progress)
        cmd = [py, "-m", "pip", "install", "--target", target, "--upgrade", pkg, "--quiet"]
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


# ─── Flux 专项安装（需根据平台选择 diffusers GGUF 依赖）───────────────────────

def setup_flux_engine(project_root: Path, packages: list[str], py: str) -> bool:
    """安装 Flux GGUF 推理依赖。
    diffusers >= 0.32 原生支持 GGUF 量化，仅需安装 gguf + diffusers。
    Mac MPS 和 CUDA 均通过相同的 pip 依赖支持。
    """
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
            [py, "-m", "pip", "install", pkg, "--quiet"],
            capture_output=True, text=True, timeout=600,
        )
        if result.returncode == 0:
            print(f"    ✓ 安装成功: {pkg}")
        else:
            print(f"    ✗ 安装失败: {result.stderr.strip()[:200]}")
            all_ok = False

    # 验证 GGUF 加载能力
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
        # 非致命错误，不影响 all_ok
    return all_ok


# ─── RVC 专项安装 ─────────────────────────────────────────────────────────────

def _patch_fairseq_for_py312(py: str) -> None:
    """修补 fairseq 以兼容 Python 3.12 + 新版 omegaconf。"""
    result = subprocess.run(
        [py, "-c", "import fairseq; import os; print(os.path.dirname(fairseq.__file__))"],
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
            block = "\n".join(bulk_imports)
            loop = (
                "for _m in "
                + repr([b.replace("import ", "").replace("  # noqa", "").strip() for b in bulk_imports])
                + ":\n"
                "    try:\n"
                "        import importlib as _il; _il.import_module(_m)\n"
                "    except Exception:\n"
                "        pass\n"
            )
            text = text.replace(block, loop)
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
    """Windows 专用：下载 fairseq 0.12.2 源码，注入 monkey-patch 禁用所有 C 扩展后安装。

    嵌入式 Python 不含 Python.h 头文件，无法编译 Cython/C 扩展。
    RVC 推理只用到 fairseq 的纯 Python 部分（checkpoint_utils、hubert 模型类）。
    策略：
      1. 在 setup.py 顶部注入代码，覆盖 setuptools.setup 使其忽略 ext_modules
      2. 提供 no-op cythonize 和假 numpy（避免 import 失败中断 setup.py 解析）
      3. 移除 setup.py 中 Cython 导入行，防止在无 Cython 环境中 ImportError
      4. --no-build-isolation：跳过 pip 隔离环境，不让 pip 单独安装 Cython 后再触发编译
    """
    _FAIRSEQ_SDIST = (
        "https://files.pythonhosted.org/packages/source/f/fairseq/fairseq-0.12.2.tar.gz"
    )

    # 注入到 setup.py 文件顶部的 monkey-patch
    _INJECT = """\
# === 以下由安装器注入：强制纯 Python 安装（禁用所有 C/Cython 扩展）===
import setuptools as _st_inject
_orig_st_setup = _st_inject.setup
def _no_ext_setup(**kw):
    kw.pop('ext_modules', None)
    return _orig_st_setup(**kw)
_st_inject.setup = _no_ext_setup
# no-op cythonize（替代 from Cython.Build import cythonize）
def cythonize(*_a, **_kw): return []
# no-op Extension（若 setup.py 在 from setuptools import 之前引用了 Extension）
class Extension:
    def __init__(self, *_a, **_kw): pass
# 假 numpy：避免 setup.py 顶层 import numpy 失败（只需 get_include 返回空串即可）
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
            # 移除原有 Cython 导入行（防止在无 Cython 的主环境中 ImportError 中断执行）
            patched = re.sub(r"^(from|import)\s+Cython[^\n]*\n", "", original, flags=re.MULTILINE)
            # 在文件顶部注入 monkey-patch
            setup_py.write_text(_INJECT + patched, encoding="utf-8")
            print("    ✓ setup.py 已注入 no-ext monkey-patch")

        # --no-build-isolation：不让 pip 创建隔离环境去安装 Cython，避免重新触发 C 编译
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
            [py, "-m", "pip", "install", *args, "--quiet"],
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
    print("  [pip] 安装 rvc-python (--no-deps) ...")
    if not pip("rvc-python", "--no-deps"):
        return False
    return True


def setup_rvc_engine(project_root: Path) -> bool:
    """安装 rvc-python 并生成推理脚本 runtime/rvc/engine/infer.py。"""
    engine_dir = project_root / "runtime" / "rvc" / "engine"
    infer_script = engine_dir / "infer.py"

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

    if infer_script.exists():
        print(f"  ✓ runtime/rvc/engine/infer.py  (已存在)")
    else:
        print(f"  ✗ runtime/rvc/engine/infer.py  (缺失，生成中…)")
        engine_dir.mkdir(parents=True, exist_ok=True)
        infer_script.write_text(
            '''#!/usr/bin/env python3
"""RVC 推理脚本（使用 rvc-python 库）
由 setup-engines.py 自动生成，请勿手动修改。
"""
import argparse
import os
import sys
from pathlib import Path

if not os.environ.get("PYTORCH_ENABLE_MPS_FALLBACK"):
    os.environ["PYTORCH_ENABLE_MPS_FALLBACK"] = "1"

# PyTorch 2.6 将 torch.load 的 weights_only 默认值从 False 改为 True，
# 导致 fairseq 内部调用 torch.load 时无法加载含自定义类（如 Dictionary）的 checkpoint。
import torch as _torch
_orig_torch_load = _torch.load
def _patched_torch_load(f, map_location=None, pickle_module=None, *, weights_only=False, mmap=None, **kwargs):
    return _orig_torch_load(f, map_location=map_location, pickle_module=pickle_module,
                            weights_only=weights_only, mmap=mmap, **kwargs)
_torch.load = _patched_torch_load

# macOS ARM：rvc-python 内部检测设备时忽略 device="cpu" 参数，强制使用 MPS；
# 而 HuBERT conv1d 的输出通道数超过 MPS 上限（>65536），导致 NotImplementedError。
# 在 rvc_python 加载 configs 之前 patch 掉 MPS 可用性，强制走 CPU 推理。
if _torch.backends.mps.is_available():
    _torch.backends.mps.is_available = lambda: False


def detect_version(model_path: str) -> str:
    try:
        import torch
        cpt = torch.load(model_path, map_location="cpu", weights_only=False)
        version = cpt.get("version", "")
        if version in ("v1", "v2"):
            return version
        emb = cpt.get("weight", {}).get("enc_p.emb_phone.weight")
        if emb is not None:
            return "v2" if emb.shape[1] == 768 else "v1"
    except Exception:
        pass
    return "v2"


def main() -> int:
    parser = argparse.ArgumentParser(description="RVC 语音转换")
    parser.add_argument("--input",  required=True, help="输入音频路径")
    parser.add_argument("--output", required=True, help="输出音频路径")
    parser.add_argument("--model",  required=True, help="模型 .pth 路径")
    parser.add_argument("--index",  default="",    help="索引文件路径（可选）")
    args = parser.parse_args()

    try:
        from rvc_python.infer import RVCInference
    except ImportError:
        print("[rvc] 缺少 rvc-python 包，请重新运行 pnpm run setup。", file=sys.stderr)
        return 1

    index_path = str(Path(args.index).resolve()) if args.index else ""
    import platform
    if index_path and sys.platform == "darwin" and platform.machine() == "arm64":
        print(f"[rvc] macOS ARM 跳过 index 文件（faiss-cpu SIGSEGV 规避）: {index_path}", file=sys.stderr)
        index_path = ""

    version = detect_version(args.model)
    try:
        rvc = RVCInference(device="cpu")
        rvc.load_model(args.model, version=version, index_path=index_path)
        rvc.infer_file(str(Path(args.input).resolve()),
                       str(Path(args.output).resolve()))
    except Exception as e:
        print(f"[rvc] 推理失败: {e}", file=sys.stderr)
        return 1

    if not Path(args.output).exists() or Path(args.output).stat().st_size == 0:
        print("[rvc] 输出文件缺失或为空", file=sys.stderr)
        return 1

    print(f"[rvc] ok -> {args.output}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
''',
            encoding="utf-8",
        )
        print(f"    ✓ 已创建 runtime/rvc/engine/infer.py")

    return rvc_ok


# ─── Fish Speech engine 源码 ─────────────────────────────────────────────────

_FISH_SPEECH_TAG = "v1.5.0"
_FISH_SPEECH_REPO = "https://github.com/fishaudio/fish-speech"

# clone 后需删除的目录（训练/服务/数据，推理不需要）
_FISH_SPEECH_RM_DIRS = [
    "tools/server", "tools/webui", "tools/sensevoice",
    "fish_speech/datasets", "fish_speech/callbacks",
    "fish_speech/models/dac",
]
# 只保留这些顶层目录/文件
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


def setup_fish_speech_engine(project_root: Path) -> bool:
    """克隆 fish-speech v1.5.0 并精简到推理所需文件。"""
    import shutil

    engine_dir = project_root / "runtime" / "fish_speech" / "engine"
    sentinel = engine_dir / "tools" / "inference_engine" / "__init__.py"

    if sentinel.exists():
        print(f"  ✓ fish_speech engine 已存在（{sentinel}）")
        return True

    print(f"  [fish_speech] 克隆 {_FISH_SPEECH_REPO} @ {_FISH_SPEECH_TAG} ...")
    tmp_dir = project_root / "runtime" / "fish_speech" / "_engine_tmp"
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

    # 只复制推理需要的顶层条目
    for item in _FISH_SPEECH_KEEP:
        src = tmp_dir / item
        dst = engine_dir / item
        if src.is_dir():
            if dst.exists():
                shutil.rmtree(dst)
            shutil.copytree(src, dst)
        elif src.is_file():
            shutil.copy2(src, dst)

    # 删除训练专用目录
    for rel in _FISH_SPEECH_RM_DIRS:
        p = engine_dir / rel
        if p.exists():
            shutil.rmtree(p)

    # 删除训练专用 utils 文件，替换为推理精简版
    utils_dir = engine_dir / "fish_speech" / "utils"
    # spectrogram.py 保留：vqgan/inference.py 通过 hydra 实例化 LogMelSpectrogram
    # file.py (utils/file.py) 保留检查：tools/file.py 是单独文件，utils/file.py 训练专用可删
    for fname in ["braceexpand.py", "instantiators.py",
                  "logging_utils.py", "rich_utils.py"]:
        (utils_dir / fname).unlink(missing_ok=True)
    (utils_dir / "__init__.py").write_text(_FISH_SPEECH_UTILS_INIT, encoding="utf-8")
    (utils_dir / "logger.py").write_text(_FISH_SPEECH_LOGGER, encoding="utf-8")
    (utils_dir / "utils.py").write_text(_FISH_SPEECH_UTILS, encoding="utf-8")

    # MPS 兼容补丁：torch.isin 要求两个张量 dtype 相同
    # codebooks 是 torch.int，但 semantic_ids_tensor 默认创建为 int64，在 MPS 上触发错误
    _patch_fish_speech_generate(engine_dir)

    shutil.rmtree(tmp_dir, ignore_errors=True)
    n = sum(1 for _ in engine_dir.rglob("*") if _.is_file())
    print(f"  ✓ fish_speech engine 就绪（{n} 个文件）")
    return True


def _patch_fish_speech_generate(engine_dir: Path) -> None:
    """修复 MPS torch.isin dtype 不匹配问题（需要两个张量 dtype 一致）。"""
    # 1) tools/llama/generate.py — decode_one_token_ar_agent / decode_one_token_naive_agent
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

    # 2) fish_speech/models/text2semantic/llama.py — embed() 中 semantic_token_ids_tensor
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


# ─── LivePortrait engine 源码 ────────────────────────────────────────────────

_LIVEPORTRAIT_REPO = "https://github.com/KlingAIResearch/LivePortrait"
# 固定到已验证 commit（2026-03-02，docs: update star-history links）
_LIVEPORTRAIT_COMMIT = "49784e879821538ecda5c8e4ca0472f4cb6236cf"

# 只复制推理所需的顶层条目
_LIVEPORTRAIT_KEEP = ["liveportrait", "inference.py", "src", "configs"]
# 克隆后删除不需要的目录
_LIVEPORTRAIT_RM = ["assets", "docs", "scripts", ".github"]


def setup_liveportrait_engine(project_root: Path) -> bool:
    """克隆 LivePortrait 并精简到推理所需文件。"""
    import shutil

    engine_dir = project_root / "runtime" / "liveportrait" / "engine"
    sentinel = engine_dir / "liveportrait" / "__init__.py"

    if sentinel.exists():
        print(f"  ✓ liveportrait engine 已存在（{sentinel}）")
        return True

    print(f"  [liveportrait] 克隆 {_LIVEPORTRAIT_REPO} @ {_LIVEPORTRAIT_COMMIT[:8]} ...")
    sys.stdout.flush()
    tmp_dir = project_root / "runtime" / "liveportrait" / "_engine_tmp"
    if tmp_dir.exists():
        shutil.rmtree(tmp_dir)
    tmp_dir.mkdir(parents=True, exist_ok=True)

    # init+fetch 固定到指定 commit（GitHub 不支持 clone --depth 1 <sha>）
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
    n = sum(1 for _ in engine_dir.rglob("*") if _.is_file())
    print(f"  ✓ liveportrait engine 就绪（{n} 个文件）")
    return True


# ─── Seed-VC engine 源码 ──────────────────────────────────────────────────────

# 无 tag，固定到已验证的 commit SHA（无法用 --branch，改用 init+fetch）
_SEED_VC_REPO = "https://github.com/Plachtaa/seed-vc"
_SEED_VC_COMMIT = "51383efd921027683c89e5348211d93ff12ac2a8"

# clone 后删除的目录/文件（v2 API、openvoice后处理、astral量化、CUDA C++源码）
_SEED_VC_RM = [
    "modules/openvoice",
    "modules/astral_quantization",
    "modules/v2",
    "modules/bigvgan/alias_free_activation/cuda",
    # encodec.py 保留：wavenet.py → encodec.SConv1d
    "configs/v2",
    "configs/astral_quantization",
    "inference_v2.py",
    "seed_vc_wrapper.py",
]
# 只复制这些顶层条目
_SEED_VC_KEEP = ["modules", "configs", "hf_utils.py", "inference.py"]


def setup_seed_vc_engine(project_root: Path) -> bool:
    """克隆 seed-vc 并精简到推理所需文件。"""
    import shutil

    engine_dir = project_root / "runtime" / "seed_vc" / "engine"
    sentinel = engine_dir / "inference.py"

    if sentinel.exists():
        print(f"  ✓ seed_vc engine 已存在（{sentinel}）")
        return True

    print(f"  [seed_vc] 获取 {_SEED_VC_REPO} @ {_SEED_VC_COMMIT[:8]} ...")
    tmp_dir = project_root / "runtime" / "seed_vc" / "_engine_tmp"
    if tmp_dir.exists():
        shutil.rmtree(tmp_dir)
    tmp_dir.mkdir(parents=True)

    # seed-vc 无 tag，用 init + fetch 固定到指定 commit（浅克隆）
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
    _patch_seed_vc_inference(engine_dir)
    n = sum(1 for _ in engine_dir.rglob("*") if _.is_file())
    print(f"  ✓ seed_vc engine 就绪（{n} 个文件）")
    return True


def _patch_seed_vc_inference(engine_dir: Path) -> None:
    """在 engine/inference.py 开头插入兼容性补丁：
    - is_offline_mode shim：部分 transformers 版本从 huggingface_hub 顶层导入
      is_offline_mode，新版 huggingface_hub (>=0.26) 已移除该导出。
    """
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

    # bigvgan/_from_pretrained 兼容性修复：
    # huggingface_hub>=1.3.0 的 ModelHubMixin.from_pretrained 不再向 _from_pretrained
    # 传递 proxies/resume_download，需将这两个参数改为可选。
    bigvgan_file = engine_dir / "modules" / "bigvgan" / "bigvgan.py"
    if bigvgan_file.exists():
        bsrc = bigvgan_file.read_text(encoding="utf-8")
        if "proxies: Optional[Dict]," in bsrc or "resume_download: bool," in bsrc:
            bsrc = bsrc.replace("proxies: Optional[Dict],", "proxies: Optional[Dict] = None,")
            bsrc = bsrc.replace("resume_download: bool,", "resume_download: bool = False,")
            bigvgan_file.write_text(bsrc, encoding="utf-8")
            print("  ✓ seed_vc modules/bigvgan/bigvgan.py 已补丁（proxies/resume_download 可选化）")

    # MPS BigVGAN 修复：conv_transpose1d 在通道数较大时触发 "Output channels > 65536" 错误，
    # PYTORCH_ENABLE_MPS_FALLBACK=1 对此 op 无效。改为将 BigVGAN 保持在 CPU 上运行。
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


# ─── FFmpeg ───────────────────────────────────────────────────────────────────

def download_ffmpeg(project_root: Path) -> bool:
    """下载 FFmpeg 静态二进制到 runtime/{mac|win}/bin/。"""
    system = platform.system()

    if system == "Darwin":
        bin_dir = project_root / "runtime" / "mac" / "bin"
        dest = bin_dir / "ffmpeg"
        url = "https://evermeet.cx/ffmpeg/getrelease/ffmpeg/zip"
    elif system == "Windows":
        bin_dir = project_root / "runtime" / "win" / "bin"
        dest = bin_dir / "ffmpeg.exe"
        url = "https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-win64-gpl.zip"
    else:
        print(f"  [ffmpeg] 不支持的平台: {system}，跳过")
        return True

    if dest.exists():
        size_mb = dest.stat().st_size / 1024 / 1024
        # 小于 10 MB 说明之前只保存了 zip 壳而非真实二进制，需要重新下载
        if size_mb < 10:
            print(f"  ✗ FFmpeg 文件异常（{size_mb:.1f} MB），重新下载")
            dest.unlink()
        else:
            print(f"  ✓ FFmpeg 已存在（{size_mb:.1f} MB）: {dest}")
            if system != "Windows":
                dest.chmod(0o755)
            return True

    print(f"  ✗ FFmpeg 未找到，下载中（~50-80 MB）: {url}")
    bin_dir.mkdir(parents=True, exist_ok=True)
    tmp_archive = bin_dir / "_ffmpeg_tmp"

    _is_tty = sys.stdout.isatty()
    _last_pct: list[int] = [-1]

    def _reporthook(count: int, block_size: int, total_size: int) -> None:
        if total_size > 0:
            mb = count * block_size / 1024 / 1024
            pct = min(100, int(count * block_size * 100 / total_size))
            if _is_tty:
                print(f"\r  {pct}% ({mb:.1f} MB)", end="", flush=True)
            elif pct // 10 != _last_pct[0]:
                _last_pct[0] = pct // 10
                print(f"  {pct}% ({mb:.1f} MB)", flush=True)

    try:
        urllib.request.urlretrieve(url, str(tmp_archive), _reporthook)
        print()

        target_name = "ffmpeg.exe" if system == "Windows" else "ffmpeg"
        if url.endswith(".zip") or url.endswith("/zip"):
            def _extract_from_zip(zip_path: Path, out_path: Path) -> bool:
                """从 zip 中提取 target_name，若提取结果仍是 zip 则再解一层（evermeet.cx 双层 zip）。"""
                with zipfile.ZipFile(zip_path, "r") as zf:
                    found = next(
                        (n for n in zf.namelist() if Path(n).name == target_name and not n.endswith("/")),
                        None,
                    )
                    if not found:
                        print(f"    ✗ 压缩包内未找到 {target_name}")
                        return False
                    with zf.open(found) as src, open(out_path, "wb") as dst:
                        dst.write(src.read())
                # 若提取结果仍是 zip（evermeet.cx 套娃），再解一层
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
                    with open(dest, "wb") as dst:
                        dst.write(f_obj.read())

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
    """下载 pandoc 静态二进制到 runtime/{mac|win}/bin/。"""
    system = platform.system()
    machine = platform.machine().lower()
    version = "3.6.4"

    if system == "Darwin":
        bin_dir = project_root / "runtime" / "mac" / "bin"
        dest = bin_dir / "pandoc"
        arch = "arm64" if "arm" in machine or "aarch" in machine else "x86_64"
        url = f"https://github.com/jgm/pandoc/releases/download/{version}/pandoc-{version}-{arch}-macOS.zip"
        binary_in_zip = f"pandoc-{version}/bin/pandoc"
    elif system == "Windows":
        bin_dir = project_root / "runtime" / "win" / "bin"
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

    print(f"  ✗ pandoc 未找到，下载中（~100-130 MB）: {url}")
    bin_dir.mkdir(parents=True, exist_ok=True)
    tmp_archive = bin_dir / "_pandoc_tmp.zip"

    _is_tty = sys.stdout.isatty()
    _last_pct: list[int] = [-1]

    def _reporthook(count: int, block_size: int, total_size: int) -> None:
        if total_size > 0:
            mb = count * block_size / 1024 / 1024
            pct = min(100, int(count * block_size * 100 / total_size))
            if _is_tty:
                print(f"\r  {pct}% ({mb:.1f} MB)", end="", flush=True)
            elif pct // 10 != _last_pct[0]:
                _last_pct[0] = pct // 10
                print(f"  {pct}% ({mb:.1f} MB)", flush=True)

    try:
        urllib.request.urlretrieve(url, str(tmp_archive), _reporthook)
        print()
        with zipfile.ZipFile(tmp_archive, "r") as zf:
            if binary_in_zip not in zf.namelist():
                # 回退：按名称搜索
                target_name = "pandoc.exe" if system == "Windows" else "pandoc"
                binary_in_zip = next(
                    (n for n in zf.namelist() if Path(n).name == target_name and not n.endswith("/")),
                    None,
                )
                if not binary_in_zip:
                    print("    ✗ 压缩包内未找到 pandoc 可执行文件")
                    return False
            with zf.open(binary_in_zip) as src, open(dest, "wb") as dst:
                dst.write(src.read())

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


# ─── 主流程：构建期 ───────────────────────────────────────────────────────────

def main_build() -> int:
    project_root = Path(__file__).resolve().parent.parent
    manifest_path = project_root / "runtime" / "manifest.json"
    if not manifest_path.exists():
        print(f"✗ 找不到 manifest.json: {manifest_path}")
        return 1

    manifest = json.loads(manifest_path.read_text(encoding="utf-8-sig"))
    engines: dict = manifest.get("engines", {})

    py = get_embedded_python(project_root)
    if not py:
        print("✗ 嵌入式 Python 未找到，请先准备 runtime/mac/python 或 runtime/win/python")
        return 1

    print(f"=== 安装引擎依赖（构建期）===")
    print(f"嵌入式 Python: {py}\n")

    all_ok = True
    for engine_name, cfg in engines.items():
        packages: list[str] = cfg.get("pip_packages", [])
        if not packages:
            continue
        if engine_name == "flux":
            # Flux (~30 GB, 需 HF 账号) 已被 SD-Turbo 替代，默认跳过 pip 安装。
            # 如需启用，手动运行 pnpm run checkpoints --engine flux
            print(f"▶ {engine_name}  [已禁用，使用 SD-Turbo 替代]")
            print()
            continue
        print(f"▶ {engine_name}")
        if engine_name == "rvc":
            ok = setup_rvc_engine(project_root)
        else:
            ok = setup_pip_packages(engine_name, packages, py)
        if not ok:
            all_ok = False
        print()

    print("▶ fish_speech engine")
    if not setup_fish_speech_engine(project_root):
        all_ok = False
    print()

    print("▶ seed_vc engine")
    if not setup_seed_vc_engine(project_root):
        all_ok = False
    print()

    print("▶ liveportrait engine")
    if not setup_liveportrait_engine(project_root):
        all_ok = False
    print()

    print("▶ ffmpeg")
    if not download_ffmpeg(project_root):
        all_ok = False
    print()

    print("▶ pandoc")
    if not download_pandoc(project_root):
        all_ok = False
    print()

    if all_ok:
        print("✓ 引擎依赖安装完成")
        return 0
    else:
        print("✗ 部分依赖安装失败，请检查上方日志")
        return 1


# ─── 主流程：首次启动（安装 runtime_pip_packages 到 userData）─────────────────

def main_runtime(args: argparse.Namespace) -> int:
    json_progress = args.json_progress
    target = args.target
    mirror = args.pypi_mirror or ""

    if not target:
        _emit({"type": "log", "message": "✗ --runtime 模式必须指定 --target 目录"}, json_progress)
        return 1

    project_root = Path(__file__).resolve().parent.parent
    resources_root_env = os.getenv("RESOURCES_ROOT", "")
    resources_root = Path(resources_root_env).resolve() if resources_root_env else project_root

    manifest_path = resources_root / "runtime" / "manifest.json"
    if not manifest_path.exists():
        manifest_path = project_root / "runtime" / "manifest.json"
    if not manifest_path.exists():
        _emit({"type": "log", "message": f"✗ 找不到 manifest.json: {manifest_path}"}, json_progress)
        return 1

    manifest = json.loads(manifest_path.read_text(encoding="utf-8-sig"))
    engines: dict = manifest.get("engines", {})

    py = get_embedded_python(resources_root)
    if not py:
        _emit({"type": "log", "message": "✗ 嵌入式 Python 未找到"}, json_progress)
        return 1

    _emit({"type": "phase", "label": "1/2 正在安装运行库…"}, json_progress)
    _emit({"type": "log", "message": f"目标目录：{target}"}, json_progress)
    if mirror:
        _emit({"type": "log", "message": f"PyPI 镜像：{mirror}"}, json_progress)

    # 收集所有引擎的 runtime_pip_packages，去重
    all_pkgs: list[str] = []
    for cfg in engines.values():
        all_pkgs.extend(cfg.get("runtime_pip_packages", []))

    packages = _dedup_packages(all_pkgs)

    if not packages:
        _emit({"type": "log", "message": "无需安装运行时包"}, json_progress)
        return 0

    _emit({"type": "log", "message": f"共 {len(packages)} 个包待安装"}, json_progress)

    ok = install_to_target(packages, py, target, mirror, json_progress)

    if ok:
        _emit({"type": "log", "message": "✓ 运行库安装完成"}, json_progress)
        return 0
    else:
        _emit({"type": "log", "message": "✗ 部分包安装失败，请检查日志"}, json_progress)
        return 1


# ─── 入口 ─────────────────────────────────────────────────────────────────────

def main_setup_engine(engine: str) -> int:
    """只克隆/安装指定引擎的源码目录（供 UI 安装按钮按需调用）。"""
    project_root = Path(__file__).resolve().parent.parent
    engine_map = {
        "liveportrait": lambda: setup_liveportrait_engine(project_root),
        "fish_speech":  lambda: setup_fish_speech_engine(project_root),
        "seed_vc":      lambda: setup_seed_vc_engine(project_root),
    }
    fn = engine_map.get(engine)
    if fn is None:
        print(f"  [{engine}] 无需单独 setup（无源码克隆步骤）")
        return 0
    print(f"▶ setup engine: {engine}")
    ok = fn()
    return 0 if ok else 1


def main() -> int:
    parser = argparse.ArgumentParser(description="安装引擎 pip 依赖 + FFmpeg")
    parser.add_argument(
        "--runtime", action="store_true",
        help="安装 runtime_pip_packages（首次启动时使用，写入 --target 目录）",
    )
    parser.add_argument(
        "--target", default="",
        help="pip install --target 目录（--runtime 模式下必填）",
    )
    parser.add_argument(
        "--pypi-mirror", default="", dest="pypi_mirror",
        help="PyPI 镜像地址，如 https://pypi.tuna.tsinghua.edu.cn/simple",
    )
    parser.add_argument(
        "--json-progress", action="store_true", dest="json_progress",
        help="输出 JSON Lines 进度（供 Electron IPC 使用）",
    )
    parser.add_argument(
        "--engine", default="",
        help="只安装指定引擎的源码目录（liveportrait / fish_speech / seed_vc）",
    )
    args = parser.parse_args()

    if args.engine:
        return main_setup_engine(args.engine)
    if args.runtime:
        return main_runtime(args)
    else:
        return main_build()


if __name__ == "__main__":
    sys.exit(main())
