import asyncio
import json
import traceback
import uuid
from datetime import datetime
from pathlib import Path

from fastapi import APIRouter, File, Form, HTTPException, UploadFile

from config import TRAIN_DATA_DIR, VOICES_DIR
from job_queue import TRAIN_JOBS
from logging_setup import logger

router = APIRouter()


async def run_mock_training(job_id: str, voice_id: str, voice_name: str, dataset_path: Path):
    TRAIN_JOBS[job_id]["status"] = "running"
    TRAIN_JOBS[job_id]["started_at"] = datetime.utcnow().isoformat()
    try:
        await asyncio.sleep(3)

        voice_dir = VOICES_DIR / voice_id
        voice_dir.mkdir(parents=True, exist_ok=True)

        # Placeholder artifacts so future conversion can reference this voice pack.
        (voice_dir / "model.pth").write_text(
            "placeholder model file for integration stage\n",
            encoding="utf-8",
        )
        meta = {
            "voice_id": voice_id,
            "name": voice_name,
            "engine": "rvc",
            "sample_rate": 44100,
            "model_file": "model.pth",
            "index_file": "index.index",
            "inference_mode": "command",
            "inference_command": "",
            "trained_from": str(dataset_path),
            "trained_at": datetime.utcnow().isoformat(),
            "note": "placeholder artifact; replace with real trained model files and inference_command",
        }
        (voice_dir / "meta.json").write_text(json.dumps(meta, ensure_ascii=False, indent=2), encoding="utf-8")

        TRAIN_JOBS[job_id]["status"] = "completed"
        TRAIN_JOBS[job_id]["finished_at"] = datetime.utcnow().isoformat()
        TRAIN_JOBS[job_id]["voice_id"] = voice_id
        TRAIN_JOBS[job_id]["result"] = {
            "message": "Training pipeline placeholder completed.",
            "voice_dir": str(voice_dir),
        }
    except Exception as exc:
        TRAIN_JOBS[job_id]["status"] = "failed"
        TRAIN_JOBS[job_id]["finished_at"] = datetime.utcnow().isoformat()
        TRAIN_JOBS[job_id]["error"] = str(exc)
        print(">>> training exception:")
        print(traceback.format_exc())


@router.post("/train")
async def train_voice(
    dataset: UploadFile = File(...),
    voice_id: str = Form(...),
    voice_name: str = Form(""),
):
    if not voice_id.strip():
        raise HTTPException(status_code=400, detail="voice_id is required")

    safe_voice_id = "".join(ch for ch in voice_id.strip().lower() if ch.isalnum() or ch in ["_", "-"])
    if not safe_voice_id:
        raise HTTPException(status_code=400, detail="voice_id contains no valid characters")

    safe_voice_name = voice_name.strip() or safe_voice_id
    ext = Path(dataset.filename or "dataset.zip").suffix or ".zip"
    job_id = str(uuid.uuid4())
    dataset_path = TRAIN_DATA_DIR / f"{job_id}{ext}"

    with open(dataset_path, "wb") as f:
        f.write(await dataset.read())

    TRAIN_JOBS[job_id] = {
        "job_id": job_id,
        "status": "queued",
        "voice_id": safe_voice_id,
        "voice_name": safe_voice_name,
        "dataset": str(dataset_path),
        "created_at": datetime.utcnow().isoformat(),
    }

    asyncio.create_task(run_mock_training(job_id, safe_voice_id, safe_voice_name, dataset_path))

    return {
        "status": "accepted",
        "job_id": job_id,
        "message": "Training job queued",
    }


@router.get("/train/{job_id}")
async def get_train_job(job_id: str):
    job = TRAIN_JOBS.get(job_id)
    if not job:
        raise HTTPException(status_code=404, detail=f"Job not found: {job_id}")
    return job
