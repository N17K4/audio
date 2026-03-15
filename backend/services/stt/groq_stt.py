"""Groq Whisper STT — 与 OpenAI /audio/transcriptions 格式完全兼容，仅 base_url 不同。"""
from typing import Dict

try:
    import httpx
except Exception:
    httpx = None

from fastapi import HTTPException

from utils.auth import require_httpx

GROQ_STT_ENDPOINT = "https://api.groq.com/openai/v1/audio/transcriptions"


async def run_groq_stt(
    content: bytes,
    filename: str,
    api_key: str,
    model: str = "whisper-large-v3-turbo",
) -> Dict:
    require_httpx("groq stt")
    if not api_key.strip():
        raise HTTPException(status_code=400, detail="api_key is required for Groq STT")
    headers = {"Authorization": f"Bearer {api_key.strip()}"}
    files = {"file": (filename, content, "audio/webm")}
    data = {"model": model or "whisper-large-v3-turbo", "response_format": "json"}
    try:
        async with httpx.AsyncClient(timeout=180.0) as client:
            resp = await client.post(GROQ_STT_ENDPOINT, headers=headers, data=data, files=files)
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Groq STT 请求失败: {exc}") from exc
    if resp.status_code >= 400:
        raise HTTPException(status_code=502, detail=f"Groq STT 错误 {resp.status_code}: {resp.text[:300]}")
    try:
        payload = resp.json()
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Groq STT 解析失败: {exc}") from exc
    return {"status": "success", "task": "stt", "provider": "groq", "text": payload.get("text", ""), "raw": payload}
