import base64
import uuid
from typing import Dict

try:
    import httpx
except Exception:
    httpx = None

from fastapi import HTTPException

from config import BACKEND_HOST, BACKEND_PORT, DOWNLOAD_DIR
from utils.auth import require_httpx


async def run_gemini_image_gen(
    *, prompt: str, api_key: str, model: str = "imagen-3.0-generate-002", aspect_ratio: str = "1:1"
) -> Dict:
    require_httpx("gemini image gen")
    if not api_key.strip():
        raise HTTPException(status_code=400, detail="api_key is required for Gemini image generation")

    m = model or "imagen-3.0-generate-002"
    endpoint = f"https://generativelanguage.googleapis.com/v1beta/models/{m}:predict"
    params = {"key": api_key.strip()}
    payload = {
        "instances": [{"prompt": prompt}],
        "parameters": {"sampleCount": 1, "aspectRatio": aspect_ratio or "1:1"},
    }
    try:
        async with httpx.AsyncClient(timeout=120.0) as client:
            resp = await client.post(endpoint, params=params, json=payload)
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Gemini image gen request failed: {exc}") from exc
    if resp.status_code >= 400:
        raise HTTPException(status_code=502, detail=f"Gemini image gen error {resp.status_code}: {resp.text[:300]}")

    data = resp.json()
    predictions = data.get("predictions") or []
    if not predictions:
        raise HTTPException(status_code=502, detail="Gemini image gen returned no images")

    pred = predictions[0]
    b64 = pred.get("bytesBase64Encoded", "")
    mime = pred.get("mimeType", "image/png")
    ext = mime.split("/")[-1] if "/" in mime else "png"

    task_id = str(uuid.uuid4())[:8]
    output_path = DOWNLOAD_DIR / f"{task_id}_img_gen.{ext}"
    output_path.write_bytes(base64.b64decode(b64))

    result_url = f"http://{BACKEND_HOST}:{BACKEND_PORT}/download/{output_path.name}"
    return {"status": "success", "task": "image_gen", "provider": "gemini", "result_url": result_url}
