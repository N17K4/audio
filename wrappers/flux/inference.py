#!/usr/bin/env python3
"""Flux.1-Schnell GGUF Q4 图像生成推理脚本。

用法:
  python inference.py --prompt "a cat" --output /tmp/out.png [--width 1024] [--height 1024] [--steps 4]

依赖（通过 pnpm run setup/checkpoints 预先安装）：
  diffusers>=0.32, transformers, gguf, torch, accelerate, sentencepiece, protobuf

Checkpoint 要求（pnpm run checkpoints 下载，禁止运行时联网）：
  - checkpoints/flux/ → city96/FLUX.1-schnell-gguf → flux1-schnell-Q4_K_M.gguf
  - checkpoints/hf_cache/ → black-forest-labs/FLUX.1-schnell（需 HF 账号同意许可）
    包含：text_encoder（CLIP-L）、text_encoder_2（T5-XXL）、vae、scheduler config

说明：
  本脚本加载 GGUF 量化 Transformer（~6.7GB），结合预下载的文本编码器和 VAE 生成图像。
  RTX 4050（6 GB VRAM）: 生成 1024×1024 约 3-6 分钟（sequential CPU offload，T5-XXL 在 CPU RAM 执行）
  MBP 32G: 生成 1024×1024 约 2-5 分钟（MPS，unified memory 不需要 offload）
"""
import argparse
import os
import sys
from pathlib import Path


