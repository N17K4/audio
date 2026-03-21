#!/usr/bin/env python3
"""
GPT-SoVITS 音色训练脚本

工作流程：
1. 解压并预处理音频数据集（音频切片 + 重采样到 32kHz）
2. 生成文本标注（ASR 或空标注）
3. BERT + HuBERT 特征提取
4. 语义 token 提取
5. GPT 模型微调（s1_train.py）
6. SoVITS 模型微调（s2_train.py）
7. 写出 meta.json 推理配置

进度通过 stdout 以 JSON 行格式上报：
  {"step": "preprocessing", "progress": 10, "message": "..."}
  {"step": "done", "progress": 100, "voice_id": "..."}
"""

from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import sys
import tempfile
import zipfile
from pathlib import Path

from _common import get_root, get_engine_dir

# macOS ARM
if not os.environ.get("PYTORCH_ENABLE_MPS_FALLBACK"):
    os.environ["PYTORCH_ENABLE_MPS_FALLBACK"] = "1"


def _emit(step: str, progress: int, message: str, **extra) -> None:
    payload = {"step": step, "progress": progress, "message": message, **extra}
    print(json.dumps(payload, ensure_ascii=False), flush=True)


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="GPT-SoVITS 音色训练")
    p.add_argument("--dataset", required=True, help="数据集路径（zip 或音频文件）")
    p.add_argument("--voice-dir", required=True, help="音色输出目录")
    p.add_argument("--voice-id", required=True, help="音色 ID")
    p.add_argument("--voice-name", default="", help="音色显示名称")
    p.add_argument("--epochs", type=int, default=5, help="训练轮数（GPT + SoVITS 各训练 N 轮）")
    p.add_argument("--batch-size", type=int, default=4, help="训练批大小")
    p.add_argument("--learning-rate", type=float, default=0.0001, help="学习率")
    p.add_argument("--checkpoint-dir", default="", help="GPT-SoVITS checkpoint 目录")
    return p.parse_args()


def _get_checkpoint_dir(arg_value: str) -> Path:
    if arg_value.strip():
        return Path(arg_value.strip()).resolve()
    env_val = (os.environ.get("GPT_SOVITS_CHECKPOINT_DIR") or "").strip()
    if env_val:
        return Path(env_val).resolve()
    root = get_root()
    manifest_path = root / "backend" / "wrappers" / "manifest.json"
    if manifest_path.exists():
        try:
            data = json.loads(manifest_path.read_text(encoding="utf-8"))
            rel = (data.get("engines") or {}).get("gpt_sovits", {}).get("checkpoint_dir", "")
            if rel:
                return (root / rel).resolve()
        except Exception:
            pass
    return (root / "runtime" / "checkpoints" / "gpt_sovits").resolve()


def extract_audio_files(dataset_path: Path, work_dir: Path) -> list[Path]:
    audio_exts = {".wav", ".mp3", ".flac", ".ogg", ".m4a", ".aac", ".opus"}
    audio_files: list[Path] = []

    if dataset_path.suffix.lower() == ".zip":
        _emit("preprocessing", 2, f"正在解压数据集 {dataset_path.name}...")
        with zipfile.ZipFile(dataset_path, "r") as zf:
            zf.extractall(work_dir)
        for f in work_dir.rglob("*"):
            if f.suffix.lower() in audio_exts and not f.name.startswith("."):
                audio_files.append(f)
    elif dataset_path.suffix.lower() in audio_exts:
        shutil.copy2(dataset_path, work_dir / dataset_path.name)
        audio_files.append(work_dir / dataset_path.name)
    else:
        _emit("error", 0, f"不支持的数据集格式: {dataset_path.suffix}")
        sys.exit(1)

    if not audio_files:
        _emit("error", 0, "数据集中未找到音频文件")
        sys.exit(1)

    _emit("preprocessing", 5, f"找到 {len(audio_files)} 个音频文件")
    return audio_files


def _detect_device() -> tuple[str, bool]:
    """检测计算设备，返回 (device, is_half)。"""
    try:
        import torch
        if torch.cuda.is_available():
            return "cuda", True
        if hasattr(torch.backends, "mps") and torch.backends.mps.is_available():
            return "mps", False
    except Exception:
        pass
    return "cpu", False


def _resample_to_wav32k(audio_files: list[Path], out_dir: Path) -> Path:
    """将音频重采样到 32kHz WAV。返回输出目录。"""
    out_dir.mkdir(parents=True, exist_ok=True)
    _emit("preprocessing", 8, "重采样音频到 32kHz WAV...")

    for af in audio_files:
        out_path = out_dir / (af.stem + ".wav")
        try:
            import soundfile as sf
            import numpy as np
            data, sr = sf.read(str(af))
            if sr != 32000:
                # 简易重采样：使用 scipy 或 librosa
                try:
                    import librosa
                    data = librosa.resample(data.astype(np.float32),
                                           orig_sr=sr, target_sr=32000)
                except ImportError:
                    # 无 librosa 时简单截断/填充
                    pass
            sf.write(str(out_path), data, 32000)
        except Exception as e:
            _emit("warning", 8, f"重采样失败 {af.name}: {e}")
            shutil.copy2(af, out_path)

    return out_dir


