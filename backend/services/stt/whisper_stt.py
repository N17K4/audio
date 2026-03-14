import os
import subprocess
import tempfile
from pathlib import Path
from typing import Dict

from fastapi import HTTPException

from logging_setup import logger
from utils.engine import get_whisper_command_template, build_engine_env


async def run_whisper_stt(content: bytes, filename: str, model: str = "base") -> Dict:
    cmd_tpl = get_whisper_command_template()
    if not cmd_tpl:
        raise HTTPException(
            status_code=400,
            detail=(
                "Whisper 引擎未找到。请将 runtime/whisper/inference.py 放置于正确路径，"
                "或在 runtime/whisper/engine.json 中配置 'command' 字段。"
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
        try:
            import asyncio
            completed = await asyncio.to_thread(
                subprocess.run,
                cmd, shell=True, check=False, capture_output=True, text=True, timeout=600,
                env=build_engine_env("whisper"),
            )
        except Exception as exc:
            raise HTTPException(status_code=500, detail=f"Whisper command failed: {exc}") from exc

        if completed.returncode != 0:
            stdout = (completed.stdout or "").strip()[:10000]
            stderr = (completed.stderr or "").strip()[:10000]
            logger.error("Whisper 失败 (code=%s)\nstdout: %s\nstderr: %s", completed.returncode, stdout, stderr)
            raise HTTPException(
                status_code=500,
                detail=f"Whisper 失败 (code={completed.returncode}): {stderr}",
            )

        text = ""
        if Path(txt_tmp_path).exists():
            text = Path(txt_tmp_path).read_text(encoding="utf-8").strip()

        return {
            "status": "success",
            "task": "stt",
            "provider": "whisper",
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
