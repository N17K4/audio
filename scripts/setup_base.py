#!/usr/bin/env python3
"""
开发环境一站式初始化 — 下载嵌入式 Python + 安装 backend 依赖 + 基础引擎。

Base 引擎：Fish Speech、RVC、Seed-VC、Faster Whisper、FaceFusion

用法（开发全量）：
    python3 scripts/setup_base.py

用法（只安装指定引擎，供 main.js app:downloadEngine 调用）：
    python3 scripts/setup_base.py --engine fish_speech
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

# macOS: python-build-standalone 版本
MAC_PBS_RELEASE = "20250317"
MAC_PY_VERSION = "3.12.9"

# Windows: python.org 嵌入式包版本
WIN_PY_VERSION = "3.10.11"

# 基础引擎集合
BASE_ENGINES = {"fish_speech", "seed_vc", "rvc", "faster_whisper", "facefusion"}

# HuggingFace 资产仓库
HF_ASSETS_REPO = "N17K4/ai-workshop-assets"


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
    """返回嵌入式 Python 可执行路径，找不到返回空串。"""
    if platform.system() == "Windows":
        p = root / "runtime" / "win" / "python" / "python.exe"
    else:
        p = root / "runtime" / "mac" / "python" / "bin" / "python3"
    return str(p) if p.exists() else ""


def _download_engine_zip_from_hf(filename: str, engine_dir: Path) -> bool:
    """从 HF dataset 仓库下载引擎 zip 并解压到 engine_dir。"""
    try:
        # 构造 HuggingFace CDN URL（不需要 huggingface_hub 包）
        url = f"https://huggingface.co/datasets/{HF_ASSETS_REPO}/resolve/main/{filename}"
        print(f"  [HF] 尝试从 {url} 下载 ...")

        engine_dir.parent.mkdir(parents=True, exist_ok=True)
        tmp_zip = engine_dir.parent / f"_{filename}"
        urllib.request.urlretrieve(url, str(tmp_zip), _reporthook)
        if _IS_TTY:
            print()

        tmp = engine_dir.parent / "_engine_hf_tmp"
        if tmp.exists():
            shutil.rmtree(tmp)
        with zipfile.ZipFile(tmp_zip) as zf:
            zf.extractall(tmp)
        tmp_zip.unlink()

        extracted = list(tmp.iterdir())
        src = extracted[0] if len(extracted) == 1 and extracted[0].is_dir() else tmp
        if engine_dir.exists():
            shutil.rmtree(engine_dir)
        shutil.move(str(src), str(engine_dir))
        shutil.rmtree(tmp, ignore_errors=True)
        return True
    except Exception as e:
        print(f"  HF 下载失败 ({e})，回退到 git clone ...")
        return False


# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# 第一步：下载嵌入式 Python
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

def _download_mac_python(dest_dir: Path) -> None:
    """下载 python-build-standalone 到 dest_dir。"""
    import struct
    arch = "aarch64" if struct.calcsize("P") * 8 == 64 and platform.machine() == "arm64" else "x86_64"
    filename = f"cpython-{MAC_PY_VERSION}+{MAC_PBS_RELEASE}-{arch}-apple-darwin-install_only.tar.gz"
    url = f"https://github.com/astral-sh/python-build-standalone/releases/download/{MAC_PBS_RELEASE}/{filename}"
    runtime_dir = dest_dir.parent.parent  # runtime/mac/python -> runtime/
    runtime_dir.mkdir(parents=True, exist_ok=True)
    tmp_tar = runtime_dir / "_python_tmp.tar.gz"

    print(f"  下载: {url}")
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
    print(f"  ✓ macOS standalone Python {MAC_PY_VERSION} 已就绪: {dest_dir}")

    # 装 huggingface_hub 等依赖到嵌入式 Python 中
    py_exe = dest_dir / "bin" / "python3"
    print(f"  装 huggingface_hub 到嵌入式 Python...")
    subprocess.run(
        [str(py_exe), "-m", "pip", "install", "-q", "huggingface-hub", "requests", "tqdm"],
        check=False,
    )


def _download_win_python(dest_dir: Path) -> None:
    """下载 Windows 嵌入式 Python 并启用 site-packages + pip。"""
    url = f"https://www.python.org/ftp/python/{WIN_PY_VERSION}/python-{WIN_PY_VERSION}-embed-amd64.zip"
    dest_dir.mkdir(parents=True, exist_ok=True)
    tmp_zip = dest_dir.parent / "_python_tmp.zip"

    print(f"  下载: {url}")
    urllib.request.urlretrieve(url, str(tmp_zip), _reporthook)
    if _IS_TTY:
        print()

    print("  解压 Windows 嵌入式 Python...")
    with zipfile.ZipFile(tmp_zip, "r") as zf:
        zf.extractall(dest_dir)
    tmp_zip.unlink()

    # 启用 site-packages
    ver_short = WIN_PY_VERSION.replace(".", "")[:3]
    pth_file = dest_dir / f"python{ver_short}._pth"
    if pth_file.exists():
        content = pth_file.read_text(encoding="utf-8")
        content = content.replace("#import site", "import site")
        content += "\n../../../app/backend\n"
        pth_file.write_text(content, encoding="utf-8")

    # 安装 pip
    get_pip_path = dest_dir / "get-pip.py"
    urllib.request.urlretrieve("https://bootstrap.pypa.io/get-pip.py", str(get_pip_path))
    py_exe = str(dest_dir / "python.exe")
    subprocess.run([py_exe, str(get_pip_path), "--quiet"], check=True)
    get_pip_path.unlink()
    subprocess.run([py_exe, "-m", "pip", "install", "setuptools", "wheel", "tomli", "--quiet"], check=True)

    # 装 huggingface_hub 等依赖
    print(f"  装 huggingface_hub 到嵌入式 Python...")
    subprocess.run([py_exe, "-m", "pip", "install", "huggingface-hub", "requests", "tqdm", "--quiet"], check=False)

    print(f"  ✓ Windows 嵌入式 Python {WIN_PY_VERSION} 已就绪: {dest_dir}")


def ensure_embedded_python(project_root: Path) -> str:
    """确保嵌入式 Python 存在，返回可执行路径。"""
    py = get_embedded_python(project_root)
    if py:
        return py

    system = platform.system()
    if system == "Darwin":
        dest = project_root / "runtime" / "mac" / "python"
        print(f"\n[setup] macOS standalone Python 不存在，开始下载 {MAC_PY_VERSION}...")
        _download_mac_python(dest)
    elif system == "Windows":
        dest = project_root / "runtime" / "win" / "python"
        print(f"\n[setup] Windows 嵌入式 Python 不存在，开始下载 {WIN_PY_VERSION}...")
        _download_win_python(dest)
    else:
        print(f"✗ 不支持的平台: {system}")
        sys.exit(1)

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
    """用嵌入式 Python 的 pip 安装 backend/pyproject.toml 的依赖。"""
    pyproject = project_root / "backend" / "pyproject.toml"
    if not pyproject.exists():
        print(f"  ⚠ {pyproject} 不存在，跳过 backend 依赖安装")
        return True

    # 用嵌入式 Python 解析 pyproject.toml（它有 tomli/tomllib）
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
    req_file = project_root / "backend" / "_requirements_tmp.txt"
    req_file.write_text("\n".join(reqs), encoding="utf-8")
    try:
        r = subprocess.run(
            [py, "-m", "pip", "install", "-r", str(req_file), "--quiet"],
            text=True, timeout=600,
        )
        if r.returncode != 0:
            print("  ✗ backend 依赖安装失败")
            return False
        print("  ✓ backend 依赖安装完成")
        return True
    finally:
        req_file.unlink(missing_ok=True)


# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# 第三步：安装引擎 pip_packages
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
            [py, "-m", "pip", "install", pkg, "--quiet"],
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
由 setup_base.py 自动生成，请勿手动修改。
"""
import argparse
import os
import sys
from pathlib import Path

