#!/usr/bin/env python3
"""
额外引擎初始化 — 可选引擎的 pip_packages + 源码。

Extra 引擎：LivePortrait、Flux、SD、WAN、GOT-OCR、Whisper

用法（开发全量）：
    python3 scripts/setup_extra.py

用法（只安装指定引擎，供 main.js app:downloadEngine 调用）：
    python3 scripts/setup_extra.py --engine liveportrait
"""

from __future__ import annotations

import argparse
import json
import os
import platform
import shutil
import subprocess
import sys
import zipfile
from pathlib import Path

# Windows 控制台 UTF-8
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")


# 额外引擎集合（不含 rag_engine/agent_engine/finetune_engine，它们只有 runtime_pip_packages，由 ml_extra.py 处理）
EXTRA_ENGINES = {"whisper", "got_ocr", "liveportrait", "wan", "flux", "sd"}


HF_ASSETS_REPO = "N17K4/ai-workshop-assets"


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
        from huggingface_hub import hf_hub_download
        print(f"  [HF] 尝试从 {HF_ASSETS_REPO} 下载 {filename} ...")
        zip_path = hf_hub_download(
            repo_id=HF_ASSETS_REPO,
            filename=filename,
            repo_type="dataset",
        )
        tmp = engine_dir.parent / "_engine_hf_tmp"
        if tmp.exists():
            shutil.rmtree(tmp)
        with zipfile.ZipFile(zip_path) as zf:
            zf.extractall(tmp)
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
            [py, "-m", "pip", "install", pkg, "--quiet"],
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


# ─── LivePortrait 引擎源码 ────────────────────────────────────────────────

_LIVEPORTRAIT_REPO = "https://github.com/KlingAIResearch/LivePortrait"
_LIVEPORTRAIT_COMMIT = "49784e879821538ecda5c8e4ca0472f4cb6236cf"
_LIVEPORTRAIT_KEEP = ["liveportrait", "inference.py", "src", "configs"]
_LIVEPORTRAIT_RM = ["assets", "docs", "scripts", ".github"]


def setup_liveportrait_engine(project_root: Path) -> bool:
    """克隆 LivePortrait 并精简到推理所需文件。"""
    engine_dir = project_root / "runtime" / "liveportrait" / "engine"
    sentinel = engine_dir / "liveportrait" / "__init__.py"

    if sentinel.exists():
        print(f"  ✓ liveportrait engine 已存在（{sentinel}）")
        return True

    if _download_engine_zip_from_hf("liveportrait_49784e87.zip", engine_dir):
        n = sum(1 for _ in engine_dir.rglob("*") if _.is_file())
        print(f"  ✓ liveportrait engine 就绪（{n} 个文件，HF 下载）")
        return True

    print(f"  [liveportrait] 克隆 {_LIVEPORTRAIT_REPO} @ {_LIVEPORTRAIT_COMMIT[:8]} ...")
    sys.stdout.flush()
    tmp_dir = project_root / "runtime" / "liveportrait" / "_engine_tmp"
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
# 主流程
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

def main_full_setup(project_root: Path) -> int:
    """安装所有额外引擎的 pip_packages + 源码。"""
    manifest_path = project_root / "wrappers" / "manifest.json"
    if not manifest_path.exists():
        print(f"✗ 找不到 manifest.json: {manifest_path}")
        return 1

    manifest = json.loads(manifest_path.read_text(encoding="utf-8-sig"))
    engines: dict = manifest.get("engines", {})

    py = get_embedded_python(project_root)
    if not py:
        print("✗ 嵌入式 Python 未找到，请先运行 python3 scripts/setup_base.py")
        return 1

    print(f"=== 安装额外引擎 ===")
    print(f"嵌入式 Python: {py}\n")

    all_ok = True
    for engine_name in sorted(EXTRA_ENGINES):
        cfg = engines.get(engine_name, {})
        packages: list[str] = cfg.get("pip_packages", [])
        if not packages and engine_name != "liveportrait":
            continue

        print(f"▶ {engine_name}")
        if engine_name == "flux":
            if not setup_flux_engine(project_root, packages, py):
                all_ok = False
        elif packages:
            if not setup_pip_packages(engine_name, packages, py):
                all_ok = False

        if engine_name == "liveportrait":
            if not setup_liveportrait_engine(project_root):
                all_ok = False
        print()

    if all_ok:
        print("✓ 额外引擎安装完成")
        return 0
    else:
        print("✗ 部分步骤失败，请检查上方日志")
        return 1


def main_single_engine(engine: str, project_root: Path) -> int:
    """只安装指定引擎。"""
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

    if engine == "flux":
        ok = setup_flux_engine(project_root, packages, py)
    elif packages:
        ok = setup_pip_packages(engine, packages, py)

    if engine == "liveportrait":
        if not setup_liveportrait_engine(project_root):
            ok = False

    return 0 if ok else 1


def main() -> int:
    parser = argparse.ArgumentParser(description="额外引擎初始化（可选引擎 pip_packages + 源码）")
    parser.add_argument("--engine", default="", help="只安装指定引擎（供 UI 按需调用）")
    args = parser.parse_args()

    project_root = Path(__file__).resolve().parent.parent

    if args.engine:
        return main_single_engine(args.engine, project_root)
    return main_full_setup(project_root)


if __name__ == "__main__":
    sys.exit(main())
