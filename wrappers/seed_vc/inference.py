#!/usr/bin/env python3
"""
Seed-VC 声音转换适配器 CLI。

持久化 Worker 模式（f0_condition=False）：
  - 首次请求自动启动 seed_vc_worker.py（后台进程，保持模型在内存中）
  - 后续请求通过 Unix socket 直接通信，无需重新加载模型
  - f0_condition=True 时回退到子进程模式（需要不同的模型权重）

配置优先级：
1) 环境变量 SEED_VC_CMD_TEMPLATE → 旧模式（直接子进程）
2) 环境变量 SEED_VC_CHECKPOINT_DIR
3) runtime/manifest.json -> engines.seed_vc.checkpoint_dir
4) 默认 checkpoints/seed_vc/
"""
from __future__ import annotations

import argparse
import json
import os
import socket
import subprocess
import sys
import time
from pathlib import Path


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Seed-VC 声音转换适配器")
    parser.add_argument("--source", required=True, help="源音频路径")
    parser.add_argument("--target", required=True, help="目标音色参考音频路径")
    parser.add_argument("--output", required=True, help="输出音频路径")
    parser.add_argument("--diffusion-steps", default="10", help="扩散步数")
    parser.add_argument("--pitch-shift", default="0", help="音调偏移半音")
    parser.add_argument("--f0-condition", action="store_true", help="启用 F0 条件化推理")
    parser.add_argument("--cfg-rate", default="0.7", help="inference_cfg_rate")
    parser.add_argument("--no-postprocess", action="store_true", help="禁用后处理")
    parser.add_argument("--checkpoint_dir", default="", help="模型权重目录")
    return parser.parse_args()


def resolve_checkpoint_dir(arg_value: str) -> str:
    if arg_value.strip():
        return arg_value.strip()
    env_val = (os.getenv("SEED_VC_CHECKPOINT_DIR") or "").strip()
    if env_val:
        return env_val
    base = Path(__file__).resolve().parent.parent.parent
    manifest_path = base / "wrappers" / "manifest.json"
    if manifest_path.exists():
        try:
            data = json.loads(manifest_path.read_text(encoding="utf-8"))
            rel = (data.get("engines") or {}).get("seed_vc", {}).get("checkpoint_dir", "")
            if rel:
                return str((base / rel).resolve())
        except Exception:
            pass
    return str((base / "checkpoints" / "seed_vc").resolve())


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
    print(f"[seed_vc] 嵌入式 Python 未找到，请将 Python 放置于 runtime/{platform_name}/python/", file=sys.stderr)
    sys.exit(1)


def _find_file(directory: str, suffix: str) -> str:
    d = Path(directory)
    if not d.exists():
        return ""
    for p in sorted(d.iterdir()):
        if p.is_file() and p.suffix.lower() == suffix.lower():
            return str(p.resolve())
    return ""


_USE_TCP = sys.platform == "win32"


def _worker_paths(checkpoint_pth: str) -> tuple[str, str]:
    """返回 (connection_path, pid_path)。

    Unix: connection_path 是 Unix socket 路径。
    Windows: connection_path 是存储 TCP 端口号的文件路径。
    """
    import hashlib
    import tempfile
    h = hashlib.md5(checkpoint_pth.encode()).hexdigest()[:8]
    tmp = tempfile.gettempdir()
    suffix = "port" if _USE_TCP else "sock"
    return (
        os.path.join(tmp, f"seed_vc_worker_{h}.{suffix}"),
        os.path.join(tmp, f"seed_vc_worker_{h}.pid"),
    )


def _worker_alive(socket_path: str, pid_path: str) -> bool:
    if not os.path.exists(socket_path):
        return False
    if os.path.exists(pid_path):
        try:
            pid = int(Path(pid_path).read_text().strip())
            os.kill(pid, 0)
        except (ProcessLookupError, ValueError, PermissionError, OSError):
            return False
    try:
        if _USE_TCP:
            port = int(Path(socket_path).read_text().strip())
            s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            s.settimeout(2.0)
            s.connect(("127.0.0.1", port))
        else:
            s = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
            s.settimeout(2.0)
            s.connect(socket_path)
        s.close()
        return True
    except (OSError, ValueError):
        return False


