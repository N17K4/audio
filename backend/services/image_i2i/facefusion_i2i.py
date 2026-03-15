import asyncio
import subprocess
import uuid
from pathlib import Path
from typing import Dict

from fastapi import HTTPException

from config import BACKEND_HOST, BACKEND_PORT, DOWNLOAD_DIR, RUNTIME_ROOT
from logging_setup import logger
from utils.engine import get_embedded_python, build_engine_env


def _get_facefusion_script() -> str:
    candidates = [
        RUNTIME_ROOT / "facefusion" / "engine" / "facefusion.py",
        RUNTIME_ROOT / "facefusion" / "facefusion.py",
    ]
    for p in candidates:
        if p.exists():
            logger.debug("[facefusion] 找到脚本: %s", p)
            return str(p.resolve())
    logger.warning("[facefusion] 未找到 facefusion.py，检查路径: %s", [str(c) for c in candidates])
    return ""


async def run_facefusion_i2i(
    *, source_image_path: str, target_image_path: str,
    output_path: str, model: str = "",
) -> Dict:
    script = _get_facefusion_script()
    if not script:
        raise HTTPException(
            status_code=400,
            detail="FaceFusion 引擎未找到。请运行 pnpm run setup-engines 安装 FaceFusion。",
        )

    try:
        py = get_embedded_python()
    except RuntimeError as e:
        raise HTTPException(status_code=500, detail=str(e))

    cmd = [
        py, script,
        "headless-run",
        "--source-paths", source_image_path,
        "--target-path", target_image_path,
        "--output-path", output_path,
        "--execution-providers", "cuda" if _has_cuda() else "cpu",
    ]
    if model:
        cmd += ["--face-swapper-model", model]

    logger.info("[facefusion] 执行换脸: %s", " ".join(str(c) for c in cmd))
    try:
        completed = await asyncio.to_thread(
            subprocess.run,
            cmd, check=False, capture_output=True, text=True, timeout=600,
            env=build_engine_env("facefusion"),
        )
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"FaceFusion 执行失败: {exc}") from exc

    if completed.returncode != 0:
        stderr = (completed.stderr or "").strip()[:5000]
        stdout = (completed.stdout or "").strip()[:5000]
        logger.error("[facefusion] 失败 code=%s\nstdout: %s\nstderr: %s", completed.returncode, stdout, stderr)
        raise HTTPException(status_code=500, detail=f"FaceFusion 失败 (code={completed.returncode}): {stderr or stdout}")

    if not Path(output_path).exists():
        raise HTTPException(status_code=500, detail="FaceFusion 执行完成但输出文件不存在")

    result_url = f"http://{BACKEND_HOST}:{BACKEND_PORT}/download/{Path(output_path).name}"
    return {
        "status": "success",
        "task": "image_i2i",
        "provider": "facefusion",
        "result_url": result_url,
        "result_text": "",
    }


def _has_cuda() -> bool:
    try:
        import torch
        return torch.cuda.is_available()
    except Exception:
        return False
