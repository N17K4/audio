import asyncio
import os
import subprocess
import uuid
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, File, Form, HTTPException, UploadFile

from config import DOWNLOAD_DIR, MAX_LOCAL_QUEUE, BACKEND_HOST, BACKEND_PORT
from job_queue import JOBS, _make_job, _run_vc_job
from logging_setup import logger
from services.vc.local_vc import run_cloud_convert, run_local_inference_or_raise, run_seed_vc_cmd
from utils.engine import get_ffmpeg_binary
from utils.voices import copy_to_output_dir, get_voice_or_404

router = APIRouter()


@router.post("/convert")
async def convert(
    file: UploadFile = File(...),
    voice_id: str = Form("default_female"),
    mode: str = Form("local"),
    provider: str = Form("custom"),
    api_key: str = Form(""),
    cloud_endpoint: str = Form(""),
    output_dir: str = Form(""),
    reference_audio: Optional[UploadFile] = File(None),
    # 通用
    pitch_shift: int = Form(0),
    # SeedVC 专属
    diffusion_steps: int = Form(10),
    f0_condition: bool = Form(False),
    cfg_rate: float = Form(0.7),
    enable_postprocess: bool = Form(True),
    # RVC 专属
    f0_method: str = Form("harvest"),  # harvest 比 rmvpe 对 macOS ARM MPS 更稳定
    filter_radius: int = Form(3),
    index_rate: float = Form(0.75),
    rms_mix_rate: float = Form(0.25),
):
    content = await file.read()
    if not content:
        raise HTTPException(status_code=400, detail="Uploaded file is empty.")

    ref_audio_tmp: Optional[Path] = None
    if reference_audio and reference_audio.filename:
        ref_ext = Path(reference_audio.filename).suffix or ".wav"
        ref_audio_tmp = DOWNLOAD_DIR / f"{uuid.uuid4()}_ref{ref_ext}"
        ref_audio_tmp.write_bytes(await reference_audio.read())

    # 云端模式：同步执行，直接返回结果（不走 job 队列）
    if mode.strip().lower() == "cloud":
        try:
            result = await run_cloud_convert(
                content=content,
                filename=file.filename or "record.webm",
                content_type=file.content_type or "application/octet-stream",
                voice_id=voice_id,
                provider=provider,
                api_key=api_key,
                cloud_endpoint=cloud_endpoint,
            )
        finally:
            if ref_audio_tmp and ref_audio_tmp.exists():
                try:
                    ref_audio_tmp.unlink()
                except Exception:
                    pass
        if result.get("result_url") and output_dir.strip():
            url_name = Path(result["result_url"]).name
            copy_to_output_dir(DOWNLOAD_DIR / url_name, output_dir)
        return result

    # 本地推理：检查队列容量
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

    # 保存输入文件，本地引擎统一转为 WAV（rvc_python/torchaudio 不支持 webm 等容器格式）
    raw_ext = (os.path.splitext(file.filename or "")[1] or ".wav").lower()
    task_id = str(uuid.uuid4())
    raw_input_path = DOWNLOAD_DIR / f"{task_id}_input{raw_ext}"
    raw_input_path.write_bytes(content)
    _SUPPORTED_AUDIO_EXTS = {".wav", ".mp3", ".flac", ".ogg", ".m4a", ".aac"}
    if raw_ext not in _SUPPORTED_AUDIO_EXTS:
        wav_input_path = DOWNLOAD_DIR / f"{task_id}_input.wav"
        # 依次尝试：打包 ffmpeg → 系统 ffmpeg（打包版可能架构不对）
        import shutil as _shutil
        _ffmpeg_candidates = []
        _bundled = get_ffmpeg_binary()
        if _bundled:
            _ffmpeg_candidates.append(_bundled)
        _sys_ff = _shutil.which("ffmpeg")
        if _sys_ff and _sys_ff not in _ffmpeg_candidates:
            _ffmpeg_candidates.append(_sys_ff)
        _converted = False
        for _ffmpeg_bin in _ffmpeg_candidates:
            try:
                subprocess.run(
                    [_ffmpeg_bin, "-y", "-i", str(raw_input_path), str(wav_input_path)],
                    capture_output=True, check=True, timeout=60,
                )
                _converted = True
                logger.debug("输入格式转换成功 (ffmpeg=%s)", _ffmpeg_bin)
                break
            except Exception as _conv_err:
                logger.warning("ffmpeg (%s) 转换失败: %s", _ffmpeg_bin, _conv_err)
        if _converted:
            raw_input_path.unlink(missing_ok=True)
            input_path = wav_input_path
        else:
            # 所有 ffmpeg 均失败：Seed-VC/RVC 无法处理 webm 等容器格式，直接拒绝
            raw_input_path.unlink(missing_ok=True)
            tried = ", ".join(_ffmpeg_candidates) if _ffmpeg_candidates else "（未找到任何 ffmpeg）"
            raise HTTPException(
                status_code=400,
                detail=(
                    f"无法将 {raw_ext} 格式转换为 WAV：所有 ffmpeg 均失败（{tried}）。"
                    "请录制/上传 WAV / MP3 / FLAC 等格式，或安装系统 ffmpeg（brew install ffmpeg）。"
                ),
            )
    else:
        input_path = raw_input_path
    output_path = DOWNLOAD_DIR / f"{task_id}_output.wav"
    file_ext = ".wav"

    prov = provider.strip().lower()
    filename_label = (file.filename or "audio").split("/")[-1]
    logger.info("convert: voice_id=%s provider=%s", voice_id, prov)

    # 构建推理函数（同步，供后台线程调用）
    def _run_vc_sync() -> str:
        if prov == "seed_vc":
            voice_ref = str(ref_audio_tmp) if ref_audio_tmp else ""
            if not voice_ref:
                try:
                    v = get_voice_or_404(voice_id)
                    voice_ref = v.get("reference_audio", "")
                except Exception:
                    pass
            logger.info("Seed-VC voice_ref=%s diffusion_steps=%s pitch_shift=%s", voice_ref, diffusion_steps, pitch_shift)
            run_seed_vc_cmd(input_path, output_path, voice_ref, diffusion_steps, pitch_shift, f0_condition, cfg_rate, enable_postprocess)
        else:
            voice = get_voice_or_404(voice_id)
            engine = voice.get("engine", "rvc").lower()
            logger.info("local engine=%s inference_mode=%s", engine, voice.get("inference_mode", "copy"))
            if engine == "seed_vc":
                voice_ref = str(ref_audio_tmp) if ref_audio_tmp else voice.get("reference_audio", "")
                run_seed_vc_cmd(input_path, output_path, voice_ref, diffusion_steps, pitch_shift, f0_condition, cfg_rate, enable_postprocess)
            else:
                rvc_extra_env = {
                    "RVC_F0_UP_KEY": str(pitch_shift),
                    "RVC_F0_METHOD": f0_method,
                    "RVC_FILTER_RADIUS": str(filter_radius),
                    "RVC_INDEX_RATE": str(index_rate),
                    "RVC_RMS_MIX_RATE": str(rms_mix_rate),
                }
                run_local_inference_or_raise(voice, input_path, output_path, rvc_extra_env)
        result_url = f"http://{BACKEND_HOST}:{BACKEND_PORT}/download/{task_id}_output{file_ext}"
        copy_to_output_dir(output_path, output_dir)
        return result_url

    job = _make_job("vc", f"音色转换 · {filename_label}", prov, is_local=True)
    job_id = job["id"]
    job["_ref_audio_tmp"] = str(ref_audio_tmp) if ref_audio_tmp else None
    job["_input_tmp"] = str(input_path)

    task = asyncio.create_task(_run_vc_job(job_id, _run_vc_sync))
    job["_task"] = task  # 防止 GC

    logger.info("convert job %s queued (provider=%s)", job_id, prov)
    return {"status": "queued", "job_id": job_id}
