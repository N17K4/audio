import asyncio
import subprocess
import uuid
from pathlib import Path
from typing import Dict

from fastapi import HTTPException

from config import BACKEND_HOST, BACKEND_PORT, DOWNLOAD_DIR, RUNTIME_ROOT
from logging_setup import logger
from utils.engine import get_embedded_python, build_engine_env


def _get_flux_script() -> str:
    candidates = [RUNTIME_ROOT / "flux" / "inference.py"]
    for p in candidates:
        if p.exists():
            logger.debug("[flux] 找到脚本: %s", p)
            return str(p.resolve())
    logger.warning("[flux] 未找到 flux inference.py")
    return ""


async def run_flux_image_gen(
    *, prompt: str, model: str = "flux1-schnell-Q4_K_M",
    width: int = 1024, height: int = 1024, steps: int = 4,
    output_path: str = "",
) -> Dict:
    script = _get_flux_script()
    if not script:
        raise HTTPException(
            status_code=400,
            detail=(
                "Flux.1-Schnell 引擎未找到。请确保 runtime/flux/inference.py 存在，"
                "并运行 pnpm run checkpoints 下载模型。"
            ),
        )

    try:
        py = get_embedded_python()
    except RuntimeError as e:
        raise HTTPException(status_code=500, detail=str(e))

    if not output_path:
        file_id = str(uuid.uuid4())[:8]
        output_path = str(DOWNLOAD_DIR / f"{file_id}_flux_gen.png")

    cmd = [
        py, script,
        "--prompt", prompt,
        "--output", output_path,
        "--width", str(width),
        "--height", str(height),
        "--steps", str(steps),
    ]

    logger.info("[flux] 生成图像: %dx%d steps=%d", width, height, steps)
    try:
        completed = await asyncio.to_thread(
            subprocess.run,
            cmd, check=False, capture_output=True, text=True, timeout=600,
            env=build_engine_env("flux"), encoding="utf-8", errors="replace",
        )
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Flux 执行失败: {exc}") from exc

    if completed.returncode != 0:
        stderr = (completed.stderr or "").strip()[:5000]
        stdout = (completed.stdout or "").strip()[:5000]
        logger.error("[flux] 失败 code=%s\nstdout: %s\nstderr: %s", completed.returncode, stdout, stderr)
        raise HTTPException(status_code=500, detail=f"Flux 推理失败 (code={completed.returncode}): {stderr or stdout}")

    if not Path(output_path).exists():
        raise HTTPException(status_code=500, detail="Flux 执行完成但输出文件不存在")

    result_url = f"http://{BACKEND_HOST}:{BACKEND_PORT}/download/{Path(output_path).name}"
    return {
        "status": "success",
        "task": "image_gen",
        "provider": "flux",
        "result_url": result_url,
        "result_text": "",
    }
