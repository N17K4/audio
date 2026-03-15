import base64
from typing import Dict

try:
    import httpx
except Exception:
    httpx = None

from fastapi import HTTPException

from utils.auth import require_httpx


async def run_ollama_image_understand(
    *, image_content: bytes, prompt: str, model: str = "llava", base_url: str = "http://localhost:11434"
) -> Dict:
    require_httpx("ollama image understand")

    b64 = base64.b64encode(image_content).decode()
    endpoint = f"{base_url.rstrip('/')}/api/chat"
    payload = {
        "model": model or "llava",
        "messages": [
            {
                "role": "user",
                "content": prompt or "请描述这张图片",
                "images": [b64],
            }
        ],
        "stream": False,
    }
    try:
        async with httpx.AsyncClient(timeout=120.0) as client:
            resp = await client.post(endpoint, json=payload)
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Ollama image understand failed: {exc}") from exc
    if resp.status_code >= 400:
        raise HTTPException(status_code=502, detail=f"Ollama image understand error {resp.status_code}: {resp.text[:300]}")

    data = resp.json()
    text = ((data.get("message") or {}).get("content") or "").strip()
    return {"status": "success", "task": "image_understand", "provider": "ollama", "text": text}
