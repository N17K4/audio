"""
tasks.py — 聚合路由器，包含所有 /tasks/* 子路由。
拆分后的子模块：tasks_tts、tasks_stt、tasks_llm、tasks_media。
图像/视频/OCR/口型同步/图像理解 等端点保留在本文件。
"""

import asyncio
import uuid
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, File, Form, HTTPException, UploadFile

from config import DOWNLOAD_DIR
from job_queue import _make_job, _run_tts_job
from logging_setup import logger
from services.image_gen.openai_image_gen import run_openai_image_gen
from services.image_gen.gemini_image_gen import run_gemini_image_gen
from services.image_gen.stability_image_gen import run_stability_image_gen
from services.image_gen.dashscope_image_gen import run_dashscope_image_gen
from services.image_gen.comfyui_image_gen import run_comfyui_image_gen
from services.image_gen.flux_image_gen import run_flux_image_gen
from services.image_gen.sd_image_gen import run_sd_image_gen
from services.image_i2i.facefusion_i2i import run_facefusion_i2i
from services.image_i2i.comfyui_i2i import run_comfyui_i2i
from services.video_gen.kling_video_gen import run_kling_video_gen
from services.video_gen.wan_video_gen import run_wan_video_gen
from services.ocr.got_ocr import run_got_ocr
from services.lipsync.liveportrait_lipsync import run_liveportrait_lipsync
from services.image_understand.openai_image_understand import run_openai_image_understand
from services.image_understand.gemini_image_understand import run_gemini_image_understand
from services.image_understand.anthropic_image_understand import run_claude_image_understand
from services.image_understand.ollama_image_understand import run_ollama_image_understand

# 子路由
from routers.tasks_tts import router as tts_router
from routers.tasks_stt import router as stt_router
from routers.tasks_llm import router as llm_router
from routers.tasks_media import router as media_router

router = APIRouter()

# 包含拆分出的子路由
router.include_router(tts_router)
router.include_router(stt_router)
router.include_router(llm_router)
router.include_router(media_router)


# ─── 辅助函数 ─────────────────────────────────────────────────────────────────

def _parse_size_for_flux(size_or_ratio: str) -> tuple:
    """将 size/aspect_ratio 字符串解析为 (width, height)，对齐 64 像素。"""
    s = (size_or_ratio or "1024x1024").strip()
    if "x" in s and not ":" in s:
        parts = s.split("x")
        return int(parts[0]), int(parts[1])
    _ratio_map = {
        "1:1": (1024, 1024), "16:9": (1360, 768), "9:16": (768, 1360),
        "4:3": (1152, 896), "3:4": (896, 1152), "21:9": (1536, 640),
    }
    if s in _ratio_map:
        return _ratio_map[s]
    return 1024, 1024


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
    is_local = p in ("comfyui", "flux", "sd_local")
    params = {
        "prompt": prompt,
        "provider": p,
        "model": model,
        "size": size,
        "aspect_ratio": aspect_ratio,
        "api_key": "***" if api_key else "",
    }
    job = _make_job("image_gen", f"图像生成 · {label}", p, is_local=is_local, params=params)
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
        if p == "comfyui":
            comfy_url = cloud_endpoint.strip() or "http://127.0.0.1:8188"
            return await run_comfyui_image_gen(prompt=prompt, comfy_url=comfy_url, model=model, aspect_ratio=aspect_ratio)
        if p == "flux":
            w, h = _parse_size_for_flux(size or aspect_ratio)
            return await run_flux_image_gen(prompt=prompt, model=model, width=w, height=h)
        if p == "sd_local":
            w, h = _parse_size_for_flux(size or aspect_ratio)
            return await run_sd_image_gen(prompt=prompt, model=model, width=w, height=h)
        raise HTTPException(status_code=400, detail=f"Unsupported image gen provider: {provider}")

    task = asyncio.create_task(_run_tts_job(job_id, _do))
    job["_task"] = task
    logger.info("image_gen job %s queued (provider=%s)", job_id, p)
    return {"status": "queued", "job_id": job_id}


