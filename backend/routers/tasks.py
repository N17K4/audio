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
from services.stt.deepgram_stt import run_deepgram_stt
from services.stt.groq_stt import run_groq_stt
from services.stt.openai_stt import run_openai_stt
from services.stt.whisper_stt import run_whisper_stt
from services.stt.faster_whisper_stt import run_faster_whisper_stt
from services.llm.claude_llm import run_claude_llm
from services.llm.openai_compat_llm import run_openai_compat_llm
from services.tts.cartesia_tts import run_cartesia_tts
from services.tts.dashscope_tts import run_dashscope_tts
from services.tts.elevenlabs_tts import run_elevenlabs_tts
from services.tts.fish_speech_tts import run_fish_speech_tts
from services.tts.gemini_tts import run_gemini_tts
from services.tts.openai_tts import run_openai_tts
from utils.engine import get_ffmpeg_binary, get_pandoc_binary, build_ffmpeg_video_encode_flags
from utils.voices import copy_to_output_dir, get_voice_or_404
from services.image_gen.openai_image_gen import run_openai_image_gen
from services.image_gen.gemini_image_gen import run_gemini_image_gen
from services.image_gen.stability_image_gen import run_stability_image_gen
from services.image_gen.dashscope_image_gen import run_dashscope_image_gen
from services.image_understand.openai_image_understand import run_openai_image_understand
from services.image_understand.gemini_image_understand import run_gemini_image_understand
from services.image_understand.claude_image_understand import run_claude_image_understand
from services.image_understand.ollama_image_understand import run_ollama_image_understand

router = APIRouter()

# OpenAI 兼容 LLM provider → base URL
OPENAI_COMPAT_LLM: dict = {
    "groq":    "https://api.groq.com/openai/v1",
    "deepseek": "https://api.deepseek.com/v1",
    "mistral": "https://api.mistral.ai/v1",
    "xai":     "https://api.x.ai/v1",
}

# OpenAI 兼容 LLM 默认模型
OPENAI_COMPAT_DEFAULT_MODEL: dict = {
    "groq":     "llama-3.3-70b-versatile",
    "deepseek": "deepseek-chat",
    "mistral":  "mistral-small-latest",
    "xai":      "grok-3-mini",
}


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
        elif p == "cartesia":
            return await run_cartesia_tts(text=text, api_key=api_key, voice=voice or "", model=model or "")
        elif p == "dashscope":
            return await run_dashscope_tts(text=text, api_key=api_key, voice=voice or "", model=model or "")
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
    elif p == "faster_whisper":
        async with LOCAL_SEM:
            result = await run_faster_whisper_stt(
                content=content,
                filename=file.filename or "audio.webm",
                model=model or "base",
            )
    elif p == "whisper":
        async with LOCAL_SEM:
            result = await run_whisper_stt(
                content=content,
                filename=file.filename or "audio.webm",
                model=model or "base",
            )
    elif p == "deepgram":
        result = await run_deepgram_stt(
            content=content,
            filename=file.filename or "audio.webm",
            api_key=api_key,
            model=model or "nova-3",
        )
    elif p == "groq":
        result = await run_groq_stt(
            content=content,
            filename=file.filename or "audio.webm",
            api_key=api_key,
            model=model or "whisper-large-v3-turbo",
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
    if p == "claude":
        return await run_claude_llm(prompt=prompt, api_key=api_key, model=model or "claude-opus-4-5", messages=parsed_messages)
    if p in OPENAI_COMPAT_LLM:
        return await run_openai_compat_llm(
            prompt=prompt, api_key=api_key,
            model=model or OPENAI_COMPAT_DEFAULT_MODEL[p],
            messages=parsed_messages,
            base_url=OPENAI_COMPAT_LLM[p],
            provider_name=p,
        )
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
    hw_accel: str = Form("auto"),       # auto | videotoolbox | nvenc | qsv | amf | software
):
    """媒体格式转换：音频互转、视频提取音频、截取片段。依赖 FFmpeg 静态二进制。"""
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

    task_id = str(uuid.uuid4())
    in_ext = os.path.splitext(file.filename or "")[1] or ".bin"
    input_path = DOWNLOAD_DIR / f"{task_id}_mc_input{in_ext}"
    output_path = DOWNLOAD_DIR / f"{task_id}_mc_output.{fmt}"

    input_path.write_bytes(content)

    # 视频输出格式需要编码，音频输出只需 -vn（去视频流）
    _VIDEO_FMTS = {"mp4", "mov", "mkv", "webm"}
    is_video_output = fmt in _VIDEO_FMTS

    try:
        if act == "convert":
            if is_video_output:
                # 视频→视频：使用硬件加速编码，音频流直接复制
                hw_flags = build_ffmpeg_video_encode_flags(hw_accel)
                cmd = [ffmpeg, "-y", "-i", str(input_path)] + hw_flags + ["-c:a", "copy", str(output_path)]
            else:
                # 任意→音频：直接流复制或音频转码，不涉及视频编码
                cmd = [ffmpeg, "-y", "-i", str(input_path), "-vn", str(output_path)]
        elif act == "extract_audio":
            cmd = [ffmpeg, "-y", "-i", str(input_path), "-vn", str(output_path)]
        elif act == "clip":
            if not start_time.strip():
                raise HTTPException(status_code=400, detail="clip 操作需要 start_time")
            # clip 优先流复制（无损且极快），仅视频输出时才用硬件重编码
            if is_video_output:
                hw_flags = build_ffmpeg_video_encode_flags(hw_accel)
                cmd = [ffmpeg, "-y", "-ss", start_time.strip()]
                if duration.strip():
                    cmd += ["-t", duration.strip()]
                cmd += ["-i", str(input_path)] + hw_flags + ["-c:a", "copy", str(output_path)]
            else:
                cmd = [ffmpeg, "-y", "-ss", start_time.strip()]
                if duration.strip():
                    cmd += ["-t", duration.strip()]
                cmd += ["-i", str(input_path), "-c", "copy", str(output_path)]
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


