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


def _get_sd_script() -> str:
    p = RUNTIME_ROOT / "engine" / "sd" / "inference.py"
    if p.exists():
        logger.debug("[sd] 找到脚本: %s", p)
        return str(p.resolve())
    logger.warning("[sd] 未找到 sd inference.py")
    return ""


async def run_sd_image_gen(
    *, prompt: str, model: str = "sd-turbo",
    width: int = 512, height: int = 512, steps: int = 4,
    output_path: str = "",
) -> Dict:
    script = _get_sd_script()
    if not script:
        raise HTTPException(
            status_code=400,
            detail="SD-Turbo 引擎未找到。请确保 runtime/engine/sd/inference.py 存在，并运行 pnpm run checkpoints --engine sd 下载模型。",
        )

    try:
        py = get_embedded_python()
    except RuntimeError as e:
        raise HTTPException(status_code=500, detail=str(e))

    if not output_path:
        file_id = str(uuid.uuid4())[:8]
        output_path = str(DOWNLOAD_DIR / f"{file_id}_sd_gen.png")

    cmd = [
        py, script,
        "--prompt", prompt,
        "--output", output_path,
        "--width",  str(width),
        "--height", str(height),
        "--steps",  str(steps),
    ]

    log_ai_call("sd", {"prompt": prompt, "model": model, "width": width, "height": height, "steps": steps, "output": output_path}, command=cmd)
    try:
        completed = await asyncio.to_thread(
            subprocess.run,
            cmd, check=False, capture_output=True, text=True, timeout=600,
            env=build_engine_env("sd"), encoding="utf-8", errors="replace",
        )
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"SD 执行失败: {exc}") from exc

    if completed.returncode != 0:
        stderr = (completed.stderr or "").strip()[:5000]
        stdout = (completed.stdout or "").strip()[:5000]
        logger.error("[sd] 失败 code=%s\nstdout: %s\nstderr: %s", completed.returncode, stdout, stderr)
        log_ai_error("sd", RuntimeError("non-zero exit"), returncode=completed.returncode, stdout=stdout, stderr=stderr)
        raise HTTPException(status_code=500, detail=f"SD 推理失败 (code={completed.returncode}): {stderr or stdout}")

    if not Path(output_path).exists():
        raise HTTPException(status_code=500, detail="SD 执行完成但输出文件不存在")

    result_url = f"http://{BACKEND_HOST}:{BACKEND_PORT}/download/{Path(output_path).name}"
    return {
        "status": "success",
        "task": "image_gen",
        "provider": "sd_local",
        "result_url": result_url,
        "result_text": "",
    }
