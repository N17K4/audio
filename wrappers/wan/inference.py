#!/usr/bin/env python3
"""Wan 2.1 视频生成推理脚本。

用法:
  # 文生视频（T2V）
  python inference.py --prompt "..." --model Wan2.1-T2V-1.3B --output out.mp4 --mode t2v

  # 图生视频（I2V）
  python inference.py --prompt "..." --model Wan2.1-I2V-1.3B --image ref.jpg --output out.mp4 --mode i2v

依赖（通过 pnpm run setup/checkpoints 预先安装）:
  torch, transformers>=4.40, diffusers>=0.30, Pillow, imageio, imageio-ffmpeg, accelerate

Checkpoint 要求（pnpm run checkpoints 下载，禁止运行时联网）：
  checkpoints/hf_cache/ → Wan-AI/Wan2.1-T2V-1.3B 等（通过 HF_HUB_CACHE 定位）
  WAN_CHECKPOINT_DIR 指向包含模型 HF 缓存的目录
"""
import argparse
import os
import sys
from pathlib import Path


def _resolve_local_path(repo_id: str, hf_cache: str) -> str | None:
    """从 HF 缓存目录解析 repo 的本地快照路径。

    返回包含 model_index.json 的快照目录（最新），找不到返回 None。
    """
    if not hf_cache:
        return None
    cache_name = "models--" + repo_id.replace("/", "--")
    snapshots_dir = Path(hf_cache) / cache_name / "snapshots"
    if not snapshots_dir.is_dir():
        return None
    # 找到包含 model_index.json 的快照（取最新修改时间）
    candidates = [
        d for d in snapshots_dir.iterdir()
        if d.is_dir() and (d / "model_index.json").exists()
    ]
    if not candidates:
        existing = list(snapshots_dir.iterdir())
        if existing:
            print(
                f"[wan] 警告：本地缓存 {snapshots_dir} 下没有找到包含 model_index.json 的快照。"
                f" 已有快照: {[d.name for d in existing]}。"
                " 模型可能未完整下载（旧版原始格式不兼容 diffusers），"
                " 请删除旧缓存并重新运行 pnpm run checkpoints。",
                file=sys.stderr,
            )
        return None
    # 取最新修改的快照
    best = max(candidates, key=lambda d: d.stat().st_mtime)
    return str(best)


_MODEL_REPO_MAP = {
    "Wan2.1-T2V-1.3B": "Wan-AI/Wan2.1-T2V-1.3B-Diffusers",
    "Wan2.1-T2V-14B":  "Wan-AI/Wan2.1-T2V-14B-Diffusers",
    "Wan2.1-I2V-1.3B": "Wan-AI/Wan2.1-I2V-480P-1.3B-Diffusers",
    "Wan2.1-I2V-14B":  "Wan-AI/Wan2.1-I2V-480P-14B-Diffusers",
}