@router.post("/tasks/doc-convert")
async def task_doc_convert(
    file: UploadFile = File(...),
    action: str = Form("pdf_to_word"),    # pdf_to_word | doc_convert | pdf_extract
    output_format: str = Form("docx"),    # doc_convert 时用
    extract_mode: str = Form("text"),     # pdf_extract 时用：text | images
    output_dir: str = Form(""),
):
    """文档转换：PDF 转 Word（pdf2docx）、文档互转（pandoc）、PDF 提取（PyMuPDF）。"""
    import os, zipfile
    content = await file.read()
    if not content:
        raise HTTPException(status_code=400, detail="上传文件为空")

    act = action.strip().lower()
    task_id = str(uuid.uuid4())
    in_ext = os.path.splitext(file.filename or "")[1] or ".bin"
    input_path = DOWNLOAD_DIR / f"{task_id}_doc_input{in_ext}"
    input_path.write_bytes(content)

    output_path = None
    try:
        if act == "pdf_to_word":
            try:
                from pdf2docx import Converter  # type: ignore
            except ImportError:
                raise HTTPException(
                    status_code=500,
                    detail="pdf2docx 未安装。请运行 pnpm run setup 安装依赖，或执行 poetry add pdf2docx。",
                )
            output_path = DOWNLOAD_DIR / f"{task_id}_doc_output.docx"
            def _convert():
                cv = Converter(str(input_path))
                cv.convert(str(output_path))
                cv.close()
            await asyncio.to_thread(_convert)

        elif act == "doc_convert":
            pandoc = get_pandoc_binary()
            if not pandoc:
                raise HTTPException(
                    status_code=500,
                    detail="pandoc 未找到。请在系统中安装 pandoc（https://pandoc.org/installing.html）或将二进制放置于 runtime/{platform}/bin/pandoc。",
                )
            fmt = output_format.strip().lower() or "docx"
            output_path = DOWNLOAD_DIR / f"{task_id}_doc_output.{fmt}"
            cmd = [pandoc, "-o", str(output_path), str(input_path)]
            logger.info("[doc-convert] pandoc cmd: %s", " ".join(cmd))
            completed = await asyncio.to_thread(
                subprocess.run, cmd, capture_output=True, text=True, timeout=120
            )
            if completed.returncode != 0:
                stderr = (completed.stderr or "").strip()[:1000]
                raise HTTPException(status_code=500, detail=f"pandoc 失败: {stderr}")

        elif act == "pdf_extract":
            try:
                import fitz  # type: ignore  # PyMuPDF
            except ImportError:
                raise HTTPException(
                    status_code=500,
                    detail="PyMuPDF 未安装。请运行 pnpm run setup 安装依赖，或执行 poetry add pymupdf。",
                )
            mode = extract_mode.strip().lower()
            if mode == "images":
                output_path = DOWNLOAD_DIR / f"{task_id}_doc_output.zip"
                def _extract_images():
                    doc = fitz.open(str(input_path))
                    with zipfile.ZipFile(str(output_path), "w") as zf:
                        for page_num in range(len(doc)):
                            page = doc[page_num]
                            for img_idx, img in enumerate(page.get_images()):
                                xref = img[0]
                                base_image = doc.extract_image(xref)
                                ext = base_image.get("ext", "png")
                                zf.writestr(f"page{page_num + 1}_img{img_idx + 1}.{ext}", base_image["image"])
                    doc.close()
                await asyncio.to_thread(_extract_images)
            else:
                output_path = DOWNLOAD_DIR / f"{task_id}_doc_output.txt"
                def _extract_text():
                    doc = fitz.open(str(input_path))
                    text = "".join(page.get_text() for page in doc)
                    doc.close()
                    output_path.write_text(text, encoding="utf-8")
                await asyncio.to_thread(_extract_text)
        else:
            raise HTTPException(status_code=400, detail=f"不支持的 action: {action}")

        if not output_path or not output_path.exists() or output_path.stat().st_size == 0:
            raise HTTPException(status_code=500, detail="转换完成但输出文件缺失或为空")

        copy_to_output_dir(output_path, output_dir)
        result_url = f"http://{BACKEND_HOST}:{BACKEND_PORT}/download/{output_path.name}"
        return {
            "status": "success",
            "task": "doc_convert",
            "action": act,
            "result_url": result_url,
            "size_bytes": output_path.stat().st_size,
        }
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("[doc-convert] 异常:\n%s", traceback.format_exc())
        raise HTTPException(status_code=500, detail=f"文档转换失败: {exc}")
    finally:
        if input_path.exists():
            try:
                input_path.unlink()
            except Exception:
                pass


