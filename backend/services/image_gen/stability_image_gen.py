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


async def run_stability_image_gen(
    *, prompt: str, api_key: str, model: str = "sd3-large-turbo", aspect_ratio: str = "1:1"
) -> Dict:
    require_httpx("stability image gen")
    if not api_key.strip():
        raise HTTPException(status_code=400, detail="api_key is required for Stability AI image generation")

    m = (model or "sd3-large-turbo").lower()
    if m == "ultra":
        endpoint = "https://api.stability.ai/v2beta/stable-image/generate/ultra"
    elif m == "core":
        endpoint = "https://api.stability.ai/v2beta/stable-image/generate/core"
    else:
        endpoint = "https://api.stability.ai/v2beta/stable-image/generate/sd3"

    headers = {"Authorization": f"Bearer {api_key.strip()}", "Accept": "application/json"}
    form_data: dict = {"prompt": prompt, "aspect_ratio": aspect_ratio or "1:1", "output_format": "png"}
    if "sd3" in endpoint:
        form_data["model"] = m

    try:
        async with httpx.AsyncClient(timeout=120.0) as client:
            resp = await client.post(endpoint, headers=headers, data=form_data)
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Stability AI request failed: {exc}") from exc
    if resp.status_code >= 400:
        raise HTTPException(status_code=502, detail=f"Stability AI error {resp.status_code}: {resp.text[:300]}")

    result = resp.json()
    b64 = result.get("image", "")
    if not b64:
        raise HTTPException(status_code=502, detail="Stability AI returned no image data")

    task_id = str(uuid.uuid4())[:8]
    output_path = DOWNLOAD_DIR / f"{task_id}_img_gen.png"
    output_path.write_bytes(base64.b64decode(b64))

    result_url = f"http://{BACKEND_HOST}:{BACKEND_PORT}/download/{output_path.name}"
    return {"status": "success", "task": "image_gen", "provider": "stability", "result_url": result_url}
