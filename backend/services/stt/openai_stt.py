from typing import Dict

try:
    import httpx
except Exception:
    httpx = None

from fastapi import HTTPException

from utils.auth import require_httpx


async def run_openai_stt(content: bytes, filename: str, api_key: str, model: str = "gpt-4o-mini-transcribe") -> Dict:
    require_httpx("openai stt")
    if not api_key.strip():
        raise HTTPException(status_code=400, detail="api_key is required for openai stt")
    endpoint = "https://api.openai.com/v1/audio/transcriptions"
    headers = {"Authorization": f"Bearer {api_key.strip()}"}
    files = {"file": (filename, content, "audio/webm")}
    data = {"model": model}
    try:
        async with httpx.AsyncClient(timeout=120.0) as client:
            resp = await client.post(endpoint, headers=headers, data=data, files=files)
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"OpenAI STT request failed: {exc}") from exc

    if resp.status_code >= 400:
        raise HTTPException(status_code=502, detail=f"OpenAI STT error {resp.status_code}: {resp.text[:300]}")
    try:
        payload = resp.json()
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"OpenAI STT parse failed: {exc}") from exc

    return {
        "status": "success",
        "task": "stt",
        "provider": "openai",
        "text": payload.get("text", ""),
        "raw": payload,
    }
