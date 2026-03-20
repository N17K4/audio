import uuid
from pathlib import Path

from fastapi import APIRouter, File, Form, HTTPException, UploadFile

from job_queue import LOCAL_SEM
from services.stt.deepgram_stt import run_deepgram_stt
from services.stt.groq_stt import run_groq_stt
from services.stt.gemini_stt import run_gemini_stt
from services.stt.openai_stt import run_openai_stt
from services.stt.whisper_stt import run_whisper_stt
from services.stt.faster_whisper_stt import run_faster_whisper_stt
from services.stt.dashscope_stt import run_dashscope_stt

router = APIRouter()


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
    elif p == "dashscope":
        result = await run_dashscope_stt(
            content=content,
            filename=file.filename or "audio.webm",
            api_key=api_key,
            model=model or "paraformer-realtime-v2",
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
