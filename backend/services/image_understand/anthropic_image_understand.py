import base64
from typing import Dict

try:
    import httpx
except Exception:
    httpx = None

from fastapi import HTTPException

from utils.auth import require_httpx


async def run_claude_image_understand(
    *, image_content: bytes, image_mime: str, prompt: str, api_key: str, model: str = "claude-opus-4-5"
) -> Dict:
    require_httpx("claude image understand")
    if not api_key.strip():
        raise HTTPException(status_code=400, detail="api_key is required for Claude image understanding")

    b64 = base64.b64encode(image_content).decode()
    endpoint = "https://api.anthropic.com/v1/messages"
    headers = {
        "x-api-key": api_key.strip(),
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json",
    }
    payload = {
        "model": model or "claude-opus-4-5",
        "max_tokens": 2048,
        "messages": [
            {
                "role": "user",
                "content": [
                    {"type": "image", "source": {"type": "base64", "media_type": image_mime, "data": b64}},
                    {"type": "text", "text": prompt or "请描述这张图片"},
                ],
            }
        ],
    }
    try:
        async with httpx.AsyncClient(timeout=120.0) as client:
            resp = await client.post(endpoint, headers=headers, json=payload)
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Claude image understand failed: {exc}") from exc
    if resp.status_code >= 400:
        raise HTTPException(status_code=502, detail=f"Claude image understand error {resp.status_code}: {resp.text[:300]}")

    data = resp.json()
    text = ((data.get("content") or [{}])[0].get("text") or "").strip()
    return {"status": "success", "task": "image_understand", "provider": "claude", "text": text}
