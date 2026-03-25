#!/usr/bin/env python3
"""从 HuggingFace 下载预构建的 ML 包并解压到目标目录。

生产环境替代 ml_base.py，跳过 pip install，直接下载压缩包解压，速度更快且无需编译。

开发用法（安装到 runtime/ml）:
    python scripts/ml_hf.py

生产用法（由 main.js / ipc-setup.js 调用）:
    python scripts/ml_hf.py \
        --target /path/to/userData/python-packages \
        [--json-progress]

环境变量:
    HF_ENDPOINT  HuggingFace 镜像端点（中国用户: https://hf-mirror.com）
"""

from __future__ import annotations

import argparse
import json
import os
import platform
import sys
import tarfile
import tempfile
import urllib.request
from pathlib import Path

# Windows 控制台 UTF-8
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")

PROJECT_ROOT = Path(__file__).resolve().parent.parent

HF_REPO = "N17K4/ai-workshop-assets"
_ARCHIVE_MAC = "ml-mac.tar.gz"
_ARCHIVE_WIN = "ml-win.tar.gz"

_IS_WINDOWS = platform.system() == "Windows"
_JSON_MODE = False
_REAL_STDOUT = sys.stdout


def _default_target() -> Path:
    """config.py の _get_user_data_base() と同じロジック。
    開発環境（.git あり）は runtime/ml/、本番はユーザーディレクトリ。
    """
    app_root = Path(__file__).resolve().parent.parent
    is_dev = (app_root / ".git").exists()
    if is_dev:
        return app_root / "runtime" / "ml"
    _sys = platform.system()
    if _sys == "Darwin":
        base = Path.home() / "Library" / "Application Support" / "AI-Workshop"
    elif _sys == "Windows":
        base = Path(os.environ.get("LOCALAPPDATA", str(Path.home() / "AppData" / "Local"))) / "AI-Workshop"
    else:
        base = Path.home() / ".local" / "share" / "AI-Workshop"
    return base / "ml"


def _hf_endpoint() -> str:
    return os.getenv("HF_ENDPOINT", "https://huggingface.co").rstrip("/")


def _emit(data: dict) -> None:
    if _JSON_MODE:
        _REAL_STDOUT.write(json.dumps(data, ensure_ascii=False) + "\n")
        _REAL_STDOUT.flush()
    else:
        msg = data.get("message", "")
        if msg:
            print(msg, flush=True)


def _download(url: str, dest: Path, label: str) -> None:
    _emit({"type": "log", "message": f"  ↓ {label}"})
    _emit({"type": "log", "message": f"    {url}"})

    def _reporthook(block_num: int, block_size: int, total_size: int) -> None:
        if total_size <= 0:
            return
        downloaded = min(block_num * block_size, total_size)
        pct = downloaded * 100 // total_size
        mb_done = downloaded / 1024 / 1024
        mb_total = total_size / 1024 / 1024
        if _JSON_MODE:
            _REAL_STDOUT.write(json.dumps({
                "type": "progress",
                "pct": pct,
                "mb_done": round(mb_done, 1),
                "mb_total": round(mb_total, 1),
                "message": f"  下载中 {pct}%  {mb_done:.0f}/{mb_total:.0f} MB",
            }, ensure_ascii=False) + "\n")
            _REAL_STDOUT.flush()
        elif block_num % 200 == 0 or pct == 100:
            print(f"\r    {pct}%  {mb_done:.0f}/{mb_total:.0f} MB", end="", flush=True)

    try:
        urllib.request.urlretrieve(url, str(dest), reporthook=_reporthook)
    finally:
        if not _JSON_MODE:
            print()  # 换行

    size_mb = dest.stat().st_size / 1024 / 1024
    _emit({"type": "log", "message": f"  ✓ 下载完成: {size_mb:.0f} MB"})


def _extract(archive: Path, target: Path) -> None:
    _emit({"type": "log", "message": f"  解压 → {target} ..."})
    target.mkdir(parents=True, exist_ok=True)
    with tarfile.open(archive, "r:gz") as tf:
        members = tf.getmembers()
        total = len(members)
        for i, member in enumerate(members, 1):
            tf.extract(member, path=str(target))
            if _JSON_MODE and i % 2000 == 0:
                pct = i * 100 // total
                _REAL_STDOUT.write(json.dumps({
                    "type": "progress",
                    "pct": pct,
                    "message": f"  解压中 {pct}%",
                }, ensure_ascii=False) + "\n")
                _REAL_STDOUT.flush()
    _emit({"type": "log", "message": "  ✓ 解压完成"})


def _already_installed(target: Path) -> bool:
    """检查目标目录中是否已有 torch，视为已安装完成。"""
    return (target / "torch" / "__init__.py").exists()


def main() -> None:
    global _JSON_MODE

    parser = argparse.ArgumentParser(description="从 HuggingFace 下载预构建 ML 包")
    parser.add_argument("--target", default=None,
                        help="解压目标目录（默认: runtime/ml）")
    parser.add_argument("--json-progress", action="store_true",
                        help="以 JSON Lines 格式输出进度（供 Electron IPC 使用）")
    parser.add_argument("--force", action="store_true",
                        help="强制重新下载解压（即使已安装）")
    args = parser.parse_args()

    _JSON_MODE = args.json_progress

    target = Path(args.target) if args.target else _default_target()

    _emit({"type": "log", "message": "=== ML 包安装（HuggingFace 预构建版）==="})
    _emit({"type": "log", "message": f"  目标目录: {target}"})
    _emit({"type": "log", "message": f"  平台: {'Windows' if _IS_WINDOWS else 'macOS'}"})

    if not args.force and _already_installed(target):
        _emit({"type": "log", "message": "  ✓ ML 包已安装，跳过（--force 可强制重装）"})
        return

    archive_name = _ARCHIVE_WIN if _IS_WINDOWS else _ARCHIVE_MAC
    url = f"{_hf_endpoint()}/{HF_REPO}/resolve/main/{archive_name}"

    with tempfile.TemporaryDirectory() as tmpdir:
        tmp_archive = Path(tmpdir) / archive_name
        try:
            _download(url, tmp_archive, archive_name)
        except Exception as e:
            _emit({"type": "log", "message": f"  ✗ 下载失败: {e}"})
            sys.exit(1)

        try:
            _extract(tmp_archive, target)
        except Exception as e:
            _emit({"type": "log", "message": f"  ✗ 解压失败: {e}"})
            sys.exit(1)

    _emit({"type": "log", "message": "✓ ML 包安装完成"})


if __name__ == "__main__":
    main()
