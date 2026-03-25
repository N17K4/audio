import asyncio
import subprocess
import time as _time
import traceback
import uuid
from pathlib import Path
from typing import Optional

try:
    import httpx
except Exception:
    httpx = None

from fastapi import APIRouter, File, Form, HTTPException, UploadFile

from config import DOWNLOAD_DIR, BACKEND_HOST, BACKEND_PORT
from job_queue import _make_job
from logging_setup import logger
from services.llm.gemini_llm import run_gemini_audio_understanding, run_gemini_realtime_bootstrap
from services.llm.openai_audio import run_openai_audio_understanding, run_openai_realtime_bootstrap
from utils.engine import get_ffmpeg_binary, build_ffmpeg_video_encode_flags
from utils.voices import copy_to_output_dir

router = APIRouter()


@router.post("/tasks/realtime")
async def task_realtime(
    provider: str = Form("openai_realtime"),
    api_key: str = Form(""),
    cloud_endpoint: str = Form(""),
    model: str = Form(""),
    voice: str = Form(""),
):
    p = provider.strip().lower()
    if p == "openai_realtime":
        return await run_openai_realtime_bootstrap(
            api_key=api_key,
            model=model or "gpt-4o-realtime-preview",
            voice=voice or "alloy",
        )
    if p == "gemini_live":
        return await run_gemini_realtime_bootstrap(
            api_key=api_key,
            model=model or "gemini-2.0-flash-live-001",
            voice=voice or "Kore",
        )
    if p == "custom":
        if not cloud_endpoint.strip():
            raise HTTPException(status_code=400, detail="cloud_endpoint is required for custom realtime")
        headers = {"Content-Type": "application/json"}
        if api_key.strip():
            headers["Authorization"] = f"Bearer {api_key.strip()}"
        payload = {"provider": provider, "model": model, "voice": voice}
        try:
            async with httpx.AsyncClient(timeout=60.0) as client:
                resp = await client.post(cloud_endpoint.strip(), headers=headers, json=payload)
        except Exception as exc:
            raise HTTPException(status_code=502, detail=f"Custom realtime request failed: {exc}") from exc
        if resp.status_code >= 400:
            raise HTTPException(status_code=502, detail=f"Custom realtime error {resp.status_code}: {resp.text[:300]}")
        try:
            raw = resp.json()
        except Exception:
            raw = {"raw_text": resp.text[:300]}
        return {"status": "success", "task": "realtime_dialogue", "provider": "custom", "raw": raw}
    raise HTTPException(status_code=400, detail=f"Unsupported realtime provider: {provider}")


@router.post("/tasks/audio-understanding")
async def task_audio_understanding(
    file: UploadFile = File(...),
    provider: str = Form("gemini"),
    prompt: str = Form("Summarize this audio."),
    api_key: str = Form(""),
    cloud_endpoint: str = Form(""),
    model: str = Form(""),
):
    content = await file.read()
    if not content:
        raise HTTPException(status_code=400, detail="Uploaded file is empty.")
    p = provider.strip().lower()
    if p == "openai":
        return await run_openai_audio_understanding(
            content=content,
            filename=file.filename or "audio.webm",
            content_type=file.content_type or "audio/webm",
            prompt=prompt,
            api_key=api_key,
            stt_model="gpt-4o-mini-transcribe",
            model=model or "gpt-4o-mini",
        )
    if p == "gemini":
        return await run_gemini_audio_understanding(
            content=content,
            filename=file.filename or "audio.webm",
            content_type=file.content_type or "audio/webm",
            prompt=prompt,
            api_key=api_key,
            model=model or "gemini-2.5-flash",
        )
    if p == "custom":
        if not cloud_endpoint.strip():
            raise HTTPException(status_code=400, detail="cloud_endpoint is required for custom audio understanding")
        headers = {}
        if api_key.strip():
            headers["Authorization"] = f"Bearer {api_key.strip()}"
        files = {"file": (file.filename or "audio.webm", content, file.content_type or "audio/webm")}
        data = {"prompt": prompt, "model": model}
        try:
            async with httpx.AsyncClient(timeout=120.0) as client:
                resp = await client.post(cloud_endpoint.strip(), headers=headers, files=files, data=data)
        except Exception as exc:
            raise HTTPException(status_code=502, detail=f"Custom audio understanding request failed: {exc}") from exc
        if resp.status_code >= 400:
            raise HTTPException(status_code=502, detail=f"Custom audio understanding error {resp.status_code}: {resp.text[:300]}")
        try:
            payload = resp.json()
        except Exception:
            payload = {"raw_text": resp.text[:300]}
        return {"status": "success", "task": "audio_understanding", "provider": "custom", "raw": payload}
    raise HTTPException(status_code=400, detail=f"Unsupported audio_understanding provider: {provider}")