if not os.environ.get("PYTORCH_ENABLE_MPS_FALLBACK"):
    os.environ["PYTORCH_ENABLE_MPS_FALLBACK"] = "1"

import torch as _torch
_orig_torch_load = _torch.load
def _patched_torch_load(f, map_location=None, pickle_module=None, *, weights_only=False, mmap=None, **kwargs):
    return _orig_torch_load(f, map_location=map_location, pickle_module=pickle_module,
                            weights_only=weights_only, mmap=mmap, **kwargs)
_torch.load = _patched_torch_load

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
    engine_dir = project_root / "runtime" / "fish_speech" / "engine"
    sentinel = engine_dir / "tools" / "inference_engine" / "__init__.py"

    if sentinel.exists():
        print(f"  ✓ fish_speech engine 已存在（{sentinel}）")
        return True

    if _download_engine_zip_from_hf("fish_speech_v1.5.0.zip", engine_dir):
        _patch_fish_speech_generate(engine_dir)
        n = sum(1 for _ in engine_dir.rglob("*") if _.is_file())
        print(f"  ✓ fish_speech engine 就绪（{n} 个文件，HF 下载）")
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
    engine_dir = project_root / "runtime" / "seed_vc" / "engine"
    sentinel = engine_dir / "inference.py"

    if sentinel.exists():
        print(f"  ✓ seed_vc engine 已存在（{sentinel}）")
        return True

    if _download_engine_zip_from_hf("seed_vc_51383efd.zip", engine_dir):
        _patch_seed_vc_inference(engine_dir)
        n = sum(1 for _ in engine_dir.rglob("*") if _.is_file())
        print(f"  ✓ seed_vc engine 就绪（{n} 个文件，HF 下载）")
        return True

    print(f"  [seed_vc] 获取 {_SEED_VC_REPO} @ {_SEED_VC_COMMIT[:8]} ...")
    tmp_dir = project_root / "runtime" / "seed_vc" / "_engine_tmp"
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
# FaceFusion 引擎源码
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

