import base64
import uuid
from typing import Dict

try:
    import httpx
except Exception:
    httpx = None

from fastapi import HTTPException

from config import DOWNLOAD_DIR, BACKEND_HOST, BACKEND_PORT
from utils.auth import require_httpx


async def run_gemini_tts(
    text: str,
    api_key: str,
    model: str = "gemini-2.5-flash-preview-tts",
    voice: str = "Kore",
) -> Dict:
    require_httpx("gemini tts")
    if not api_key.strip():
        raise HTTPException(status_code=400, detail="api_key is required for gemini tts")
    endpoint = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={api_key.strip()}"
    payload = {
        "contents": [{"parts": [{"text": text}]}],
        "generationConfig": {
            "responseModalities": ["AUDIO"],
            "speechConfig": {
                "voiceConfig": {
                    "prebuiltVoiceConfig": {"voiceName": voice}
                }
            },
        },
    }
    try:
        async with httpx.AsyncClient(timeout=120.0) as client:
            resp = await client.post(endpoint, json=payload)
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Gemini TTS request failed: {exc}") from exc
    if resp.status_code >= 400:
        raise HTTPException(status_code=502, detail=f"Gemini TTS error {resp.status_code}: {resp.text[:300]}")
    try:
        data = resp.json()
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Gemini TTS parse failed: {exc}") from exc

    candidates = data.get("candidates") or []
    if not candidates:
        raise HTTPException(status_code=502, detail="Gemini TTS response has no candidates")
    parts = ((candidates[0] or {}).get("content") or {}).get("parts") or []
    inline = None
    for p in parts:
        inline = p.get("inlineData") or p.get("inline_data")
        if inline:
            break
    if not inline:
        raise HTTPException(status_code=502, detail="Gemini TTS response has no audio payload")

    b64 = inline.get("data")
    mime = inline.get("mimeType") or inline.get("mime_type") or "audio/wav"
    if not b64:
        raise HTTPException(status_code=502, detail="Gemini TTS audio payload has no data")

    try:
        audio_bytes = base64.b64decode(b64)
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Gemini TTS audio decode failed: {exc}") from exc

    ext = ".wav" if "wav" in mime else ".mp3"
    task_id = str(uuid.uuid4())
    out = DOWNLOAD_DIR / f"{task_id}_tts_gemini{ext}"
    with open(out, "wb") as f:
        f.write(audio_bytes)

    return {
        "status": "success",
        "task": "tts",
        "provider": "gemini",
        "result_url": f"http://{BACKEND_HOST}:{BACKEND_PORT}/download/{out.name}",
        "mime_type": mime,
    }
