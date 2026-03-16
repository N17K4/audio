#!/usr/bin/env python3
"""
Fish Speech 1.5 持久化推理 Worker。

模型只加载一次，通过 Unix socket 接收 JSON 请求，避免每次 TTS 重复加载模型。

协议（换行分隔的 JSON）：
  请求  → {"text": "...", "voice_ref": "/path", "output": "/path"}
  响应  → {"ok": true}  或  {"ok": false, "error": "..."}

与 inference.py 配合使用，由 inference.py 负责 worker 生命周期管理。
"""
from __future__ import annotations

import argparse
import json
import os
import signal
import socket
import sys
import threading
from pathlib import Path


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Fish Speech 1.5 持久化 Worker")
    p.add_argument("--checkpoint_dir", required=True, help="模型权重目录")
    p.add_argument("--socket_path", required=True, help="Unix socket 路径")
    p.add_argument("--device", default="", help="推理设备（默认自动检测）")
    return p.parse_args()


def load_engine(checkpoint_dir: str, device: str):
    """加载 LLaMA + FireflyGAN 解码器，返回 TTSInferenceEngine 实例（fish-speech-1.5）。"""
    import time as _time
    _t0 = _time.monotonic()

    engine_dir = Path(__file__).resolve().parent.parent.parent / "runtime" / "fish_speech" / "engine"
    engine_dir_str = str(engine_dir)
    if engine_dir_str not in sys.path:
        sys.path.insert(0, engine_dir_str)

    # pyrootutils 需要在 engine 目录下找到 .project-root 标记
    orig_cwd = os.getcwd()
    os.chdir(engine_dir_str)
    try:
        import pyrootutils
        pyrootutils.setup_root(__file__, indicator=".project-root", pythonpath=True)
    except Exception:
        pass

    import torch
    from tools.inference_engine import TTSInferenceEngine
    from tools.vqgan.inference import load_model as load_decoder_model
    from tools.llama.generate import launch_thread_safe_queue

    os.chdir(orig_cwd)

    if not device:
        if torch.backends.mps.is_available():
            device = "mps"
        elif torch.cuda.is_available():
            device = "cuda"
        else:
            device = "cpu"

    print(f"[fish_speech_worker] 使用设备: {device}", file=sys.stderr, flush=True)

    # MPS 不完整支持 bfloat16（torch.isin dtype mismatch），改用 float16
    precision = torch.float16 if device == "mps" else torch.bfloat16
    checkpoint_path = Path(checkpoint_dir)
    llama_ckpt = checkpoint_path / "model.pth"
    decoder_ckpt = checkpoint_path / "firefly-gan-vq-fsq-8x1024-21hz-generator.pth"

    if not llama_ckpt.exists():
        raise FileNotFoundError(f"LLaMA 权重缺失: {llama_ckpt}")
    if not decoder_ckpt.exists():
        raise FileNotFoundError(f"Decoder 权重缺失: {decoder_ckpt}")

    print(f"[fish_speech_worker] [1/3] 开始加载 LLaMA: {llama_ckpt}", file=sys.stderr, flush=True)
    _t1 = _time.monotonic()
    llama_queue = launch_thread_safe_queue(
        checkpoint_path=str(checkpoint_path),
        device=device,
        precision=precision,
        compile=False,
    )
    print(f"[fish_speech_worker] [1/3] LLaMA 加载完成，耗时 {_time.monotonic()-_t1:.1f}s", file=sys.stderr, flush=True)

    print(f"[fish_speech_worker] [2/3] 开始加载 Decoder: {decoder_ckpt}", file=sys.stderr, flush=True)
    _t2 = _time.monotonic()
    decoder_model = load_decoder_model(
        config_name="firefly_gan_vq",
        checkpoint_path=str(decoder_ckpt),
        device=device,
    )
    print(f"[fish_speech_worker] [2/3] Decoder 加载完成，耗时 {_time.monotonic()-_t2:.1f}s", file=sys.stderr, flush=True)

    print(f"[fish_speech_worker] [3/3] 初始化推理引擎...", file=sys.stderr, flush=True)
    _t3 = _time.monotonic()
    engine = TTSInferenceEngine(
        llama_queue=llama_queue,
        decoder_model=decoder_model,
        precision=precision,
        compile=False,
    )
    print(f"[fish_speech_worker] [3/3] 引擎就绪，总加载耗时 {_time.monotonic()-_t0:.1f}s", file=sys.stderr, flush=True)
    return engine