def _start_worker(checkpoint_pth: str, config_yml: str, socket_path: str, pid_path: str) -> None:
    import tempfile
    py = get_embedded_python()
    worker_script = str(Path(__file__).resolve().parent / "seed_vc_worker.py")
    stderr_fd, stderr_log = tempfile.mkstemp(prefix="seedvc_worker_err_", suffix=".log")
    os.close(stderr_fd)

    cmd = [py, worker_script,
           "--checkpoint", checkpoint_pth,
           "--config", config_yml]
    if _USE_TCP:
        cmd.extend(["--tcp", "--port_file", socket_path])
    else:
        cmd.extend(["--socket_path", socket_path])

    proc = subprocess.Popen(
        cmd,
        stdout=subprocess.PIPE,
        # stderr 写入独立日志文件，既避免继承上层 capture pipe 死锁，也保留崩溃原因。
        stderr=open(stderr_log, "w", encoding="utf-8", errors="replace"),
        env=os.environ.copy(),
        text=True,
    )
    Path(pid_path).write_text(str(proc.pid))
    print(f"[seed_vc] 启动 worker PID={proc.pid}，等待模型加载（最长 300s）...", file=sys.stderr)

    deadline = time.monotonic() + 300
    while time.monotonic() < deadline:
        line = proc.stdout.readline()
        if not line:
            rc = proc.poll()
            try:
                err_content = Path(stderr_log).read_text(encoding="utf-8", errors="replace").strip()
                if err_content:
                    print(f"[seed_vc] worker stderr:\n{err_content}", file=sys.stderr)
                os.unlink(stderr_log)
            except OSError:
                pass
            print(f"[seed_vc] worker 进程意外退出 (code={rc})", file=sys.stderr)
            sys.exit(1)
        if line.strip() == "ready":
            try:
                os.unlink(stderr_log)
            except OSError:
                pass
            print("[seed_vc] worker 就绪，模型已加载", file=sys.stderr)
            return
        print(f"[seed_vc] worker: {line.strip()}", file=sys.stderr)

    proc.terminate()
    try:
        err_content = Path(stderr_log).read_text(encoding="utf-8", errors="replace").strip()
        if err_content:
            print(f"[seed_vc] worker stderr:\n{err_content}", file=sys.stderr)
        os.unlink(stderr_log)
    except OSError:
        pass
    print("[seed_vc] worker 启动超时（300s）", file=sys.stderr)
    sys.exit(1)


def _send_request(socket_path: str, req: dict) -> dict:
    if _USE_TCP:
        port = int(Path(socket_path).read_text().strip())
        s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        s.settimeout(600.0)
        s.connect(("127.0.0.1", port))
    else:
        s = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        s.settimeout(600.0)
        s.connect(socket_path)
    s.sendall((json.dumps(req, ensure_ascii=False) + "\n").encode())
    buf = b""
    while b"\n" not in buf:
        chunk = s.recv(65536)
        if not chunk:
            break
        buf += chunk
    s.close()
    return json.loads(buf.decode().strip())


def run_subprocess_fallback(args, checkpoint_dir: str, project_root: Path) -> int:
    """f0_condition=True 时回退到子进程模式（使用 engine/inference.py 直接调用）。"""
    import time as _time
    py = get_embedded_python()
    engine_script = project_root / "runtime" / "seed_vc" / "engine" / "inference.py"
    if not engine_script.exists():
        print("[seed_vc] engine/inference.py 不存在", file=sys.stderr)
        return 3

    checkpoint_pth = _find_file(checkpoint_dir, ".pth")
    checkpoint_yml = _find_file(checkpoint_dir, ".yml")
    print(f"[seed_vc] checkpoint_pth={checkpoint_pth}", file=sys.stderr, flush=True)
    print(f"[seed_vc] checkpoint_yml={checkpoint_yml}", file=sys.stderr, flush=True)

    import tempfile
    tmp_dir = Path(tempfile.mkdtemp(prefix="seedvc_out_"))
    try:
        f0_flag = "--f0-condition True" if args.f0_condition else ""
        # --no-postprocess 是 wrapper 层参数，engine/inference.py 不支持，不向下传递
        cmd = (
            f'"{py}" "{engine_script}" '
            f'--source "{args.source}" --target "{args.target}" --output "{tmp_dir}" '
            f'--diffusion-steps {args.diffusion_steps} '
            f'--semi-tone-shift {args.pitch_shift} {f0_flag} '
            f'--inference-cfg-rate {args.cfg_rate} '
            f'--checkpoint "{checkpoint_pth}" --config "{checkpoint_yml}"'
        )
        print(f"[seed_vc] 执行推理命令: {cmd}", file=sys.stderr, flush=True)
        _t0 = _time.monotonic()
        # CWD 须为 checkpoints/ 的父目录（生产模式 checkpoints 在 userData，非 app bundle）
        _hf_cache = os.getenv("HF_HUB_CACHE", "").strip()
        _run_cwd = str(Path(_hf_cache).parent.parent) if (_hf_cache and Path(_hf_cache).parent.parent.exists()) else str(project_root)
        completed = subprocess.run(
            cmd, shell=True, capture_output=True, text=True, timeout=1800,
            cwd=_run_cwd,
        )
        _elapsed = _time.monotonic() - _t0
        print(f"[seed_vc] 推理命令结束，耗时 {_elapsed:.1f}s，退出码={completed.returncode}", file=sys.stderr, flush=True)
        if completed.returncode != 0:
            print(f"[seed_vc] 引擎返回错误码 {completed.returncode}", file=sys.stderr)
            if completed.stderr:
                print(f"[seed_vc][stderr]\n{completed.stderr}", file=sys.stderr)
            return completed.returncode

        # engine 输出到目录，找到生成的 wav 文件并移动
        wav_files = list(tmp_dir.glob("*.wav"))
        if not wav_files:
            print("[seed_vc] 引擎完成但未生成输出文件", file=sys.stderr)
            return 4
        import shutil
        shutil.move(str(wav_files[0]), args.output)
        print(f"[seed_vc] 输出已保存到: {args.output}", file=sys.stderr, flush=True)
        return 0
    finally:
        import shutil as _sh
        try:
            _sh.rmtree(str(tmp_dir), ignore_errors=True)
        except Exception:
            pass


