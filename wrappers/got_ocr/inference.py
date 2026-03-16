#!/usr/bin/env python3
"""GOT-OCR2.0 推理脚本（transformers HF 版）。

用法:
  python inference.py --input /path/to/image.png --output /tmp/result.txt [--model GOT-OCR2.0]
  python inference.py --input /path/to/doc.pdf --output /tmp/result.txt

依赖（通过 pnpm run setup/checkpoints 预先安装到嵌入式 Python）:
  transformers>=4.48, torch, torchvision, Pillow, tiktoken, verovio, pymupdf

Checkpoint 要求（pnpm run checkpoints 下载，禁止运行时联网）：
  checkpoints/hf_cache/ → stepfun-ai/GOT-OCR-2.0-hf（通过 HF_HUB_CACHE 环境变量定位）
"""
import argparse
import os
import sys
from pathlib import Path


def _load_images(input_path: str):
    """将输入文件加载为 PIL Image 列表（支持图片和 PDF）。"""
    from PIL import Image

    p = Path(input_path)
    suffix = p.suffix.lower()

    if suffix == ".pdf":
        try:
            import fitz  # pymupdf
        except ImportError:
            print("[got_ocr] 错误：PDF 需要 pymupdf，请运行 pnpm run setup", file=sys.stderr)
            sys.exit(1)

        doc = fitz.open(input_path)
        images = []
        for page_num in range(len(doc)):
            page = doc[page_num]
            # 2x 缩放提升 OCR 精度
            mat = fitz.Matrix(2.0, 2.0)
            pix = page.get_pixmap(matrix=mat)
            img = Image.frombytes("RGB", [pix.width, pix.height], pix.samples)
            images.append(img)
            print(f"[got_ocr] PDF 第 {page_num + 1}/{len(doc)} 页转换完成", file=sys.stderr)
        doc.close()
        return images
    else:
        return [Image.open(input_path).convert("RGB")]


def main():
    parser = argparse.ArgumentParser(description="GOT-OCR2.0 文字识别")
    parser.add_argument("--input", required=True, help="输入图片或 PDF 路径")
    parser.add_argument("--output", required=True, help="输出文本路径（.txt）")
    parser.add_argument("--model", default="GOT-OCR2.0", help="模型名称（仅用于日志）")
    args = parser.parse_args()

    if not Path(args.input).exists():
        print(f"[got_ocr] 错误：输入文件不存在: {args.input}", file=sys.stderr)
        sys.exit(1)

    try:
        from transformers import AutoProcessor, AutoModelForImageTextToText
        import torch
    except ImportError as e:
        print(f"[got_ocr] 错误：缺少依赖 {e}，请运行 pnpm run setup", file=sys.stderr)
        sys.exit(1)

    # HF_HUB_CACHE 由 build_engine_env 注入（指向 checkpoints/hf_cache）
    # HF_HUB_OFFLINE=1 由 build_engine_env 注入（禁止运行时联网下载）
    repo_id = "stepfun-ai/GOT-OCR-2.0-hf"

    print(f"[got_ocr] 加载模型: {repo_id}", file=sys.stderr)
    print(f"[got_ocr] HF_HUB_CACHE: {os.environ.get('HF_HUB_CACHE', '(未设置)')}", file=sys.stderr)

    try:
        if torch.cuda.is_available():
            device = "cuda"
        elif hasattr(torch.backends, "mps") and torch.backends.mps.is_available():
            device = "mps"
        else:
            device = "cpu"
        print(f"[got_ocr] 使用设备: {device}", file=sys.stderr)

        processor = AutoProcessor.from_pretrained(repo_id)
        model = AutoModelForImageTextToText.from_pretrained(
            repo_id,
            low_cpu_mem_usage=True,
        )
        model = model.to(device)
        model.eval()

        print(f"[got_ocr] 识别文件: {args.input}", file=sys.stderr)
        images = _load_images(args.input)

        page_texts = []
        for i, image in enumerate(images):
            if len(images) > 1:
                print(f"[got_ocr] 识别第 {i + 1}/{len(images)} 页", file=sys.stderr)

            inputs = processor(image, return_tensors="pt").to(device)
            with torch.no_grad():
                generate_ids = model.generate(
                    **inputs,
                    do_sample=False,
                    tokenizer=processor.tokenizer,
                    stop_strings="<|im_end|>",
                    max_new_tokens=4096,
                )
            decoded = processor.decode(
                generate_ids[0, inputs["input_ids"].shape[1]:],
                skip_special_tokens=True,
            )
            page_texts.append(decoded)

        # 多页 PDF 用换行分隔
        text = "\n\n".join(page_texts) if len(page_texts) > 1 else page_texts[0]

        Path(args.output).write_text(text, encoding="utf-8")
        print(f"[got_ocr] 完成，字符数: {len(text)}", file=sys.stderr)

    except Exception as e:
        print(f"[got_ocr] 推理失败: {e}", file=sys.stderr)
        import traceback
        traceback.print_exc(file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