# ─── 字幕工具 ─────────────────────────────────────────────────────────────────

def _srt_ts_to_vtt(line: str) -> str:
    import re
    return re.sub(r'(\d{2}:\d{2}:\d{2}),(\d{3})', r'\1.\2', line)

def _vtt_ts_to_srt(line: str) -> str:
    import re
    return re.sub(r'(\d{2}:\d{2}:\d{2})\.(\d{3})', r'\1,\2', line)

def _convert_subtitle(content: str, src_fmt: str, dst_fmt: str) -> str:
    lines = content.replace('\r\n', '\n').strip().split('\n')
    if src_fmt == dst_fmt:
        return content
    if src_fmt == 'srt' and dst_fmt == 'vtt':
        out = ['WEBVTT', '']
        seq = 0
        for line in lines:
            stripped = line.strip()
            if stripped.isdigit():
                seq += 1
                out.append(str(seq))
            elif '-->' in stripped:
                out.append(_srt_ts_to_vtt(stripped))
            else:
                out.append(stripped)
        return '\n'.join(out)
    if src_fmt == 'vtt' and dst_fmt == 'srt':
        out = []
        idx = 1
        for line in lines:
            stripped = line.strip()
            if stripped in ('WEBVTT', '') or stripped.startswith('NOTE') or stripped.startswith('STYLE'):
                continue
            if '-->' in stripped:
                out.append(str(idx))
                out.append(_vtt_ts_to_srt(stripped))
                idx += 1
            else:
                out.append(stripped)
        return '\n'.join(out)
    raise ValueError(f"不支持的转换方向: {src_fmt} → {dst_fmt}")


