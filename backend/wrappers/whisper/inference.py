#!/usr/bin/env python3
"""
Whisper STT 适配器 CLI。

接收后端标准化参数，调用真实的 Whisper 推理引擎，将转录文本写入输出文件。

配置优先级：
1) 环境变量 WHISPER_CMD_TEMPLATE
2) wrappers/whisper/engine.json -> { "command": "..." }
3) 自动探测 runtime/engine/whisper/ 子目录中的推理脚本
4) fallback：使用 transformers pipeline（当前 Python 环境需安装 transformers + torch）

命令模板占位符：
  {input}   — 输入音频路径
  {output}  — 转录文本输出路径（纯文本文件）
  {model}   — Whisper 模型名称（tiny / base / small / medium / large）
"""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
from pathlib import Path

from wrappers._common import get_root, get_embedded_python, get_engine_dir


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Whisper STT 适配器")
    parser.add_argument("--input", required=True, help="输入音频路径")
    parser.add_argument("--output", required=True, help="转录文本输出路径")
    parser.add_argument("--model", default="base", help="Whisper 模型（默认 base）")
    parser.add_argument("--checkpoint_dir", default="", help="模型权重目录（覆盖 manifest 默认值）")
    return parser.parse_args()


def resolve_checkpoint_dir(arg_value: str) -> str:
    """按优先级解析 checkpoint 目录：CLI 参数 > 环境变量 > manifest > 默认值。"""
    if arg_value.strip():
        return arg_value.strip()
    env_val = (os.getenv("WHISPER_CHECKPOINT_DIR") or "").strip()
    if env_val:
        return env_val
    root = get_root()
    manifest_path = root / "backend" / "wrappers" / "manifest.json"
    if manifest_path.exists():
        try:
            data = json.loads(manifest_path.read_text(encoding="utf-8"))
            rel = (data.get("engines") or {}).get("whisper", {}).get("checkpoint_dir", "")
            if rel:
                return str((root / rel).resolve())
        except Exception:
            pass
    return str((root / "runtime" / "checkpoints" / "whisper").resolve())


def load_cmd_template() -> str:
    env_tpl = (os.getenv("WHISPER_CMD_TEMPLATE") or "").strip()
    if env_tpl:
        return env_tpl

    cfg_path = Path(__file__).resolve().parent / "engine.json"
    if cfg_path.exists():
        try:
            data = json.loads(cfg_path.read_text(encoding="utf-8"))
            cmd = (data.get("command") or "").strip()
            if cmd:
                return cmd
        except Exception:
            pass

    return detect_engine_cmd()


def detect_engine_cmd() -> str:
    """自动探测 engine/ 子目录中的推理脚本。"""
    engine_dir = get_engine_dir("whisper")
    if not engine_dir.exists():
        return ""

    py = get_embedded_python()

    candidates = [
        engine_dir / "transcribe.py",
        engine_dir / "infer.py",
        engine_dir / "inference.py",
        engine_dir / "whisper_infer.py",
    ]
    for p in candidates:
        if p.exists():
            return f'"{py}" "{p.resolve()}" --input {{input}} --output {{output}} --model {{model}}'

    return ""


