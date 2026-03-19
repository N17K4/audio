#!/usr/bin/env python3
"""
下载基础 checkpoint — 必需的模型文件。

Base 引擎：Fish Speech、GPT-SoVITS、RVC、Seed-VC、Faster Whisper、FaceFusion + 内置音色

运行模式（本地开发 — 下载全部）：
    python scripts/checkpoints_base.py
    python scripts/checkpoints_base.py --check-only
    python scripts/checkpoints_base.py --force

模型管理面板（用户单独安装某个引擎）：
    python scripts/checkpoints_base.py --engine fish_speech
    python scripts/checkpoints_base.py --engine faster_whisper --json-progress
"""

import subprocess
import sys
from pathlib import Path

BASE_ENGINES = {
    "facefusion",
    "faster_whisper",
    "fish_speech",
    "gpt_sovits",
    "rvc",
    "seed_vc",
    "voices",  # 内置音色
}

def main():
    """调用 _checkpoint_download.py，下载 base 引擎的 checkpoint。"""
    import argparse

    parser = argparse.ArgumentParser(description="下载基础引擎的 checkpoint")
    parser.add_argument("--engine", default="", help="仅下载指定引擎（默认下载全部 base）")
    parser.add_argument("--check-only", action="store_true", help="仅检查，不下载")
    parser.add_argument("--force", action="store_true", help="强制重新下载")
    parser.add_argument("--json-progress", action="store_true", help="输出 JSON Lines 进度")
    parser.add_argument("--hf-endpoint", default="", dest="hf_endpoint",
                        help="HuggingFace 镜像端点（如 https://hf-mirror.com）")
    parser.add_argument("--pypi-mirror", default="", dest="pypi_mirror",
                        help="PyPI 镜像地址（如 https://pypi.tuna.tsinghua.edu.cn/simple）")
    args = parser.parse_args()

    script = Path(__file__).parent / "_checkpoint_download.py"

    # 如果指定了 --engine，只下载该引擎；否则下载全部 base 引擎
    if args.engine:
        cmd_args = [f"--engine={args.engine}"]
    else:
        cmd_args = ["--engines", ",".join(sorted(BASE_ENGINES))]

    # 添加其他参数
    if args.check_only:
        cmd_args.append("--check-only")
    if args.force:
        cmd_args.append("--force")
    if args.json_progress:
        cmd_args.append("--json-progress")
    if args.hf_endpoint:
        cmd_args.extend(["--hf-endpoint", args.hf_endpoint])
    if args.pypi_mirror:
        cmd_args.extend(["--pypi-mirror", args.pypi_mirror])

    result = subprocess.run(
        [sys.executable, str(script)] + cmd_args,
        cwd=Path(__file__).parent.parent
    )
    return result.returncode

if __name__ == "__main__":
    sys.exit(main())