@router.post("/tasks/subtitle")
async def task_subtitle(
    file: UploadFile = File(...),
    action: str = Form("convert"),        # convert | extract
    output_format: str = Form("srt"),     # srt | vtt
    output_dir: str = Form(""),
):
    """字幕工具：字幕格式互转（SRT↔VTT）、从视频提取字幕（FFmpeg）。"""
    import os
    content = await file.read()
    if not content:
        raise HTTPException(status_code=400, detail="上传文件为空")

    act = action.strip().lower()
    dst_fmt = output_format.strip().lower() or "srt"
    task_id = str(uuid.uuid4())
    in_ext = os.path.splitext(file.filename or "")[1].lstrip('.').lower() or "bin"
    input_path = DOWNLOAD_DIR / f"{task_id}_sub_input.{in_ext}"
    input_path.write_bytes(content)
    output_path = DOWNLOAD_DIR / f"{task_id}_sub_output.{dst_fmt}"

    try:
        if act == "convert":
            src_fmt = in_ext if in_ext in ('srt', 'vtt', 'ass') else 'srt'
            if src_fmt == dst_fmt:
                raise HTTPException(status_code=400, detail="输入输出格式相同，无需转换")
            if src_fmt not in ('srt', 'vtt') or dst_fmt not in ('srt', 'vtt'):
                raise HTTPException(status_code=400, detail=f"暂不支持 {src_fmt} → {dst_fmt} 转换（仅支持 SRT↔VTT）")
            text = content.decode('utf-8', errors='replace')
            result_text = _convert_subtitle(text, src_fmt, dst_fmt)
            output_path.write_text(result_text, encoding='utf-8')

        elif act == "extract":
            ffmpeg = get_ffmpeg_binary()
            if not ffmpeg:
                raise HTTPException(status_code=500, detail="FFmpeg 未找到，无法提取字幕")
            cmd = [ffmpeg, "-y", "-i", str(input_path), "-map", "0:s:0", str(output_path)]
            logger.info("[subtitle] extract cmd: %s", " ".join(cmd))
            completed = await asyncio.to_thread(
                subprocess.run, cmd, capture_output=True, text=True, timeout=120
            )
            if completed.returncode != 0 or not output_path.exists() or output_path.stat().st_size == 0:
                raise HTTPException(status_code=500, detail="视频中未找到字幕轨道，或提取失败")
        else:
            raise HTTPException(status_code=400, detail=f"不支持的 action: {action}")

        copy_to_output_dir(output_path, output_dir)
        result_url = f"http://{BACKEND_HOST}:{BACKEND_PORT}/download/{output_path.name}"
        return {"status": "success", "task": "subtitle", "action": act, "result_url": result_url}

    except HTTPException:
        raise
    except Exception as exc:
        logger.error("[subtitle] 异常:\n%s", traceback.format_exc())
        raise HTTPException(status_code=500, detail=f"字幕处理失败: {exc}")
    finally:
        if input_path.exists():
            try: input_path.unlink()
            except Exception: pass


# ─── 工具箱 ───────────────────────────────────────────────────────────────────