def main():
    parser = argparse.ArgumentParser(description="Flux.1-Schnell GGUF Q4 推理")
    parser.add_argument("--prompt", required=True, help="图像描述文本")
    parser.add_argument("--output", required=True, help="输出图片路径（.png）")
    parser.add_argument("--width", type=int, default=1024, help="宽度（像素，建议 512~1024）")
    parser.add_argument("--height", type=int, default=1024, help="高度（像素，建议 512~1024）")
    parser.add_argument("--steps", type=int, default=4, help="推理步数（Schnell 建议 4）")
    parser.add_argument("--seed", type=int, default=-1, help="随机种子（-1 为随机）")
    args = parser.parse_args()

    checkpoint_dir = os.environ.get("FLUX_CHECKPOINT_DIR", "").strip()
    if not checkpoint_dir:
        print("[flux] 错误：FLUX_CHECKPOINT_DIR 未设置", file=sys.stderr)
        sys.exit(1)

    # 验证依赖
    try:
        import torch
        from diffusers import FluxPipeline, FluxTransformer2DModel
    except ImportError as e:
        print(f"[flux] 错误：缺少依赖 {e}，请运行 pnpm run setup && pnpm run checkpoints", file=sys.stderr)
        sys.exit(1)

    # GGUF 量化配置（diffusers >= 0.32；顶层 diffusers 或 diffusers.quantizers.gguf 均可）
    GGUFQuantizationConfig = None
    for _import_path in (
        "diffusers",
        "diffusers.quantizers.gguf",
    ):
        try:
            import importlib
            _mod = importlib.import_module(_import_path)
            GGUFQuantizationConfig = getattr(_mod, "GGUFQuantizationConfig", None)
            if GGUFQuantizationConfig is not None:
                break
        except ImportError:
            pass
    has_gguf_quant = GGUFQuantizationConfig is not None
    if not has_gguf_quant:
        print("[flux] 提示：GGUFQuantizationConfig 不可用，尝试普通加载", file=sys.stderr)

    # 查找 GGUF 文件
    gguf_path = _find_gguf_file(checkpoint_dir)
    if not gguf_path:
        print(f"[flux] 错误：未找到 GGUF 文件，请运行 pnpm run checkpoints 下载 Flux.1-Schnell GGUF", file=sys.stderr)
        sys.exit(1)
    print(f"[flux] GGUF 文件: {gguf_path}", file=sys.stderr)

    # 探测设备
    if torch.cuda.is_available():
        device = "cuda"
        dtype = torch.bfloat16
    elif hasattr(torch.backends, "mps") and torch.backends.mps.is_available():
        device = "mps"
        dtype = torch.float16  # MPS 不支持 bfloat16
    else:
        device = "cpu"
        dtype = torch.float32
    print(f"[flux] 使用设备: {device}", file=sys.stderr)

    try:
        # 加载 GGUF Transformer
        print("[flux] 加载 GGUF Transformer...", file=sys.stderr)
        if has_gguf_quant:
            quant_config = GGUFQuantizationConfig(compute_dtype=dtype)
            transformer = FluxTransformer2DModel.from_single_file(
                gguf_path,
                quantization_config=quant_config,
                torch_dtype=dtype,
            )
        else:
            transformer = FluxTransformer2DModel.from_single_file(
                gguf_path,
                torch_dtype=dtype,
            )

        # 加载基础 Pipeline（从 HF 缓存，需已通过 pnpm run checkpoints 下载）
        print("[flux] 加载 Pipeline 组件（text encoder / VAE）...", file=sys.stderr)
        hf_cache = os.environ.get("HF_HUB_CACHE", "")
        pipe = FluxPipeline.from_pretrained(
            "black-forest-labs/FLUX.1-schnell",
            transformer=transformer,
            torch_dtype=dtype,
            cache_dir=hf_cache if hf_cache else None,
        )

        # 显存管理：
        # T5-XXL ~9.3 GB，超出 6 GB 显卡上限，必须用 sequential_cpu_offload。
        # 不能先调 .to(device) 再调 enable_*_offload，否则已 OOM。
        if device == "cuda":
            # sequential offload：每个组件推理时移入显存，推理后立即移回 CPU RAM
            # 峰值显存 ≈ 最大单组件（GGUF Transformer ~6 GB），适合 6 GB 显卡
            pipe.enable_sequential_cpu_offload()
        else:
            pipe = pipe.to(device)

        try:
            pipe.enable_attention_slicing()
        except Exception:
            pass

        # 生成图像
        import random
        seed = args.seed if args.seed >= 0 else random.randint(0, 2**32 - 1)
        generator = torch.Generator(device=device).manual_seed(seed)

        print(f"[flux] 生成图像: {args.width}x{args.height}, steps={args.steps}, seed={seed}", file=sys.stderr)
        print(f"[flux] prompt: {args.prompt[:80]}", file=sys.stderr)

        result = pipe(
            prompt=args.prompt,
            width=args.width,
            height=args.height,
            num_inference_steps=args.steps,
            guidance_scale=0.0,  # Flux Schnell 不需要 CFG
            generator=generator,
            max_sequence_length=256,
        )

        Path(args.output).parent.mkdir(parents=True, exist_ok=True)
        result.images[0].save(args.output)
        print(f"[flux] 完成，输出: {args.output}", file=sys.stderr)

    except Exception as e:
        print(f"[flux] 推理失败: {e}", file=sys.stderr)
        import traceback
        traceback.print_exc(file=sys.stderr)
        sys.exit(1)


_GGUF_MIN_SIZE = 5 * 1024 * 1024 * 1024  # 6.47 GB 完整文件，至少需要 5 GB 才视为有效


def _find_gguf_file(checkpoint_dir: str) -> str:
    """在 checkpoint_dir 下或其 HF 缓存子目录中查找完整的 GGUF 文件（>5 GB）。"""
    base = Path(checkpoint_dir)
    candidates = list(base.glob("*.gguf")) + list(base.rglob("*.gguf"))
    # 优先返回完整文件（>5 GB）
    for f in candidates:
        try:
            if f.stat().st_size >= _GGUF_MIN_SIZE:
                return str(f)
        except OSError:
            pass
    # 找到了 GGUF 但文件不完整
    for f in candidates:
        try:
            size_gb = f.stat().st_size / 1024 / 1024 / 1024
            print(
                f"[flux] 错误：找到 GGUF 文件 {f.name} 但大小仅 {size_gb:.2f} GB（预期 ≥5 GB）。\n"
                f"[flux]        文件可能未下载完整，请在「模型管理」页面重新安装 Flux。",
                file=sys.stderr,
            )
        except OSError:
            pass
        return ""  # 有文件但不完整，直接返回空让调用方报错
    return ""


if __name__ == "__main__":
    main()
