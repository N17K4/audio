import base64
from typing import Dict

try:
    import httpx
except Exception:
    httpx = None

from fastapi import HTTPException

from utils.auth import require_httpx


async def run_openai_image_understand(
    *, image_content: bytes, image_mime: str, prompt: str, api_key: str, model: str = "gpt-4o-mini"
) -> Dict:
    require_httpx("openai image understand")
    if not api_key.strip():
        raise HTTPException(status_code=400, detail="api_key is required for OpenAI image understanding")

    b64 = base64.b64encode(image_content).decode()
    endpoint = "https://api.openai.com/v1/chat/completions"
    headers = {"Authorization": f"Bearer {api_key.strip()}", "Content-Type": "application/json"}
    payload = {
        "model": model or "gpt-4o-mini",
        "messages": [
            {
                "role": "user",
                "content": [
                    {"type": "image_url", "image_url": {"url": f"data:{image_mime};base64,{b64}"}},
                    {"type": "text", "text": prompt or "请描述这张图片"},
                ],
            }
        ],
        "max_tokens": 2048,
    }
    try:
        async with httpx.AsyncClient(timeout=120.0) as client:
            resp = await client.post(endpoint, headers=headers, json=payload)
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"OpenAI image understand failed: {exc}") from exc
    if resp.status_code >= 400:
        raise HTTPException(status_code=502, detail=f"OpenAI image understand error {resp.status_code}: {resp.text[:300]}")

    data = resp.json()
    text = (((data.get("choices") or [{}])[0].get("message") or {}).get("content") or "").strip()
    return {"status": "success", "task": "image_understand", "provider": "openai", "text": text}
