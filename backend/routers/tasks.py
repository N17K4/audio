import asyncio
import subprocess
import traceback
import uuid
from pathlib import Path
from typing import Optional

try:
    import httpx
except Exception:
    httpx = None

from fastapi import APIRouter, File, Form, HTTPException, UploadFile

from config import DOWNLOAD_DIR, MAX_LOCAL_QUEUE, BACKEND_HOST, BACKEND_PORT
from job_queue import JOBS, LOCAL_SEM, _make_job, _run_tts_job
from logging_setup import logger
from services.llm.gemini_llm import run_gemini_audio_understanding, run_gemini_realtime_bootstrap
from services.llm.github_llm import run_github_llm
from services.llm.ollama_llm import run_ollama_llm
from services.llm.openai_audio import run_openai_audio_understanding, run_openai_realtime_bootstrap
from services.llm.openai_llm import run_openai_llm
from services.llm.gemini_llm import run_gemini_llm
from services.stt.gemini_stt import run_gemini_stt
from services.stt.openai_stt import run_openai_stt
from services.stt.whisper_stt import run_whisper_stt
from services.tts.elevenlabs_tts import run_elevenlabs_tts
from services.tts.fish_speech_tts import run_fish_speech_tts
from services.tts.gemini_tts import run_gemini_tts
from services.tts.openai_tts import run_openai_tts
from utils.engine import get_ffmpeg_binary
from utils.voices import copy_to_output_dir, get_voice_or_404

router = APIRouter()


@router.post("/tasks/tts")
async def task_tts(
    text: str = Form(...),
    provider: str = Form("fish_speech"),
    api_key: str = Form(""),
    cloud_endpoint: str = Form(""),
    model: str = Form(""),
    voice: str = Form(""),
    voice_ref: str = Form(""),
    voice_id: str = Form(""),
    output_dir: str = Form(""),
    reference_audio: Optional[UploadFile] = File(None),
):
    if not text.strip():
        raise HTTPException(status_code=400, detail="text is required")
    p = provider.strip().lower()

    ref_audio_tmp: Optional[Path] = None
    if reference_audio and reference_audio.filename:
        ref_ext = Path(reference_audio.filename).suffix or ".wav"
        ref_audio_tmp = DOWNLOAD_DIR / f"{uuid.uuid4()}_tts_ref{ref_ext}"
        ref_audio_tmp.write_bytes(await reference_audio.read())

    ref = str(ref_audio_tmp) if ref_audio_tmp else (voice_ref.strip() or voice.strip())
    voice_id_str = voice_id.strip()
    if voice_id_str and p == "fish_speech" and not ref:
        try:
            v = get_voice_or_404(voice_id_str)
            ref = v.get("reference_audio", "")
        except Exception:
            ref = ""

    is_local = p == "fish_speech" and not cloud_endpoint.strip()

    # 本地队列容量检查
    if is_local:
        local_active = sum(
            1 for j in JOBS.values() if j.get("is_local") and j["status"] in ("queued", "running")
        )
        if local_active >= MAX_LOCAL_QUEUE:
            if ref_audio_tmp and ref_audio_tmp.exists():
                ref_audio_tmp.unlink()
            raise HTTPException(
                status_code=429,
                detail=f"本地推理队列已满（{MAX_LOCAL_QUEUE} 个），请等待当前任务完成后再提交。",
            )

    label = (text[:30] + "…") if len(text) > 30 else text
    job = _make_job("tts", f"TTS · {label}", p, is_local=is_local)
    job_id = job["id"]
    job["_ref_audio_tmp"] = str(ref_audio_tmp) if ref_audio_tmp else None

    async def _do_tts():
        if p == "fish_speech":
            return await run_fish_speech_tts(text=text, voice=ref, api_key=api_key, endpoint=cloud_endpoint)
        elif p == "openai":
            return await run_openai_tts(text=text, api_key=api_key, model=model or "gpt-4o-mini-tts", voice=voice or "alloy")
        elif p == "gemini":
            return await run_gemini_tts(text=text, api_key=api_key, model=model or "gemini-2.5-flash-preview-tts", voice=voice or "Kore")
        elif p == "elevenlabs":
            return await run_elevenlabs_tts(text=text, api_key=api_key, voice=voice or "", model=model or "")
        else:
            raise HTTPException(status_code=400, detail=f"Unsupported TTS provider: {provider}")

    async def _tts_with_copy():
        result = await _do_tts()
        if result.get("result_url") and output_dir.strip():
            url_name = Path(result["result_url"]).name
            copy_to_output_dir(DOWNLOAD_DIR / url_name, output_dir)
        return result

    task = asyncio.create_task(_run_tts_job(job_id, _tts_with_copy))
    job["_task"] = task

    logger.info("tts job %s queued (provider=%s local=%s)", job_id, p, is_local)
    return {"status": "queued", "job_id": job_id}


@router.post("/tasks/stt")
async def task_stt(
    file: UploadFile = File(...),
    provider: str = Form("openai"),
    api_key: str = Form(""),
    cloud_endpoint: str = Form(""),
    model: str = Form(""),
    output_dir: str = Form(""),
):
    content = await file.read()
    if not content:
        raise HTTPException(status_code=400, detail="Uploaded file is empty.")
    p = provider.strip().lower()
    if p == "openai":
        result = await run_openai_stt(
            content=content,
            filename=file.filename or "audio.webm",
            api_key=api_key,
            model=model or "gpt-4o-mini-transcribe",
        )
    elif p == "gemini":
        result = await run_gemini_stt(
            content=content,
            filename=file.filename or "audio.webm",
            content_type=file.content_type or "audio/webm",
            api_key=api_key,
            model=model or "gemini-2.5-flash",
        )
    elif p == "whisper":
        async with LOCAL_SEM:
            result = await run_whisper_stt(
                content=content,
                filename=file.filename or "audio.webm",
                model=model or "base",
            )
    else:
        raise HTTPException(status_code=400, detail=f"Unsupported STT provider: {provider}")
    if output_dir.strip() and result.get("text"):
        try:
            dest = Path(output_dir.strip())
            dest.mkdir(parents=True, exist_ok=True)
            txt_path = dest / f"transcript_{str(uuid.uuid4())[:8]}.txt"
            txt_path.write_text(result["text"], encoding="utf-8")
        except Exception:
            pass
    return result


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