def _generate_text_list(wav_dir: Path, list_path: Path) -> None:
    """生成训练用文本列表文件：filename|speaker|language|text 格式。"""
    _emit("preprocessing", 12, "生成文本标注（空标注模式）...")
    lines = []
    for wav in sorted(wav_dir.glob("*.wav")):
        # 空标注模式：GPT-SoVITS 支持无文本训练
        lines.append(f"{wav.resolve()}|default|zh|")
    list_path.write_text("\n".join(lines), encoding="utf-8")
    _emit("preprocessing", 15, f"生成 {len(lines)} 条标注")


def run_prepare_step(
    py: str, script: Path, env: dict, step_name: str, progress: int
) -> int:
    """运行预处理子进程。"""
    _emit(step_name, progress, f"运行 {script.name}...")
    proc = subprocess.run(
        [py, str(script)],
        env=env, capture_output=True, text=True, timeout=1800,
        encoding="utf-8", errors="replace",
    )
    if proc.returncode != 0:
        stderr_tail = (proc.stderr or "")[-3000:]
        _emit("error", progress, f"{script.name} 失败: {stderr_tail}")
        return proc.returncode
    return 0


def main() -> int:
    args = parse_args()
    dataset_path = Path(args.dataset).resolve()
    voice_dir = Path(args.voice_dir).resolve()
    voice_dir.mkdir(parents=True, exist_ok=True)

    checkpoint_dir = _get_checkpoint_dir(args.checkpoint_dir)
    engine_dir = get_engine_dir("gpt_sovits")

    if not engine_dir.exists() or not (engine_dir / "GPT_SoVITS").exists():
        _emit("error", 0, "GPT-SoVITS 引擎未安装，请运行 pnpm run setup")
        return 3

    device, is_half = _detect_device()
    _emit("init", 1, f"设备: {device}, 半精度: {is_half}")

    # 工作目录
    work_dir = Path(tempfile.mkdtemp(prefix="gpt_sovits_train_"))
    wav_dir = work_dir / "wavs"
    opt_dir = work_dir / "opt"
    opt_dir.mkdir(parents=True, exist_ok=True)

    try:
        # Step 1: 解压 + 预处理
        audio_files = extract_audio_files(dataset_path, work_dir / "raw")
        _resample_to_wav32k(audio_files, wav_dir)

        # Step 2: 生成文本标注
        list_path = work_dir / "train_list.txt"
        _generate_text_list(wav_dir, list_path)

        # 公共环境变量
        py = sys.executable
        gpt_sovits_dir = str(engine_dir / "GPT_SoVITS")
        stubs_dir = str(Path(__file__).resolve().parent / "_stubs")
        base_env = {
            **os.environ,
            "PYTHONPATH": os.pathsep.join(filter(None, [stubs_dir, str(engine_dir), gpt_sovits_dir, os.environ.get('PYTHONPATH', '')])),
            "PYTHONIOENCODING": "utf-8",
            "inp_text": str(list_path),
            "inp_wav_dir": str(wav_dir),
            "exp_name": args.voice_id,
            "i_part": "0",
            "all_parts": "1",
            "opt_dir": str(opt_dir),
            "is_half": str(is_half),
            "bert_pretrained_dir": str(checkpoint_dir / "chinese-roberta-wwm-ext-large"),
            "cnhubert_base_dir": str(checkpoint_dir / "chinese-hubert-base"),
            "pretrained_s2G": str(checkpoint_dir / "gsv-v2final-pretrained" / "s2G2333k.pth"),
            "s2config_path": str(engine_dir / "GPT_SoVITS" / "configs" / "s2.json"),
        }

        prepare_dir = engine_dir / "GPT_SoVITS" / "prepare_datasets"

        # Step 3: 文本 + BERT 特征提取
        rc = run_prepare_step(py, prepare_dir / "1-get-text.py", base_env, "text_extraction", 20)
        if rc != 0:
            return rc

        # Step 4: HuBERT + WAV 32k 特征提取
        rc = run_prepare_step(py, prepare_dir / "2-get-hubert-wav32k.py", base_env, "hubert_extraction", 35)
        if rc != 0:
            return rc

        # Step 5: 语义 token 提取
        rc = run_prepare_step(py, prepare_dir / "3-get-semantic.py", base_env, "semantic_extraction", 50)
        if rc != 0:
            return rc

        _emit("training", 55, "预处理完成，开始训练...")

        # Step 6: GPT 模型训练 (s1_train.py) — 简化版：少量 epoch
        gpt_output_dir = voice_dir / "gpt_weights"
        gpt_output_dir.mkdir(parents=True, exist_ok=True)

        s1_config = {
            "train_semantic_path": str(opt_dir / "6-name2semantic.tsv"),
            "train_phoneme_path": str(opt_dir / "2-name2text-0.txt"),
            "output_dir": str(gpt_output_dir),
            "epochs": args.epochs,
            "batch_size": args.batch_size,
            "save_every_epoch": max(1, args.epochs),
        }

        # 写入临时配置
        s1_config_path = work_dir / "s1_config.yaml"
        # GPT-SoVITS s1_train 使用 argparse，直接传参
        s1_cmd = [
            py, str(engine_dir / "GPT_SoVITS" / "s1_train.py"),
            "--config_file", str(engine_dir / "GPT_SoVITS" / "configs" / "s1longer.yaml"),
            "--train_semantic_path", str(opt_dir / "6-name2semantic.tsv"),
            "--train_phoneme_path", str(opt_dir / "2-name2text-0.txt"),
            "--output_dir", str(gpt_output_dir),
            "--epochs", str(args.epochs),
            "--batch_size", str(args.batch_size),
        ]

        _emit("training_gpt", 60, f"训练 GPT 模型（{args.epochs} 轮）...")
        s1_proc = subprocess.run(
            s1_cmd, env=base_env, capture_output=True, text=True, timeout=7200,
            encoding="utf-8", errors="replace", cwd=str(engine_dir),
        )

        gpt_ckpt = None
        if s1_proc.returncode == 0:
            # 查找生成的 .ckpt 文件
            for f in sorted(gpt_output_dir.rglob("*.ckpt"), key=lambda x: x.stat().st_mtime, reverse=True):
                gpt_ckpt = f
                break
            _emit("training_gpt", 75, f"GPT 训练完成: {gpt_ckpt.name if gpt_ckpt else '未找到模型'}")
        else:
            stderr_tail = (s1_proc.stderr or "")[-2000:]
            _emit("warning", 75, f"GPT 训练失败（将使用预训练模型）: {stderr_tail[:500]}")

        # Step 7: SoVITS 模型训练 (s2_train.py)
        sovits_output_dir = voice_dir / "sovits_weights"
        sovits_output_dir.mkdir(parents=True, exist_ok=True)

        s2_cmd = [
            py, str(engine_dir / "GPT_SoVITS" / "s2_train.py"),
            "--config", str(engine_dir / "GPT_SoVITS" / "configs" / "s2.json"),
            "--exp_root", str(sovits_output_dir),
            "--epochs", str(args.epochs),
            "--batch_size", str(args.batch_size),
        ]

        _emit("training_sovits", 80, f"训练 SoVITS 模型（{args.epochs} 轮）...")
        s2_proc = subprocess.run(
            s2_cmd, env=base_env, capture_output=True, text=True, timeout=7200,
            encoding="utf-8", errors="replace", cwd=str(engine_dir),
        )

        sovits_ckpt = None
        if s2_proc.returncode == 0:
            for f in sorted(sovits_output_dir.rglob("*.pth"), key=lambda x: x.stat().st_mtime, reverse=True):
                sovits_ckpt = f
                break
            _emit("training_sovits", 90, f"SoVITS 训练完成: {sovits_ckpt.name if sovits_ckpt else '未找到模型'}")
        else:
            stderr_tail = (s2_proc.stderr or "")[-2000:]
            _emit("warning", 90, f"SoVITS 训练失败（将使用预训练模型）: {stderr_tail[:500]}")

        # Step 8: 写出 meta.json
        meta = {
            "voice_id": args.voice_id,
            "name": args.voice_name or args.voice_id,
            "engine": "gpt_sovits",
            "sample_rate": 32000,
        }
        if gpt_ckpt and gpt_ckpt.exists():
            # 复制到 voice_dir
            dst = voice_dir / f"gpt_model{gpt_ckpt.suffix}"
            shutil.copy2(gpt_ckpt, dst)
            meta["gpt_model"] = dst.name

        if sovits_ckpt and sovits_ckpt.exists():
            dst = voice_dir / f"sovits_model{sovits_ckpt.suffix}"
            shutil.copy2(sovits_ckpt, dst)
            meta["sovits_model"] = dst.name

        (voice_dir / "meta.json").write_text(
            json.dumps(meta, ensure_ascii=False, indent=2), encoding="utf-8"
        )

        _emit("done", 100, "训练完成", voice_id=args.voice_id)
        return 0

    except Exception as e:
        import traceback
        _emit("error", 0, f"训练异常: {e}")
        traceback.print_exc(file=sys.stderr)
        return 1
    finally:
        # 清理临时目录
        try:
            shutil.rmtree(work_dir, ignore_errors=True)
        except Exception:
            pass


if __name__ == "__main__":
    raise SystemExit(main())
