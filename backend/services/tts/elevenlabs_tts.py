import uuid
from typing import Dict

try:
    import httpx
except Exception:
    httpx = None

from fastapi import HTTPException

from config import DOWNLOAD_DIR, ELEVENLABS_BASE_URL
from utils.auth import require_httpx


async def run_elevenlabs_tts(*, text: str, api_key: str, voice: str = "JBFqnCBsd6RMkjVDRTp2", model: str = "eleven_multilingual_v2") -> Dict:
    require_httpx("elevenlabs tts")
    if not api_key.strip():
        raise HTTPException(status_code=400, detail="api_key is required for elevenlabs tts")
    voice_id = voice.strip() or "JBFqnCBsd6RMkjVDRTp2"
    endpoint = f"{ELEVENLABS_BASE_URL}/v1/text-to-speech/{voice_id}"
    headers = {"xi-api-key": api_key.strip(), "Content-Type": "application/json", "Accept": "audio/mpeg"}
    payload = {"text": text, "model_id": model or "eleven_multilingual_v2", "voice_settings": {"stability": 0.5, "similarity_boost": 0.75}}
    try:
        async with httpx.AsyncClient(timeout=120.0) as client:
            resp = await client.post(endpoint, headers=headers, json=payload)
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"ElevenLabs TTS request failed: {exc}") from exc
    if resp.status_code >= 400:
        raise HTTPException(status_code=502, detail=f"ElevenLabs TTS error {resp.status_code}: {resp.text[:300]}")
    audio_bytes = resp.content
    out_path = DOWNLOAD_DIR / f"tts_{uuid.uuid4().hex[:8]}.mp3"
    out_path.write_bytes(audio_bytes)
    return {"status": "success", "task": "tts", "provider": "elevenlabs", "result_url": f"/download/{out_path.name}"}
