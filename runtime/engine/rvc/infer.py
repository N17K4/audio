#!/usr/bin/env python3
"""RVC 推理脚本（使用 rvc-python 库）
由 runtime.py 自动生成，请勿手動修改。
"""
import argparse
import os
import sys
from pathlib import Path

if not os.environ.get("PYTORCH_ENABLE_MPS_FALLBACK"):
    os.environ["PYTORCH_ENABLE_MPS_FALLBACK"] = "1"

import torch as _torch
_orig_torch_load = _torch.load
def _patched_torch_load(f, map_location=None, pickle_module=None, *, weights_only=False, mmap=None, **kwargs):
    return _orig_torch_load(f, map_location=map_location, pickle_module=pickle_module,
                            weights_only=weights_only, mmap=mmap, **kwargs)
_torch.load = _patched_torch_load

if _torch.backends.mps.is_available():
    _torch.backends.mps.is_available = lambda: False


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

    index_path = str(Path(args.index).resolve()) if args.index else ""
    import platform
    if index_path and sys.platform == "darwin" and platform.machine() == "arm64":
        print(f"[rvc] macOS ARM 跳过 index 文件（faiss-cpu SIGSEGV 规避）: {index_path}", file=sys.stderr)
        index_path = ""

    version = detect_version(args.model)
    try:
        rvc = RVCInference(device="cpu")
        rvc.load_model(args.model, version=version, index_path=index_path)
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
