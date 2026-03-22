#!/usr/bin/env python3
"""
GPT-SoVITS TTS 适配器 CLI。

接收后端标准化参数，直接调用 GPT-SoVITS TTS 引擎进行语音合成。

通过 sys.path 注入 engine 目录，直接 import GPT-SoVITS 的 TTS 类进行推理，
避免子进程嵌套和 CLI 接口不兼容问题。

配置优先级：
  1) 环境变量 GPT_SOVITS_CHECKPOINT_DIR
  2) wrappers/manifest.json -> engines.gpt_sovits.checkpoint_dir
  3) 默认 checkpoints/gpt_sovits/
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

from _common import get_root, get_engine_dir


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="GPT-SoVITS TTS 适配器")
    parser.add_argument("--text", required=True, help="要合成的文本")
    parser.add_argument("--output", required=True, help="输出音频路径")
    parser.add_argument("--voice_ref", nargs="*", default=[], help="参考音频路径（可选，可多个）")
    parser.add_argument("--checkpoint_dir", default="", help="模型权重目录（覆盖 manifest 默认值）")
    parser.add_argument("--gpt_model", default="", help="GPT 模型文件路径（.ckpt）")
    parser.add_argument("--sovits_model", default="", help="SoVITS 模型文件路径（.pth）")
    parser.add_argument("--text_lang", default="auto", help="合成文本语言（auto / zh / ja / en / ko / yue）")
    parser.add_argument("--prompt_lang", default="auto", help="参考音频语言（auto / zh / ja / en / ko / yue）")
    parser.add_argument("--ref_text", default="", help="参考音频对应文本（few-shot 推荐填写）")
    parser.add_argument("--top_k", type=int, default=15, help="Top-K 采样（默认 15）")
    parser.add_argument("--top_p", type=float, default=1.0, help="Top-P 核采样（默认 1.0）")
    parser.add_argument("--temperature", type=float, default=1.0, help="采样温度（默认 1.0）")
    parser.add_argument("--speed", type=float, default=1.0, help="语速倍率（默认 1.0）")
    parser.add_argument("--repetition_penalty", type=float, default=1.35, help="重复惩罚（默认 1.35）")
    parser.add_argument("--seed", type=int, default=-1, help="随机种子（-1 为随机）")
    parser.add_argument("--text_split_method", default="cut5", help="文本切分方式（默认 cut5）")
    parser.add_argument("--batch_size", type=int, default=1, help="推理批处理大小（默认 1）")
    parser.add_argument("--no_parallel_infer", action="store_true", help="禁用并行推理")
    parser.add_argument("--fragment_interval", type=float, default=0.3, help="分段间隔秒数（默认 0.3）")
    parser.add_argument("--sample_steps", type=int, default=32, help="VITS V3 扩散采样步数（默认 32）")
    return parser.parse_args()


def resolve_checkpoint_dir(arg_value: str) -> str:
    if arg_value.strip():
        return arg_value.strip()
    env_val = os.getenv("GPT_SOVITS_CHECKPOINT_DIR", "").strip()
    if env_val:
        return env_val
    root = get_root()
    manifest_path = root / "backend" / "wrappers" / "manifest.json"
    if manifest_path.exists():
        try:
            data = json.loads(manifest_path.read_text(encoding="utf-8"))
            rel = (data.get("engines") or {}).get("gpt_sovits", {}).get("checkpoint_dir", "")
            if rel:
                return str((root / rel).resolve())
        except Exception:
            pass
    return str((root / "runtime" / "checkpoints" / "gpt_sovits").resolve())


def _ensure_fast_langdetect(pretrained_dir: Path) -> None:
    """fast_langdetect のモデルファイルを pretrained_models/fast_langdetect/ にコピー。"""
    target = pretrained_dir / "fast_langdetect"
    if target.exists():
        return
    try:
        import fast_langdetect
        src = Path(fast_langdetect.__file__).parent / "resources"
        if src.exists():
            import shutil
            shutil.copytree(str(src), str(target))
    except Exception:
        pass


def _detect_engine_dir() -> Path | None:
    """检测 GPT-SoVITS 引擎目录。"""
    engine_dir = get_engine_dir("gpt_sovits")
    if engine_dir.exists() and (engine_dir / "GPT_SoVITS").exists():
        return engine_dir
    return None


def main() -> int:
    args = parse_args()

    output_path = Path(args.output).resolve()
    output_path.parent.mkdir(parents=True, exist_ok=True)

    checkpoint_dir = resolve_checkpoint_dir(getattr(args, "checkpoint_dir", ""))

    # HF 缓存统一指向 checkpoints/hf_cache
    root = get_root()
    hf_cache = str((root / "runtime" / "checkpoints" / "hf_cache").resolve())
    os.environ.setdefault("HF_HUB_CACHE", hf_cache)
    os.environ.setdefault("HUGGINGFACE_HUB_CACHE", hf_cache)

    # NLTK データパス（ml_base.py でダウンロード済み）
    nltk_data_dir = root / "runtime" / "ml" / "nltk_data"
    if nltk_data_dir.exists():
        os.environ.setdefault("NLTK_DATA", str(nltk_data_dir))

    engine_dir = _detect_engine_dir()
    if not engine_dir:
        print("[gpt_sovits] engine 目录不存在，请先运行 pnpm run setup 安装 GPT-SoVITS", file=sys.stderr)
        return 3

    # 将 engine 目录加入 sys.path，使 GPT-SoVITS 模块可被 import
    # GPT_SoVITS/ 子目录也需加入，AR 等模块在其中以顶层包形式被引用
    engine_dir_str = str(engine_dir)
    gpt_sovits_subdir = str(engine_dir / "GPT_SoVITS")
    if engine_dir_str not in sys.path:
        sys.path.insert(0, engine_dir_str)
    if os.path.isdir(gpt_sovits_subdir) and gpt_sovits_subdir not in sys.path:
        sys.path.insert(0, gpt_sovits_subdir)

    # jieba_fast は Windows でビルドできない（C 拡張必要）。
    # GPT-SoVITS が import jieba_fast する前に、jieba で代替するシムを注入。
    try:
        import jieba_fast  # noqa: F401
    except ImportError:
        import jieba
        jieba.setLogLevel = getattr(jieba, "setLogLevel", lambda *_: None)
        sys.modules["jieba_fast"] = jieba
        # jieba_fast.posseg → jieba.posseg
        import jieba.posseg
        sys.modules["jieba_fast.posseg"] = jieba.posseg

    # pyopenjtalk は Windows で CMake ビルドが必要で失敗しやすい。
    # 未インストール時はスタブを注入し、日本語 TTS 使用時に明確なエラーを出す。
    try:
        import pyopenjtalk  # noqa: F401
    except ImportError:
        import types
        _stub = types.ModuleType("pyopenjtalk")
        _stub.OPEN_JTALK_DICT_DIR = b""
        def _not_available(*args, **kwargs):
            raise RuntimeError(
                "pyopenjtalk 未安装。Windows では CMake + C++ コンパイラが必要です。"
                "日本語テキストの音素変換は利用できません。"
            )
        _stub.g2p = _not_available
        _stub.run_frontend = _not_available
        _stub.update_global_jtalk_with_user_dict = lambda *a, **k: None
        sys.modules["pyopenjtalk"] = _stub

    # GPT-SoVITS 内部使用 os.getcwd() 的相对路径定位 pretrained_models
    original_cwd = os.getcwd()
    os.chdir(engine_dir_str)

    # GPT-SoVITS engine 初始化失败时会 fall back 到相对路径
    # GPT_SoVITS/pretrained_models/ → 需要指向 checkpoint_dir
    # GPT_SoVITS/pretrained_models/ → checkpoint_dir のファイルを参照できるようにする。
    # 旧ビルドで pretrained_models/ が実ディレクトリとして残っている場合もある。
    pretrained_link = engine_dir / "GPT_SoVITS" / "pretrained_models"
    if checkpoint_dir:
        ckpt = Path(checkpoint_dir)
        if pretrained_link.is_symlink() or (os.name == "nt" and not pretrained_link.exists()):
            pass  # 既に symlink/junction
        elif pretrained_link.is_dir():
            # 実ディレクトリ → checkpoint_dir のファイルがなければコピー/リンク
            for src in ckpt.iterdir():
                dst = pretrained_link / src.name
                if not dst.exists():
                    if src.is_dir():
                        if os.name == "nt":
                            try:
                                import _winapi
                                _winapi.CreateJunction(str(src), str(dst))
                            except Exception:
                                import shutil
                                shutil.copytree(src, dst)
                        else:
                            dst.symlink_to(src)
                    else:
                        if os.name == "nt":
                            import shutil
                            shutil.copy2(src, dst)
                        else:
                            dst.symlink_to(src)
        else:
            # pretrained_models が存在しない → symlink/junction 作成
            try:
                pretrained_link.symlink_to(checkpoint_dir)
            except OSError:
                if os.name == "nt":
                    try:
                        import _winapi
                        _winapi.CreateJunction(checkpoint_dir, str(pretrained_link))
                    except Exception:
                        pass

    # fast_langdetect 需要模型文件在 pretrained_models/fast_langdetect/ 下
    _ensure_fast_langdetect(pretrained_link)

    try:
        return _run_inference(args, output_path, checkpoint_dir)
    finally:
        os.chdir(original_cwd)


def _patch_bigvgan_from_pretrained(checkpoint_dir: str):
    """Windows パス問題を回避: BigVGAN.from_pretrained に渡されるローカルパスを正規化。

    GPT-SoVITS が `"%s/GPT_SoVITS/pretrained_models/..." % now_dir` で
    パスを組み立てるため、Windows では混在パスになり os.path.isdir() が False。
    さらに pretrained_models → checkpoint_dir の junction 作成が Windows で失敗しうる。
    パスを正規化し、存在しなければ checkpoint_dir にフォールバックする。
    """
    try:
        from BigVGAN.bigvgan import BigVGAN
        _original = BigVGAN.from_pretrained.__func__

        @classmethod
        def _patched(cls, model_id, *args, **kwargs):
            normalized = os.path.normpath(str(model_id))
            if not os.path.isdir(normalized) and checkpoint_dir:
                # junction 失敗時: checkpoint_dir 内の同名ディレクトリにフォールバック
                basename = os.path.basename(normalized)
                alt = os.path.join(checkpoint_dir, basename)
                if os.path.isdir(alt):
                    print(f"[gpt_sovits] BigVGAN: {normalized} → {alt} にフォールバック", file=sys.stderr)
                    normalized = alt
            return _original(cls, normalized, *args, **kwargs)

        BigVGAN.from_pretrained = _patched
    except Exception:
        pass


def _run_inference(args: argparse.Namespace, output_path: Path, checkpoint_dir: str) -> int:
    """在 engine_dir 作为 CWD 的环境下执行推理。"""
    print(f"[gpt_sovits] 运行推理: text={args.text[:50]}{'...' if len(args.text) > 50 else ''}", file=sys.stderr, flush=True)

    # Windows パス混在問題を回避（BigVGAN.from_pretrained monkey-patch）
    if os.name == "nt":
        _patch_bigvgan_from_pretrained(checkpoint_dir)

    # torchaudio 2.6+: torchcodec 未インストール時のフォールバック
    from _common import patch_torchaudio
    patch_torchaudio()

    try:
        from GPT_SoVITS.TTS_infer_pack.TTS import TTS, TTS_Config
    except ImportError as e:
        print(f"[gpt_sovits] 无法导入 TTS 模块: {e}", file=sys.stderr)
        print("[gpt_sovits] 请确保已运行 pnpm run ml 安装 ML 依赖（torch、transformers 等）", file=sys.stderr)
        return 3

    # 构建 TTS 配置
    # pretrained 模型存放于 checkpoints/gpt_sovits/，需显式设置路径
    try:
        # TTS_Config は configs_.get("custom", configs_["v2"]) で config を読む。
        # "custom" キーの下に全パラメータを入れなければ v2 にフォールバックする。
        config_dict = {
            "custom": {
                "version": "v3",
                "device": "cpu",
                "is_half": False,
                "cnhuhbert_base_path": os.path.join(checkpoint_dir, "chinese-hubert-base"),
                "bert_base_path": os.path.join(checkpoint_dir, "chinese-roberta-wwm-ext-large"),
                "t2s_weights_path": os.path.join(checkpoint_dir, "s1v3.ckpt"),
                "vits_weights_path": os.path.join(checkpoint_dir, "s2Gv3.pth"),
            }
        }

        # 自动检测设备
        custom = config_dict["custom"]
        try:
            import torch
            if torch.cuda.is_available():
                custom["device"] = "cuda"
                custom["is_half"] = True
            elif hasattr(torch.backends, "mps") and torch.backends.mps.is_available():
                custom["device"] = "mps"
                custom["is_half"] = False  # MPS 不支持 half
        except Exception:
            pass

        # 用户指定的自定义 GPT/SoVITS 模型路径（覆盖默认预训练模型）
        if args.gpt_model:
            custom["t2s_weights_path"] = args.gpt_model
        if args.sovits_model:
            custom["vits_weights_path"] = args.sovits_model

        config = TTS_Config(config_dict)
        tts_engine = TTS(config)
    except Exception as e:
        print(f"[gpt_sovits] TTS 引擎初始化失败: {e}", file=sys.stderr)
        import traceback
        traceback.print_exc(file=sys.stderr)
        return 3

    # 如果用户指定了自定义模型，重新加载
    if args.gpt_model and os.path.isfile(args.gpt_model):
        try:
            tts_engine.init_t2s_weights(args.gpt_model)
        except Exception as e:
            print(f"[gpt_sovits] 加载 GPT 模型失败: {e}", file=sys.stderr)
            return 3

    if args.sovits_model and os.path.isfile(args.sovits_model):
        try:
            tts_engine.init_vits_weights(args.sovits_model)
        except Exception as e:
            print(f"[gpt_sovits] 加载 SoVITS 模型失败: {e}", file=sys.stderr)
            return 3

    # 构建推理参数
    ref_audio = args.voice_ref[0] if args.voice_ref else ""
    # 过滤空字符串（服务层可能传入 ""）
    if ref_audio and not ref_audio.strip():
        ref_audio = ""

    inputs = {
        "text": args.text,
        "text_lang": args.text_lang if args.text_lang != "auto" else "auto",
        "prompt_text": args.ref_text,
        "prompt_lang": args.prompt_lang if args.prompt_lang != "auto" else "auto",
        "top_k": args.top_k,
        "top_p": args.top_p,
        "temperature": args.temperature,
        "speed_factor": args.speed,
        "repetition_penalty": args.repetition_penalty,
        "seed": args.seed,
        "text_split_method": args.text_split_method,
        "batch_size": args.batch_size,
        "parallel_infer": not args.no_parallel_infer,
        "fragment_interval": args.fragment_interval,
        "sample_steps": args.sample_steps,
    }
    # GPT-SoVITS v2 は参考音声（ref_audio_path）が必須
    if ref_audio:
        inputs["ref_audio_path"] = ref_audio
    else:
        print("[gpt_sovits] 未指定参考音频（voice_ref），GPT-SoVITS 需要至少一个参考音频才能合成", file=sys.stderr)
        return 5

    # 辅助参考音频
    if len(args.voice_ref) > 1:
        inputs["aux_ref_audio_paths"] = [r for r in args.voice_ref[1:] if r.strip()]

    try:
        result = tts_engine.run(inputs)
        # TTS.run() 返回生成器，收集所有音频片段
        sr = None
        audio_chunks = []

        import numpy as np
        for chunk_sr, chunk_audio in result:
            sr = chunk_sr
            audio_chunks.append(chunk_audio)

        if not audio_chunks or sr is None:
            print("[gpt_sovits] 推理完成但未生成音频数据", file=sys.stderr)
            return 4

        # 合并所有片段
        full_audio = np.concatenate(audio_chunks) if len(audio_chunks) > 1 else audio_chunks[0]

        # 保存音频
        import soundfile as sf
        sf.write(str(output_path), full_audio, sr)

    except Exception as e:
        print(f"[gpt_sovits] 推理失败: {e}", file=sys.stderr)
        import traceback
        traceback.print_exc(file=sys.stderr)
        return 1

    if not output_path.exists() or output_path.stat().st_size <= 0:
        print("[gpt_sovits] 推理完成但输出文件缺失或为空", file=sys.stderr)
        return 4

    print(f"[gpt_sovits] ok -> {output_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
