#!/usr/bin/env python3
"""FaceFusion 3.x 换脸推理脚本（包装器）。

用法:
  python inference.py --source face.jpg --target photo.jpg --output result.jpg [--model inswapper_128_fp16]

依赖:
  FaceFusion 3.x 安装于 engine/ 目录（通过 pnpm run setup-engines 克隆）
  依赖包由 FaceFusion 自身管理（onnxruntime, insightface 等）

说明:
  本脚本是对 FaceFusion 3.x headless-run 命令的封装，负责参数映射和错误处理。
"""
import argparse
import os
import subprocess
import sys
from pathlib import Path

from wrappers._common import get_engine_dir


def _find_facefusion_script() -> str:
    runtime_dir = get_engine_dir("facefusion")
    candidates = [
        runtime_dir / "facefusion.py",
    ]
    for c in candidates:
        if c.exists():
            return str(c.resolve())
    return ""


def main():
    parser = argparse.ArgumentParser(description="FaceFusion 3.x 换脸")
    parser.add_argument("--source", required=True, help="换脸源图片路径（提供人脸的图片）")
    parser.add_argument("--target", required=True, help="目标图片/视频路径（被换脸的内容）")
    parser.add_argument("--output", required=True, help="输出路径")
    parser.add_argument("--model", default="inswapper_128_fp16", help="换脸模型名称")
    args = parser.parse_args()

    for f, name in [(args.source, "source"), (args.target, "target")]:
        if not Path(f).exists():
            print(f"[facefusion] 错误：{name} 文件不存在: {f}", file=sys.stderr)
            sys.exit(1)

    ff_script = _find_facefusion_script()
    if not ff_script:
        print(
            "[facefusion] 错误：未找到 facefusion.py。"
            "请确保 runtime/engine/facefusion/ 目录存在（通过 pnpm run setup-engines 安装）。",
            file=sys.stderr,
        )
        sys.exit(1)

    # 探测执行设备
    execution_provider = _detect_provider()

    cmd = [
        sys.executable, ff_script,
        "headless-run",
        "--source-paths", args.source,
        "--target-path", args.target,
        "--output-path", args.output,
        "--face-swapper-model", args.model,
        "--execution-providers", execution_provider,
    ]

    print(f"[facefusion] 执行换脸: provider={execution_provider}", file=sys.stderr)
    print(f"[facefusion] source={args.source}", file=sys.stderr)
    print(f"[facefusion] target={args.target}", file=sys.stderr)

    try:
        result = subprocess.run(cmd, check=False, timeout=600)
    except subprocess.TimeoutExpired:
        print("[facefusion] 错误：执行超时（10 分钟）", file=sys.stderr)
        sys.exit(1)
    except Exception as e:
        print(f"[facefusion] 错误：{e}", file=sys.stderr)
        sys.exit(1)

    if result.returncode != 0:
        print(f"[facefusion] 失败，退出码: {result.returncode}", file=sys.stderr)
        sys.exit(result.returncode)

    if not Path(args.output).exists():
        print(f"[facefusion] 错误：输出文件不存在: {args.output}", file=sys.stderr)
        sys.exit(1)

    print(f"[facefusion] 完成，输出: {args.output}", file=sys.stderr)


def _detect_provider() -> str:
    try:
        import torch
        if torch.cuda.is_available():
            return "cuda"
    except ImportError:
        pass
    import sys as _sys
    if _sys.platform == "darwin":
        return "coreml"
    return "cpu"


if __name__ == "__main__":
    main()
