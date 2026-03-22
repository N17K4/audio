#!/usr/bin/env python3
"""
Fish Speech TTS 适配器 CLI。

接收后端标准化参数，通过持久化 Worker 进行推理（避免每次重载模型）。

Worker 生命周期：
  - 首次请求时自动启动 fish_speech_worker.py（后台进程）
  - Worker 加载模型后写出 "ready"，此后保持运行
  - 后续请求直接通过 Unix socket 通信，无需重新加载模型
  - Worker 绑定到 socket 文件，可通过 PID 文件检测存活状态

配置优先级：
  1) 环境变量 FISH_SPEECH_CMD_TEMPLATE → 旧模式（直接子进程）
  2) 环境变量 FISH_SPEECH_CHECKPOINT_DIR
  3) runtime/manifest.json -> engines.fish_speech.checkpoint_dir
  4) 默认 checkpoints/fish_speech/
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

from _common import get_root, get_embedded_python, get_engine_dir


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Fish Speech TTS 适配器")
    parser.add_argument("--text", required=True, help="要合成的文本")
    parser.add_argument("--output", required=True, help="输出音频路径")
    parser.add_argument("--voice_ref", nargs="*", default=[], help="参考音频路径（可选，可多个）")
    parser.add_argument("--checkpoint_dir", default="", help="模型权重目录（覆盖 manifest 默认值）")
    parser.add_argument("--top_p", type=float, default=0.7, help="Top-P 核采样（默认 0.7）")
    parser.add_argument("--temperature", type=float, default=0.7, help="采样温度（默认 0.7）")
    parser.add_argument("--repetition_penalty", type=float, default=1.2, help="重复惩罚（默认 1.2）")
    parser.add_argument("--max_new_tokens", type=int, default=1024, help="最大生成 token 数（默认 1024）")
    return parser.parse_args()


def resolve_checkpoint_dir(arg_value: str) -> str:
    if arg_value.strip():
        return arg_value.strip()
    env_val = os.getenv("FISH_SPEECH_CHECKPOINT_DIR", "").strip()
    if env_val:
        return env_val
    root = get_root()
    manifest_path = root / "backend" / "wrappers" / "manifest.json"
    if manifest_path.exists():
        try:
            data = json.loads(manifest_path.read_text(encoding="utf-8"))
            rel = (data.get("engines") or {}).get("fish_speech", {}).get("checkpoint_dir", "")
            if rel:
                return str((root / rel).resolve())
        except Exception:
            pass
    return str((root / "runtime" / "checkpoints" / "fish_speech").resolve())


_USE_TCP = sys.platform == "win32"


def _worker_paths(checkpoint_dir: str) -> tuple[str, str]:
    """返回 (connection_path, pid_path)。

    Unix: connection_path 是 Unix socket 路径。
    Windows: connection_path 是存储 TCP 端口号的文件路径。
    """
    import hashlib
    import tempfile
    h = hashlib.md5(checkpoint_dir.encode()).hexdigest()[:8]
    tmp = tempfile.gettempdir()
    suffix = "port" if _USE_TCP else "sock"
    return (
        os.path.join(tmp, f"fish_speech_worker_{h}.{suffix}"),
        os.path.join(tmp, f"fish_speech_worker_{h}.pid"),
    )


def _worker_alive(socket_path: str, pid_path: str) -> bool:
    """检查 worker 是否存活：PID 存在 + socket/TCP 可连接。"""
    if not os.path.exists(socket_path):
        return False
    # 检查 PID
    if os.path.exists(pid_path):
        try:
            pid = int(Path(pid_path).read_text().strip())
            os.kill(pid, 0)  # 不发送信号，仅探活
        except (ProcessLookupError, ValueError, PermissionError, OSError):
            return False
    # 尝试连接
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


def _start_worker(checkpoint_dir: str, socket_path: str, pid_path: str) -> None:
    """启动 fish_speech_worker.py 后台进程，等待其输出 'ready'。"""
    import tempfile
    import threading

    py = get_embedded_python()
    worker_script = str(Path(__file__).resolve().parent / "fish_speech_worker.py")

    env = os.environ.copy()

    # stderr 写入临时文件而非 DEVNULL：
    # - 避免死锁：当上层 backend 用 capture_output=True 运行本脚本时，
    #   sys.stderr 是一个 PIPE 写端；若 worker 持有该 FD，backend 的 communicate()
    #   会永远等待 EOF 而死锁。用独立文件 FD 可完全规避。
    # - 保留错误信息：worker 崩溃时将 stderr 内容打印出来，便于排查问题。
    stderr_fd, stderr_log = tempfile.mkstemp(prefix="fish_worker_err_", suffix=".log")
    os.close(stderr_fd)

    cmd = [py, worker_script, "--checkpoint_dir", checkpoint_dir]
    if _USE_TCP:
        cmd.extend(["--tcp", "--port_file", socket_path])
    else:
        cmd.extend(["--socket_path", socket_path])

    proc = subprocess.Popen(
        cmd,
        stdout=subprocess.PIPE,
        stderr=open(stderr_log, "w", encoding="utf-8", errors="replace"),
        env=env,
        text=True,
    )

    # 写入 PID 文件
    Path(pid_path).write_text(str(proc.pid))

    import time as _time
    _start_t = _time.monotonic()
    print(f"[fish_speech] 启动 worker PID={proc.pid}，等待模型加载（最长 600s）...", file=sys.stderr, flush=True)

    # 等待 worker 输出 "ready"（模型加载完成信号）
    # 注意：不能直接在主线程 readline()，因为若 worker 在 C 扩展里挂起且无 stdout 输出，
    # readline() 永远阻塞，600s deadline 检查无法执行，导致 inference.py 一直挂到后端超时。
    # 用线程 + join(timeout) 让超时可靠生效。
    _ready = threading.Event()
    _exit_early = threading.Event()

    def _reader():
        for line in proc.stdout:
            line = line.strip()
            if line == "ready":
                _ready.set()
                return
            print(f"[fish_speech] worker: {line}", file=sys.stderr, flush=True)
        # stdout 关闭 → 进程退出
        _exit_early.set()

    t = threading.Thread(target=_reader, daemon=True)
    t.start()
    t.join(timeout=600)

    if _ready.is_set():
        # 成功：保留 stderr 日志以便排查推理阶段问题
        print(f"[fish_speech] worker 就绪，模型加载耗时 {_time.monotonic()-_start_t:.1f}s（stderr: {stderr_log}）", file=sys.stderr, flush=True)
        return

    # 失败：打印 worker stderr 帮助排查
    try:
        err_content = Path(stderr_log).read_text(encoding="utf-8", errors="replace").strip()
        if err_content:
            print(f"[fish_speech] worker stderr:\n{err_content}", file=sys.stderr, flush=True)
        os.unlink(stderr_log)
    except OSError:
        pass

    if _exit_early.is_set() or proc.poll() is not None:
        rc = proc.poll()
        print(f"[fish_speech] worker 进程意外退出 (code={rc})，耗时 {_time.monotonic()-_start_t:.1f}s", file=sys.stderr, flush=True)
    else:
        proc.terminate()
        print(f"[fish_speech] worker 启动超时（600s），模型加载失败", file=sys.stderr, flush=True)
    sys.exit(1)


def _send_request(socket_path: str, text: str, voice_refs: list, output: str, **kwargs) -> dict:
    """通过 socket/TCP 发送推理请求，返回响应 dict。"""
    req = {"text": text, "voice_refs": voice_refs, "output": output, **kwargs}
    payload = json.dumps(req, ensure_ascii=False)
    if _USE_TCP:
        port = int(Path(socket_path).read_text().strip())
        s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        s.settimeout(120.0)
        s.connect(("127.0.0.1", port))
    else:
        s = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        s.settimeout(120.0)
        s.connect(socket_path)
    s.sendall((payload + "\n").encode())
    # 接收响应
    buf = b""
    while b"\n" not in buf:
        chunk = s.recv(65536)
        if not chunk:
            break
        buf += chunk
    s.close()
    return json.loads(buf.decode().strip())


def main() -> int:
    args = parse_args()

    output_path = Path(args.output).resolve()
    output_path.parent.mkdir(parents=True, exist_ok=True)

    checkpoint_dir = resolve_checkpoint_dir(getattr(args, "checkpoint_dir", ""))

    # HF 缓存统一指向 checkpoints/hf_cache（与其他模型权重同级管理）
    root = get_root()
    hf_cache = str((root / "runtime" / "checkpoints" / "hf_cache").resolve())
    os.environ.setdefault("HF_HUB_CACHE", hf_cache)
    os.environ.setdefault("HUGGINGFACE_HUB_CACHE", hf_cache)

    # 兼容旧模式：如果设置了 FISH_SPEECH_CMD_TEMPLATE 环境变量，走原子进程方式
    legacy_cmd = (os.getenv("FISH_SPEECH_CMD_TEMPLATE") or "").strip()
    if legacy_cmd:
        import shlex
        _q = (lambda s: f'"{s}"') if sys.platform == "win32" else shlex.quote
        voice_refs_legacy = args.voice_ref or []
        refs_arg = " ".join(_q(r) for r in voice_refs_legacy if r) if voice_refs_legacy else '""'
        cmd = (
            legacy_cmd
            .replace("{text}", _q(args.text))
            .replace("{output}", f'"{output_path}"')
            .replace("{voice_ref}", refs_arg)
            .replace("{checkpoint_dir}", f'"{checkpoint_dir}"')
        )
        completed = subprocess.run(cmd, shell=True, capture_output=True, text=True, timeout=600)
        if completed.returncode != 0:
            print(f"[fish_speech] 引擎返回错误码 {completed.returncode}", file=sys.stderr)
            if completed.stdout:
                print(f"[fish_speech][stdout]\n{completed.stdout}", file=sys.stderr)
            if completed.stderr:
                print(f"[fish_speech][stderr]\n{completed.stderr}", file=sys.stderr)
            return completed.returncode
        if not output_path.exists() or output_path.stat().st_size <= 0:
            print("[fish_speech] 引擎已完成但输出文件缺失或为空", file=sys.stderr)
            return 4
        print(f"[fish_speech] ok -> {output_path}")
        return 0

    # ── 持久化 Worker 模式 ────────────────────────────────────────────────────

    # 检查依赖
    engine_dir = get_engine_dir("fish_speech")
    if not engine_dir.exists():
        print("[fish_speech] engine 目录不存在，请先运行 pnpm run checkpoints", file=sys.stderr)
        return 3

    worker_script = Path(__file__).resolve().parent / "fish_speech_worker.py"
    if not worker_script.exists():
        print(f"[fish_speech] fish_speech_worker.py 缺失: {worker_script}", file=sys.stderr)
        return 3

    socket_path, pid_path = _worker_paths(checkpoint_dir)

    if not _worker_alive(socket_path, pid_path):
        _start_worker(checkpoint_dir, socket_path, pid_path)

    # 发送推理请求
    import time as _time
    print(f"[fish_speech] 发送推理请求: {args.text[:50]}{'...' if len(args.text) > 50 else ''}", file=sys.stderr, flush=True)
    _req_t0 = _time.monotonic()
    try:
        result = _send_request(
            socket_path=socket_path,
            text=args.text,
            voice_refs=args.voice_ref or [],
            output=str(output_path),
            top_p=args.top_p,
            temperature=args.temperature,
            repetition_penalty=args.repetition_penalty,
            max_new_tokens=args.max_new_tokens,
        )
        print(f"[fish_speech] 收到推理响应，耗时 {_time.monotonic()-_req_t0:.1f}s", file=sys.stderr, flush=True)
    except Exception as exc:
        print(f"[fish_speech] socket 通信失败 (耗时 {_time.monotonic()-_req_t0:.1f}s): {exc}", file=sys.stderr, flush=True)
        # worker の stderr ログを出力して排查（デバッグ用）
        _stderr_log = str(Path(__file__).resolve().parent / ".." / ".." / ".." / "cache" / "fish_worker_err.log")
        # _start_worker が保存した stderr_log を探す
        import glob as _glob
        for _f in sorted(_glob.glob(os.path.join(os.environ.get("TEMP", "/tmp"), "fish_worker_err_*.log")), key=os.path.getmtime, reverse=True):
            try:
                _content = Path(_f).read_text(encoding="utf-8", errors="replace").strip()
                if _content:
                    print(f"[fish_speech] worker stderr:\n{_content}", file=sys.stderr, flush=True)
                break
            except Exception:
                pass
        # worker 进程可能卡死（正在处理上一个请求），必须 kill 掉，否则下次仍会卡住
        if os.path.exists(pid_path):
            try:
                pid = int(Path(pid_path).read_text().strip())
                os.kill(pid, 9)  # SIGKILL
                print(f"[fish_speech] 已 kill worker 进程 PID={pid}", file=sys.stderr, flush=True)
            except (ProcessLookupError, ValueError, OSError):
                pass
        for _f in (socket_path, pid_path):
            try:
                os.unlink(_f)
            except OSError:
                pass
        return 1

    if not result.get("ok"):
        err = result.get("error", "未知错误")
        print(f"[fish_speech] 推理失败: {err}", file=sys.stderr)
        return 1

    if not output_path.exists() or output_path.stat().st_size <= 0:
        print("[fish_speech] 推理完成但输出文件缺失或为空", file=sys.stderr)
        return 4

    print(f"[fish_speech] ok -> {output_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
