#!/usr/bin/env python3
"""
Faster-Whisper STT 适配器 CLI。

接收后端标准化参数，调用 faster-whisper 推理引擎，将转录文本写入输出文件。
与 wrappers/whisper/inference.py 保持相同的接口约定。

配置优先级：
1) 环境变量 FASTER_WHISPER_CMD_TEMPLATE
2) wrappers/faster_whisper/engine.json -> { "command": "..." }
3) 自动探测 runtime/engine/faster_whisper/ 子目录中的推理脚本
4) fallback：使用当前 Python 环境中的 faster-whisper 库

命令模板占位符：
  {input}   — 输入音频路径
  {output}  — 转录文本输出路径（纯文本文件）
  {model}   — Whisper 模型名称（tiny / base / small / medium / large-v3 等）
"""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
from pathlib import Path

from _common import get_root, get_embedded_python, get_engine_dir


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Faster-Whisper STT 适配器")
    parser.add_argument("--input", required=True, help="输入音频路径")
    parser.add_argument("--output", required=True, help="转录文本输出路径")
    parser.add_argument("--model", default="large-v3", help="Whisper 模型（默认 large-v3）")
    parser.add_argument("--checkpoint_dir", default="", help="模型缓存目录（覆盖 manifest 默认值）")
    return parser.parse_args()


def resolve_checkpoint_dir(arg_value: str) -> str:
    """按优先级解析 checkpoint 目录：CLI 参数 > 环境变量 > manifest > 默认值。"""
    if arg_value.strip():
        return arg_value.strip()
    env_val = (os.getenv("FASTER_WHISPER_CHECKPOINT_DIR") or "").strip()
    if env_val:
        return env_val
    root = get_root()
    manifest_path = root / "backend" / "wrappers" / "manifest.json"
    if manifest_path.exists():
        try:
            data = json.loads(manifest_path.read_text(encoding="utf-8"))
            rel = (data.get("engines") or {}).get("faster_whisper", {}).get("checkpoint_dir", "")
            if rel:
                return str((root / rel).resolve())
        except Exception:
            pass
    return str((root / "runtime" / "checkpoints" / "faster_whisper").resolve())


def load_cmd_template() -> str:
    env_tpl = (os.getenv("FASTER_WHISPER_CMD_TEMPLATE") or "").strip()
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
    engine_dir = get_engine_dir("faster_whisper")
    if not engine_dir.exists():
        return ""

    py = get_embedded_python()

    candidates = [
        engine_dir / "transcribe.py",
        engine_dir / "infer.py",
        engine_dir / "inference.py",
    ]
    for p in candidates:
        if p.exists():
            return f'"{py}" "{p.resolve()}" --input {{input}} --output {{output}} --model {{model}}'

    return ""


def run_with_faster_whisper(input_path: Path, output_path: Path, model: str, checkpoint_dir: str = "") -> int:
    """使用本地已下载的 faster-whisper 模型进行转录。

    模型必须通过 pnpm run checkpoints 预先下载到 checkpoint_dir/{model}/ 目录下。
    不允许在推理时联网下载（与 HF_HUB_OFFLINE=1 保持一致）。
    """
    try:
        from faster_whisper import WhisperModel
    except ImportError:
        print(
            "[faster-whisper] faster-whisper 未安装，请重新运行 pnpm run setup。",
            file=sys.stderr,
        )
        return 1

    # 必须有本地模型，不允许运行时下载
    if not checkpoint_dir:
        print(
            "[faster-whisper] 未指定模型目录（FASTER_WHISPER_CHECKPOINT_DIR 未设置）。\n"
            "请运行 pnpm run checkpoints 预下载模型。",
            file=sys.stderr,
        )
        return 1

    local_model_dir = Path(checkpoint_dir) / model
    model_bin = local_model_dir / "model.bin"
    if not model_bin.exists():
        print(
            f"[faster-whisper] 模型 '{model}' 未找到（{local_model_dir}）。\n"
            f"请运行 pnpm run checkpoints 下载模型，或在 STT 页面选择其他模型大小。",
            file=sys.stderr,
        )
        return 1

    try:
        model_path = str(local_model_dir)
        print(f"[faster-whisper] 使用本地模型: {model_path}", file=sys.stderr)
        # CPU + int8：macOS/Windows 兼容性最好，速度比 float16 快
        wm = WhisperModel(
            model_path,
            device="cpu",
            compute_type="int8",
        )
        segments, info = wm.transcribe(str(input_path), beam_size=5)
        text = "".join(segment.text for segment in segments).strip()
        output_path.parent.mkdir(parents=True, exist_ok=True)
        output_path.write_text(text, encoding="utf-8")
        print(f"[faster-whisper] ok -> {output_path} (language={info.language})", file=sys.stderr)
        return 0
    except Exception as exc:
        print(f"[faster-whisper] 推理失败: {exc}", file=sys.stderr)
        return 1


def main() -> int:
    args = parse_args()

    input_path = Path(args.input).resolve()
    output_path = Path(args.output).resolve()

    if not input_path.exists():
        print(f"[faster-whisper] 输入音频不存在: {input_path}", file=sys.stderr)
        return 2

    output_path.parent.mkdir(parents=True, exist_ok=True)

    checkpoint_dir = resolve_checkpoint_dir(getattr(args, "checkpoint_dir", ""))
    cmd_template = load_cmd_template()
    if not cmd_template:
        # Fallback：直接使用 faster-whisper 库
        return run_with_faster_whisper(input_path, output_path, args.model, checkpoint_dir)

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
            f"[faster-whisper] 引擎返回错误码 {completed.returncode}",
            file=sys.stderr,
        )
        if completed.stdout:
            print(f"[faster-whisper][stdout]\n{completed.stdout}", file=sys.stderr)
        if completed.stderr:
            print(f"[faster-whisper][stderr]\n{completed.stderr}", file=sys.stderr)
        return completed.returncode

    if not output_path.exists() or output_path.stat().st_size == 0:
        output_path.write_text("", encoding="utf-8")

    print(f"[faster-whisper] ok -> {output_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
