#!/usr/bin/env python3
"""
Fish Speech v2 独立推理 CLI。

直接调用 fish_speech 包完成 TTS，无需启动 HTTP 服务器。

用法：
  python fish_speech_cli.py \\
    --text "要合成的文本" \\
    --output /path/to/output.wav \\
    [--voice_ref /path/to/ref.wav] \\
    --checkpoint_dir /path/to/checkpoints/fish_speech

checkpoint_dir 应包含：
  - model.pth              (LLaMA 权重)
  - firefly-gan-vq-fsq-8x1024-21hz-generator.pth  (Decoder 权重)
  - config.json
  - tokenizer.tiktoken
"""

from __future__ import annotations

import argparse
import os
import sys
import time
from pathlib import Path


def _ts() -> str:
    """返回 +Xs 相对于启动时的时间戳。"""
    return f"+{time.time() - _START:.1f}s"


_START = time.time()


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Fish Speech v2 TTS 推理")
    parser.add_argument("--text", required=True, help="要合成的文本")
    parser.add_argument("--output", required=True, help="输出 WAV 路径")
    parser.add_argument("--voice_ref", default="", help="参考音频路径（可选，用于声音克隆）")
    parser.add_argument("--checkpoint_dir", required=True, help="模型权重目录")
    return parser.parse_args()


