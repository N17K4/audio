import uuid
from typing import Dict

try:
    import httpx
except Exception:
    httpx = None

from fastapi import HTTPException

from config import DOWNLOAD_DIR, BACKEND_HOST, BACKEND_PORT
from utils.auth import require_httpx


async def run_openai_tts(text: str, api_key: str, model: str = "gpt-4o-mini-tts", voice: str = "alloy") -> Dict:
    require_httpx("openai tts")
    if not api_key.strip():
        raise HTTPException(status_code=400, detail="api_key is required for openai tts")
    endpoint = "https://api.openai.com/v1/audio/speech"
    payload = {"model": model, "voice": voice, "input": text}
    headers = {"Authorization": f"Bearer {api_key.strip()}", "Content-Type": "application/json"}
    try:
        async with httpx.AsyncClient(timeout=120.0) as client:
            resp = await client.post(endpoint, headers=headers, json=payload)
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"OpenAI TTS request failed: {exc}") from exc

    if resp.status_code >= 400:
        raise HTTPException(status_code=502, detail=f"OpenAI TTS error {resp.status_code}: {resp.text[:300]}")

    task_id = str(uuid.uuid4())
    output_path = DOWNLOAD_DIR / f"{task_id}_tts_openai.mp3"
    with open(output_path, "wb") as f:
        f.write(resp.content)
    return {
        "status": "success",
        "task": "tts",
        "provider": "openai",
        "result_url": f"http://{BACKEND_HOST}:{BACKEND_PORT}/download/{output_path.name}",
    }
