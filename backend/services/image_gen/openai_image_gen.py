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


async def run_openai_image_gen(
    *, prompt: str, api_key: str, model: str = "dall-e-3", size: str = "1024x1024"
) -> Dict:
    require_httpx("openai image gen")
    if not api_key.strip():
        raise HTTPException(status_code=400, detail="api_key is required for OpenAI image generation")

    endpoint = "https://api.openai.com/v1/images/generations"
    headers = {"Authorization": f"Bearer {api_key.strip()}", "Content-Type": "application/json"}
    payload = {
        "model": model or "dall-e-3",
        "prompt": prompt,
        "n": 1,
        "size": size or "1024x1024",
        "response_format": "b64_json",
    }
    try:
        async with httpx.AsyncClient(timeout=120.0) as client:
            resp = await client.post(endpoint, headers=headers, json=payload)
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"OpenAI image gen request failed: {exc}") from exc
    if resp.status_code >= 400:
        raise HTTPException(status_code=502, detail=f"OpenAI image gen error {resp.status_code}: {resp.text[:300]}")

    data = resp.json()
    item = (data.get("data") or [{}])[0]
    b64 = item.get("b64_json", "")
    revised_prompt = item.get("revised_prompt", "")

    task_id = str(uuid.uuid4())[:8]
    output_path = DOWNLOAD_DIR / f"{task_id}_img_gen.png"
    output_path.write_bytes(base64.b64decode(b64))

    result_url = f"http://{BACKEND_HOST}:{BACKEND_PORT}/download/{output_path.name}"
    return {
        "status": "success",
        "task": "image_gen",
        "provider": "openai",
        "result_url": result_url,
        "result_text": revised_prompt or "",
    }
