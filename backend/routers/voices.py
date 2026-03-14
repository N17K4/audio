import json
from datetime import datetime
from pathlib import Path
from typing import Dict, Optional

from fastapi import APIRouter, File, Form, HTTPException, UploadFile

from config import VOICES_DIR
from logging_setup import logger
from utils.voices import list_voices, read_voice_meta

router = APIRouter()


@router.get("/voices")
async def get_voices():
    return {"voices": list_voices()}


@router.post("/voices/create")
async def create_voice(
    voice_name: str = Form(...),
    engine: str = Form("rvc"),
    model_file: Optional[UploadFile] = File(None),
    index_file: Optional[UploadFile] = File(None),
    reference_audio: Optional[UploadFile] = File(None),
):
    """创建音色包：RVC 上传 .pth（+可选 .index），Fish Speech / Seed-VC 上传参考音频。"""
    safe = "".join(ch for ch in voice_name.strip().lower() if ch.isalnum() or ch in ["_", "-"])
    if not safe:
        raise HTTPException(status_code=400, detail="voice_name 包含无效字符")

    voice_id = f"{safe}_{int(datetime.utcnow().timestamp())}"
    voice_dir = VOICES_DIR / voice_id
    voice_dir.mkdir(parents=True, exist_ok=True)

    meta: Dict = {
        "voice_id": voice_id,
        "name": voice_name.strip(),
        "engine": engine,
        "sample_rate": 44100,
    }

    if model_file and model_file.filename:
        ext = Path(model_file.filename).suffix or ".pth"
        dst = voice_dir / f"model{ext}"
        dst.write_bytes(await model_file.read())
        meta["model_file"] = dst.name
        # RVC 有模型文件时启用命令推理模式
        if engine == "rvc":
            meta["inference_mode"] = "command"

    if index_file and index_file.filename:
        ext = Path(index_file.filename).suffix or ".index"
        dst = voice_dir / f"index{ext}"
        dst.write_bytes(await index_file.read())
        meta["index_file"] = dst.name

    if reference_audio and reference_audio.filename:
        ext = Path(reference_audio.filename).suffix or ".wav"
        dst = voice_dir / f"reference{ext}"
        dst.write_bytes(await reference_audio.read())
        meta["reference_audio"] = dst.name

    (voice_dir / "meta.json").write_text(
        json.dumps(meta, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    logger.info("创建音色: voice_id=%s engine=%s inference_mode=%s", voice_id, engine, meta.get("inference_mode", "copy"))

    return {"status": "ok", "voice_id": voice_id, "voice_name": voice_name.strip()}
