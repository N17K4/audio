import json
import shutil
from datetime import datetime
from pathlib import Path
from typing import Dict, List

from fastapi import HTTPException

from config import VOICES_DIR, USER_VOICES_DIR
from logging_setup import logger


def read_voice_meta(voice_dir: Path, is_builtin: bool = False) -> Dict:
    meta_path = voice_dir / "meta.json"
    meta = {}
    if meta_path.exists():
        try:
            meta = json.loads(meta_path.read_text(encoding="utf-8"))
        except Exception:
            meta = {}

    voice_id = meta.get("voice_id") or voice_dir.name
    name = meta.get("name") or voice_dir.name.replace("_", " ").title()

    model_candidates = [
        "model.pth",
        "model.onnx",
        "model.pt",
        "model.safetensors",
    ]
    found_model = None
    for candidate in model_candidates:
        if (voice_dir / candidate).exists():
            found_model = candidate
            break

    inference_mode = meta.get("inference_mode", "copy")
    inference_command = meta.get("inference_command", "")
    ref_candidates = ["reference.wav", "reference.mp3", "ref.wav"]
    found_ref = next((str((voice_dir / r).resolve()) for r in ref_candidates if (voice_dir / r).exists()), "")
    engine = meta.get("engine", "rvc")
    # RVC 需要模型文件(.pth)；Fish Speech / Seed-VC 只需参考音频
    if engine == "rvc":
        is_ready = bool(found_model)
    else:
        is_ready = bool(found_ref) or bool(found_model)

    return {
        "voice_id": voice_id,
        "name": name,
        "engine": engine,
        "sample_rate": meta.get("sample_rate", 44100),
        "model_file": meta.get("model_file", found_model),
        "index_file": meta.get("index_file", "index.index" if (voice_dir / "index.index").exists() else None),
        "path": str(voice_dir),
        "is_ready": is_ready,
        "is_builtin": is_builtin,
        "inference_mode": inference_mode,
        "inference_command": inference_command,
        "reference_audio": found_ref,
        "updated_at": datetime.fromtimestamp(voice_dir.stat().st_mtime).isoformat(),
    }


def list_voices() -> List[Dict]:
    voices = []
    dirs = []
    # 内置音色（标记为 is_builtin=True）
    if VOICES_DIR.exists():
        for p in VOICES_DIR.iterdir():
            if p.is_dir() and p.name != "user":
                voices.append(read_voice_meta(p, is_builtin=True))
    # 用户导入的音色（标记为 is_builtin=False）
    if USER_VOICES_DIR.exists():
        for p in USER_VOICES_DIR.iterdir():
            if p.is_dir():
                voices.append(read_voice_meta(p, is_builtin=False))
    # 按名称排序
    voices.sort(key=lambda x: x["name"])
    return voices


def get_voice_or_404(voice_id: str) -> Dict:
    voices = list_voices()
    for v in voices:
        if v["voice_id"] == voice_id:
            return v
    raise HTTPException(status_code=404, detail=f"Voice not found: {voice_id}")


def copy_to_output_dir(src: Path, output_dir: str) -> None:
    """Copy result file to user-specified output directory if provided."""
    if not output_dir.strip():
        return
    try:
        dest = Path(output_dir.strip())
        dest.mkdir(parents=True, exist_ok=True)
        shutil.copy(src, dest / src.name)
    except Exception:
        pass  # Non-fatal: temp URL is still returned