def run_with_transformers(input_path: Path, output_path: Path, model: str, checkpoint_dir: str = "") -> int:
    """Fallback：直接用当前 Python 环境中的 transformers pipeline 转录。
    若 checkpoint_dir 有效且包含 model.pt，则从本地加载；否则从 HuggingFace 下载。"""
    try:
        from transformers import pipeline as hf_pipeline
    except ImportError:
        print(
            "[whisper] transformers 未安装，请重新运行 pnpm run checkpoints。",
            file=sys.stderr,
        )
        return 1

    try:
        # transformers pipeline 需要 HuggingFace 格式的模型目录（含 config.json）
        # model.pt 是 OpenAI 格式，不兼容；使用 HF model ID，由 transformers 缓存
        hf_model_id = f"openai/whisper-{model}"
        # 若 checkpoint_dir 是 HF 格式目录（含 config.json），则优先使用本地
        local_dir = Path(checkpoint_dir) if checkpoint_dir else None
        if local_dir and (local_dir / "config.json").exists():
            model_id = str(local_dir)
        else:
            # 离线模式下尝试从 HF 缓存找已有版本（按大小优先级：small > base > tiny）
            hf_cache = os.getenv("HF_HUB_CACHE", "")
            model_id = hf_model_id
            found_in_cache = False
            if hf_cache:
                for fallback in [model, "small", "base", "tiny", "medium", "large-v3"]:
                    fb_dir = Path(hf_cache) / f"models--openai--whisper-{fallback}"
                    if (fb_dir / "blobs").exists() and any((fb_dir / "blobs").iterdir()):
                        model_id = f"openai/whisper-{fallback}"
                        found_in_cache = True
                        if fallback != model:
                            print(f"[whisper] 本地无 whisper-{model}，改用已缓存的 whisper-{fallback}", file=sys.stderr)
                        break
            # 离线模式且无本地模型，提前报错而不是让 transformers 给出混乱的网络错误
            is_offline = os.getenv("TRANSFORMERS_OFFLINE", "0") == "1" or os.getenv("HF_HUB_OFFLINE", "0") == "1"
            if is_offline and not found_in_cache:
                print(
                    f"[whisper] 本地未找到 Whisper 模型（checkpoint_dir={checkpoint_dir}，HF_HUB_CACHE={hf_cache}），"
                    f"且当前为离线模式，无法从 HuggingFace 下载。\n"
                    f"请先运行 pnpm run checkpoints 下载 Whisper 模型，"
                    f"或将 HuggingFace 格式模型（含 config.json）放入 checkpoints/whisper/ 目录。",
                    file=sys.stderr,
                )
                return 1
        asr = hf_pipeline(
            "automatic-speech-recognition",
            model=model_id,
            device=-1,
        )
        # 超过 30 秒的音频需要 return_timestamps=True 才能做长格式转录
        result = asr(str(input_path), return_timestamps=True)
        # 结果可能是 {"text": "...", "chunks": [...]} 或 {"text": "..."}
        text = (result.get("text") or "").strip()
        output_path.parent.mkdir(parents=True, exist_ok=True)
        output_path.write_text(text, encoding="utf-8")
        print(f"[whisper] ok -> {output_path}")
        return 0
    except Exception as exc:
        print(f"[whisper] transformers 推理失败: {exc}", file=sys.stderr)
        return 1


def main() -> int:
    args = parse_args()

    input_path = Path(args.input).resolve()
    output_path = Path(args.output).resolve()

    if not input_path.exists():
        print(f"[whisper] 输入音频不存在: {input_path}", file=sys.stderr)
        return 2

    output_path.parent.mkdir(parents=True, exist_ok=True)

    checkpoint_dir = resolve_checkpoint_dir(getattr(args, "checkpoint_dir", ""))
    cmd_template = load_cmd_template()
    if not cmd_template:
        # Fallback：transformers pipeline
        return run_with_transformers(input_path, output_path, args.model, checkpoint_dir)

    cmd = (
        cmd_template
        .replace("{input}", str(input_path))
        .replace("{output}", str(output_path))
        .replace("{model}", args.model)
        .replace("{checkpoint_dir}", checkpoint_dir)
    )

    completed = subprocess.run(
        cmd, shell=True, capture_output=True, text=True, timeout=600
    )

    if completed.returncode != 0:
        print(
            f"[whisper] 引擎返回错误码 {completed.returncode}",
            file=sys.stderr,
        )
        if completed.stdout:
            print(f"[whisper][stdout]\n{completed.stdout}", file=sys.stderr)
        if completed.stderr:
            print(f"[whisper][stderr]\n{completed.stderr}", file=sys.stderr)
        return completed.returncode

    if not output_path.exists() or output_path.stat().st_size == 0:
        # 空文件也算正常（静音段），写入空字符串
        output_path.write_text("", encoding="utf-8")

    print(f"[whisper] ok -> {output_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
