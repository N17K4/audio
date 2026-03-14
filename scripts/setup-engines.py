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
import platform
import re
import subprocess
import sys
import tarfile
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
    for pkg in packages:
        _emit({"type": "log", "message": f"  安装 {pkg}…"}, json_progress)
        cmd = [py, "-m", "pip", "install", "--target", target, pkg, "--quiet"]
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
    if not pip("fairseq==0.12.2", "--no-deps"):
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
    if check.returncode == 0:
        print("  ✓ rvc-python  (已安装)")
    else:
        print("  ✗ rvc-python  (未安装)")
        if _install_rvc_python(py):
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
import sys
from pathlib import Path


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

    version = detect_version(args.model)
    try:
        rvc = RVCInference(device="cpu")
        rvc.load_model(args.model, version=version,
                       index_path=str(Path(args.index).resolve()) if args.index else "")
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

    return True


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
            with zipfile.ZipFile(tmp_archive, "r") as zf:
                found = next(
                    (n for n in zf.namelist() if Path(n).name == target_name and not n.endswith("/")),
                    None,
                )
                if not found:
                    print(f"    ✗ 压缩包内未找到 {target_name}")
                    return False
                with zf.open(found) as src, open(dest, "wb") as dst:
                    dst.write(src.read())
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
        print(f"▶ {engine_name}")
        if engine_name == "rvc":
            ok = setup_rvc_engine(project_root)
        else:
            ok = setup_pip_packages(engine_name, packages, py)
        if not ok:
            all_ok = False
        print()

    print("▶ ffmpeg")
    if not download_ffmpeg(project_root):
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
    manifest_path = project_root / "runtime" / "manifest.json"
    if not manifest_path.exists():
        _emit({"type": "log", "message": f"✗ 找不到 manifest.json: {manifest_path}"}, json_progress)
        return 1

    manifest = json.loads(manifest_path.read_text(encoding="utf-8-sig"))
    engines: dict = manifest.get("engines", {})

    py = get_embedded_python(project_root)
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
    args = parser.parse_args()

    if args.runtime:
        return main_runtime(args)
    else:
        return main_build()


if __name__ == "__main__":
    sys.exit(main())