# ─── 换脸换图 ─────────────────────────────────────────────────────────────────

@router.post("/tasks/image-i2i")
async def task_image_i2i(
    source_image: UploadFile = File(...),
    reference_image: Optional[UploadFile] = File(None),
    prompt: str = Form(""),
    provider: str = Form("facefusion"),
    api_key: str = Form(""),
    cloud_endpoint: str = Form(""),
    model: str = Form(""),
    strength: float = Form(0.75),
    face_enhancer: bool = Form(False),
    frame_enhancer: bool = Form(False),
    many_faces: bool = Form(False),
):
    if not source_image or not source_image.filename:
        raise HTTPException(status_code=400, detail="source_image is required")

    p = provider.strip().lower()
    is_local = p in ("facefusion", "comfyui")

    source_ext = Path(source_image.filename).suffix or ".png"
    source_tmp = DOWNLOAD_DIR / f"{uuid.uuid4()}_i2i_src{source_ext}"
    source_content = await source_image.read()
    source_tmp.write_bytes(source_content)

    ref_tmp: Optional[Path] = None
    ref_content: Optional[bytes] = None
    if reference_image and reference_image.filename:
        ref_ext = Path(reference_image.filename).suffix or ".png"
        ref_tmp = DOWNLOAD_DIR / f"{uuid.uuid4()}_i2i_ref{ref_ext}"
        ref_content = await reference_image.read()
        ref_tmp.write_bytes(ref_content)

    label = source_image.filename[:30]
    params = {
        "provider": p,
        "prompt": prompt,
        "model": model,
        "source_image": source_image.filename,
        "reference_image": reference_image.filename if reference_image else None,
        "api_key": "***" if api_key else "",
    }
    if p == "comfyui":
        params["strength"] = strength
    if p == "facefusion":
        params["face_enhancer"] = face_enhancer
        params["frame_enhancer"] = frame_enhancer
        params["many_faces"] = many_faces
    job = _make_job("image_i2i", f"换脸换图 · {label}", p, is_local=is_local, params=params)
    job_id = job["id"]
    job["_source_tmp"] = str(source_tmp)
    if ref_tmp:
        job["_ref_tmp"] = str(ref_tmp)

    async def _do():
        try:
            if p == "facefusion":
                target = str(ref_tmp) if ref_tmp else str(source_tmp)
                def _normalize_image(path: str) -> str:
                    try:
                        from PIL import Image as _Img, ImageOps as _ImgOps
                        img = _Img.open(path)
                        img = _ImgOps.exif_transpose(img)
                        norm_path = path + "_norm.jpg"
                        img.convert("RGB").save(norm_path, "JPEG", quality=95)
                        return norm_path
                    except Exception:
                        return path
                norm_source = await asyncio.to_thread(_normalize_image, str(source_tmp))
                norm_target = await asyncio.to_thread(_normalize_image, target)
                target_ext = Path(norm_target).suffix or ".jpg"
                output_path = DOWNLOAD_DIR / f"{str(uuid.uuid4())[:8]}_i2i_out{target_ext}"
                return await run_facefusion_i2i(
                    source_image_path=norm_source,
                    target_image_path=norm_target,
                    output_path=str(output_path),
                    model=model,
                    face_enhancer=face_enhancer,
                    frame_enhancer=frame_enhancer,
                    many_faces=many_faces,
                )
            if p == "comfyui":
                comfy_url = cloud_endpoint.strip() or "http://127.0.0.1:8188"
                return await run_comfyui_i2i(
                    source_image_bytes=source_content,
                    source_filename=source_image.filename,
                    prompt=prompt,
                    strength=strength,
                    comfy_url=comfy_url,
                    model=model,
                )
            raise HTTPException(status_code=400, detail=f"Unsupported image i2i provider: {provider}")
        finally:
            for tmp in [source_tmp, ref_tmp]:
                if tmp and Path(str(tmp)).exists():
                    try:
                        Path(str(tmp)).unlink()
                    except Exception:
                        pass

    task = asyncio.create_task(_run_tts_job(job_id, _do))
    job["_task"] = task
    logger.info("image_i2i job %s queued (provider=%s)", job_id, p)
    return {"status": "queued", "job_id": job_id}


