#!/usr/bin/env python3
"""Stable Diffusion Turbo 图像生成推理脚本。

用法:
  python inference.py --prompt "a cat" --output /tmp/out.png [--width 512] [--height 512] [--steps 4]

依赖（通过 pnpm run setup/checkpoints 预先安装）：
  diffusers>=0.21, transformers, accelerate, safetensors, torch, Pillow

Checkpoint 要求（pnpm run checkpoints 下载，禁止运行时联网）：
  - checkpoints/sd/ → stabilityai/sd-turbo（~2.3 GB，无门控，无需 HF 账号）

说明：
  SD-Turbo 是 SD 1.x 架构的蒸馏版本，支持 1-4 步推理，最佳分辨率 512×512。
  MBP / Apple Silicon：生成 512×512 约 10-30 秒（MPS）
  CPU 备用：约 1-3 分钟
"""
import argparse
import os
import sys
from pathlib import Path


def main():
    parser = argparse.ArgumentParser(description="Stable Diffusion Turbo 推理")
    parser.add_argument("--prompt", required=True, help="图像描述文本（推荐英文）")
    parser.add_argument("--output", required=True, help="输出图片路径（.png / .jpg）")
    parser.add_argument("--width",  type=int, default=512, help="宽度（像素，建议 512）")
    parser.add_argument("--height", type=int, default=512, help="高度（像素，建议 512）")
    parser.add_argument("--steps",  type=int, default=4,   help="推理步数（1-4，Turbo 建议 4）")
    parser.add_argument("--seed",   type=int, default=-1,  help="随机种子（-1 为随机）")
    args = parser.parse_args()

    checkpoint_dir = os.environ.get("SD_CHECKPOINT_DIR", "").strip()
    if not checkpoint_dir:
        print("[sd] 错误：SD_CHECKPOINT_DIR 未设置", file=sys.stderr)
        sys.exit(1)

    # 检查模型是否已下载（HF cache 结构: models--stabilityai--sd-turbo）
    ckpt_path = Path(checkpoint_dir)
    model_cache = ckpt_path / "models--stabilityai--sd-turbo"
    if not model_cache.exists():
        print(
            "[sd] 错误：SD-Turbo 模型未下载。\n"
            "  请先运行: pnpm run checkpoints --engine sd\n"
            f"  预期路径: {model_cache}",
            file=sys.stderr,
        )
        sys.exit(1)

    try:
        import torch
        from diffusers import AutoPipelineForText2Image
    except ImportError as e:
        print(f"[sd] 错误：缺少依赖 {e}，请运行 pnpm run setup && pnpm run checkpoints", file=sys.stderr)
        sys.exit(1)

    # 探测设备
    if torch.cuda.is_available():
        device = "cuda"
        dtype = torch.float16
    elif hasattr(torch.backends, "mps") and torch.backends.mps.is_available():
        device = "mps"
        dtype = torch.float32  # MPS fp16 会产生 NaN → 黑图，必须用 fp32
    else:
        device = "cpu"
        dtype = torch.float32
    print(f"[sd] 使用设备: {device}", file=sys.stderr)

    try:
        print("[sd] 加载 SD-Turbo 模型...", file=sys.stderr)
        pipe = AutoPipelineForText2Image.from_pretrained(
            "stabilityai/sd-turbo",
            torch_dtype=dtype,
            cache_dir=checkpoint_dir,
        )
        pipe = pipe.to(device)

        try:
            pipe.enable_attention_slicing()
        except Exception:
            pass

        import random
        seed = args.seed if args.seed >= 0 else random.randint(0, 2**32 - 1)
        generator = torch.Generator(device=device).manual_seed(seed)

        print(f"[sd] 生成图像: {args.width}x{args.height}, steps={args.steps}, seed={seed}", file=sys.stderr)
        print(f"[sd] prompt: {args.prompt[:80]}", file=sys.stderr)

        result = pipe(
            prompt=args.prompt,
            width=args.width,
            height=args.height,
            num_inference_steps=args.steps,
            guidance_scale=0.0,   # SD-Turbo 不需要 CFG
            generator=generator,
        )

        Path(args.output).parent.mkdir(parents=True, exist_ok=True)
        result.images[0].save(args.output)
        print(f"[sd] 完成，输出: {args.output}", file=sys.stderr)

    except Exception as e:
        print(f"[sd] 推理失败: {e}", file=sys.stderr)
        import traceback
        traceback.print_exc(file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
