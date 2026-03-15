from fastapi import APIRouter, Body

from config import BACKEND_HOST, BACKEND_PORT, MODEL_ROOT, TASK_CAPABILITIES, _MANIFEST, DOWNLOAD_DIR, load_settings, save_settings
from utils.engine import get_checkpoint_dir
from utils.voices import list_voices
from pathlib import Path
import job_queue

router = APIRouter()


@router.get("/health")
async def health():
    return {
        "status": "ok",
        "host": BACKEND_HOST,
        "port": BACKEND_PORT,
        "model_root": str(MODEL_ROOT),
        "download_dir": str(DOWNLOAD_DIR),
        "voices_count": len(list_voices()),
    }


@router.get("/runtime/info")
async def runtime_info():
    """返回各本地引擎的固化版本信息（来自 manifest.json）。"""
    engines_out = {}
    manifest_engines = (_MANIFEST.get("engines") or {})
    for name, cfg in manifest_engines.items():
        checkpoint_dir = get_checkpoint_dir(name)
        checkpoint_path = Path(checkpoint_dir)
        required_files = [f["path"] for f in cfg.get("checkpoint_files", []) if f.get("required")]
        missing = [p for p in required_files if not (checkpoint_path / p).exists()]
        engines_out[name] = {
            "version": cfg.get("version", "unknown"),
            "checkpoint_dir": checkpoint_dir,
            "ready": len(missing) == 0,
            "missing_checkpoints": missing,
        }
    return {
        "manifest_version": _MANIFEST.get("manifest_version", "1"),
        "engines": engines_out,
    }


@router.get("/capabilities")
async def get_capabilities():
    return {"tasks": TASK_CAPABILITIES}


@router.get("/settings")
async def get_settings():
    s = load_settings()
    return {"local_concurrency": max(1, min(4, int(s.get("local_concurrency", 1))))}


@router.post("/settings")
async def update_settings(local_concurrency: int = Body(..., embed=True)):
    n = max(1, min(4, local_concurrency))
    s = load_settings()
    s["local_concurrency"] = n
    save_settings(s)
    job_queue.set_local_concurrency(n)
    return {"local_concurrency": n}
