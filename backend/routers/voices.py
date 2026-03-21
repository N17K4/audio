import json
import shutil
import time as _time
from datetime import datetime
from pathlib import Path
from typing import Dict, Optional

from fastapi import APIRouter, File, Form, HTTPException, UploadFile

from config import get_voices_dir, get_user_voices_dir, RVC_VOICES_DIR, RVC_USER_VOICES_DIR, SEED_VC_VOICES_DIR, SEED_VC_USER_VOICES_DIR
from job_queue import JOBS, _make_job
from logging_setup import logger
from utils.voices import list_voices, read_voice_meta

router = APIRouter()

# 全エンジンの音色ディレクトリを走査して voice_id にマッチするディレクトリを返す
_ALL_VOICE_DIRS = [
    RVC_USER_VOICES_DIR, RVC_VOICES_DIR,
    SEED_VC_USER_VOICES_DIR, SEED_VC_VOICES_DIR,
]


def _find_voice_dir(voice_id: str) -> Path | None:
    for parent in _ALL_VOICE_DIRS:
        candidate = parent / voice_id
        if candidate.exists() and candidate.is_dir():
            return candidate
    return None


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
    gpt_model_file: Optional[UploadFile] = File(None),
    sovits_model_file: Optional[UploadFile] = File(None),
    ref_text: Optional[str] = Form(None),
):
    """创建音色包：RVC 上传 .pth（+可选 .index），Fish Speech / Seed-VC 上传参考音频。"""
    engine_label = {"rvc": "RVC", "fish_speech": "Fish Speech", "seed_vc": "Seed-VC", "gpt_sovits": "GPT-SoVITS"}.get(engine, engine)
    job = _make_job("voice_create", f"创建音色 · {voice_name.strip()}", engine_label, is_local=False, params={"engine": engine, "voice_name": voice_name.strip()})
    job_id = job["id"]
    job["status"] = "running"
    job["started_at"] = _time.time()

    try:
        safe = "".join(ch for ch in voice_name.strip().lower() if ch.isalnum() or ch in ["_", "-"])
        if not safe:
            raise HTTPException(status_code=400, detail="voice_name 包含无效字符")

        voice_id = f"{safe}_{int(datetime.utcnow().timestamp())}"
        user_dir = get_user_voices_dir(engine)
        user_dir.mkdir(parents=True, exist_ok=True)
        voice_dir = user_dir / voice_id
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

        if gpt_model_file and gpt_model_file.filename:
            ext = Path(gpt_model_file.filename).suffix or ".ckpt"
            dst = voice_dir / f"gpt_model{ext}"
            dst.write_bytes(await gpt_model_file.read())
            meta["gpt_model"] = dst.name

        if sovits_model_file and sovits_model_file.filename:
            ext = Path(sovits_model_file.filename).suffix or ".pth"
            dst = voice_dir / f"sovits_model{ext}"
            dst.write_bytes(await sovits_model_file.read())
            meta["sovits_model"] = dst.name

        if ref_text and ref_text.strip():
            meta["ref_text"] = ref_text.strip()

        (voice_dir / "meta.json").write_text(
            json.dumps(meta, ensure_ascii=False, indent=2), encoding="utf-8"
        )
        logger.info("创建音色: voice_id=%s engine=%s inference_mode=%s", voice_id, engine, meta.get("inference_mode", "copy"))

        job["status"] = "completed"
        job["result_text"] = f"音色已创建：{voice_id}"
        return {"status": "ok", "voice_id": voice_id, "voice_name": voice_name.strip(), "job_id": job_id}

    except HTTPException:
        job["status"] = "failed"
        job["error"] = "参数错误"
        raise
    except Exception as exc:
        job["status"] = "failed"
        job["error"] = str(exc)
        raise
    finally:
        job["completed_at"] = _time.time()


@router.patch("/voices/{voice_id}")
async def rename_voice(voice_id: str, voice_name: str = Form(...)):
    """重命名音色（更新 meta.json 中的 name 字段）。"""
    voice_dir = _find_voice_dir(voice_id)
    if not voice_dir:
        raise HTTPException(status_code=404, detail=f"音色不存在: {voice_id}")
    new_name = voice_name.strip()
    if not new_name:
        raise HTTPException(status_code=400, detail="名称不能为空")
    meta_path = voice_dir / "meta.json"
    meta: Dict = {}
    if meta_path.exists():
        try:
            meta = json.loads(meta_path.read_text(encoding="utf-8"))
        except Exception:
            meta = {}
    meta["name"] = new_name
    meta_path.write_text(json.dumps(meta, ensure_ascii=False, indent=2), encoding="utf-8")
    logger.info("重命名音色: voice_id=%s new_name=%s", voice_id, new_name)
    return {"status": "ok", "voice_id": voice_id, "voice_name": new_name}


@router.delete("/voices/{voice_id}")
async def delete_voice(voice_id: str):
    """删除音色目录及其所有文件。"""
    voice_dir = _find_voice_dir(voice_id)
    if not voice_dir:
        raise HTTPException(status_code=404, detail=f"音色不存在: {voice_id}")
    shutil.rmtree(voice_dir)
    logger.info("删除音色: voice_id=%s", voice_id)
    return {"status": "ok", "voice_id": voice_id}
