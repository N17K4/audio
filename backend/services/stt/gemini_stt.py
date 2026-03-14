import base64
from typing import Dict

try:
    import httpx
except Exception:
    httpx = None

from fastapi import HTTPException

from utils.auth import require_httpx


async def run_gemini_stt(
    content: bytes,
    filename: str,
    content_type: str,
    api_key: str,
    model: str = "gemini-2.5-flash",
) -> Dict:
    require_httpx("gemini stt")
    if not api_key.strip():
        raise HTTPException(status_code=400, detail="api_key is required for gemini stt")
    endpoint = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={api_key.strip()}"
    audio_b64 = base64.b64encode(content).decode("ascii")
    payload = {
        "contents": [
            {
                "parts": [
                    {"text": "Transcribe this audio. Return plain text only."},
                    {
                        "inlineData": {
                            "mimeType": content_type or "audio/webm",
                            "data": audio_b64,
                        }
                    },
                ]
            }
        ]
    }
    try:
        async with httpx.AsyncClient(timeout=120.0) as client:
            resp = await client.post(endpoint, json=payload)
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Gemini STT request failed: {exc}") from exc
    if resp.status_code >= 400:
        raise HTTPException(status_code=502, detail=f"Gemini STT error {resp.status_code}: {resp.text[:300]}")
    try:
        data = resp.json()
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Gemini STT parse failed: {exc}") from exc

    candidates = data.get("candidates") or []
    if not candidates:
        raise HTTPException(status_code=502, detail="Gemini STT response has no candidates")
    parts = ((candidates[0] or {}).get("content") or {}).get("parts") or []
    text = ""
    for p in parts:
        if p.get("text"):
            text += p.get("text", "")
    return {
        "status": "success",
        "task": "stt",
        "provider": "gemini",
        "text": text.strip(),
        "raw": data,
        "filename": filename,
    }
