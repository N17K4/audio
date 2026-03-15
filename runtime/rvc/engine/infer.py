#!/usr/bin/env python3
"""
RVC 推理脚本（使用 rvc-python 库）
由 download_checkpoints.py 自动生成，请勿手动修改。
"""
import argparse
import os
import sys
from pathlib import Path

# macOS ARM：PYTORCH_ENABLE_MPS_FALLBACK=1 允许 MPS 不支持的算子自动降级到 CPU，
# 避免 fairseq/HuBERT 在纯 CPU 模式下触发 SIGSEGV。
# backend/utils/engine.py 的 build_engine_env 统一注入此变量；
# 此处作为本地直接调用的保底。
if not os.environ.get("PYTORCH_ENABLE_MPS_FALLBACK"):
    os.environ["PYTORCH_ENABLE_MPS_FALLBACK"] = "1"

# PyTorch 2.6 将 torch.load 的 weights_only 默认值从 False 改为 True，
# 导致 fairseq 内部调用 torch.load 时无法加载含自定义类（如 Dictionary）的 checkpoint。
# 此处 monkey-patch 恢复旧行为，仅影响本进程内所有 torch.load 调用。
import torch as _torch
_orig_torch_load = _torch.load
def _patched_torch_load(f, map_location=None, pickle_module=None, *, weights_only=False, mmap=None, **kwargs):
    return _orig_torch_load(f, map_location=map_location, pickle_module=pickle_module,
                            weights_only=weights_only, mmap=mmap, **kwargs)
_torch.load = _patched_torch_load


def detect_version(model_path: str) -> str:
    """从 checkpoint 自动检测 v1/v2，避免 emb_phone 尺寸不匹配。"""
    try:
        import torch
        cpt = torch.load(model_path, map_location="cpu", weights_only=False)
        # 优先从 checkpoint 自身读取 version 字段
        version = cpt.get("version", "")
        if version in ("v1", "v2"):
            return version
        # 若无 version 字段，根据 emb_phone 权重维度判断
        emb = cpt.get("weight", {}).get("enc_p.emb_phone.weight")
        if emb is not None:
            return "v2" if emb.shape[1] == 768 else "v1"
    except Exception:
        pass
    return "v2"  # 保守默认


def main() -> int:
    parser = argparse.ArgumentParser(description="RVC 语音转换")
    parser.add_argument("--input",  required=True, help="输入音频路径")
    parser.add_argument("--output", required=True, help="输出音频路径")
    parser.add_argument("--model",  required=True, help="模型 .pth 路径")
    parser.add_argument("--index",  default="",    help="索引文件路径（可选）")
    parser.add_argument("--f0-up-key",     type=int,   default=None, help="音调偏移半音（默认 0）")
    parser.add_argument("--f0-method",     default=None,             help="F0 提取方法（默认 rmvpe）")
    parser.add_argument("--filter-radius", type=int,   default=None, help="F0 平滑半径（默认 3）")
    parser.add_argument("--index-rate",    type=float, default=None, help="索引文件混合率（默认 0.75）")
    parser.add_argument("--rms-mix-rate",  type=float, default=None, help="音量包络混合率（默认 0.25）")
    parser.add_argument("--protect",       type=float, default=None, help="清音保护强度（默认 0.33）")
    args = parser.parse_args()

    try:
        from rvc_python.infer import RVCInference
    except ImportError:
        print("[rvc] 缺少 rvc-python 包，请重新运行 pnpm run checkpoints。", file=sys.stderr)
        return 1

    input_path  = str(Path(args.input).resolve())
    output_path = str(Path(args.output).resolve())
    model_path  = str(Path(args.model).resolve())
    index_path  = str(Path(args.index).resolve()) if args.index else ""

    # macOS ARM：faiss-cpu 读取 index 文件时会 SIGSEGV（无法被 Python 捕获）
    # 跳过 index 文件，降级到无 index 推理（音质略低但可用）
    import sys as _sys, platform as _platform
    if index_path and _sys.platform == "darwin" and _platform.machine() == "arm64":
        print(f"[rvc] macOS ARM 跳过 index 文件（faiss-cpu SIGSEGV 规避）: {index_path}", file=sys.stderr)
        index_path = ""

    version = detect_version(model_path)

    # 从环境变量读取质量参数（fallback），CLI 参数优先
    import os as _os
    f0_up_key    = args.f0_up_key    if args.f0_up_key    is not None else int(_os.environ.get("RVC_F0_UP_KEY", "0"))
    # rmvpe 依赖 fairseq，在 macOS ARM CPU 模式下会 SIGSEGV；改用 harvest（pyworld，无神经网络依赖）
    f0_method    = args.f0_method    if args.f0_method    is not None else _os.environ.get("RVC_F0_METHOD", "harvest")
    filter_radius= args.filter_radius if args.filter_radius is not None else int(_os.environ.get("RVC_FILTER_RADIUS", "3"))
    index_rate   = args.index_rate   if args.index_rate   is not None else float(_os.environ.get("RVC_INDEX_RATE", "0.75"))
    rms_mix_rate = args.rms_mix_rate if args.rms_mix_rate is not None else float(_os.environ.get("RVC_RMS_MIX_RATE", "0.25"))
    protect      = args.protect      if args.protect      is not None else float(_os.environ.get("RVC_PROTECT", "0.33"))

    import time as _time
    try:
        print(f"[rvc] 初始化 RVCInference device=cpu", file=sys.stderr, flush=True)
        _t0 = _time.monotonic()
        rvc = RVCInference(device="cpu")
        print(f"[rvc] RVCInference 初始化完成 ({_time.monotonic()-_t0:.1f}s)", file=sys.stderr, flush=True)

        print(f"[rvc] 加载模型: {model_path}  version={version}  index={index_path!r}", file=sys.stderr, flush=True)
        _t1 = _time.monotonic()
        rvc.load_model(model_path, version=version, index_path=index_path)
        print(f"[rvc] 模型加载完成 ({_time.monotonic()-_t1:.1f}s)", file=sys.stderr, flush=True)

        print(f"[rvc] 设置参数: f0up_key={f0_up_key} f0method={f0_method} "
              f"filter_radius={filter_radius} index_rate={index_rate} "
              f"rms_mix_rate={rms_mix_rate} protect={protect}", file=sys.stderr, flush=True)
        rvc.set_params(
            f0up_key=f0_up_key,
            f0method=f0_method,
            filter_radius=filter_radius,
            index_rate=index_rate,
            rms_mix_rate=rms_mix_rate,
            protect=protect,
        )
        print(f"[rvc] 开始推理: {input_path} -> {output_path}", file=sys.stderr, flush=True)
        _t2 = _time.monotonic()
        rvc.infer_file(input_path, output_path)
        print(f"[rvc] 推理完成 ({_time.monotonic()-_t2:.1f}s，总计 {_time.monotonic()-_t0:.1f}s)", file=sys.stderr, flush=True)
    except Exception as e:
        import traceback
        print(f"[rvc] 推理失败: {e}", file=sys.stderr)
        traceback.print_exc(file=sys.stderr)
        return 1

    if not Path(output_path).exists() or Path(output_path).stat().st_size == 0:
        print("[rvc] 输出文件缺失或为空", file=sys.stderr)
        return 1

    print(f"[rvc] ok -> {output_path}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
