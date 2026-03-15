from typing import Dict

try:
    import httpx
except Exception:
    httpx = None

from fastapi import HTTPException

from utils.auth import require_httpx


async def run_deepgram_stt(
    content: bytes,
    filename: str,
    api_key: str,
    model: str = "nova-3",
) -> Dict:
    require_httpx("deepgram stt")
    if not api_key.strip():
        raise HTTPException(status_code=400, detail="api_key is required for Deepgram STT")

    # 根据文件名推断 Content-Type
    ext = (filename.rsplit(".", 1)[-1].lower()) if "." in filename else "webm"
    mime_map = {
        "mp3": "audio/mpeg", "wav": "audio/wav", "flac": "audio/flac",
        "m4a": "audio/mp4", "ogg": "audio/ogg", "opus": "audio/ogg",
        "mp4": "video/mp4", "webm": "audio/webm",
    }
    content_type = mime_map.get(ext, "audio/webm")

    endpoint = f"https://api.deepgram.com/v1/listen?model={model}&language=multi&smart_format=true&punctuate=true"
    headers = {
        "Authorization": f"Token {api_key.strip()}",
        "Content-Type": content_type,
    }
    try:
        async with httpx.AsyncClient(timeout=180.0) as client:
            resp = await client.post(endpoint, headers=headers, content=content)
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Deepgram STT 请求失败: {exc}") from exc
    if resp.status_code >= 400:
        raise HTTPException(status_code=502, detail=f"Deepgram STT 错误 {resp.status_code}: {resp.text[:300]}")
    try:
        data = resp.json()
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Deepgram STT 解析失败: {exc}") from exc

    try:
        transcript = data["results"]["channels"][0]["alternatives"][0]["transcript"]
    except (KeyError, IndexError):
        transcript = ""

    return {"status": "success", "task": "stt", "provider": "deepgram", "text": transcript, "raw": data}
