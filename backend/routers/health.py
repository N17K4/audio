from fastapi import APIRouter, Body
from fastapi.responses import StreamingResponse
import subprocess
import json
import threading
import queue as _queue

import os
from config import BACKEND_HOST, BACKEND_PORT, USER_DATA_ROOT, TASK_CAPABILITIES, _MANIFEST, DOWNLOAD_DIR, load_settings, save_settings, APP_ROOT, RESOURCES_ROOT, RUNTIME_ROOT, ML_PACKAGES_DIR, LOGS_DIR
from utils.engine import get_checkpoint_dir, detect_ffmpeg_hwaccel
from utils.voices import list_voices
from logging_setup import logger
from pathlib import Path
import job_queue


def _stream_subprocess(proc):
    """并发读取 stdout/stderr，避免 Windows 4KB 管道缓冲区死锁。

    用一个后台线程收集 stderr，主线程流式输出 stdout，
    进程结束后再输出 stderr 缓冲内容。
    """
    stderr_lines: list[str] = []

    def _drain_stderr():
        for line in iter(proc.stderr.readline, ''):
            if line:
                stderr_lines.append(line.rstrip())
        proc.stderr.close()

    t = threading.Thread(target=_drain_stderr, daemon=True)
    t.start()

    for line in iter(proc.stdout.readline, ''):
        if line:
            yield json.dumps({"log": line.rstrip()})
    proc.stdout.close()

    t.join(timeout=10)
    returncode = proc.wait()

    for sl in stderr_lines:
        yield json.dumps({"log": f"[ERROR] {sl}"})

    yield returncode

router = APIRouter()


@router.get("/health")
async def health():
    return {
        "status": "ok",
        "host": BACKEND_HOST,
        "port": BACKEND_PORT,
        "user_data_root": str(USER_DATA_ROOT),
        "download_dir": str(DOWNLOAD_DIR),
        "voices_count": len(list_voices()),
        "is_docker": os.environ.get("RESOURCES_ROOT") == "/app",
    }


@router.get("/runtime/info")
async def runtime_info():
    """返回各本地引擎的固化版本信息（来自 manifest.json）。"""
    engines_out = {}
    manifest_engines = (_MANIFEST.get("engines") or {})
    for name, cfg in manifest_engines.items():
        checkpoint_dir = get_checkpoint_dir(name)
        checkpoint_path = Path(checkpoint_dir)
        required_files = [f["path"] for f in cfg.get("checkpoint_files", []) if f.get("required")]
        # 支持自定义就绪检测文件（用于 prefetch 类引擎，如 faster_whisper）
        readiness_check = cfg.get("readiness_check_file", "")
        if readiness_check:
            required_files.append(readiness_check)
        missing = [p for p in required_files if not (checkpoint_path / p).exists()]
        engines_out[name] = {
            "version": cfg.get("version", "unknown"),
            "checkpoint_dir": checkpoint_dir,
            "ready": len(missing) == 0,
            "missing_checkpoints": missing,
        }
    return {
        "manifest_version": _MANIFEST.get("manifest_version", "1"),
        "engines": engines_out,
        "network_deps": _MANIFEST.get("network_deps", []),
    }


@router.get("/capabilities")
async def get_capabilities():
    return {"tasks": TASK_CAPABILITIES}


@router.get("/hw-accel")
async def hw_accel_info():
    """探测并返回当前可用的 FFmpeg 硬件加速编码器（结果缓存，首次调用较慢）。"""
    import asyncio
    hw = await asyncio.to_thread(detect_ffmpeg_hwaccel)
    return {"hwaccel": hw["hwaccel"], "encoder": hw["encoder"], "label": hw["label"]}


@router.get("/settings")
async def get_settings():
    s = load_settings()
    result: dict = {
        "local_concurrency": max(1, min(4, int(s.get("local_concurrency", 1)))),
    }
    # pip_mirror / hf_endpoint: 只有用户设置过才返回（区分"未设置"和"选择了官方源=空字符串"）
    if "pip_mirror" in s:
        result["pip_mirror"] = s["pip_mirror"]
    if "hf_endpoint" in s:
        result["hf_endpoint"] = s["hf_endpoint"]
    return result


@router.post("/settings")
async def update_settings(
    local_concurrency: int | None = Body(None, embed=True),
    pip_mirror: str | None = Body(None, embed=True),
    hf_endpoint: str | None = Body(None, embed=True),
):
    s = load_settings()
    if local_concurrency is not None:
        n = max(1, min(4, local_concurrency))
        s["local_concurrency"] = n
        job_queue.set_local_concurrency(n)
    if pip_mirror is not None:
        s["pip_mirror"] = pip_mirror.strip()
    if hf_endpoint is not None:
        s["hf_endpoint"] = hf_endpoint.strip().rstrip("/")
    save_settings(s)
    return {
        "local_concurrency": max(1, min(4, int(s.get("local_concurrency", 1)))),
        "pip_mirror": s.get("pip_mirror", ""),
        "hf_endpoint": s.get("hf_endpoint", ""),
    }


_TASK_LOG = LOGS_DIR / "task.log"


def _open_task_log() -> "IO":
    """打开共享 task.log（追加模式）。"""
    LOGS_DIR.mkdir(parents=True, exist_ok=True)
    return open(_TASK_LOG, "a", encoding="utf-8")


_smoketest_proc: subprocess.Popen | None = None


