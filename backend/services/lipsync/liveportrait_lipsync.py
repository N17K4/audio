import asyncio
import subprocess
import uuid
from pathlib import Path
from typing import Dict

from fastapi import HTTPException

from config import BACKEND_HOST, BACKEND_PORT, DOWNLOAD_DIR, RUNTIME_ROOT
from logging_setup import logger
from utils.engine import get_embedded_python, build_engine_env
from utils.audit import log_ai_call, log_ai_error


def _get_liveportrait_script() -> str:
    candidates = [
        RUNTIME_ROOT / "liveportrait" / "inference.py",
    ]
    for p in candidates:
        if p.exists():
            logger.debug("[liveportrait] 找到脚本: %s", p)
            return str(p.resolve())
    logger.warning("[liveportrait] 未找到 liveportrait inference.py")
    return ""


async def run_liveportrait_lipsync(
    *,
    source_path: str,
    audio_path: str,
    output_path: str = "",
    model: str = "",
) -> Dict:
    script = _get_liveportrait_script()
    if not script:
        raise HTTPException(
            status_code=400,
            detail="LivePortrait 引擎未找到。请运行 pnpm run checkpoints 安装 LivePortrait 模型。",
        )

    try:
        py = get_embedded_python()
    except RuntimeError as e:
        raise HTTPException(status_code=500, detail=str(e))

    if not output_path:
        file_id = str(uuid.uuid4())[:8]
        output_path = str(DOWNLOAD_DIR / f"{file_id}_liveportrait.mp4")

    cmd = [
        py, script,
        "--source", source_path,
        "--audio", audio_path,
        "--output", output_path,
    ]
    if model:
        cmd += ["--model", model]

    logger.info("[liveportrait] 执行口型同步: source=%s, audio=%s", source_path, audio_path)
    log_ai_call("liveportrait", {"source": source_path, "audio": audio_path, "output": output_path}, command=cmd)
    try:
        completed = await asyncio.to_thread(
            subprocess.run,
            cmd, check=False, capture_output=True, text=True, timeout=600,
            env=build_engine_env("liveportrait"),
        )
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"LivePortrait 执行失败: {exc}") from exc

    if completed.returncode != 0:
        stderr = (completed.stderr or "").strip()
        stdout = (completed.stdout or "").strip()
        logger.error("[liveportrait] 失败 code=%s\nstdout: %s\nstderr: %s", completed.returncode, stdout, stderr)
        log_ai_error("liveportrait", RuntimeError("non-zero exit"), returncode=completed.returncode, stdout=stdout, stderr=stderr)
        tail = (stderr or stdout)[-3000:]
        raise HTTPException(status_code=500, detail=f"LivePortrait 失败 (code={completed.returncode}): {tail}")

    if not Path(output_path).exists():
        raise HTTPException(status_code=500, detail="LivePortrait 执行完成但输出文件不存在")

    result_url = f"http://{BACKEND_HOST}:{BACKEND_PORT}/download/{Path(output_path).name}"
    return {
        "status": "success",
        "task": "lipsync",
        "provider": "liveportrait",
        "result_url": result_url,
        "result_text": "",
    }
