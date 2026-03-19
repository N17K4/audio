import os
import subprocess
import tempfile
from pathlib import Path
from typing import Dict

from fastapi import HTTPException

from logging_setup import logger
from utils.engine import get_faster_whisper_command_template, build_engine_env
from utils.audit import log_ai_call, log_ai_error


async def run_faster_whisper_stt(content: bytes, filename: str, model: str = "large-v3") -> Dict:
    cmd_tpl = get_faster_whisper_command_template()
    if not cmd_tpl:
        raise HTTPException(
            status_code=400,
            detail=(
                "Faster-Whisper 引擎未找到。请将 runtime/faster_whisper/inference.py 放置于正确路径，"
                "或在 runtime/faster_whisper/engine.json 中配置 'command' 字段。"
            ),
        )

    suffix = Path(filename).suffix or ".wav"
    with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as audio_tmp:
        audio_tmp.write(content)
        audio_tmp_path = audio_tmp.name

    txt_tmp_path = audio_tmp_path + ".txt"

    try:
        cmd = (
            cmd_tpl
            .replace("{input}", audio_tmp_path)
            .replace("{output}", txt_tmp_path)
            .replace("{model}", model)
        )
        log_ai_call("faster_whisper", {"input": audio_tmp_path, "model": model}, command=cmd)
        try:
            import asyncio
            completed = await asyncio.to_thread(
                subprocess.run,
                cmd, shell=True, check=False, capture_output=True, text=True, timeout=600,
                env=build_engine_env("faster_whisper"),
            )
        except Exception as exc:
            raise HTTPException(status_code=500, detail=f"Faster-Whisper command failed: {exc}") from exc

        if completed.returncode != 0:
            stdout = (completed.stdout or "").strip()[:10000]
            stderr = (completed.stderr or "").strip()[:10000]
            logger.error("Faster-Whisper 失败 (code=%s)\nstdout: %s\nstderr: %s", completed.returncode, stdout, stderr)
            log_ai_error("faster_whisper", RuntimeError("non-zero exit"), returncode=completed.returncode, stdout=stdout, stderr=stderr)
            raise HTTPException(
                status_code=500,
                detail=f"Faster-Whisper 失败 (code={completed.returncode}): {stderr}",
            )

        text = ""
        if Path(txt_tmp_path).exists():
            text = Path(txt_tmp_path).read_text(encoding="utf-8").strip()

        return {
            "status": "success",
            "task": "stt",
            "provider": "faster_whisper",
            "text": text,
            "model": model,
            "filename": filename,
        }
    finally:
        for p in [audio_tmp_path, txt_tmp_path]:
            try:
                os.unlink(p)
            except Exception:
                pass
