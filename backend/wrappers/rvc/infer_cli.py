#!/usr/bin/env python3
"""
RVC inference adapter CLI.

This script is intentionally a thin adapter (not a mock):
- It accepts normalized args from backend.
- It forwards execution to a real local RVC engine command.
- It fails fast if no real engine command is configured.

Config priority:
1) env var RVC_ENGINE_CMD_TEMPLATE
2) backend/wrappers/rvc/engine.json -> { "cmd_template": "..." }
3) auto-detect project-local engine under runtime/engine/rvc/

Supported placeholders in command template:
{input} {output} {model} {index} {voice_dir}
"""

from __future__ import annotations

import argparse
import json
import os
import shlex
import subprocess
import sys
from pathlib import Path


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="RVC inference adapter")
    parser.add_argument("--input", required=True, help="Input audio path")
    parser.add_argument("--output", required=True, help="Output audio path")
    parser.add_argument("--model", required=True, help="Model weights path")
    parser.add_argument("--index", default="", help="Index path (optional)")
    parser.add_argument("--checkpoint_dir", default="", help="Checkpoint directory (overrides manifest default)")
    return parser.parse_args()


def resolve_checkpoint_dir(arg_value: str) -> str:
    """按优先级解析 checkpoint 目录：CLI 参数 > 环境变量 > manifest > 默认值。"""
    if arg_value.strip():
        return arg_value.strip()
    env_val = (os.getenv("RVC_CHECKPOINT_DIR") or "").strip()
    if env_val:
        return env_val
    base = Path(__file__).resolve().parent.parent.parent.parent
    manifest_path = base / "backend" / "wrappers" / "manifest.json"
    if manifest_path.exists():
        try:
            data = json.loads(manifest_path.read_text(encoding="utf-8"))
            rel = (data.get("engines") or {}).get("rvc", {}).get("checkpoint_dir", "")
            if rel:
                return str((base / rel).resolve())
        except Exception:
            pass
    return str((base / "runtime" / "checkpoints" / "rvc").resolve())


def load_cmd_template() -> str:
    env_tpl = (os.getenv("RVC_ENGINE_CMD_TEMPLATE") or "").strip()
    if env_tpl:
        return env_tpl

    cfg_path = Path(__file__).resolve().parent / "engine.json"
    if not cfg_path.exists():
        return ""
    try:
        data = json.loads(cfg_path.read_text(encoding="utf-8"))
    except Exception:
        data = {}
    cfg_tpl = (data.get("cmd_template") or "").strip()
    if cfg_tpl:
        return cfg_tpl
    return detect_project_local_engine_cmd()


def get_embedded_python() -> str:
    """返回平台对応の嵌入式 Python 路径（runtime/python/mac 或 runtime/python/win）。找不到则报错退出。"""
    # __file__ = wrappers/rvc/infer_cli.py，上三级为项目根目录
    base = Path(__file__).resolve().parent.parent.parent.parent
    if sys.platform == "win32":
        candidates = [base / "runtime" / "python" / "win" / "python.exe"]
        platform_name = "win"
    else:
        candidates = [
            base / "runtime" / "python" / "mac" / "bin" / "python3",
            base / "runtime" / "python" / "mac" / "bin" / "python",
        ]
        platform_name = "mac"
    for p in candidates:
        if p.exists():
            return str(p)
    print(
        f"[infer_cli] 嵌入式 Python 未找到，请将 Python 放置于 runtime/python/{platform_name}/",
        file=sys.stderr,
    )
    sys.exit(1)


def detect_project_local_engine_cmd() -> str:
    base_dir = Path(__file__).resolve().parent
    engine_dir = base_dir.parent.parent / "runtime" / "engine" / "rvc"
    if not engine_dir.exists():
        return ""

    self_path = Path(__file__).resolve()
    py_candidates = [
        engine_dir / "infer.py",
        engine_dir / "infer_cli.py",
        engine_dir / "run_infer.py",
    ]
    for p in py_candidates:
        if p.exists() and p.resolve() != self_path:
            return (
                f"\"{get_embedded_python()}\" \"{p.resolve()}\" "
                "--input {input} --output {output} --model {model} --index {index}"
            )

    bat_candidates = [
        engine_dir / "infer.bat",
        engine_dir / "run.bat",
    ]
    for p in bat_candidates:
        if p.exists():
            return (
                f"\"{p.resolve()}\" "
                "--input {input} --output {output} --model {model} --index {index}"
            )
    return ""


def main() -> int:
    args = parse_args()

    input_path = Path(args.input).resolve()
    output_path = Path(args.output).resolve()
    model_path = Path(args.model).resolve()
    index_path = Path(args.index).resolve() if args.index else Path("")
    voice_dir = model_path.parent

    if not input_path.exists():
        print(f"[infer_cli] input missing: {input_path}", file=sys.stderr)
        return 2
    if not model_path.exists():
        print(f"[infer_cli] model missing: {model_path}", file=sys.stderr)
        return 2

    cmd_template = load_cmd_template()
    if not cmd_template:
        print(
            "[infer_cli] no real RVC engine command configured.\n"
            "Set env RVC_ENGINE_CMD_TEMPLATE or edit backend/wrappers/rvc/engine.json (cmd_template).",
            file=sys.stderr,
        )
        return 3

    checkpoint_dir = resolve_checkpoint_dir(getattr(args, "checkpoint_dir", ""))

    def _q(p: str) -> str:
        return shlex.quote(p) if p else "''"

    cmd = (
        cmd_template.replace("{input}", _q(str(input_path)))
        .replace("{output}", _q(str(output_path)))
        .replace("{model}", _q(str(model_path)))
        .replace("{index}", _q(str(index_path)) if args.index else "")
        .replace("{voice_dir}", _q(str(voice_dir)))
        .replace("{checkpoint_dir}", _q(checkpoint_dir) if checkpoint_dir else "")
    )

    # shell=True allows users to provide batch/python command templates directly.
    completed = subprocess.run(cmd, shell=True, capture_output=True, text=True, timeout=1800)
    if completed.returncode != 0:
        print(f"[infer_cli] engine failed with code {completed.returncode}", file=sys.stderr)
        if completed.stdout:
            print(f"[infer_cli][stdout]\n{completed.stdout}", file=sys.stderr)
        if completed.stderr:
            print(f"[infer_cli][stderr]\n{completed.stderr}", file=sys.stderr)
        return completed.returncode

    if not output_path.exists() or output_path.stat().st_size <= 0:
        print("[infer_cli] engine completed but output file missing/empty", file=sys.stderr)
        return 4

    print(f"[infer_cli] ok -> {output_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