def main() -> int:
    args = parse_args()

    checkpoint_dir = Path(args.checkpoint_dir).resolve()
    output_path = Path(args.output).resolve()
    output_path.parent.mkdir(parents=True, exist_ok=True)

    print(f"[fish_speech_cli] {_ts()} 启动，Python {sys.version.split()[0]}", file=sys.stderr)
    print(f"[fish_speech_cli] {_ts()} checkpoint_dir={checkpoint_dir}", file=sys.stderr)
    print(f"[fish_speech_cli] {_ts()} output={output_path}", file=sys.stderr)

    # engine 目录：本脚本位于 runtime/fish_speech/，engine 在 runtime/fish_speech/engine/
    engine_dir = Path(__file__).resolve().parent / "engine"
    print(f"[fish_speech_cli] {_ts()} engine_dir={engine_dir}  exists={engine_dir.exists()}", file=sys.stderr)
    if not engine_dir.exists():
        print(f"[fish_speech_cli] {_ts()} ERROR: engine 目录不存在", file=sys.stderr)
        return 3

    # 将 engine 目录加入 sys.path，使 fish_speech 包可导入
    engine_dir_str = str(engine_dir)
    if engine_dir_str not in sys.path:
        sys.path.insert(0, engine_dir_str)

    # pyrootutils 需要在 engine 目录下找到 .project-root 标记
    orig_cwd = os.getcwd()
    os.chdir(engine_dir_str)
    print(f"[fish_speech_cli] {_ts()} chdir -> {engine_dir_str}", file=sys.stderr)

    try:
        import pyrootutils
        pyrootutils.setup_root(__file__, indicator=".project-root", pythonpath=True)
        print(f"[fish_speech_cli] {_ts()} pyrootutils OK", file=sys.stderr)
    except Exception as e:
        print(f"[fish_speech_cli] {_ts()} pyrootutils 跳过: {e}", file=sys.stderr)

    print(f"[fish_speech_cli] {_ts()} 导入 torch/fish_speech...", file=sys.stderr)
    try:
        import torch
        print(f"[fish_speech_cli] {_ts()} torch {torch.__version__} 导入 OK", file=sys.stderr)
        from fish_speech.inference_engine import TTSInferenceEngine
        print(f"[fish_speech_cli] {_ts()} TTSInferenceEngine 导入 OK", file=sys.stderr)
        from fish_speech.models.dac.inference import load_model as load_decoder_model
        print(f"[fish_speech_cli] {_ts()} load_decoder_model 导入 OK", file=sys.stderr)
        from fish_speech.models.text2semantic.inference import launch_thread_safe_queue
        print(f"[fish_speech_cli] {_ts()} launch_thread_safe_queue 导入 OK", file=sys.stderr)
        from fish_speech.utils.schema import ServeReferenceAudio, ServeTTSRequest
        print(f"[fish_speech_cli] {_ts()} schema 导入 OK", file=sys.stderr)
        import soundfile as sf
        import numpy as np
        print(f"[fish_speech_cli] {_ts()} soundfile/numpy 导入 OK", file=sys.stderr)
    except ImportError as e:
        print(f"[fish_speech_cli] {_ts()} ERROR 导入失败: {e}", file=sys.stderr)
        print(
            "[fish_speech_cli] 缺少必要依赖，请重新运行 pnpm run checkpoints 安装。",
            file=sys.stderr,
        )
        os.chdir(orig_cwd)
        return 3

    # 检查权重文件
    llama_ckpt = checkpoint_dir / "model.pth"
    decoder_ckpt = checkpoint_dir / "firefly-gan-vq-fsq-8x1024-21hz-generator.pth"
    print(f"[fish_speech_cli] {_ts()} llama_ckpt={llama_ckpt}  exists={llama_ckpt.exists()}", file=sys.stderr)
    print(f"[fish_speech_cli] {_ts()} decoder_ckpt={decoder_ckpt}  exists={decoder_ckpt.exists()}", file=sys.stderr)
    if not llama_ckpt.exists():
        print(f"[fish_speech_cli] {_ts()} ERROR: 缺少 LLaMA 权重", file=sys.stderr)
        os.chdir(orig_cwd)
        return 2
    if not decoder_ckpt.exists():
        print(f"[fish_speech_cli] {_ts()} ERROR: 缺少 Decoder 权重", file=sys.stderr)
        os.chdir(orig_cwd)
        return 2

    # 选择运算设备
    mps_ok = torch.backends.mps.is_available()
    cuda_ok = torch.cuda.is_available()
    print(f"[fish_speech_cli] {_ts()} MPS={mps_ok} CUDA={cuda_ok}", file=sys.stderr)
    if mps_ok:
        device = "mps"
    elif cuda_ok:
        device = "cuda"
    else:
        device = "cpu"

    precision = torch.bfloat16
    print(f"[fish_speech_cli] {_ts()} 使用设备: {device}  精度: bfloat16", file=sys.stderr)

    print(f"[fish_speech_cli] {_ts()} 加载 LLaMA 模型中...", file=sys.stderr)
    t_llama = time.time()
    try:
        llama_queue = launch_thread_safe_queue(
            checkpoint_path=str(llama_ckpt),
            device=device,
            precision=precision,
            compile=False,
        )
        print(f"[fish_speech_cli] {_ts()} LLaMA 加载完成 ({time.time()-t_llama:.1f}s)", file=sys.stderr)
    except Exception as e:
        print(f"[fish_speech_cli] {_ts()} ERROR 加载 LLaMA 失败: {e}", file=sys.stderr)
        import traceback; traceback.print_exc(file=sys.stderr)
        os.chdir(orig_cwd)
        return 1

    print(f"[fish_speech_cli] {_ts()} 加载 Decoder 模型中...", file=sys.stderr)
    t_dec = time.time()
    try:
        decoder_model = load_decoder_model(
            config_name="modded_dac_vq",
            checkpoint_path=str(decoder_ckpt),
            device=device,
        )
        print(f"[fish_speech_cli] {_ts()} Decoder 加载完成 ({time.time()-t_dec:.1f}s)", file=sys.stderr)
    except Exception as e:
        print(f"[fish_speech_cli] {_ts()} ERROR 加载 Decoder 失败: {e}", file=sys.stderr)
        import traceback; traceback.print_exc(file=sys.stderr)
        os.chdir(orig_cwd)
        return 1

    print(f"[fish_speech_cli] {_ts()} 初始化 TTSInferenceEngine...", file=sys.stderr)
    engine = TTSInferenceEngine(
        llama_queue=llama_queue,
        decoder_model=decoder_model,
        precision=precision,
        compile=False,
    )
    print(f"[fish_speech_cli] {_ts()} Engine 初始化完成", file=sys.stderr)

    # 构造请求
    references: list[ServeReferenceAudio] = []
    if args.voice_ref:
        voice_ref_path = Path(args.voice_ref)
        if voice_ref_path.exists() and voice_ref_path.stat().st_size > 0:
            ref_size = voice_ref_path.stat().st_size
            print(f"[fish_speech_cli] {_ts()} 使用参考音频: {voice_ref_path} ({ref_size} bytes)", file=sys.stderr)
            references = [
                ServeReferenceAudio(
                    audio=voice_ref_path.read_bytes(),
                    text="",
                )
            ]
        else:
            print(f"[fish_speech_cli] {_ts()} 参考音频不存在或为空，跳过: {voice_ref_path}", file=sys.stderr)
    else:
        print(f"[fish_speech_cli] {_ts()} 无参考音频（零样本合成）", file=sys.stderr)

    req = ServeTTSRequest(
        text=args.text,
        references=references,
        streaming=False,
        format="wav",
    )

    print(f"[fish_speech_cli] {_ts()} 开始推理 ({len(args.text)} 字): {args.text[:60]}{'...' if len(args.text) > 60 else ''}", file=sys.stderr)
    t_infer = time.time()

    audio_data = None
    sample_rate = 44100
    result_count = 0

    try:
        for result in engine.inference(req):
            result_count += 1
            code = getattr(result, 'code', '?')
            print(f"[fish_speech_cli] {_ts()} inference result #{result_count} code={code}", file=sys.stderr)
            if code == "error":
                err = getattr(result, 'error', str(result))
                print(f"[fish_speech_cli] {_ts()} ERROR 推理错误: {err}", file=sys.stderr)
                os.chdir(orig_cwd)
                return 1
            elif code == "final":
                audio = getattr(result, 'audio', None)
                print(f"[fish_speech_cli] {_ts()} final audio type={type(audio)}", file=sys.stderr)
                if isinstance(audio, tuple):
                    sample_rate, audio_data = audio
                    print(f"[fish_speech_cli] {_ts()} audio shape={getattr(audio_data, 'shape', 'n/a')} sample_rate={sample_rate}", file=sys.stderr)
                break
        print(f"[fish_speech_cli] {_ts()} 推理完成，共 {result_count} 个 result，耗时 {time.time()-t_infer:.1f}s", file=sys.stderr)
    except Exception as e:
        print(f"[fish_speech_cli] {_ts()} ERROR 推理异常: {e}", file=sys.stderr)
        import traceback; traceback.print_exc(file=sys.stderr)
        os.chdir(orig_cwd)
        return 1

    os.chdir(orig_cwd)

    if audio_data is None:
        print(f"[fish_speech_cli] {_ts()} ERROR: 未生成音频（result_count={result_count}）", file=sys.stderr)
        return 1

    # audio_data 是 float32/float64 numpy 数组，soundfile 可直接写入
    if isinstance(audio_data, np.ndarray):
        audio_np = audio_data
    else:
        # torch.Tensor
        audio_np = audio_data.cpu().float().numpy()

    print(f"[fish_speech_cli] {_ts()} audio_np shape={audio_np.shape} dtype={audio_np.dtype}", file=sys.stderr)

    # 确保是 1D 或 2D (samples, channels)
    if audio_np.ndim == 1:
        pass
    elif audio_np.ndim == 2 and audio_np.shape[0] < audio_np.shape[1]:
        # (channels, samples) → (samples, channels)
        audio_np = audio_np.T
        print(f"[fish_speech_cli] {_ts()} 转置后 shape={audio_np.shape}", file=sys.stderr)

    print(f"[fish_speech_cli] {_ts()} 写入文件: {output_path}", file=sys.stderr)
    sf.write(str(output_path), audio_np, int(sample_rate))
    total = time.time() - _START
    print(f"[fish_speech_cli] ok -> {output_path}  总耗时 {total:.1f}s")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
