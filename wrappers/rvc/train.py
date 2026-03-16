#!/usr/bin/env python3
"""
RVC 音色训练脚本 — ContentVec 特征提取 + FAISS 索引构建

工作流程：
1. 解压并预处理音频数据集（重采样到 40kHz）
2. 使用 ContentVec（hubert_base.pt）提取 256 维内容特征
3. 构建 FAISS IVF 检索索引（.index 文件）
4. 查找预训练 RVC v2 基础模型作为 model.pth
5. 写出 meta.json 推理配置

进度通过 stdout 以 JSON 行格式上报：
  {"step": "preprocessing", "progress": 10, "message": "..."}
  {"step": "done", "progress": 100, "voice_id": "..."}
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import zipfile
import tempfile
import time
from pathlib import Path

# macOS ARM：PYTORCH_ENABLE_MPS_FALLBACK 允许不支持的算子自动降级到 CPU
if not os.environ.get("PYTORCH_ENABLE_MPS_FALLBACK"):
    os.environ["PYTORCH_ENABLE_MPS_FALLBACK"] = "1"


def _emit(step: str, progress: int, message: str, **extra) -> None:
    """向 stdout 输出 JSON 格式的进度信息，供 backend 解析。"""
    payload = {"step": step, "progress": progress, "message": message, **extra}
    print(json.dumps(payload, ensure_ascii=False), flush=True)


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="RVC 音色训练")
    p.add_argument("--dataset", required=True, help="数据集路径（zip 压缩包或单个音频文件）")
    p.add_argument("--voice-dir", required=True, help="音色输出目录")
    p.add_argument("--voice-id", required=True, help="音色 ID")
    p.add_argument("--voice-name", default="", help="音色显示名称")
    p.add_argument("--epochs", type=int, default=0, help="精细训练轮数，0 表示仅构建索引")
    p.add_argument("--f0-method", default="harvest", help="F0 提取方法（harvest/rmvpe/pm）")
    p.add_argument("--sample-rate", type=int, default=40000, help="目标采样率（40000/48000）")
    p.add_argument("--checkpoint-dir", default="", help="RVC checkpoint 目录（含 hubert_base.pt）")
    return p.parse_args()


def _get_checkpoint_dir(arg_value: str) -> Path:
    """解析 checkpoint 目录：命令行参数 → 环境变量 → manifest → 默认路径。"""
    if arg_value.strip():
        return Path(arg_value.strip()).resolve()
    env_val = (os.environ.get("RVC_CHECKPOINT_DIR") or "").strip()
    if env_val:
        return Path(env_val).resolve()
    base = Path(__file__).resolve().parent.parent.parent
    manifest_path = base / "wrappers" / "manifest.json"
    if manifest_path.exists():
        try:
            data = json.loads(manifest_path.read_text(encoding="utf-8"))
            rel = (data.get("engines") or {}).get("rvc", {}).get("checkpoint_dir", "")
            if rel:
                return (base / rel).resolve()
        except Exception:
            pass
    return (base / "checkpoints" / "rvc").resolve()


def extract_audio_files(dataset_path: Path, work_dir: Path) -> list[Path]:
    """解压数据集，返回所有音频文件路径列表。"""
    audio_exts = {".wav", ".mp3", ".flac", ".ogg", ".m4a", ".aac", ".opus", ".wma"}
    audio_files: list[Path] = []

    if dataset_path.suffix.lower() == ".zip":
        _emit("preprocessing", 2, f"正在解压数据集 {dataset_path.name}...")
        try:
            with zipfile.ZipFile(dataset_path, "r") as zf:
                zf.extractall(work_dir / "raw")
        except zipfile.BadZipFile as e:
            print(f"[rvc-train] ZIP 解压失败: {e}", file=sys.stderr)
            sys.exit(1)
        for p in (work_dir / "raw").rglob("*"):
            if p.is_file() and p.suffix.lower() in audio_exts:
                audio_files.append(p)
    elif dataset_path.suffix.lower() in audio_exts:
        # 单个音频文件
        audio_files.append(dataset_path)
    else:
        # 尝试作为目录
        if dataset_path.is_dir():
            for p in dataset_path.rglob("*"):
                if p.is_file() and p.suffix.lower() in audio_exts:
                    audio_files.append(p)
        else:
            print(f"[rvc-train] 不支持的数据集格式: {dataset_path}", file=sys.stderr)
            sys.exit(1)

    if not audio_files:
        print("[rvc-train] 数据集中未找到有效音频文件", file=sys.stderr)
        sys.exit(1)

    _emit("preprocessing", 5, f"找到 {len(audio_files)} 个音频文件")
    return audio_files


def preprocess_audio(audio_files: list[Path], out_dir: Path, target_sr: int) -> list[Path]:
    """将所有音频文件重采样到目标采样率，转为单声道 WAV，并切片到 3-30 秒。"""
    try:
        import soundfile as sf
        import numpy as np
    except ImportError as e:
        print(f"[rvc-train] 缺少依赖包: {e}，请运行 pnpm run checkpoints", file=sys.stderr)
        sys.exit(1)

    # 尝试导入 librosa 或 torchaudio 用于重采样
    _resample_fn = None
    try:
        import librosa
        def _resample_librosa(data, orig_sr, tgt_sr):
            return librosa.resample(data.astype(np.float32), orig_sr=orig_sr, target_sr=tgt_sr)
        _resample_fn = _resample_librosa
    except ImportError:
        try:
            import torchaudio
            import torch
            def _resample_torch(data, orig_sr, tgt_sr):
                tensor = torch.from_numpy(data.astype(np.float32))
                resampled = torchaudio.functional.resample(tensor, orig_sr, tgt_sr)
                return resampled.numpy()
            _resample_fn = _resample_torch
        except ImportError:
            pass

    out_dir.mkdir(parents=True, exist_ok=True)
    processed: list[Path] = []
    max_clip_len = 30  # seconds
    min_clip_len = 1   # seconds

    for i, src in enumerate(audio_files):
        _emit("preprocessing", 5 + int(15 * i / max(len(audio_files), 1)),
              f"预处理音频 {i+1}/{len(audio_files)}: {src.name}")
        try:
            data, sr = sf.read(str(src))
        except Exception as e:
            print(f"[rvc-train] 读取失败 {src}: {e}", file=sys.stderr)
            continue

        if data.ndim > 1:
            data = data.mean(axis=1)

        # 重采样
        if sr != target_sr and _resample_fn is not None:
            data = _resample_fn(data, sr, target_sr)
            sr = target_sr
        elif sr != target_sr:
            print(f"[rvc-train] 警告: {src.name} 采样率 {sr} 与目标 {target_sr} 不匹配，跳过重采样", file=sys.stderr)

        # 归一化
        max_val = np.abs(data).max()
        if max_val > 0:
            data = data / max_val * 0.95

        # 切片（避免超长片段耗尽内存）
        chunk_len = int(max_clip_len * sr)
        clips = [data[j:j + chunk_len] for j in range(0, len(data), chunk_len)]

        for k, clip in enumerate(clips):
            if len(clip) < int(min_clip_len * sr):
                continue
            out_path = out_dir / f"{src.stem}_{k:03d}.wav"
            sf.write(str(out_path), clip.astype(np.float32), sr)
            processed.append(out_path)

    if not processed:
        print("[rvc-train] 预处理后无有效音频片段", file=sys.stderr)
        sys.exit(1)

    _emit("preprocessing", 20, f"预处理完成，共 {len(processed)} 个音频片段")
    return processed


def load_contentvec(hubert_path: Path, device: str):
    """使用 fairseq 加载 ContentVec/HuBERT 模型。"""
    try:
        import fairseq
    except ImportError:
        print("[rvc-train] 缺少 fairseq 包，请运行 pnpm run checkpoints", file=sys.stderr)
        sys.exit(1)

    # PyTorch 2.6 将 torch.load 的 weights_only 默认值改为 True，
    # 但 fairseq checkpoint 包含 fairseq.data.dictionary.Dictionary，
    # 需要显式注册为安全全局类才能正常加载。
    try:
        import torch
        from fairseq.data.dictionary import Dictionary
        torch.serialization.add_safe_globals([Dictionary])
    except Exception:
        pass

    try:
        models, _, _ = fairseq.checkpoint_utils.load_model_ensemble_and_task(
            [str(hubert_path)],
            suffix="",
        )
    except Exception as e:
        print(f"[rvc-train] 加载 ContentVec 失败: {e}", file=sys.stderr)
        sys.exit(1)

    model = models[0]
    try:
        import torch
        model = model.to(device)
    except Exception:
        pass
    model.eval()
    return model


def extract_features(model, audio_files: list[Path]) -> list:
    """从预处理后的音频中提取 ContentVec 特征（256 维），返回 numpy 数组列表。"""
    try:
        import torch
        import numpy as np
        import soundfile as sf
    except ImportError as e:
        print(f"[rvc-train] 缺少依赖包: {e}", file=sys.stderr)
        sys.exit(1)

    # 检测设备
    device = "cpu"
    if torch.cuda.is_available():
        device = "cuda"
    elif hasattr(torch.backends, "mps") and torch.backends.mps.is_available():
        device = "mps"

    # HuBERT 需要 16kHz 输入
    hbt_sr = 16000

    all_features: list = []
    total = len(audio_files)

    try:
        import librosa
        def _to16k(data, sr):
            return librosa.resample(data.astype(np.float32), orig_sr=sr, target_sr=hbt_sr)
    except ImportError:
        try:
            import torchaudio
            def _to16k(data, sr):
                t = torch.from_numpy(data.astype(np.float32))
                return torchaudio.functional.resample(t, sr, hbt_sr).numpy()
        except ImportError:
            def _to16k(data, sr):
                # 朴素重采样（质量低，仅备用）
                ratio = hbt_sr / sr
                new_len = int(len(data) * ratio)
                idx = np.round(np.linspace(0, len(data) - 1, new_len)).astype(int)
                return data[idx].astype(np.float32)

    for i, audio_path in enumerate(audio_files):
        _emit("features", 20 + int(40 * i / max(total, 1)),
              f"提取特征 {i+1}/{total}: {audio_path.name}")
        try:
            data, sr = sf.read(str(audio_path))
        except Exception as e:
            print(f"[rvc-train] 读取失败 {audio_path}: {e}", file=sys.stderr)
            continue

        if data.ndim > 1:
            data = data.mean(axis=1)

        if sr != hbt_sr:
            data = _to16k(data, sr)

        # 分块提取，避免 OOM（每块最多 5 秒）
        chunk = int(hbt_sr * 5)
        for start in range(0, len(data), chunk):
            seg = data[start:start + chunk]
            if len(seg) < 400:
                continue
            feats_tensor = torch.from_numpy(seg).float().unsqueeze(0)
            if device in ("cuda", "mps"):
                feats_tensor = feats_tensor.to(device)
            pad_mask = torch.BoolTensor(feats_tensor.shape).fill_(False)
            if device in ("cuda", "mps"):
                pad_mask = pad_mask.to(device)
            try:
                with torch.no_grad():
                    out = model.extract_features(
                        source=feats_tensor,
                        padding_mask=pad_mask,
                        mask=False,
                        output_layer=9,
                    )
                    seg_feats = out[0].squeeze(0).cpu().float().numpy()
                all_features.append(seg_feats)
            except Exception as e:
                print(f"[rvc-train] 特征提取失败 {audio_path.name} 块 {start}: {e}", file=sys.stderr)
                continue

    if not all_features:
        print("[rvc-train] 未能提取任何特征", file=sys.stderr)
        sys.exit(1)

    _emit("features", 60, f"特征提取完成，共 {sum(len(f) for f in all_features)} 帧")
    return all_features


def build_index(all_features: list, voice_dir: Path) -> Path:
    """从特征数组列表构建 FAISS 检索索引，写入 voice_dir/index.index。"""
    import platform as _platform

    try:
        import faiss
        import numpy as np
    except ImportError as e:
        print(f"[rvc-train] 缺少 faiss-cpu 包: {e}", file=sys.stderr)
        sys.exit(1)

    _emit("index", 62, "正在构建 FAISS 索引...")

    features = np.concatenate(all_features, axis=0).astype(np.float32)
    n, dim = features.shape
    _emit("index", 65, f"特征矩阵: {n} 帧 × {dim} 维")

    # macOS ARM：faiss-cpu 的 IVF index.train() 会触发 SIGSEGV（faiss-cpu 无 ARM 原生构建）
    # 使用 IndexFlatL2，不需要 train() 步骤，完全规避崩溃。
    # 注意：macOS ARM 的 RVC 推理侧也会跳过 index 文件（同样原因），
    # 但在其他平台（Linux/Windows）生成的 index 会正常使用。
    is_mac_arm = (sys.platform == "darwin" and _platform.machine() == "arm64")

    if n < 100 or is_mac_arm:
        if is_mac_arm and n >= 100:
            print("[rvc-train] macOS ARM：使用 IndexFlatL2 规避 faiss-cpu IVF SIGSEGV", file=sys.stderr)
        index = faiss.IndexFlatL2(dim)
    else:
        # 根据数据量选择 IVF 中心数
        n_ivf = min(int(n ** 0.5), 512)
        n_ivf = max(n_ivf, 2)
        index = faiss.index_factory(dim, f"IVF{n_ivf},Flat")
        _emit("index", 68, f"训练 IVF{n_ivf},Flat 索引...")
        index.train(features)

    index.add(features)

    index_path = voice_dir / "index.index"
    faiss.write_index(index, str(index_path))
    _emit("index", 80, f"FAISS 索引已写入: index.index（{n} 向量）")
    return index_path


def find_base_model(checkpoint_dir: Path) -> Path | None:
    """在 checkpoint 目录中查找可用的预训练 RVC 基础模型。"""
    candidates = [
        checkpoint_dir / "pretrained_v2" / "f0G40k.pth",
        checkpoint_dir / "pretrained_v2" / "f0G48k.pth",
        checkpoint_dir / "pretrained" / "f0G40k.pth",
    ]
    for c in candidates:
        if c.exists() and c.stat().st_size > 1_000_000:  # 至少 1MB（排除占位符）
            return c
    # 也搜索 checkpoint_dir 下的任意 .pth 文件（可能是用户自放的预训练模型）
    for p in sorted(checkpoint_dir.glob("*.pth")):
        if p.stat().st_size > 1_000_000:
            return p
    return None


def convert_to_inference_model(g_model_path: Path, voice_dir: Path, sample_rate: int) -> Path:
    """将训练格式的生成器 checkpoint（f0G*.pth）转换为 rvc_python 可加载的推理格式。

    训练格式：{"model": state_dict, "optimizer": ..., "iteration": ...}
    推理格式：{"weight": state_dict, "config": [...], "f0": 1, "version": "v2", "sr": sr}

    注意：config 中的架构参数（upsample_rates/kernel_sizes/sr）由权重形状自动检测，
    不依赖 sample_rate 参数，因为预训练基础模型的架构是固定的。
    """
    import torch

    cpt = torch.load(str(g_model_path), map_location="cpu", weights_only=False)

    # 如果已经是推理格式，直接返回原路径
    if "config" in cpt and "weight" in cpt:
        return g_model_path

    # 提取 state_dict（训练格式下存放在 "model" key）
    state_dict = cpt.get("model") or cpt.get("weight") or cpt
    if not isinstance(state_dict, dict):
        raise ValueError(f"无法识别的 checkpoint 格式: keys={list(cpt.keys()) if isinstance(cpt, dict) else type(cpt)}")

    # 从权重推断 spk_embed_dim（emb_g.weight 的行数）
    spk_embed_dim = 109  # RVC v2 默认值
    if "emb_g.weight" in state_dict:
        spk_embed_dim = state_dict["emb_g.weight"].shape[0]

    # 从 dec.ups.* 权重形状自动检测实际的 upsample_kernel_sizes
    # ConvTranspose1d weight shape: [in_ch, out_ch, kernel_size]
    ups_kernels = []
    i = 0
    while f"dec.ups.{i}.weight_v" in state_dict:
        k = state_dict[f"dec.ups.{i}.weight_v"].shape[2]
        ups_kernels.append(k)
        i += 1

    # 根据检测到的 kernel_sizes 映射到对应的 rates 和 sr
    # 已知配置（来自 rvc_python configs/ 目录 + 实测）：
    #   [16, 16, 4, 4] → rates [10, 10, 2, 2], sr 40000  (f0G40k.pth 实际架构)
    #   [24, 20, 4, 4] → rates [12, 10, 2, 2], sr 48000  (v2/48k.json)
    #   [20, 16, 4, 4] → rates [10,  8, 2, 2], sr 32000  (v2/32k.json)
    ARCH_MAP = {
        (16, 16, 4, 4): ([10, 10, 2, 2], 40000),
        (24, 20, 4, 4): ([12, 10, 2, 2], 48000),
        (20, 16, 4, 4): ([10,  8, 2, 2], 32000),
    }
    key = tuple(ups_kernels) if ups_kernels else None
    if key and key in ARCH_MAP:
        upsample_rates, detected_sr = ARCH_MAP[key]
    else:
        # 无法识别时的回退：kernel_size ≈ 2 × rate，sr 使用调用方传入的值
        upsample_rates = [k // 2 for k in ups_kernels] if ups_kernels else [10, 10, 2, 2]
        detected_sr = sample_rate
        print(f"[rvc-train] 警告: 未识别的 upsample_kernel_sizes {ups_kernels}，"
              f"使用推断 rates={upsample_rates} sr={detected_sr}", file=sys.stderr)

    config = [
        1025, 32, 192, 192, 768, 2, 6, 3, 0, "1",
        [3, 7, 11], [[1, 3, 5], [1, 3, 5], [1, 3, 5]],
        upsample_rates, 512, list(ups_kernels) if ups_kernels else [16, 16, 4, 4],
        spk_embed_dim, 256, detected_sr,
    ]

    inference_cpt = {
        "weight": {k: v.half() for k, v in state_dict.items()},
        "config": config,
        "info": "converted_pretrained",
        "sr": detected_sr,
        "f0": 1,
        "version": "v2",
    }

    out_path = voice_dir / "model.pth"
    torch.save(inference_cpt, str(out_path))
    print(f"[rvc-train] 模型架构检测: upsample_kernel_sizes={list(ups_kernels)}, "
          f"upsample_rates={upsample_rates}, sr={detected_sr}", file=sys.stderr)
    return out_path


def main() -> int:
    args = parse_args()
    _t_start = time.monotonic()

    voice_dir = Path(args.voice_dir).resolve()
    voice_dir.mkdir(parents=True, exist_ok=True)
    dataset_path = Path(args.dataset).resolve()
    checkpoint_dir = _get_checkpoint_dir(args.checkpoint_dir)

    _emit("start", 0, f"开始训练音色 {args.voice_id!r}，数据集: {dataset_path.name}")

    # ── 阶段 1: 解压 & 预处理 ────────────────────────────────────────────────
    with tempfile.TemporaryDirectory(prefix="rvc_train_") as tmpdir:
        work_dir = Path(tmpdir)
        audio_files = extract_audio_files(dataset_path, work_dir)

        proc_dir = work_dir / "processed"
        processed = preprocess_audio(audio_files, proc_dir, args.sample_rate)

        # ── 阶段 2: 加载 ContentVec ──────────────────────────────────────────
        hubert_path = checkpoint_dir / "hubert_base.pt"
        if not hubert_path.exists():
            print(f"[rvc-train] ContentVec 模型未找到: {hubert_path}", file=sys.stderr)
            print("[rvc-train] 请运行 pnpm run checkpoints 下载训练所需模型", file=sys.stderr)
            sys.exit(2)

        _emit("features", 22, f"加载 ContentVec: {hubert_path.name}")
        device = "cpu"
        try:
            import torch
            if torch.cuda.is_available():
                device = "cuda"
            elif hasattr(torch.backends, "mps") and torch.backends.mps.is_available():
                device = "mps"
        except Exception:
            pass
        _emit("features", 24, f"使用设备: {device}")
        model = load_contentvec(hubert_path, device)

        # ── 阶段 3: 特征提取 ─────────────────────────────────────────────────
        all_features = extract_features(model, processed)

        # 释放模型内存
        try:
            del model
            import torch
            if device == "cuda":
                torch.cuda.empty_cache()
        except Exception:
            pass

    # ── 阶段 4: 构建 FAISS 索引 ──────────────────────────────────────────────
    build_index(all_features, voice_dir)

    # ── 阶段 5: 查找 / 复制预训练基础模型 ───────────────────────────────────
    _emit("model", 82, "查找预训练基础模型...")
    base_model = find_base_model(checkpoint_dir)
    model_path = voice_dir / "model.pth"

    if base_model:
        _emit("model", 85, f"转换基础模型为推理格式: {base_model.name}")
        try:
            convert_to_inference_model(base_model, voice_dir, args.sample_rate)
        except Exception as e:
            print(f"[rvc-train] 模型格式转换失败: {e}", file=sys.stderr)
            sys.exit(1)
    else:
        print("[rvc-train] 未找到预训练基础模型（checkpoints/rvc/pretrained_v2/f0G40k.pth）", file=sys.stderr)
        print("[rvc-train] 请运行 pnpm run checkpoints 下载或手动放置预训练模型", file=sys.stderr)
        sys.exit(2)

    # ── 阶段 6: 写出 meta.json ───────────────────────────────────────────────
    _emit("meta", 90, "写出 meta.json 推理配置...")

    # 检测模型版本
    model_version = "v2"
    try:
        import torch
        cpt = torch.load(str(model_path), map_location="cpu", weights_only=False)
        v = cpt.get("version", "")
        if v in ("v1", "v2"):
            model_version = v
        else:
            emb = (cpt.get("weight") or {}).get("enc_p.emb_phone.weight")
            if emb is not None:
                model_version = "v2" if emb.shape[1] == 768 else "v1"
    except Exception:
        pass

    meta = {
        "voice_id": args.voice_id,
        "name": args.voice_name or args.voice_id,
        "engine": "rvc",
        "sample_rate": args.sample_rate,
        "model_version": model_version,
        "model_file": "model.pth",
        "index_file": "index.index",
        "inference_mode": "command",
        "inference_command": "",
        "trained_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "train_config": {
            "f0_method": args.f0_method,
            "epochs": args.epochs,
            "source_files": len(audio_files) if 'audio_files' in dir() else 0,
        },
    }
    (voice_dir / "meta.json").write_text(
        json.dumps(meta, ensure_ascii=False, indent=2), encoding="utf-8"
    )

    elapsed = time.monotonic() - _t_start
    _emit("done", 100,
          f"训练完成，耗时 {elapsed:.0f}s",
          voice_id=args.voice_id,
          voice_dir=str(voice_dir))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