# ─── 视频生成 ─────────────────────────────────────────────────────────────────

@router.post("/tasks/video-gen")
async def task_video_gen(
    prompt: str = Form(""),
    provider: str = Form("kling"),
    api_key: str = Form(""),
    cloud_endpoint: str = Form(""),
    model: str = Form(""),
    duration: int = Form(5),
    mode: str = Form("t2v"),
    image: Optional[UploadFile] = File(None),
):
    p = provider.strip().lower()
    is_local = p == "wan_local"

    image_bytes: Optional[bytes] = None
    image_tmp: Optional[Path] = None
    image_filename = ""
    if image and image.filename:
        image_filename = image.filename
        img_ext = Path(image.filename).suffix or ".jpg"
        image_tmp = DOWNLOAD_DIR / f"{uuid.uuid4()}_vgen_img{img_ext}"
        image_bytes = await image.read()
        image_tmp.write_bytes(image_bytes)

    label = (prompt[:30] + "…") if len(prompt) > 30 else (prompt or "视频生成")
    params = {
        "prompt": prompt,
        "provider": p,
        "model": model,
        "duration": duration,
        "mode": mode,
        "image": image_filename,
        "api_key": "***" if api_key else "",
    }
    job = _make_job("video_gen", f"视频生成 · {label}", p, is_local=is_local, params=params)
    job_id = job["id"]
    if image_tmp:
        job["_image_tmp"] = str(image_tmp)

    output_path = str(DOWNLOAD_DIR / f"{str(uuid.uuid4())[:8]}_video_gen.mp4")

    async def _do():
        try:
            if p == "kling":
                return await run_kling_video_gen(
                    prompt=prompt, api_key=api_key, model=model or "kling-v1",
                    duration=duration, mode=mode,
                    image_bytes=image_bytes, image_filename=image_filename,
                )
            if p == "wan_local":
                return await run_wan_video_gen(
                    prompt=prompt, model=model or "Wan2.1-T2V-1.3B",
                    duration=duration, mode=mode,
                    image_path=str(image_tmp) if image_tmp else None,
                    output_path=output_path,
                )
            raise HTTPException(status_code=400, detail=f"Unsupported video gen provider: {provider}")
        finally:
            if image_tmp and Path(str(image_tmp)).exists():
                try:
                    Path(str(image_tmp)).unlink()
                except Exception:
                    pass

    task = asyncio.create_task(_run_tts_job(job_id, _do))
    job["_task"] = task
    logger.info("video_gen job %s queued (provider=%s)", job_id, p)
    return {"status": "queued", "job_id": job_id}


# ─── OCR 识别 ─────────────────────────────────────────────────────────────────

