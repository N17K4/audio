#!/usr/bin/env python3
"""
Seed-VC 持久化推理 Worker（f0_condition=False 模式）。

模型只加载一次，通过 Unix socket 接收 JSON 请求，避免每次转换重复加载。
f0_condition=True 时由适配器回退到子进程模式（需要不同的模型权重）。

协议（换行分隔的 JSON）：
  请求  → {"source": "...", "target": "...", "output": "...",
            "diffusion_steps": 10, "pitch_shift": 0,
            "length_adjust": 1.0, "inference_cfg_rate": 0.7}
  响应  → {"ok": true}  或  {"ok": false, "error": "..."}
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
    p = argparse.ArgumentParser(description="Seed-VC 持久化 Worker")
    p.add_argument("--checkpoint", required=True, help=".pth 模型路径")
    p.add_argument("--config", required=True, help=".yml 配置路径")
    p.add_argument("--socket_path", required=True, help="Unix socket 路径")
    p.add_argument("--device", default="", help="推理设备（默认自动检测）")
    return p.parse_args()


def setup_engine(project_root: Path) -> None:
    """把 engine 目录加入 sys.path，切换 CWD 让 engine 内部的相对路径正确。"""
    engine_dir = project_root / "runtime" / "seed_vc" / "engine"
    if not engine_dir.exists():
        print(f"[seed_vc_worker] engine 目录不存在: {engine_dir}", file=sys.stderr)
        sys.exit(1)
    engine_str = str(engine_dir)
    if engine_str not in sys.path:
        sys.path.insert(0, engine_str)
    # engine/inference.py 模块级：os.environ['HF_HUB_CACHE'] = './checkpoints/hf_cache'
    # 以及 hf_utils.load_custom_model_from_hf(..., cache_dir="./checkpoints")
    # 均使用相对路径，CWD 必须是 checkpoints/ 的父目录。
    # 生产模式 checkpoints 在 userData（而非 app bundle），须从 HF_HUB_CACHE 推算。
    hf_cache = os.getenv("HF_HUB_CACHE", "").strip()
    if hf_cache and Path(hf_cache).parent.parent.exists():
        cwd = str(Path(hf_cache).parent.parent)  # .../userData/  or  project_root/
    else:
        cwd = str(project_root)
    os.chdir(cwd)


def load_engine(checkpoint_pth: str, config_yml: str, device_str: str):
    """加载模型组件，返回 (components, device, sr, hop_length)。"""
    import argparse as _ap
    import torch

    # rvc/fairseq 在 MPS 下会 SIGSEGV，强制 CPU
    if not device_str:
        if torch.cuda.is_available():
            device_str = "cuda"
        else:
            device_str = "cpu"  # MPS 不稳定，默认 CPU

    # engine 的 inference.py 在 import 时会设置 device（module-level），
    # 需要先 patch torch.backends.mps 让它走 CPU 分支
    torch.backends.mps.is_available = lambda: False

    # 导入 engine 的 inference 模块（会执行 module-level device 检测 + HF_HUB_CACHE 设置）
    import inference as _engine

    print(f"[seed_vc_worker] 使用设备: {_engine.device}", file=sys.stderr)

    # 构造最小 args 传给 load_models
    args = _ap.Namespace(
        checkpoint=checkpoint_pth,
        config=config_yml,
        f0_condition=False,
        fp16=False,
    )

    print(f"[seed_vc_worker] 加载模型: {checkpoint_pth}", file=sys.stderr)
    components = _engine.load_models(args)
    print("[seed_vc_worker] 模型加载完成", file=sys.stderr)
    return components, _engine.device, _engine


def run_inference(components, device, engine_mod, req: dict) -> None:
    """用预加载的模型运行一次语音转换，输出到 req['output']。"""
    import numpy as np
    import torch
    import torchaudio
    import librosa
    import soundfile as sf

    model, semantic_fn, f0_fn, vocoder_fn, campplus_model, mel_fn, mel_fn_args = components

    sr = mel_fn_args["sampling_rate"]
    hop_length = mel_fn_args["hop_size"]
    diffusion_steps = int(req.get("diffusion_steps", 10))
    pitch_shift = int(req.get("pitch_shift", 0))        # 暂不用于 f0_condition=False
    length_adjust = float(req.get("length_adjust", 1.0))
    inference_cfg_rate = float(req.get("inference_cfg_rate", 0.7))
    source_path = req["source"]
    target_path = req["target"]
    output_path = req["output"]

    max_context_window = sr // hop_length * 30
    overlap_frame_len = 16
    overlap_wave_len = overlap_frame_len * hop_length

    source_audio = torch.tensor(librosa.load(source_path, sr=sr)[0]).unsqueeze(0).float().to(device)
    ref_audio = torch.tensor(librosa.load(target_path, sr=sr)[0][:sr * 25]).unsqueeze(0).float().to(device)

    # 语义特征提取
    converted_16k = torchaudio.functional.resample(source_audio, sr, 16000)
    if converted_16k.size(-1) <= 16000 * 30:
        S_alt = semantic_fn(converted_16k)
    else:
        ovlap_t = 5
        S_alt_list, buffer, traversed = [], None, 0
        while traversed < converted_16k.size(-1):
            if buffer is None:
                chunk = converted_16k[:, traversed:traversed + 16000 * 30]
            else:
                chunk = torch.cat([buffer, converted_16k[:, traversed:traversed + 16000 * (30 - ovlap_t)]], dim=-1)
            S = semantic_fn(chunk)
            S_alt_list.append(S if traversed == 0 else S[:, 50 * ovlap_t:])
            buffer = chunk[:, -16000 * ovlap_t:]
            traversed += 30 * 16000 if traversed == 0 else chunk.size(-1) - 16000 * ovlap_t
        S_alt = torch.cat(S_alt_list, dim=1)

    ori_16k = torchaudio.functional.resample(ref_audio, sr, 16000)
    S_ori = semantic_fn(ori_16k)

    mel = mel_fn(source_audio.float())
    mel2 = mel_fn(ref_audio.float())

    target_lengths = torch.LongTensor([int(mel.size(2) * length_adjust)]).to(device)
    target2_lengths = torch.LongTensor([mel2.size(2)]).to(device)

    feat2 = torchaudio.compliance.kaldi.fbank(ori_16k, num_mel_bins=80, dither=0, sample_frequency=16000)
    feat2 = feat2 - feat2.mean(dim=0, keepdim=True)
    style2 = campplus_model(feat2.unsqueeze(0))

    # 长度调节（f0_condition=False，无 F0）
    cond, _, _, _, _ = model.length_regulator(S_alt, ylens=target_lengths, n_quantizers=3, f0=None)
    prompt_cond, _, _, _, _ = model.length_regulator(S_ori, ylens=target2_lengths, n_quantizers=3, f0=None)

    max_source_window = max_context_window - mel2.size(2)
    processed_frames = 0
    chunks = []
    prev_chunk = None

    while processed_frames < cond.size(1):
        chunk_cond = cond[:, processed_frames:processed_frames + max_source_window]
        is_last = processed_frames + max_source_window >= cond.size(1)
        cat_cond = torch.cat([prompt_cond, chunk_cond], dim=1)

        _dev = device.type if device.type in ("cuda", "cpu") else "cpu"
        with torch.autocast(device_type=_dev, dtype=torch.float32):
            vc_target = model.cfm.inference(
                cat_cond,
                torch.LongTensor([cat_cond.size(1)]).to(device),
                mel2, style2, None, diffusion_steps,
                inference_cfg_rate=inference_cfg_rate,
            )
            vc_target = vc_target[:, :, mel2.size(-1):]

        # no_grad + clone：cfm.inference() 用 @inference_mode 产生 inference tensor，
        # BigVGAN 的 conv1d 会尝试 save_for_backward 导致报错；
        # 先 clone 脱离 inference_mode，再用 no_grad 避免 requires_grad 问题
        with torch.no_grad():
            wave = vocoder_fn(vc_target.float().clone()).squeeze()[None, :]

        if processed_frames == 0:
            if is_last:
                chunks.append(wave[0].cpu().numpy())
                break
            chunks.append(wave[0, :-overlap_wave_len].cpu().numpy())
            prev_chunk = wave[0, -overlap_wave_len:]
            processed_frames += vc_target.size(2) - overlap_frame_len
        elif is_last:
            c2 = wave[0].cpu().numpy()
            c2 = engine_mod.crossfade(prev_chunk.cpu().numpy(), c2, overlap_wave_len)
            chunks.append(c2)
            break
        else:
            c2 = wave[0, :-overlap_wave_len].cpu().numpy()
            c2 = engine_mod.crossfade(prev_chunk.cpu().numpy(), c2, overlap_wave_len)
            chunks.append(c2)
            prev_chunk = wave[0, -overlap_wave_len:]
            processed_frames += vc_target.size(2) - overlap_frame_len

    result_wave = np.concatenate(chunks)
    Path(output_path).parent.mkdir(parents=True, exist_ok=True)
    sf.write(output_path, result_wave, sr)


def handle_request(conn: socket.socket, components, device, engine_mod) -> None:
    try:
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

        req = json.loads(buf.decode().strip())
        run_inference(components, device, engine_mod, req)
        _send(conn, {"ok": True})

    except Exception as exc:
        import traceback
        traceback.print_exc(file=sys.stderr)
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

    # project_root = runtime/seed_vc 上两级
    project_root = Path(__file__).resolve().parent.parent.parent
    setup_engine(project_root)

    try:
        components, device, engine_mod = load_engine(args.checkpoint, args.config, args.device)
    except Exception as exc:
        import traceback
        traceback.print_exc(file=sys.stderr)
        print(f"[seed_vc_worker] 模型加载失败: {exc}", file=sys.stderr)
        return 1

    socket_path = args.socket_path
    try:
        os.unlink(socket_path)
    except OSError:
        pass

    server_sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    server_sock.bind(socket_path)
    server_sock.listen(5)

    print("ready", flush=True)
    print(f"[seed_vc_worker] 就绪，监听: {socket_path}", file=sys.stderr)

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
        t = threading.Thread(target=handle_request, args=(conn, components, device, engine_mod), daemon=True)
        t.start()

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
