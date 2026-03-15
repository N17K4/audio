import uuid
from typing import Dict

try:
    import httpx
except Exception:
    httpx = None

from fastapi import HTTPException

from config import DOWNLOAD_DIR, CARTESIA_BASE_URL
from utils.auth import require_httpx

CARTESIA_VERSION = "2024-06-10"

# Cartesia 内置音色 ID（用户也可直接填写自定义音色 ID）
DEFAULT_VOICE_ID = "a0e99841-438c-4a64-b679-ae501e7d6091"  # Barbershop Man


async def run_cartesia_tts(
    *,
    text: str,
    api_key: str,
    voice: str = "",
    model: str = "sonic-2",
) -> Dict:
    require_httpx("cartesia tts")
    if not api_key.strip():
        raise HTTPException(status_code=400, detail="api_key is required for Cartesia TTS")

    voice_id = voice.strip() or DEFAULT_VOICE_ID
    model_id = model.strip() or "sonic-2"

    endpoint = f"{CARTESIA_BASE_URL}/tts/bytes"
    headers = {
        "X-API-Key": api_key.strip(),
        "Cartesia-Version": CARTESIA_VERSION,
        "Content-Type": "application/json",
    }
    payload = {
        "model_id": model_id,
        "transcript": text,
        "voice": {"mode": "id", "id": voice_id},
        "output_format": {
            "container": "mp3",
            "bit_rate": 128000,
            "sample_rate": 44100,
        },
    }

    try:
        async with httpx.AsyncClient(timeout=120.0) as client:
            resp = await client.post(endpoint, headers=headers, json=payload)
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Cartesia TTS 请求失败: {exc}") from exc

    if resp.status_code >= 400:
        raise HTTPException(
            status_code=502,
            detail=f"Cartesia TTS 错误 {resp.status_code}: {resp.text[:300]}",
        )

    out_path = DOWNLOAD_DIR / f"tts_{uuid.uuid4().hex[:8]}.mp3"
    out_path.write_bytes(resp.content)
    return {"status": "success", "task": "tts", "provider": "cartesia", "result_url": f"/download/{out_path.name}"}
