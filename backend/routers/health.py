from fastapi import APIRouter, Body
from fastapi.responses import StreamingResponse
import subprocess
import json

from config import BACKEND_HOST, BACKEND_PORT, MODEL_ROOT, TASK_CAPABILITIES, _MANIFEST, DOWNLOAD_DIR, load_settings, save_settings
from utils.engine import get_checkpoint_dir, detect_ffmpeg_hwaccel
from utils.voices import list_voices
from logging_setup import logger
from pathlib import Path
import job_queue

router = APIRouter()


@router.get("/health")
async def health():
    return {
        "status": "ok",
        "host": BACKEND_HOST,
        "port": BACKEND_PORT,
        "model_root": str(MODEL_ROOT),
        "download_dir": str(DOWNLOAD_DIR),
        "voices_count": len(list_voices()),
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
    return {"local_concurrency": max(1, min(4, int(s.get("local_concurrency", 1))))}


@router.post("/settings")
async def update_settings(local_concurrency: int = Body(..., embed=True)):
    n = max(1, min(4, local_concurrency))
    s = load_settings()
    s["local_concurrency"] = n
    save_settings(s)
    job_queue.set_local_concurrency(n)
    return {"local_concurrency": n}


@router.post("/smoketest/run")
async def run_smoketest():
    """运行基础功能烟雾测试（smoke_test.py）。"""
    from pathlib import Path
    import sys

    test_file = Path(__file__).parent.parent.parent / "tests" / "smoke_test.py"

    if not test_file.exists():
        return {"ok": False, "error": f"测试文件不存在：{test_file}"}

    def generate():
        """流式输出测试结果。"""
        try:
            proc = subprocess.Popen(
                [sys.executable, str(test_file)],
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                bufsize=1
            )

            for line in iter(proc.stdout.readline, ''):
                if line:
                    yield f"data: {json.dumps({'log': line.rstrip()})}\n\n"

            returncode = proc.wait()

            for line in iter(proc.stderr.readline, ''):
                if line:
                    yield f"data: {json.dumps({'log': f'[ERROR] {line.rstrip()}'})}\n\n"

            if returncode == 0:
                yield f"data: {json.dumps({'log': '─── 烟雾测试执行完成 ✅'})}\n\n"
            else:
                yield f"data: {json.dumps({'log': f'─── 烟雾测试执行失败（退出码：{returncode}）'})}\n\n"

        except Exception as e:
            logger.error(f"运行 smoke_test 失败: {e}", exc_info=True)
            yield f"data: {json.dumps({'log': f'❌ 异常：{str(e)}'})}\n\n"

    return StreamingResponse(generate(), media_type="text/event-stream")


@router.post("/smoketest2/run")
async def run_smoketest2():
    """运行 RAG / Agent / LoRA 进阶功能测试（smoke_test2.py）。"""
    from pathlib import Path
    import sys

    test_file = Path(__file__).parent.parent.parent / "tests" / "smoke_test2.py"

    if not test_file.exists():
        return {"ok": False, "error": f"测试文件不存在：{test_file}"}

    def generate():
        """流式输出测试结果。"""
        try:
            # 运行 pytest，直接执行测试脚本中的 main 逻辑
            proc = subprocess.Popen(
                [sys.executable, str(test_file)],
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                bufsize=1
            )

            # 流式输出 stdout
            for line in iter(proc.stdout.readline, ''):
                if line:
                    yield f"data: {json.dumps({'log': line.rstrip()})}\n\n"

            # 等待进程完成
            returncode = proc.wait()

            # 输出 stderr 如果有错误
            for line in iter(proc.stderr.readline, ''):
                if line:
                    yield f"data: {json.dumps({'log': f'[ERROR] {line.rstrip()}'})}\n\n"

            if returncode == 0:
                yield f"data: {json.dumps({'log': '─── 烟雾测试 2 执行完成 ✅'})}\n\n"
            else:
                yield f"data: {json.dumps({'log': f'─── 烟雾测试 2 执行失败（退出码：{returncode}）'})}\n\n"

        except Exception as e:
            logger.error(f"运行 smoketest2 失败: {e}", exc_info=True)
            yield f"data: {json.dumps({'log': f'❌ 异常：{str(e)}'})}\n\n"

    return StreamingResponse(generate(), media_type="text/event-stream")
