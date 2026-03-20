import asyncio
import os
import subprocess
import tempfile
import uuid
from pathlib import Path
from typing import Dict

from fastapi import HTTPException

from config import BACKEND_HOST, BACKEND_PORT, DOWNLOAD_DIR, RUNTIME_ROOT
from logging_setup import logger
from utils.engine import get_embedded_python, build_engine_env
from utils.audit import log_ai_call, log_ai_error


def _get_got_ocr_script() -> str:
    candidates = [
        RUNTIME_ROOT / "got_ocr" / "inference.py",
    ]
    for p in candidates:
        if p.exists():
            logger.debug("[got_ocr] 找到脚本: %s", p)
            return str(p.resolve())
    logger.warning("[got_ocr] 未找到 got_ocr inference.py")
    return ""


async def run_got_ocr(
    *, file_content: bytes, filename: str, model: str = "GOT-OCR2.0",
) -> Dict:
    script = _get_got_ocr_script()
    if not script:
        raise HTTPException(
            status_code=400,
            detail="GOT-OCR2.0 引擎未找到。请运行 pnpm run checkpoints 安装 GOT-OCR2.0 模型。",
        )

    try:
        py = get_embedded_python()
    except RuntimeError as e:
        raise HTTPException(status_code=500, detail=str(e))

    suffix = Path(filename).suffix or ".png"
    with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp_in:
        tmp_in.write(file_content)
        tmp_in_path = tmp_in.name

    tmp_out_path = tmp_in_path + ".txt"

    try:
        cmd = [
            py, script,
            "--input", tmp_in_path,
            "--output", tmp_out_path,
            "--model", model,
        ]
        logger.info("[got_ocr] 识别文件: %s (model=%s)", filename, model)
        log_ai_call("got_ocr", {"input": tmp_in_path, "model": model}, command=cmd)
        try:
            completed = await asyncio.to_thread(
                subprocess.run,
                cmd, check=False, capture_output=True, text=True, timeout=300,
                env=build_engine_env("got_ocr"), encoding="utf-8", errors="replace",
            )
        except Exception as exc:
            raise HTTPException(status_code=500, detail=f"GOT-OCR 执行失败: {exc}") from exc

        if completed.returncode != 0:
            stderr = (completed.stderr or "").strip()
            stdout = (completed.stdout or "").strip()
            logger.error("[got_ocr] 失败 code=%s\nstdout: %s\nstderr: %s", completed.returncode, stdout, stderr)
            log_ai_error("got_ocr", RuntimeError("non-zero exit"), returncode=completed.returncode, stdout=stdout, stderr=stderr)
            tail = (stderr or stdout)[-3000:]
            raise HTTPException(status_code=500, detail=f"GOT-OCR 失败 (code={completed.returncode}): {tail}")

        text = ""
        if Path(tmp_out_path).exists():
            text = Path(tmp_out_path).read_text(encoding="utf-8").strip()

        return {
            "status": "success",
            "task": "ocr",
            "provider": "got_ocr",
            "text": text,
            "filename": filename,
        }
    finally:
        for p in [tmp_in_path, tmp_out_path]:
            try:
                os.unlink(p)
            except Exception:
                pass