def _run_smoketest_gen(task_name: str, test_file: Path, py_cmd: str):
    """通用烟雾测试 SSE 生成器：写入 task.log + 流式输出 + 最终返回 summary。"""
    global _smoketest_proc
    import os
    from datetime import datetime

    log_fp = _open_task_log()
    all_lines: list[str] = []

    def _emit(msg: str):
        log_fp.write(msg + "\n")
        log_fp.flush()
        all_lines.append(msg)
        return f"data: {json.dumps({'log': msg})}\n\n"

    try:
        yield _emit(f"═══ {task_name} [{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}] ═══")

        env = os.environ.copy()
        paths_to_add = [str(APP_ROOT), str(ML_PACKAGES_DIR)]
        existing = env.get("PYTHONPATH", "")
        for p in paths_to_add:
            if p not in existing:
                existing = f"{p}{os.pathsep}{existing}" if existing else p
        env["PYTHONPATH"] = existing
        env["BACKEND_PORT"] = str(BACKEND_PORT)
        env["PYTHONUNBUFFERED"] = "1"
        env["PYTHONIOENCODING"] = "utf-8"

        # 烟雾测试前に __pycache__ をクリア（コード変更が確実に反映されるように）
        import shutil
        for cache_root in [APP_ROOT / "backend", APP_ROOT / "tests"]:
            for pc in cache_root.rglob("__pycache__"):
                shutil.rmtree(pc, ignore_errors=True)
        yield _emit("[调试] __pycache__ 已清理")

        cmd = [py_cmd, "-u", str(test_file)]
        yield _emit(f"[调试] Python: {py_cmd}")
        yield _emit(f"[调试] 测试文件: {test_file} (存在: {test_file.exists()})")
        yield _emit(f"[调试] PYTHONPATH: {env['PYTHONPATH']}")

        proc = subprocess.Popen(
            cmd,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            bufsize=1,
            env=env,
            encoding="utf-8", errors="replace",
        )
        _smoketest_proc = proc
        yield _emit(f"[调试] 进程已启动 (PID: {proc.pid})")

        returncode = None
        for item in _stream_subprocess(proc):
            if isinstance(item, int):
                returncode = item
            else:
                data = json.loads(item)
                yield _emit(data.get("log", ""))

        if returncode == 0:
            yield _emit(f"─── {task_name} 执行完成 ✅")
        else:
            yield _emit(f"─── {task_name} 执行失败（退出码：{returncode}）")

    except Exception as e:
        logger.error("[%s] 异常: %s", task_name, e, exc_info=True)
        yield _emit(f"❌ 异常：{str(e)}")

    finally:
        _smoketest_proc = None
        yield _emit("")  # 空行分隔
        log_fp.close()

    # ── 解析结果汇总 ──────────────────────────────────────────────────────────
    summary: list[dict] = []
    summary_idx = next((i for i, l in enumerate(all_lines) if "📊 测试结果汇总" in l), -1)
    lines_to_parse = all_lines[summary_idx:] if summary_idx >= 0 else all_lines
    for line in lines_to_parse:
        pass_m = __import__("re").match(r".*[✅✓]\s*(?:通过\s*—?\s*)?(.+)", line)
        fail_m = __import__("re").match(r".*[❌✗]\s*(?:失败\s*—?\s*)?(.+)", line)
        if pass_m and "总计" not in line:
            summary.append({"name": pass_m.group(1).strip().split("：")[0].split(" [")[0], "status": "passed"})
        elif fail_m and "总计" not in line:
            summary.append({"name": fail_m.group(1).strip().split("：")[0].split(" [")[0], "status": "failed"})

    yield f"data: {json.dumps({'done': True, 'summary': summary})}\n\n"


def _clear_task_log():
    """清空 task.log（由 DELETE /jobs 调用）。"""
    try:
        if _TASK_LOG.exists():
            _TASK_LOG.write_text("", encoding="utf-8")
    except Exception:
        pass


@router.get("/smoketest/status")
async def smoketest_status():
    """烟雾测试の実行状態を返す。"""
    proc = _smoketest_proc
    running = proc is not None and proc.poll() is None
    return {"running": running}


@router.post("/smoketest/abort")
async def abort_smoketest():
    """实行中の烟雾测试プロセスを中止する。"""
    global _smoketest_proc
    proc = _smoketest_proc
    if proc is None or proc.poll() is not None:
        return {"ok": False, "error": "没有正在运行的烟雾测试"}
    try:
        proc.terminate()
        proc.wait(timeout=5)
    except subprocess.TimeoutExpired:
        proc.kill()
    _smoketest_proc = None
    return {"ok": True, "message": "烟雾测试已中止"}


@router.post("/smoketest/run")
async def run_smoketest():
    """运行基础功能烟雾测试（smoke_test.py）。"""
    import sys

    test_file = APP_ROOT / "tests" / "smoke_test.py"
    if not test_file.exists():
        return {"ok": False, "error": f"测试文件不存在：{test_file}"}

    from utils.engine import get_embedded_python as _get_py
    try:
        py_cmd = _get_py()
    except RuntimeError:
        py_cmd = sys.executable

    return StreamingResponse(
        _run_smoketest_gen("烟雾测试 1", test_file, py_cmd),
        media_type="text/event-stream",
    )


@router.post("/smoketest2/run")
async def run_smoketest2():
    """运行 RAG / Agent / LoRA 进阶功能测试（smoke_test2.py）。"""
    import sys

    test_file = APP_ROOT / "tests" / "smoke_test2.py"
    if not test_file.exists():
        return {"ok": False, "error": f"测试文件不存在：{test_file}"}

    from utils.engine import get_embedded_python as _get_py
    try:
        py_cmd = _get_py()
    except RuntimeError:
        py_cmd = sys.executable

    return StreamingResponse(
        _run_smoketest_gen("烟雾测试 2", test_file, py_cmd),
        media_type="text/event-stream",
    )