@router.post("/tasks/llm")
async def task_llm(
    prompt: str = Form(""),
    messages: str = Form(""),   # JSON 数组 [{role, content}, ...]，优先于 prompt
    provider: str = Form("gemini"),
    api_key: str = Form(""),
    cloud_endpoint: str = Form(""),
    model: str = Form(""),
):
    import json
    # 解析多轮历史
    parsed_messages = None
    if messages.strip():
        try:
            parsed_messages = json.loads(messages)
        except Exception:
            pass

    if not parsed_messages and not prompt.strip():
        raise HTTPException(status_code=400, detail="prompt 或 messages 必须提供其一")

    p = provider.strip().lower()
    if p == "gemini":
        return await run_gemini_llm(prompt=prompt, api_key=api_key, model=model or "gemini-2.5-flash", messages=parsed_messages)
    if p == "openai":
        return await run_openai_llm(prompt=prompt, api_key=api_key, model=model or "gpt-4o-mini", messages=parsed_messages)
    if p == "ollama":
        return await run_ollama_llm(prompt=prompt, model=model or "qwen2.5-coder:14b", base_url=cloud_endpoint or "http://localhost:11434", messages=parsed_messages)
    if p == "github":
        return await run_github_llm(prompt=prompt, api_key=api_key, model=model or "gpt-4o-mini", messages=parsed_messages)
    raise HTTPException(status_code=400, detail=f"Unsupported LLM provider: {provider}")


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
    action: str = Form("convert"),      # convert | extract_audio | clip
    output_format: str = Form("mp3"),   # mp3 | wav | m4a
    start_time: str = Form(""),         # HH:MM:SS，clip 时用
    duration: str = Form(""),           # HH:MM:SS，clip 时用
    output_dir: str = Form(""),
):
    """媒体格式转换：音频互转、视频提取音频、截取片段。依赖 FFmpeg 静态二进制。"""
    import os
    ffmpeg = get_ffmpeg_binary()
    if not ffmpeg:
        raise HTTPException(
            status_code=500,
            detail=(
                "FFmpeg 未找到。请运行 pnpm run checkpoints 下载 FFmpeg 静态二进制，"
                "或在系统中安装 FFmpeg 并确保其在 PATH 中。"
            ),
        )

    content = await file.read()
    if not content:
        raise HTTPException(status_code=400, detail="上传文件为空")

    act = action.strip().lower()
    fmt = output_format.strip().lower() or "mp3"
    if fmt not in ("mp3", "wav", "m4a"):
        raise HTTPException(status_code=400, detail=f"不支持的输出格式: {fmt}")

    task_id = str(uuid.uuid4())
    in_ext = os.path.splitext(file.filename or "")[1] or ".bin"
    input_path = DOWNLOAD_DIR / f"{task_id}_mc_input{in_ext}"
    output_path = DOWNLOAD_DIR / f"{task_id}_mc_output.{fmt}"

    input_path.write_bytes(content)

    try:
        if act == "convert":
            cmd = [ffmpeg, "-y", "-i", str(input_path), str(output_path)]
        elif act == "extract_audio":
            cmd = [ffmpeg, "-y", "-i", str(input_path), "-vn", str(output_path)]
        elif act == "clip":
            if not start_time.strip():
                raise HTTPException(status_code=400, detail="clip 操作需要 start_time")
            cmd = [ffmpeg, "-y", "-ss", start_time.strip()]
            if duration.strip():
                cmd += ["-t", duration.strip()]
            cmd += ["-i", str(input_path), str(output_path)]
        else:
            raise HTTPException(status_code=400, detail=f"不支持的 action: {action}")

        logger.info("[media-convert] action=%s fmt=%s cmd=%s", act, fmt, " ".join(cmd))
        completed = await asyncio.to_thread(
            subprocess.run, cmd, capture_output=True, text=True, timeout=300
        )
        if completed.returncode != 0:
            stderr = (completed.stderr or "").strip()[:1000]
            logger.error("[media-convert] FFmpeg 失败: %s", stderr)
            raise HTTPException(status_code=500, detail=f"FFmpeg 处理失败: {stderr}")

        if not output_path.exists() or output_path.stat().st_size == 0:
            raise HTTPException(status_code=500, detail="FFmpeg 完成但输出文件缺失或为空")

        copy_to_output_dir(output_path, output_dir)
        result_url = f"http://{BACKEND_HOST}:{BACKEND_PORT}/download/{output_path.name}"
        return {
            "status": "success",
            "task": "media_convert",
            "action": act,
            "output_format": fmt,
            "result_url": result_url,
            "size_bytes": output_path.stat().st_size,
        }
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("[media-convert] 异常:\n%s", traceback.format_exc())
        raise HTTPException(status_code=500, detail=f"媒体转换失败: {exc}")
    finally:
        if input_path.exists():
            try:
                input_path.unlink()
            except Exception:
                pass
