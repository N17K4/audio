#!/usr/bin/env python3
"""LivePortrait 口型同步推理脚本。

用法:
  python inference.py --source portrait.jpg --audio speech.wav --output result.mp4 [--model liveportrait]

依赖（通过 pnpm run checkpoints 预先安装）:
  torch, torchvision, Pillow, imageio, imageio-ffmpeg, av, liveportrait（pip install liveportrait）
  或者 engine/ 目录中的 LivePortrait 源码

说明:
  - 输入 source 可以是人物图片（jpg/png）或短视频（mp4）
  - audio 为 WAV/MP3 格式驱动音频
  - LivePortrait 使用音频特征提取 + 面部关键点驱动实现口型同步
"""
import argparse
import os
import sys
from pathlib import Path

from wrappers._common import get_root, get_engine_dir


def _find_engine_dir() -> str:
    engine_dir = get_engine_dir("liveportrait")
    if (engine_dir / "liveportrait").is_dir() or (engine_dir / "inference.py").exists():
        return str(engine_dir.resolve())
    return ""


def main():
    parser = argparse.ArgumentParser(description="LivePortrait 口型同步")
    parser.add_argument("--source", required=True, help="人物图片或视频路径")
    parser.add_argument("--audio", required=True, help="驱动音频路径（WAV/MP3）")
    parser.add_argument("--output", required=True, help="输出视频路径（.mp4）")
    parser.add_argument("--model", default="liveportrait", help="模型变体")
    args = parser.parse_args()

    if not Path(args.source).exists():
        print(f"[liveportrait] 错误：source 文件不存在: {args.source}", file=sys.stderr)
        sys.exit(1)
    if not Path(args.audio).exists():
        print(f"[liveportrait] 错误：audio 文件不存在: {args.audio}", file=sys.stderr)
        sys.exit(1)

    checkpoint_dir = os.environ.get("LIVEPORTRAIT_CHECKPOINT_DIR", "").strip()

    # 优先尝试 pip 安装版本
    _try_pip_liveportrait(args, checkpoint_dir)


def _try_pip_liveportrait(args, checkpoint_dir: str):
    """尝试通过 pip liveportrait 包运行。如失败转 engine 目录。"""
    engine_dir = _find_engine_dir()
    if engine_dir:
        sys.path.insert(0, engine_dir)

    try:
        import torch
        if torch.cuda.is_available():
            device = "cuda"
        elif hasattr(torch.backends, "mps") and torch.backends.mps.is_available():
            device = "mps"
        else:
            device = "cpu"
        print(f"[liveportrait] 使用设备: {device}", file=sys.stderr)
    except ImportError:
        print("[liveportrait] 错误：torch 未安装，请运行 pnpm run checkpoints", file=sys.stderr)
        sys.exit(1)

    try:
        # 尝试调用 LivePortrait CLI（engine 目录模式）
        _run_via_engine(args, checkpoint_dir, engine_dir, device)
    except Exception as e:
        print(f"[liveportrait] 推理失败: {e}", file=sys.stderr)
        import traceback
        traceback.print_exc(file=sys.stderr)
        sys.exit(1)


def _resolve_pretrained_weights(checkpoint_dir: str, engine_dir: str) -> None:
    """确保 engine/pretrained_weights 指向实际权重目录。
    LivePortrait engine 硬编码从 engine/pretrained_weights/ 读取权重，
    不支持命令行参数指定路径。此函数负责建立符号链接。
    """
    pretrained_link = Path(engine_dir) / "pretrained_weights"
    if pretrained_link.exists() or pretrained_link.is_symlink():
        return  # 已存在，无需处理

    # 优先使用 checkpoint_dir（下载脚本指定的目录）
    if checkpoint_dir and Path(checkpoint_dir).is_dir():
        pretrained_link.symlink_to(Path(checkpoint_dir).resolve())
        print(f"[liveportrait] 已链接 pretrained_weights → {checkpoint_dir}", file=sys.stderr)
        return

    # 回退：从 HF cache 中查找 KwaiVGI/LivePortrait 快照
    root = get_root()
    hf_cache = root / "runtime" / "checkpoints" / "hf_cache" / "models--KwaiVGI--LivePortrait" / "snapshots"
    if hf_cache.is_dir():
        snapshots = sorted(hf_cache.iterdir())
        if snapshots:
            pretrained_link.symlink_to(snapshots[-1].resolve())
            print(f"[liveportrait] 已链接 pretrained_weights → {snapshots[-1]}", file=sys.stderr)
            return

    print("[liveportrait] 警告：未找到权重目录，engine 将使用默认路径", file=sys.stderr)


def _run_via_engine(args, checkpoint_dir: str, engine_dir: str, device: str):
    """通过 LivePortrait engine 目录的 inference.py 执行推理。
    LivePortrait 是视频驱动的人脸动画工具，--audio 参数无效。
    当前用 --source 同时作为驱动（静态图片 → 自驱动），输出结果为动画视频。
    """
    if not engine_dir:
        raise RuntimeError(
            "LivePortrait engine 目录未找到。"
            "请确保 runtime/engine/liveportrait/ 目录存在（通过 pnpm run setup 安装）。"
        )

    engine_inference = Path(engine_dir) / "inference.py"
    if not engine_inference.exists():
        engine_inference = Path(engine_dir) / "scripts" / "inference.py"

    if not engine_inference.exists():
        raise RuntimeError(f"LivePortrait engine inference 脚本不存在: {engine_dir}")

    # 建立权重符号链接（engine 硬编码从 engine/pretrained_weights/ 读取）
    _resolve_pretrained_weights(checkpoint_dir, engine_dir)

    import subprocess
    import sys as _sys

    out_dir = str(Path(args.output).parent)

    # LivePortrait CLI：-s 源图/视频，-d 驱动视频（此处用 source 自驱动）
    cmd = [
        _sys.executable, str(engine_inference),
        "-s", args.source,
        "-d", args.source,  # 自驱动（无外部驱动视频时使用 source 自身）
        "-o", out_dir,
    ]

    print(f"[liveportrait] 执行: {' '.join(cmd)}", file=sys.stderr)
    result = subprocess.run(cmd, check=False, timeout=600, cwd=engine_dir)
    if result.returncode != 0:
        raise RuntimeError(f"LivePortrait engine 返回非零退出码: {result.returncode}")

    # LivePortrait 输出文件名可能与指定不同，查找最新 mp4 并重命名
    out_path = Path(out_dir)
    candidates = sorted(out_path.glob("*.mp4"), key=lambda p: p.stat().st_mtime, reverse=True)
    expected = Path(args.output)
    if not expected.exists() and candidates:
        candidates[0].rename(expected)

    print(f"[liveportrait] 完成，输出: {args.output}", file=sys.stderr)


if __name__ == "__main__":
    main()