@router.post("/tasks/toolbox")
async def task_toolbox(
    action: str = Form(...),             # image_convert | qr_generate | qr_decode | text_encoding
    file: Optional[UploadFile] = File(None),
    text_input: str = Form(""),          # qr_generate / text_encoding 时输入文本
    output_format: str = Form("png"),    # image_convert 输出格式 / text_encoding 目标编码
    resize_w: str = Form(""),
    resize_h: str = Form(""),
    quality: str = Form("85"),
    output_dir: str = Form(""),
):
    """工具箱：图片处理（Pillow）、二维码生成/识别（qrcode+zxing-cpp）、文本编码转换。"""
    import os, io
    act = action.strip().lower()
    task_id = str(uuid.uuid4())
    input_path = None
    output_path = None

    try:
        # ── 图片处理 ──
        if act == "image_convert":
            try:
                from PIL import Image  # type: ignore
            except ImportError:
                raise HTTPException(status_code=500, detail="Pillow 未安装，请运行 pnpm run setup:dev")
            if not file or not file.filename:
                raise HTTPException(status_code=400, detail="请上传图片文件")
            content = await file.read()
            in_ext = os.path.splitext(file.filename)[1].lstrip('.').lower() or "bin"
            input_path = DOWNLOAD_DIR / f"{task_id}_tbx_input.{in_ext}"
            input_path.write_bytes(content)

            fmt = output_format.strip().lower() or "png"
            fmt_map = {"jpg": "JPEG", "jpeg": "JPEG", "png": "PNG", "webp": "WEBP", "bmp": "BMP"}
            pil_fmt = fmt_map.get(fmt, fmt.upper())
            output_path = DOWNLOAD_DIR / f"{task_id}_tbx_output.{fmt}"

            def _img_convert():
                img = Image.open(str(input_path))
                w_str = resize_w.strip()
                h_str = resize_h.strip()
                if w_str or h_str:
                    orig_w, orig_h = img.size
                    nw = int(w_str) if w_str else int(orig_w * int(h_str) / orig_h)
                    nh = int(h_str) if h_str else int(orig_h * nw / orig_w)
                    img = img.resize((nw, nh), Image.LANCZOS)
                if pil_fmt == "JPEG" and img.mode in ("RGBA", "LA", "P"):
                    img = img.convert("RGB")
                q = max(1, min(95, int(quality or "85")))
                img.save(str(output_path), format=pil_fmt, quality=q)
            await asyncio.to_thread(_img_convert)

        # ── 二维码生成 ──
        elif act == "qr_generate":
            try:
                import qrcode as _qrcode  # type: ignore
            except ImportError:
                raise HTTPException(status_code=500, detail="qrcode 未安装，请运行 pnpm run setup:dev")
            if not text_input.strip():
                raise HTTPException(status_code=400, detail="请输入要生成二维码的文字")
            output_path = DOWNLOAD_DIR / f"{task_id}_tbx_qr.png"
            def _gen_qr():
                qr = _qrcode.QRCode(error_correction=_qrcode.constants.ERROR_CORRECT_M, box_size=10, border=4)
                qr.add_data(text_input.strip())
                qr.make(fit=True)
                img = qr.make_image(fill_color="black", back_color="white")
                img.save(str(output_path))
            await asyncio.to_thread(_gen_qr)

        # ── 二维码识别 ──
        elif act == "qr_decode":
            try:
                import zxingcpp  # type: ignore
                from PIL import Image  # type: ignore
            except ImportError:
                raise HTTPException(status_code=500, detail="zxing-cpp 或 Pillow 未安装，请运行 pnpm run setup:dev")
            if not file or not file.filename:
                raise HTTPException(status_code=400, detail="请上传包含二维码的图片")
            content = await file.read()
            in_ext = os.path.splitext(file.filename)[1].lstrip('.').lower() or "png"
            input_path = DOWNLOAD_DIR / f"{task_id}_tbx_input.{in_ext}"
            input_path.write_bytes(content)
            def _decode_qr():
                img = Image.open(str(input_path))
                results = zxingcpp.read_barcodes(img)
                if not results:
                    raise ValueError("未识别到二维码或条形码")
                return "\n".join(r.text for r in results)
            decoded_text = await asyncio.to_thread(_decode_qr)
            return {"status": "success", "task": "toolbox", "action": act, "result_text": decoded_text}

        # ── 文本编码转换 ──
        elif act == "text_encoding":
            if not file or not file.filename:
                raise HTTPException(status_code=400, detail="请上传文本文件")
            content = await file.read()
            in_ext = os.path.splitext(file.filename)[1].lstrip('.').lower() or "txt"
            input_path = DOWNLOAD_DIR / f"{task_id}_tbx_input.{in_ext}"
            input_path.write_bytes(content)

            target_enc = output_format.strip() or "utf-8"
            output_path = DOWNLOAD_DIR / f"{task_id}_tbx_output.txt"

            def _convert_encoding():
                from charset_normalizer import from_bytes  # type: ignore  # 随 requests 安装
                result = from_bytes(content).best()
                src_enc = result.encoding if result else "utf-8"
                text = content.decode(src_enc, errors="replace")
                output_path.write_text(text, encoding=target_enc, errors="replace")
                return src_enc
            src_enc_detected = await asyncio.to_thread(_convert_encoding)
            copy_to_output_dir(output_path, output_dir)
            result_url = f"http://{BACKEND_HOST}:{BACKEND_PORT}/download/{output_path.name}"
            return {"status": "success", "task": "toolbox", "action": act,
                    "result_url": result_url, "result_text": f"检测到原始编码: {src_enc_detected}"}
        else:
            raise HTTPException(status_code=400, detail=f"不支持的 action: {action}")

        if output_path and output_path.exists():
            copy_to_output_dir(output_path, output_dir)
            result_url = f"http://{BACKEND_HOST}:{BACKEND_PORT}/download/{output_path.name}"
            return {"status": "success", "task": "toolbox", "action": act, "result_url": result_url}
        raise HTTPException(status_code=500, detail="处理完成但输出文件缺失")

    except HTTPException:
        raise
    except Exception as exc:
        logger.error("[toolbox] 异常:\n%s", traceback.format_exc())
        raise HTTPException(status_code=500, detail=f"工具箱处理失败: {exc}")
    finally:
        for p in [input_path]:
            if p and p.exists():
                try: p.unlink()
                except Exception: pass


# ─── 图像生成 ─────────────────────────────────────────────────────────────────

