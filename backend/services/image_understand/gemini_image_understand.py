import base64
from typing import Dict

try:
    import httpx
except Exception:
    httpx = None

from fastapi import HTTPException

from utils.auth import require_httpx


async def run_gemini_image_understand(
    *, image_content: bytes, image_mime: str, prompt: str, api_key: str, model: str = "gemini-2.5-flash"
) -> Dict:
    require_httpx("gemini image understand")
    if not api_key.strip():
        raise HTTPException(status_code=400, detail="api_key is required for Gemini image understanding")

    b64 = base64.b64encode(image_content).decode()
    m = model or "gemini-2.5-flash"
    endpoint = f"https://generativelanguage.googleapis.com/v1beta/models/{m}:generateContent"
    params = {"key": api_key.strip()}
    payload = {
        "contents": [
            {
                "parts": [
                    {"inline_data": {"mime_type": image_mime, "data": b64}},
                    {"text": prompt or "请描述这张图片"},
                ]
            }
        ]
    }
    try:
        async with httpx.AsyncClient(timeout=120.0) as client:
            resp = await client.post(endpoint, params=params, json=payload)
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Gemini image understand failed: {exc}") from exc
    if resp.status_code >= 400:
        raise HTTPException(status_code=502, detail=f"Gemini image understand error {resp.status_code}: {resp.text[:300]}")

    data = resp.json()
    text = (
        (((data.get("candidates") or [{}])[0].get("content") or {}).get("parts") or [{}])[0]
        .get("text", "")
        .strip()
    )
    return {"status": "success", "task": "image_understand", "provider": "gemini", "text": text}