_FACEFUSION_REPO = "https://github.com/facefusion/facefusion"
_FACEFUSION_TAG = "3.5.4"
_FACEFUSION_KEEP = ["facefusion", "facefusion.py"]
_FACEFUSION_RM = [".github", "tests", "docs", "assets"]


def setup_facefusion_engine(project_root: Path) -> bool:
    """克隆 FaceFusion 并精简到推理所需文件。"""
    engine_dir = project_root / "runtime" / "facefusion" / "engine"
    sentinel = engine_dir / "facefusion.py"

    if sentinel.exists():
        print(f"  ✓ facefusion engine 已存在（{sentinel}）")
        return True

    if _download_engine_zip_from_hf("facefusion_3.5.4.zip", engine_dir):
        n = sum(1 for _ in engine_dir.rglob("*") if _.is_file())
        print(f"  ✓ facefusion engine 就绪（{n} 个文件，HF 下载）")
        return True

    print(f"  [facefusion] 克隆 {_FACEFUSION_REPO} @ {_FACEFUSION_TAG} ...")
    tmp_dir = project_root / "runtime" / "facefusion" / "_engine_tmp"
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
# FFmpeg / Pandoc 下载
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

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
# 主流程
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

def main_full_setup(project_root: Path) -> int:
    """全量 setup：下载 Python + backend 依赖 + 基础引擎 + FFmpeg + pandoc。"""
    manifest_path = project_root / "wrappers" / "manifest.json"
    if not manifest_path.exists():
        print(f"✗ 找不到 manifest.json: {manifest_path}")
        return 1

    manifest = json.loads(manifest_path.read_text(encoding="utf-8-sig"))
    engines: dict = manifest.get("engines", {})

    # 1. 确保嵌入式 Python
    print("\n=== 1/4 嵌入式 Python ===")
    py = ensure_embedded_python(project_root)
    print(f"嵌入式 Python: {py}")

    all_ok = True

    # 2. 安装 backend 依赖
    print("\n=== 2/4 安装 backend 依赖 ===")
    if not install_backend_deps(project_root, py):
        all_ok = False

    # 3. 安装基础引擎 pip_packages + 源码
    print("\n=== 3/4 安装基础引擎 ===")
    for engine_name in sorted(BASE_ENGINES):
        cfg = engines.get(engine_name, {})
        packages: list[str] = cfg.get("pip_packages", [])
        print(f"\n▶ {engine_name}")

        if engine_name == "rvc":
            if not setup_rvc_engine(project_root):
                all_ok = False
        else:
            if packages:
                if not setup_pip_packages(engine_name, packages, py):
                    all_ok = False

        # 引擎源码 setup
        if engine_name == "fish_speech":
            if not setup_fish_speech_engine(project_root):
                all_ok = False
        elif engine_name == "seed_vc":
            if not setup_seed_vc_engine(project_root):
                all_ok = False
        elif engine_name == "facefusion":
            if not setup_facefusion_engine(project_root):
                all_ok = False

    # 4. FFmpeg + pandoc
    print("\n=== 4/4 下载工具 ===")
    print("\n▶ ffmpeg")
    if not download_ffmpeg(project_root):
        all_ok = False
    print("\n▶ pandoc")
    if not download_pandoc(project_root):
        all_ok = False

    print()
    if all_ok:
        print("✓ 基础环境初始化完成")
        return 0
    else:
        print("✗ 部分步骤失败，请检查上方日志")
        return 1