@router.post("/tasks/image-gen")
async def task_image_gen(
    prompt: str = Form(...),
    provider: str = Form("openai"),
    api_key: str = Form(""),
    cloud_endpoint: str = Form(""),
    model: str = Form(""),
    size: str = Form("1024x1024"),
    aspect_ratio: str = Form("1:1"),
):
    if not prompt.strip():
        raise HTTPException(status_code=400, detail="prompt is required")
    p = provider.strip().lower()
    label = (prompt[:30] + "…") if len(prompt) > 30 else prompt
    job = _make_job("image_gen", f"图像生成 · {label}", p, is_local=False)
    job_id = job["id"]

    async def _do():
        if p == "openai":
            return await run_openai_image_gen(prompt=prompt, api_key=api_key, model=model, size=size)
        if p == "gemini":
            return await run_gemini_image_gen(prompt=prompt, api_key=api_key, model=model, aspect_ratio=aspect_ratio)
        if p == "stability":
            return await run_stability_image_gen(prompt=prompt, api_key=api_key, model=model, aspect_ratio=aspect_ratio)
        if p == "dashscope":
            return await run_dashscope_image_gen(prompt=prompt, api_key=api_key, model=model, size=size.replace("x", "*"))
        raise HTTPException(status_code=400, detail=f"Unsupported image gen provider: {provider}")

    task = asyncio.create_task(_run_tts_job(job_id, _do))
    job["_task"] = task
    logger.info("image_gen job %s queued (provider=%s)", job_id, p)
    return {"status": "queued", "job_id": job_id}


# ─── 图像理解 ─────────────────────────────────────────────────────────────────

@router.post("/tasks/image-understand")
async def task_image_understand(
    file: UploadFile = File(...),
    provider: str = Form("openai"),
    prompt: str = Form("请详细描述这张图片"),
    api_key: str = Form(""),
    cloud_endpoint: str = Form(""),
    model: str = Form(""),
):
    content = await file.read()
    if not content:
        raise HTTPException(status_code=400, detail="Uploaded file is empty.")
    p = provider.strip().lower()
    mime = file.content_type or "image/png"

    if p == "openai":
        return await run_openai_image_understand(
            image_content=content, image_mime=mime, prompt=prompt, api_key=api_key,
            model=model or "gpt-4o-mini",
        )
    if p == "gemini":
        return await run_gemini_image_understand(
            image_content=content, image_mime=mime, prompt=prompt, api_key=api_key,
            model=model or "gemini-2.5-flash",
        )
    if p == "claude":
        return await run_claude_image_understand(
            image_content=content, image_mime=mime, prompt=prompt, api_key=api_key,
            model=model or "claude-opus-4-5",
        )
    if p == "ollama":
        return await run_ollama_image_understand(
            image_content=content, prompt=prompt,
            model=model or "llava",
            base_url=cloud_endpoint or "http://localhost:11434",
        )
    raise HTTPException(status_code=400, detail=f"Unsupported image understand provider: {provider}")


# ─── 文字翻译 ─────────────────────────────────────────────────────────────────

@router.post("/tasks/translate")
async def task_translate(
    text: str = Form(...),
    target_lang: str = Form("中文"),
    source_lang: str = Form("自动检测"),
    provider: str = Form("gemini"),
    api_key: str = Form(""),
    cloud_endpoint: str = Form(""),
    model: str = Form(""),
):
    import json as _json
    if not text.strip():
        raise HTTPException(status_code=400, detail="text is required")
    p = provider.strip().lower()

    system_prompt = f"你是专业翻译。{'如果源语言是' + source_lang + '，' if source_lang and source_lang != '自动检测' else ''}请将以下文本翻译成{target_lang}，只返回译文，不要解释。"
    messages = [{"role": "system", "content": system_prompt}, {"role": "user", "content": text}]

    if p == "gemini":
        result = await run_gemini_llm(prompt=text, api_key=api_key, model=model or "gemini-2.5-flash", messages=messages)
    elif p == "openai":
        result = await run_openai_llm(prompt=text, api_key=api_key, model=model or "gpt-4o-mini", messages=messages)
    elif p == "ollama":
        result = await run_ollama_llm(prompt=text, model=model or "qwen2.5:14b", base_url=cloud_endpoint or "http://localhost:11434", messages=messages)
    elif p == "github":
        result = await run_github_llm(prompt=text, api_key=api_key, model=model or "gpt-4o-mini", messages=messages)
    elif p == "claude":
        result = await run_claude_llm(prompt=text, api_key=api_key, model=model or "claude-opus-4-5", messages=messages)
    elif p in OPENAI_COMPAT_LLM:
        result = await run_openai_compat_llm(
            prompt=text, api_key=api_key,
            model=model or OPENAI_COMPAT_DEFAULT_MODEL[p],
            messages=messages,
            base_url=OPENAI_COMPAT_LLM[p],
            provider_name=p,
        )
    else:
        raise HTTPException(status_code=400, detail=f"Unsupported translate provider: {provider}")

    result["task"] = "translate"
    return result
