import asyncio
import subprocess
import uuid
from pathlib import Path
from typing import Dict, Optional

from fastapi import HTTPException

from config import BACKEND_HOST, BACKEND_PORT, DOWNLOAD_DIR, RUNTIME_ROOT
from logging_setup import logger
from utils.engine import get_embedded_python, build_engine_env


def _get_wan_script() -> str:
    candidates = [
        RUNTIME_ROOT / "wan" / "inference.py",
    ]
    for p in candidates:
        if p.exists():
            logger.debug("[wan] 找到脚本: %s", p)
            return str(p.resolve())
    logger.warning("[wan] 未找到 wan inference.py")
    return ""


async def run_wan_video_gen(
    *,
    prompt: str,
    model: str = "Wan2.1-T2V-1.3B",
    duration: int = 5,
    mode: str = "t2v",
    image_path: Optional[str] = None,
    output_path: str = "",
) -> Dict:
    script = _get_wan_script()
    if not script:
        raise HTTPException(
            status_code=400,
            detail="Wan 2.1 引擎未找到。请运行 pnpm run checkpoints 安装 Wan 2.1 模型。",
        )

    try:
        py = get_embedded_python()
    except RuntimeError as e:
        raise HTTPException(status_code=500, detail=str(e))

    if not output_path:
        file_id = str(uuid.uuid4())[:8]
        output_path = str(DOWNLOAD_DIR / f"{file_id}_wan_video.mp4")

    cmd = [
        py, script,
        "--prompt", prompt,
        "--model", model,
        "--output", output_path,
        "--mode", mode,
        "--duration", str(duration),
    ]
    if image_path:
        cmd += ["--image", image_path]

    logger.info("[wan] 执行视频生成: model=%s mode=%s", model, mode)
    try:
        completed = await asyncio.to_thread(
            subprocess.run,
            cmd, check=False, capture_output=True, text=True, timeout=1800,
            env=build_engine_env("wan"),
        )
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Wan 执行失败: {exc}") from exc

    if completed.returncode != 0:
        stderr = (completed.stderr or "").strip()[:5000]
        stdout = (completed.stdout or "").strip()[:5000]
        logger.error("[wan] 失败 code=%s\nstdout: %s\nstderr: %s", completed.returncode, stdout, stderr)
        raise HTTPException(status_code=500, detail=f"Wan 视频生成失败 (code={completed.returncode}): {stderr or stdout}")

    if not Path(output_path).exists():
        raise HTTPException(status_code=500, detail="Wan 执行完成但输出文件不存在")

    result_url = f"http://{BACKEND_HOST}:{BACKEND_PORT}/download/{Path(output_path).name}"
    return {
        "status": "success",
        "task": "video_gen",
        "provider": "wan_local",
        "result_url": result_url,
        "result_text": "",
    }