@router.post("/tasks/ocr")
async def task_ocr(
    file: UploadFile = File(...),
    provider: str = Form("got_ocr"),
    api_key: str = Form(""),
    cloud_endpoint: str = Form(""),
    model: str = Form("GOT-OCR2.0"),
):
    if not file or not file.filename:
        raise HTTPException(status_code=400, detail="file is required")

    p = provider.strip().lower()
    content = await file.read()
    filename = file.filename
    mime = file.content_type or "image/png"
    label = filename[:30]
    is_local = p == "got_ocr"

    if p not in ("got_ocr", "openai", "gemini", "claude"):
        raise HTTPException(status_code=400, detail=f"Unsupported OCR provider: {provider}")

    params = {
        "provider": p,
        "model": model,
        "file": filename,
        "api_key": "***" if api_key else "",
    }
    job = _make_job("ocr", f"OCR · {label}", p, is_local=is_local, params=params)
    job_id = job["id"]

    async def _do():
        if p == "got_ocr":
            result = await run_got_ocr(file_content=content, filename=filename, model=model or "GOT-OCR2.0")
            return {"text": result.get("text", "")}
        if p == "openai":
            from services.image_understand.openai_image_understand import run_openai_image_understand
            r = await run_openai_image_understand(
                image_content=content, image_mime=mime,
                prompt="请识别图片中所有文字，只输出文字内容，保留原始格式",
                api_key=api_key, model=model or "gpt-4o-mini",
            )
        elif p == "gemini":
            from services.image_understand.gemini_image_understand import run_gemini_image_understand
            r = await run_gemini_image_understand(
                image_content=content, image_mime=mime,
                prompt="请识别图片中所有文字，只输出文字内容，保留原始格式",
                api_key=api_key, model=model or "gemini-2.5-flash",
            )
        else:
            from services.image_understand.anthropic_image_understand import run_claude_image_understand
            r = await run_claude_image_understand(
                image_content=content, image_mime=mime,
                prompt="请识别图片中所有文字，只输出文字内容，保留原始格式",
                api_key=api_key, model=model or "claude-opus-4-5",
            )
        return {"status": "completed", "result_text": r.get("result_text") or r.get("text") or ""}

    task = asyncio.create_task(_run_tts_job(job_id, _do))
    job["_task"] = task
    logger.info("ocr job %s queued (provider=%s)", job_id, p)
    return {"status": "queued", "job_id": job_id}


# ─── 口型同步 ─────────────────────────────────────────────────────────────────

@router.post("/tasks/lipsync")
async def task_lipsync(
    video: UploadFile = File(...),
    audio: UploadFile = File(...),
    provider: str = Form("liveportrait"),
    api_key: str = Form(""),
    cloud_endpoint: str = Form(""),
    model: str = Form(""),
):
    if not video or not video.filename:
        raise HTTPException(status_code=400, detail="video is required")
    if not audio or not audio.filename:
        raise HTTPException(status_code=400, detail="audio is required")

    p = provider.strip().lower()
    is_local = p in ("liveportrait", "sadtalker")

    vid_ext = Path(video.filename).suffix or ".mp4"
    aud_ext = Path(audio.filename).suffix or ".wav"
    vid_tmp = DOWNLOAD_DIR / f"{uuid.uuid4()}_lipsync_vid{vid_ext}"
    aud_tmp = DOWNLOAD_DIR / f"{uuid.uuid4()}_lipsync_aud{aud_ext}"
    vid_tmp.write_bytes(await video.read())
    aud_tmp.write_bytes(await audio.read())

    label = video.filename[:30]
    params = {
        "provider": p,
        "model": model,
        "video": video.filename,
        "audio": audio.filename,
        "api_key": "***" if api_key else "",
    }
    job = _make_job("lipsync", f"口型同步 · {label}", p, is_local=is_local, params=params)
    job_id = job["id"]
    job["_vid_tmp"] = str(vid_tmp)
    job["_aud_tmp"] = str(aud_tmp)

    output_path = str(DOWNLOAD_DIR / f"{str(uuid.uuid4())[:8]}_lipsync_out.mp4")

    async def _do():
        try:
            if p == "liveportrait":
                return await run_liveportrait_lipsync(
                    source_path=str(vid_tmp),
                    audio_path=str(aud_tmp),
                    output_path=output_path,
                    model=model,
                )
            raise HTTPException(status_code=400, detail=f"Unsupported lipsync provider: {provider}")
        finally:
            for tmp in [vid_tmp, aud_tmp]:
                if Path(str(tmp)).exists():
                    try:
                        Path(str(tmp)).unlink()
                    except Exception:
                        pass

    task = asyncio.create_task(_run_tts_job(job_id, _do))
    job["_task"] = task
    logger.info("lipsync job %s queued (provider=%s)", job_id, p)
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
