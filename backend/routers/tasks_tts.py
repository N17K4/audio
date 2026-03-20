import asyncio
import uuid
from pathlib import Path
from typing import List

from fastapi import APIRouter, File, Form, HTTPException, UploadFile

from config import DOWNLOAD_DIR, MAX_LOCAL_QUEUE
from job_queue import JOBS, _make_job, _run_tts_job
from logging_setup import logger
from services.tts.cartesia_tts import run_cartesia_tts
from services.tts.dashscope_tts import run_dashscope_tts
from services.tts.minimax_tts import run_minimax_tts
from services.tts.elevenlabs_tts import run_elevenlabs_tts
from services.tts.fish_speech_tts import run_fish_speech_tts
from services.tts.gpt_sovits_tts import run_gpt_sovits_tts
from services.tts.gemini_tts import run_gemini_tts
from services.tts.openai_tts import run_openai_tts
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
    reference_audio: List[UploadFile] = File([]),
    # GPT-SoVITS 高级参数
    text_lang: str = Form("auto"),
    prompt_lang: str = Form("auto"),
    ref_text: str = Form(""),
    top_k: int = Form(15),
    top_p: float = Form(1.0),
    temperature: float = Form(1.0),
    speed: float = Form(1.0),
    repetition_penalty: float = Form(1.35),
    seed: int = Form(-1),
    text_split_method: str = Form("cut5"),
    batch_size: int = Form(1),
    parallel_infer: int = Form(1),
    fragment_interval: float = Form(0.3),
    sample_steps: int = Form(32),
):
    if not text.strip():
        raise HTTPException(status_code=400, detail="text is required")
    p = provider.strip().lower()

    ref_audio_tmps: List[Path] = []
    for raf in reference_audio:
        if raf and raf.filename:
            ref_ext = Path(raf.filename).suffix or ".wav"
            tmp = DOWNLOAD_DIR / f"{uuid.uuid4()}_tts_ref{ref_ext}"
            tmp.write_bytes(await raf.read())
            ref_audio_tmps.append(tmp)

    voice_refs_list = [str(p_) for p_ in ref_audio_tmps]
    if not voice_refs_list:
        fallback = voice_ref.strip() or voice.strip()
        if fallback:
            voice_refs_list = [fallback]

    voice_id_str = voice_id.strip()
    voice_meta = None
    if voice_id_str and p in ("fish_speech", "gpt_sovits"):
        try:
            voice_meta = get_voice_or_404(voice_id_str)
            if p == "fish_speech" and not voice_refs_list:
                ref_path = voice_meta.get("reference_audio", "")
                if ref_path:
                    voice_refs_list = [ref_path]
        except Exception:
            pass

    is_local = p in ("fish_speech", "gpt_sovits") and not cloud_endpoint.strip()

    # 本地队列容量检查
    if is_local:
        local_active = sum(
            1 for j in JOBS.values() if j.get("is_local") and j["status"] in ("queued", "running")
        )
        if local_active >= MAX_LOCAL_QUEUE:
            for tmp in ref_audio_tmps:
                if tmp.exists():
                    tmp.unlink()
            raise HTTPException(
                status_code=429,
                detail=f"本地推理队列已满（{MAX_LOCAL_QUEUE} 个），请等待当前任务完成后再提交。",
            )

    label = (text[:30] + "…") if len(text) > 30 else text
    params = {
        "text": text,
        "provider": p,
        "model": model,
        "voice": voice,
        "voice_id": voice_id_str,
        "api_key": "***" if api_key else "",
    }
    job = _make_job("tts", f"TTS · {label}", p, is_local=is_local, params=params)
    job_id = job["id"]
    job["_ref_audio_tmps"] = [str(t) for t in ref_audio_tmps]

    async def _do_tts():
        if p == "fish_speech":
            return await run_fish_speech_tts(text=text, voice_refs=voice_refs_list, api_key=api_key, endpoint=cloud_endpoint)
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
        elif p == "minimax_tts":
            return await run_minimax_tts(text=text, api_key=api_key, voice=voice or "", model=model or "")
        elif p == "gpt_sovits":
            return await run_gpt_sovits_tts(
                text=text, voice_meta=voice_meta, voice_refs=voice_refs_list,
                api_key=api_key, endpoint=cloud_endpoint,
                text_lang=text_lang, prompt_lang=prompt_lang, ref_text=ref_text,
                top_k=top_k, top_p=top_p, temperature=temperature, speed=speed,
                repetition_penalty=repetition_penalty, seed=seed,
                text_split_method=text_split_method, batch_size=batch_size,
                parallel_infer=bool(parallel_infer), fragment_interval=fragment_interval,
                sample_steps=sample_steps,
            )
        elif p == "cosyvoice":
            raise HTTPException(status_code=501, detail="CosyVoice 2 引擎即将支持，敬请期待。")
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