def main() -> int:
    args = parse_args()

    source_path = Path(args.source).resolve()
    target_path = Path(args.target).resolve()
    output_path = Path(args.output).resolve()
    output_path.parent.mkdir(parents=True, exist_ok=True)

    if not source_path.exists():
        print(f"[seed_vc] 源音频不存在: {source_path}", file=sys.stderr)
        return 2
    if not target_path.exists():
        print(f"[seed_vc] 目标参考音频不存在: {target_path}", file=sys.stderr)
        return 2

    checkpoint_dir = resolve_checkpoint_dir(getattr(args, "checkpoint_dir", ""))
    base = Path(__file__).resolve().parent.parent.parent
    hf_cache = str((base / "checkpoints" / "hf_cache").resolve())
    os.environ.setdefault("HF_HUB_CACHE", hf_cache)
    os.environ.setdefault("HUGGINGFACE_HUB_CACHE", hf_cache)

    # f0_condition=True 需要不同模型，回退到子进程
    if args.f0_condition:
        print("[seed_vc] f0_condition=True，使用子进程模式", file=sys.stderr)
        return run_subprocess_fallback(args, checkpoint_dir, base)

    # ── 持久化 Worker 模式 ────────────────────────────────────────────────────
    checkpoint_pth = _find_file(checkpoint_dir, ".pth")
    checkpoint_yml = _find_file(checkpoint_dir, ".yml")

    if not checkpoint_pth:
        print(f"[seed_vc] 未找到 .pth 权重文件: {checkpoint_dir}", file=sys.stderr)
        return 2
    if not checkpoint_yml:
        print(f"[seed_vc] 未找到 .yml 配置文件: {checkpoint_dir}", file=sys.stderr)
        return 2

    worker_script = Path(__file__).resolve().parent / "seed_vc_worker.py"
    if not worker_script.exists():
        print("[seed_vc] seed_vc_worker.py 缺失", file=sys.stderr)
        return 3

    socket_path, pid_path = _worker_paths(checkpoint_pth)

    if not _worker_alive(socket_path, pid_path):
        _start_worker(checkpoint_pth, checkpoint_yml, socket_path, pid_path)

    import time as _time
    print(f"[seed_vc] 发送推理请求: {source_path.name} → {output_path.name}", file=sys.stderr, flush=True)
    _t0 = _time.monotonic()
    try:
        result = _send_request(socket_path, {
            "source": str(source_path),
            "target": str(target_path),
            "output": str(output_path),
            "diffusion_steps": int(args.diffusion_steps),
            "pitch_shift": int(args.pitch_shift),
            "length_adjust": 1.0,
            "inference_cfg_rate": float(args.cfg_rate),
        })
    except Exception as exc:
        print(f"[seed_vc] socket 通信失败 (耗时 {_time.monotonic()-_t0:.1f}s): {exc}", file=sys.stderr)
        try:
            os.unlink(socket_path)
        except OSError:
            pass
        try:
            os.unlink(pid_path)
        except OSError:
            pass
        return 1

    print(f"[seed_vc] 收到推理响应，耗时 {_time.monotonic()-_t0:.1f}s", file=sys.stderr, flush=True)
    if not result.get("ok"):
        err = result.get("error", "未知错误")
        print(f"[seed_vc] 推理失败: {err}", file=sys.stderr)
        return 1

    if not output_path.exists() or output_path.stat().st_size <= 0:
        print("[seed_vc] 推理完成但输出文件缺失或为空", file=sys.stderr)
        return 4

    print(f"[seed_vc] ok -> {output_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
