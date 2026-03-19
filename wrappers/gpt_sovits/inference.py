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
    parser.add_argument("--gpt_model", default="", help="GPT 模型文件路径（.ckpt）")
    parser.add_argument("--sovits_model", default="", help="SoVITS 模型文件路径（.pth）")
    parser.add_argument("--text_lang", default="auto", help="合成文本语言（auto / zh / ja / en / ko / yue）")
    parser.add_argument("--prompt_lang", default="auto", help="参考音频语言（auto / zh / ja / en / ko / yue）")
    parser.add_argument("--ref_text", default="", help="参考音频对应文本（few-shot 推荐填写）")
    parser.add_argument("--top_k", type=int, default=15, help="Top-K 采样：每步从概率最高的 K 个 token 中选择（默认 15）")
    parser.add_argument("--top_p", type=float, default=1.0, help="Top-P 核采样：保留累计概率达到 P 的 token（默认 1.0）")
    parser.add_argument("--temperature", type=float, default=1.0, help="采样温度：控制随机性（默认 1.0）")
    parser.add_argument("--speed", type=float, default=1.0, help="语速倍率（默认 1.0）")
    parser.add_argument("--repetition_penalty", type=float, default=1.35, help="重复惩罚：抑制重复 token 生成（默认 1.35）")
    parser.add_argument("--seed", type=int, default=-1, help="随机种子：-1 为随机，固定值可复现结果")
    parser.add_argument("--text_split_method", default="cut5", help="文本切分方式：cut0 不切/cut1 按4句/cut2 按50字/cut3 中文句号/cut4 英文句号/cut5 标点（默认 cut5）")
    parser.add_argument("--batch_size", type=int, default=1, help="推理批处理大小（默认 1）")
    parser.add_argument("--no_parallel_infer", action="store_true", help="禁用并行推理（默认启用）")
    parser.add_argument("--fragment_interval", type=float, default=0.3, help="分段间隔秒数（默认 0.3）")
    parser.add_argument("--sample_steps", type=int, default=32, help="VITS V3 扩散采样步数（默认 32）")
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
    if args.gpt_model:
        cmd.extend(["--gpt_model", args.gpt_model])
    if args.sovits_model:
        cmd.extend(["--sovits_model", args.sovits_model])
    if args.prompt_lang and args.prompt_lang != "auto":
        cmd.extend(["--prompt_lang", args.prompt_lang])
    if args.ref_text:
        cmd.extend(["--ref_text", args.ref_text])
    if args.top_k != 15:
        cmd.extend(["--top_k", str(args.top_k)])
    if args.top_p != 1.0:
        cmd.extend(["--top_p", str(args.top_p)])
    if args.temperature != 1.0:
        cmd.extend(["--temperature", str(args.temperature)])
    if args.speed != 1.0:
        cmd.extend(["--speed", str(args.speed)])
    if args.repetition_penalty != 1.35:
        cmd.extend(["--repetition_penalty", str(args.repetition_penalty)])
    if args.seed != -1:
        cmd.extend(["--seed", str(args.seed)])
    if args.text_split_method != "cut5":
        cmd.extend(["--text_split_method", args.text_split_method])
    if args.batch_size != 1:
        cmd.extend(["--batch_size", str(args.batch_size)])
    if args.no_parallel_infer:
        cmd.extend(["--no_parallel_infer"])
    if args.fragment_interval != 0.3:
        cmd.extend(["--fragment_interval", str(args.fragment_interval)])
    if args.sample_steps != 32:
        cmd.extend(["--sample_steps", str(args.sample_steps)])

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