def handle_request(conn: socket.socket, engine) -> None:
    """处理单个 socket 连接：读取请求 → 推理 → 写回结果。"""
    try:
        # 读取直到换行（请求是单行 JSON）
        buf = b""
        conn.settimeout(10.0)
        try:
            while b"\n" not in buf:
                chunk = conn.recv(65536)
                if not chunk:
                    break
                buf += chunk
        except socket.timeout:
            pass

        if not buf.strip():
            return

        req_dict = json.loads(buf.decode().strip())
        text = req_dict["text"]
        output_path = req_dict["output"]

        # 延迟 import — 只在模型加载完成后进来才 import
        from tools.schema import ServeReferenceAudio, ServeTTSRequest
        import soundfile as sf
        import numpy as np

        # 支持多参考音频：voice_refs（列表）优先，向后兼容 voice_ref（单字符串）
        voice_refs = req_dict.get("voice_refs") or (
            [req_dict["voice_ref"]] if req_dict.get("voice_ref") else []
        )
        references = [
            ServeReferenceAudio(audio=Path(vr).read_bytes(), text="")
            for vr in voice_refs
            if vr and Path(vr).exists() and Path(vr).stat().st_size > 0
        ]

        req = ServeTTSRequest(text=text, references=references, streaming=False, format="wav")

        import time as _t
        _infer_t0 = _t.monotonic()
        print(f"[fish_speech_worker] 开始推理，文本长度={len(text)}", file=sys.stderr, flush=True)
        audio_data = None
        sample_rate = 44100
        for result in engine.inference(req):
            if result.code == "error":
                _send(conn, {"ok": False, "error": str(result.error)})
                return
            elif result.code == "final":
                if isinstance(result.audio, tuple):
                    sample_rate, audio_data = result.audio
                break

        if audio_data is None:
            _send(conn, {"ok": False, "error": "推理未生成音频"})
            return

        if not isinstance(audio_data, np.ndarray):
            audio_data = audio_data.cpu().float().numpy()
        # (channels, samples) → (samples, channels)
        if audio_data.ndim == 2 and audio_data.shape[0] < audio_data.shape[1]:
            audio_data = audio_data.T

        Path(output_path).parent.mkdir(parents=True, exist_ok=True)
        sf.write(output_path, audio_data, int(sample_rate))
        print(f"[fish_speech_worker] 推理完成，耗时 {_t.monotonic()-_infer_t0:.1f}s，输出: {output_path}", file=sys.stderr, flush=True)
        _send(conn, {"ok": True})

    except Exception as exc:
        import traceback
        err = traceback.format_exc()
        print(f"[fish_speech_worker] 请求处理异常:\n{err}", file=sys.stderr)
        try:
            _send(conn, {"ok": False, "error": str(exc)})
        except Exception:
            pass
    finally:
        conn.close()


def _send(conn: socket.socket, payload: dict) -> None:
    conn.sendall((json.dumps(payload, ensure_ascii=False) + "\n").encode())


def main() -> int:
    args = parse_args()
    socket_path = args.socket_path

    # 清理旧的 socket 文件（上次意外退出可能遗留）
    try:
        os.unlink(socket_path)
    except OSError:
        pass

    print(f"[fish_speech_worker] 启动中，加载模型: {args.checkpoint_dir}", file=sys.stderr)
    try:
        engine = load_engine(args.checkpoint_dir, args.device)
    except Exception as exc:
        import traceback
        traceback.print_exc(file=sys.stderr)
        print(f"[fish_speech_worker] 模型加载失败: {exc}", file=sys.stderr)
        return 1

    # 创建 Unix socket 并开始监听
    server_sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    server_sock.bind(socket_path)
    server_sock.listen(5)

    # 向 stdout 输出 "ready"，通知 inference.py 可以开始接受请求
    print("ready", flush=True)
    print(f"[fish_speech_worker] 就绪，监听: {socket_path}", file=sys.stderr)

    def _cleanup(signum=None, frame=None):
        try:
            server_sock.close()
        except Exception:
            pass
        try:
            os.unlink(socket_path)
        except OSError:
            pass
        sys.exit(0)

    signal.signal(signal.SIGTERM, _cleanup)

    while True:
        try:
            conn, _ = server_sock.accept()
        except OSError:
            break
        # 每个请求在独立线程中处理，worker 可持续接收新请求
        t = threading.Thread(target=handle_request, args=(conn, engine), daemon=True)
        t.start()

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