def main():
    parser = argparse.ArgumentParser(description="Wan 2.1 视频生成")
    parser.add_argument("--prompt", required=True, help="视频描述文本")
    parser.add_argument("--output", required=True, help="输出视频路径（.mp4）")
    parser.add_argument("--model", default="Wan2.1-T2V-1.3B", help="模型名称（显示名）")
    parser.add_argument("--mode", default="t2v", choices=["t2v", "i2v"], help="生成模式")
    parser.add_argument("--image", default="", help="参考图片路径（i2v 模式）")
    parser.add_argument("--duration", type=int, default=5, help="视频时长（秒）")
    args = parser.parse_args()

    # HF_HUB_CACHE 和 WAN_CHECKPOINT_DIR 由 build_engine_env("wan") 注入
    # HF_HUB_OFFLINE=1 防止运行时联网
    checkpoint_dir = os.environ.get("WAN_CHECKPOINT_DIR", "").strip()
    hf_cache = os.environ.get("HF_HUB_CACHE", "").strip()

    # 解析 model 名称（去掉括号内的硬件推荐文字）
    model_display = args.model.split("（")[0].strip()
    repo_id = _MODEL_REPO_MAP.get(model_display)
    if not repo_id:
        # 回退：尝试直接用作 repo_id
        repo_id = model_display
        print(f"[wan] 警告：未识别的模型名 '{model_display}'，尝试用作 repo_id", file=sys.stderr)

    # 尝试解析本地 HF 缓存路径，避免 offline 模式下 hub 解析失败
    resolved_id = _resolve_local_path(repo_id, hf_cache) or repo_id

    print(f"[wan] 模型: {repo_id}, 模式: {args.mode}", file=sys.stderr)
    print(f"[wan] HF_HUB_CACHE: {hf_cache or '(未设置)'}", file=sys.stderr)
    if resolved_id != repo_id:
        print(f"[wan] 使用本地路径: {resolved_id}", file=sys.stderr)

    try:
        import torch
    except ImportError:
        print("[wan] 错误：torch 未安装，请运行 pnpm run setup", file=sys.stderr)
        sys.exit(1)

    if torch.cuda.is_available():
        device = "cuda"
        dtype = torch.float16
    elif hasattr(torch.backends, "mps") and torch.backends.mps.is_available():
        device = "mps"
        dtype = torch.float16
        # MPS 不支持部分算子（如 linalg.solve），允许回落到 CPU
        os.environ.setdefault("PYTORCH_ENABLE_MPS_FALLBACK", "1")
    else:
        device = "cpu"
        dtype = torch.float32
    print(f"[wan] 使用设备: {device}", file=sys.stderr)

    # 帧数（Wan 2.1 要求 4n+1 格式）
    fps = 16
    # MPS 显存有限，帧数过多会出现 "Invalid buffer size" 错误，限制为最小帧数
    if device == "mps":
        num_frames = 17  # 最小帧数（约 1 秒）
    else:
        num_frames = max(17, args.duration * fps)
        if (num_frames - 1) % 4 != 0:
            num_frames = ((num_frames - 1) // 4) * 4 + 1

    try:
        if args.mode == "i2v":
            _run_i2v(args, resolved_id, device, dtype, num_frames, fps)
        else:
            _run_t2v(args, resolved_id, device, dtype, num_frames, fps)
    except Exception as e:
        print(f"[wan] 推理失败: {e}", file=sys.stderr)
        import traceback
        traceback.print_exc(file=sys.stderr)
        sys.exit(1)


def _setup_pipe(pipe, device: str):
    """配置 pipeline：MPS/CUDA 用 sequential CPU offload + attention slicing 节省显存，CPU 直接加载。"""
    if device in ("mps", "cuda"):
        # enable_sequential_cpu_offload 逐层迁移，峰值显存最小
        pipe.enable_sequential_cpu_offload()
        # attention slicing 防止 MPS 出现 "Invalid buffer size" 错误
        try:
            pipe.enable_attention_slicing(1)
        except Exception:
            pass
        print(f"[wan] 已启用 sequential_cpu_offload + attention_slicing（最小显存模式）", file=sys.stderr)
    else:
        pipe = pipe.to(device)
    return pipe


def _run_t2v(args, repo_id: str, device: str, dtype, num_frames: int, fps: int):
    from diffusers import WanPipeline
    import torch

    print(f"[wan] 加载 T2V 模型: {repo_id}", file=sys.stderr)
    pipe = WanPipeline.from_pretrained(
        repo_id,
        torch_dtype=dtype,
        low_cpu_mem_usage=True,
    )
    pipe = _setup_pipe(pipe, device)

    # MPS 下减少推理步数以缩短时间并节省内存
    import platform as _platform
    steps = 10 if (_platform.system() == "Darwin" and _platform.machine() == "arm64") else 20
    print(f"[wan] 生成视频: {num_frames} 帧，steps={steps}", file=sys.stderr)
    output = pipe(
        prompt=args.prompt,
        num_frames=num_frames,
        guidance_scale=5.0,
        num_inference_steps=steps,
        generator=torch.Generator(device="cpu").manual_seed(42),
    )
    _save_video(output.frames[0], args.output, fps)


def _run_i2v(args, repo_id: str, device: str, dtype, num_frames: int, fps: int):
    from diffusers import WanImageToVideoPipeline
    from PIL import Image
    import torch

    if not args.image or not Path(args.image).exists():
        raise ValueError(f"i2v 模式需要 --image 参数，当前: '{args.image}'")

    print(f"[wan] 加载 I2V 模型: {repo_id}", file=sys.stderr)
    pipe = WanImageToVideoPipeline.from_pretrained(
        repo_id,
        torch_dtype=dtype,
        low_cpu_mem_usage=True,
    )
    pipe = _setup_pipe(pipe, device)

    image = Image.open(args.image).convert("RGB")
    print(f"[wan] 生成视频（图生视频）: {num_frames} 帧", file=sys.stderr)
    output = pipe(
        image=image,
        prompt=args.prompt,
        num_frames=num_frames,
        guidance_scale=5.0,
        num_inference_steps=20,
        generator=torch.Generator(device="cpu").manual_seed(42),
    )
    _save_video(output.frames[0], args.output, fps)


def _save_video(frames, output_path: str, fps: int):
    try:
        import imageio
        import numpy as np
        Path(output_path).parent.mkdir(parents=True, exist_ok=True)
        writer = imageio.get_writer(output_path, fps=fps, codec="libx264", quality=8)
        for frame in frames:
            if hasattr(frame, "numpy"):
                frame = frame.numpy()
            elif not isinstance(frame, np.ndarray):
                frame = np.array(frame)
            writer.append_data(frame)
        writer.close()
        print(f"[wan] 视频已保存: {output_path}", file=sys.stderr)
    except Exception as e:
        raise RuntimeError(f"视频保存失败: {e}") from e


if __name__ == "__main__":
    main()
