#!/usr/bin/env python3
"""
GPT-SoVITS TTS 适配器 CLI。

接收后端标准化参数，调用 GPT-SoVITS 推理引擎生成语音。

支持两种模式：
  1) 通过 GPT-SoVITS API 服务（如 api.py / api2.py 启动的 HTTP 服务）
  2) 直接调用 GPT-SoVITS 推理脚本（命令行模式）

配置优先级：
  1) 环境变量 GPT_SOVITS_CHECKPOINT_DIR
  2) wrappers/manifest.json -> engines.gpt_sovits.checkpoint_dir
  3) 默认 checkpoints/gpt_sovits/
"""
from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
from pathlib import Path


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="GPT-SoVITS TTS 适配器")
    parser.add_argument("--text", required=True, help="要合成的文本")
    parser.add_argument("--output", required=True, help="输出音频路径")
    parser.add_argument("--voice_ref", nargs="*", default=[], help="参考音频路径（可选，可多个）")
    parser.add_argument("--checkpoint_dir", default="", help="模型权重目录（覆盖 manifest 默认值）")
    parser.add_argument("--text_lang", default="auto", help="文本语言（auto / zh / ja / en 等）")
    return parser.parse_args()


def resolve_checkpoint_dir(arg_value: str) -> str:
    if arg_value.strip():
        return arg_value.strip()
    env_val = os.getenv("GPT_SOVITS_CHECKPOINT_DIR", "").strip()
    if env_val:
        return env_val
    base = Path(__file__).resolve().parent.parent.parent
    manifest_path = base / "wrappers" / "manifest.json"
    if manifest_path.exists():
        try:
            data = json.loads(manifest_path.read_text(encoding="utf-8"))
            rel = (data.get("engines") or {}).get("gpt_sovits", {}).get("checkpoint_dir", "")
            if rel:
                return str((base / rel).resolve())
        except Exception:
            pass
    return str((base / "checkpoints" / "gpt_sovits").resolve())


def get_embedded_python() -> str:
    base = Path(__file__).resolve().parent.parent.parent
    if sys.platform == "win32":
        candidates = [base / "runtime" / "win" / "python" / "python.exe"]
        platform_name = "win"
    else:
        candidates = [
            base / "runtime" / "mac" / "python" / "bin" / "python3",
            base / "runtime" / "mac" / "python" / "bin" / "python",
        ]
        platform_name = "mac"
    for p in candidates:
        if p.exists():
            return str(p)
    print(
        f"[gpt_sovits] 嵌入式 Python 未找到，请将 Python 放置于 runtime/{platform_name}/python/",
        file=sys.stderr,
    )
    sys.exit(1)


def _detect_engine_dir() -> Path | None:
    """检测 GPT-SoVITS 引擎目录。"""
    base = Path(__file__).resolve().parent.parent.parent
    candidates = [
        base / "runtime" / "gpt_sovits" / "engine",
        base / "runtime" / "gpt_sovits",
    ]
    for d in candidates:
        # 检查标志性文件：GPT_SoVITS 目录或 inference 脚本
        if d.exists() and (
            (d / "GPT_SoVITS").exists()
            or (d / "api.py").exists()
            or (d / "inference_cli.py").exists()
        ):
            return d
    return None


def main() -> int:
    args = parse_args()

    output_path = Path(args.output).resolve()
    output_path.parent.mkdir(parents=True, exist_ok=True)

    checkpoint_dir = resolve_checkpoint_dir(getattr(args, "checkpoint_dir", ""))

    # HF 缓存统一指向项目 checkpoints/hf_cache
    base = Path(__file__).resolve().parent.parent.parent
    hf_cache = str((base / "checkpoints" / "hf_cache").resolve())
    os.environ.setdefault("HF_HUB_CACHE", hf_cache)
    os.environ.setdefault("HUGGINGFACE_HUB_CACHE", hf_cache)

    engine_dir = _detect_engine_dir()
    if not engine_dir:
        print("[gpt_sovits] engine 目录不存在，请先运行 pnpm run setup:extra 安装 GPT-SoVITS", file=sys.stderr)
        return 3

    # 查找 GPT-SoVITS CLI 推理入口
    cli_script = None
    for name in ("inference_cli.py", "cli_infer.py", "api.py"):
        candidate = engine_dir / name
        if candidate.exists():
            cli_script = candidate
            break

    if not cli_script:
        print(f"[gpt_sovits] 未找到推理脚本，检查 {engine_dir}", file=sys.stderr)
        return 3

    py = get_embedded_python()

    # 构建参考音频参数
    ref_audio = args.voice_ref[0] if args.voice_ref else ""

    cmd = [
        py, str(cli_script),
        "--text", args.text,
        "--output", str(output_path),
        "--text_lang", args.text_lang,
        "--checkpoint_dir", checkpoint_dir,
    ]
    if ref_audio:
        cmd.extend(["--ref_audio", ref_audio])

    env = os.environ.copy()
    env["PYTHONPATH"] = str(engine_dir) + os.pathsep + env.get("PYTHONPATH", "")
    env["GPT_SOVITS_CHECKPOINT_DIR"] = checkpoint_dir

    print(f"[gpt_sovits] 运行推理: text={args.text[:50]}{'...' if len(args.text) > 50 else ''}", file=sys.stderr, flush=True)

    try:
        completed = subprocess.run(
            cmd, capture_output=True, text=True, timeout=600, env=env,
        )
    except subprocess.TimeoutExpired:
        print("[gpt_sovits] 推理超时（600s）", file=sys.stderr)
        return 1

    if completed.returncode != 0:
        print(f"[gpt_sovits] 推理失败 (code={completed.returncode})", file=sys.stderr)
        if completed.stdout:
            print(f"[gpt_sovits][stdout]\n{completed.stdout}", file=sys.stderr)
        if completed.stderr:
            print(f"[gpt_sovits][stderr]\n{completed.stderr}", file=sys.stderr)
        return completed.returncode

    if not output_path.exists() or output_path.stat().st_size <= 0:
        print("[gpt_sovits] 推理完成但输出文件缺失或为空", file=sys.stderr)
        return 4

    print(f"[gpt_sovits] ok -> {output_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