@router.post("/tasks/media-convert")
async def task_media_convert(
    file: UploadFile = File(...),
    action: str = Form("convert"),      # convert | clip
    output_format: str = Form("mp3"),   # mp3 | wav | m4a
    start_time: str = Form(""),         # HH:MM:SS，clip 时用
    duration: str = Form(""),           # HH:MM:SS，clip 时用
    output_dir: str = Form(""),
    hw_accel: str = Form("auto"),       # auto | videotoolbox | nvenc | qsv | amf | software
):
    """媒体格式转换：音频互转、截取片段。依赖 FFmpeg 静态二进制。"""
    import os
    ffmpeg = get_ffmpeg_binary()
    if not ffmpeg:
        raise HTTPException(
            status_code=500,
            detail=(
                "FFmpeg 未找到。请运行 pnpm run setup 下载 FFmpeg 静态二进制，"
                "或在系统中安装 FFmpeg 并确保其在 PATH 中。"
            ),
        )

    content = await file.read()
    if not content:
        raise HTTPException(status_code=400, detail="上传文件为空")

    act = action.strip().lower()
    fmt = output_format.strip().lower() or "mp3"
    if fmt not in ("mp3", "wav", "m4a", "flac", "ogg", "aac", "opus", "mp4", "webm", "mkv", "mov"):
        raise HTTPException(status_code=400, detail=f"不支持的输出格式: {fmt}")

    filename_stem = Path(file.filename or "media").stem
    action_label = {"convert": "格式转换", "clip": "截取片段"}.get(act, act)
    job = _make_job("media_convert", f"{action_label} · {filename_stem}", "FFmpeg", is_local=False, params={"action": act, "output_format": fmt})
    job_id = job["id"]
    job["status"] = "running"
    job["started_at"] = _time.time()

    task_id = str(uuid.uuid4())
    in_ext = os.path.splitext(file.filename or "")[1] or ".bin"
    input_path = DOWNLOAD_DIR / f"{task_id}_mc_input{in_ext}"
    output_path = DOWNLOAD_DIR / f"{task_id}_mc_output.{fmt}"

    input_path.write_bytes(content)

    # 视频输出格式需要编码，音频输出只需 -vn（去视频流）
    _VIDEO_FMTS = {"mp4", "mov", "mkv", "webm"}
    is_video_output = fmt in _VIDEO_FMTS

    try:
        BASE = [ffmpeg, "-hide_banner", "-y"]
        if act == "convert":
            if is_video_output:
                hw_flags = build_ffmpeg_video_encode_flags(hw_accel)
                cmd = BASE + ["-i", str(input_path)] + hw_flags + ["-c:a", "copy", str(output_path)]
            else:
                cmd = BASE + ["-i", str(input_path), "-vn", str(output_path)]
        elif act == "clip":
            if not start_time.strip():
                raise HTTPException(status_code=400, detail="clip 操作需要 start_time")
            if is_video_output:
                hw_flags = build_ffmpeg_video_encode_flags(hw_accel)
                cmd = BASE + ["-ss", start_time.strip()]
                if duration.strip():
                    cmd += ["-t", duration.strip()]
                cmd += ["-i", str(input_path)] + hw_flags + ["-c:a", "copy", str(output_path)]
            else:
                cmd = BASE + ["-ss", start_time.strip()]
                if duration.strip():
                    cmd += ["-t", duration.strip()]
                cmd += ["-i", str(input_path), "-vn", str(output_path)]
        else:
            raise HTTPException(status_code=400, detail=f"不支持的 action: {action}")

        logger.debug("[media-convert] action=%s fmt=%s cmd=%s", act, fmt, " ".join(cmd))
        completed = await asyncio.to_thread(
            subprocess.run, cmd, capture_output=True, text=True, timeout=300
        )
        if completed.returncode != 0:
            stderr = (completed.stderr or "").strip()[-2000:]
            logger.error("[media-convert] FFmpeg 失败: %s", stderr)
            raise HTTPException(status_code=500, detail=f"FFmpeg 处理失败: {stderr}")

        if not output_path.exists() or output_path.stat().st_size == 0:
            raise HTTPException(status_code=500, detail="FFmpeg 完成但输出文件缺失或为空")

        copy_to_output_dir(output_path, output_dir)
        result_url = f"http://{BACKEND_HOST}:{BACKEND_PORT}/download/{output_path.name}"

        job["status"] = "completed"
        job["result_url"] = result_url
        return {
            "status": "success",
            "task": "media_convert",
            "action": act,
            "output_format": fmt,
            "result_url": result_url,
            "size_bytes": output_path.stat().st_size,
            "job_id": job_id,
        }
    except HTTPException:
        job["status"] = "failed"
        job["error"] = "处理失败"
        raise
    except Exception as exc:
        logger.error("[media-convert] 异常:\n%s", traceback.format_exc())
        job["status"] = "failed"
        job["error"] = str(exc)
        raise HTTPException(status_code=500, detail=f"媒体转换失败: {exc}")
    finally:
        job["completed_at"] = _time.time()
        if input_path.exists():
            try:
                input_path.unlink()
            except Exception:
                pass
