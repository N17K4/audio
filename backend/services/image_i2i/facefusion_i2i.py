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


def _get_facefusion_script() -> str:
    candidates = [
        RUNTIME_ROOT / "engine" / "facefusion" / "facefusion.py",
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
    face_enhancer: bool = False, frame_enhancer: bool = False,
    many_faces: bool = False,
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

    # FaceFusion 用相对路径 resolve_file_paths('facefusion/processors/modules') 查找处理器模块，
    # 必须在引擎根目录下运行，否则 face_swapper_model 状态无法初始化。
    engine_dir = str((RUNTIME_ROOT / "engine" / "facefusion").resolve())

    cmd = [
        py, script,
        "headless-run",
        "--source-paths", source_image_path,
        "--target-path", target_image_path,
        "--output-path", output_path,
        "--processors", "face_swapper",
        "--execution-providers", "cuda" if _has_cuda() else "cpu",
        "--face-swapper-model", model or "inswapper_128_fp16",
    ]

    if face_enhancer:
        cmd.extend(["--processors", "face_enhancer"])
    if frame_enhancer:
        cmd.extend(["--processors", "frame_enhancer"])
    if many_faces:
        cmd.append("--many-faces")

    logger.debug("[facefusion] 执行换脸: %s", " ".join(str(c) for c in cmd))
    log_ai_call("facefusion", {"source": source_image_path, "target": target_image_path, "output": output_path}, command=cmd)
    try:
        completed = await asyncio.to_thread(
            subprocess.run,
            cmd, check=False, capture_output=True, text=True, timeout=600,
            env=build_engine_env("facefusion"), encoding="utf-8", errors="replace",
            cwd=engine_dir,
        )
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"FaceFusion 执行失败: {exc}") from exc

    if completed.returncode != 0:
        stderr = (completed.stderr or "").strip()
        stdout = (completed.stdout or "").strip()

        # "no source face detected" 不算致命错误 — 返回提示而非 500
        combined = f"{stderr} {stdout}".lower()
        if "no source face detected" in combined or "no target face detected" in combined:
            logger.warning("[facefusion] 未检测到人脸，跳过处理")
            return {
                "status": "no_face",
                "task": "image_i2i",
                "provider": "facefusion",
                "result_url": "",
                "result_text": "未检测到人脸，请使用包含清晰人脸的图片",
            }

        # 过滤下载进度条等冗余行，只保留有意义的日志
        def _filter_noise(text: str, max_len: int = 3000) -> str:
            lines = text.splitlines()
            filtered = [
                ln for ln in lines
                if not any(kw in ln for kw in ("%|", "B/s", "Downloading", "━", "██", "it/s"))
            ]
            return "\n".join(filtered)[-max_len:]
        filtered_stderr = _filter_noise(stderr)
        filtered_stdout = _filter_noise(stdout)
        logger.error("[facefusion] 失败 code=%s\nstdout: %s\nstderr: %s", completed.returncode, filtered_stdout, filtered_stderr)
        log_ai_error("facefusion", RuntimeError("non-zero exit"), returncode=completed.returncode, stdout=filtered_stdout, stderr=filtered_stderr)
        tail = (filtered_stderr or filtered_stdout)[-3000:]
        raise HTTPException(status_code=500, detail=f"FaceFusion 失败 (code={completed.returncode}): {tail}")

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
