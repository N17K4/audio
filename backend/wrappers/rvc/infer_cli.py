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

from _common import get_root, get_embedded_python, get_engine_dir


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
    root = get_root()
    manifest_path = root / "backend" / "wrappers" / "manifest.json"
    if manifest_path.exists():
        try:
            data = json.loads(manifest_path.read_text(encoding="utf-8"))
            rel = (data.get("engines") or {}).get("rvc", {}).get("checkpoint_dir", "")
            if rel:
                return str((root / rel).resolve())
        except Exception:
            pass
    return str((root / "runtime" / "checkpoints" / "rvc").resolve())


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


def detect_project_local_engine_cmd() -> str:
    engine_dir = get_engine_dir("rvc")
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
        # cmd_template 未配置时，直接使用 rvc-python API 推理
        return _run_via_rvc_python(input_path, output_path, model_path, index_path)

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
            print(f"[infer_cli][stdout]\n{completed.stdout[-3000:]}", file=sys.stderr)
        if completed.stderr:
            print(f"[infer_cli][stderr]\n{completed.stderr[-3000:]}", file=sys.stderr)
        return completed.returncode

    if not output_path.exists() or output_path.stat().st_size <= 0:
        print("[infer_cli] engine completed but output file missing/empty", file=sys.stderr)
        return 4

    print(f"[infer_cli] ok -> {output_path}")
    return 0


def _patch_torch_load() -> None:
    """torch >= 2.6 将 weights_only 默认改为 True，rvc-python 内部未适配。
    Monkey-patch torch.load 使其默认 weights_only=False。"""
    try:
        import torch
        _orig = torch.load
        import functools

        @functools.wraps(_orig)
        def _patched(*args, **kwargs):
            kwargs.setdefault("weights_only", False)
            return _orig(*args, **kwargs)

        torch.load = _patched
    except Exception:
        pass


def _run_via_rvc_python(input_path: Path, output_path: Path, model_path: Path, index_path: Path) -> int:
    """cmd_template 未配置时，直接调用 rvc-python API 进行推理。"""
    _patch_torch_load()
    try:
        from rvc_python.infer import RVCInference
    except ImportError as e:
        print(
            f"[infer_cli] rvc-python 导入失败: {e}\n"
            "请运行 pnpm run setup 安装 rvc-python，或配置 engine.json cmd_template。",
            file=sys.stderr,
        )
        return 3

    try:
        rvc = RVCInference(device="cpu:0")
        rvc.load_model(str(model_path))
        if index_path and index_path.exists():
            rvc.set_params(index_path=str(index_path))
        rvc.infer_file(str(input_path), str(output_path))
    except Exception as exc:
        print(f"[infer_cli] rvc-python 推理失败: {exc}", file=sys.stderr)
        return 1

    if not output_path.exists() or output_path.stat().st_size <= 0:
        print("[infer_cli] rvc-python 完成但输出文件缺失", file=sys.stderr)
        return 4

    print(f"[infer_cli] ok (rvc-python) -> {output_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