def main_single_engine(engine: str, project_root: Path) -> int:
    """只安装指定引擎（pip_packages + 源码），供 main.js app:downloadEngine 调用。"""
    manifest_path = project_root / "wrappers" / "manifest.json"
    if not manifest_path.exists():
        manifest_path = Path(os.getenv("RESOURCES_ROOT", "")) / "wrappers" / "manifest.json"
    if not manifest_path.exists():
        print(f"✗ 找不到 manifest.json")
        return 1

    manifest = json.loads(manifest_path.read_text(encoding="utf-8-sig"))
    engines: dict = manifest.get("engines", {})

    py = get_embedded_python(project_root)
    resources_root = os.getenv("RESOURCES_ROOT", "")
    if not py and resources_root:
        py = get_embedded_python(Path(resources_root))
    if not py:
        print("✗ 嵌入式 Python 未找到")
        return 1

    cfg = engines.get(engine, {})
    packages = cfg.get("pip_packages", [])

    print(f"▶ setup engine: {engine}")

    ok = True
    # pip_packages
    if packages:
        if engine == "rvc":
            ok = setup_rvc_engine(project_root)
        else:
            ok = setup_pip_packages(engine, packages, py)

    # 源码 setup
    engine_source_map = {
        "fish_speech": lambda: setup_fish_speech_engine(project_root),
        "seed_vc": lambda: setup_seed_vc_engine(project_root),
        "facefusion": lambda: setup_facefusion_engine(project_root),
    }
    source_fn = engine_source_map.get(engine)
    if source_fn and not source_fn():
        ok = False

    return 0 if ok else 1


def main() -> int:
    parser = argparse.ArgumentParser(description="基础环境初始化（嵌入式 Python + backend + 基础引擎）")
    parser.add_argument("--engine", default="", help="只安装指定引擎（供 UI 按需调用）")
    args = parser.parse_args()

    project_root = Path(__file__).resolve().parent.parent

    if args.engine:
        return main_single_engine(args.engine, project_root)
    return main_full_setup(project_root)


if __name__ == "__main__":
    sys.exit(main())
