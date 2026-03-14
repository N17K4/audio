from typing import Dict

try:
    import httpx
except Exception:
    httpx = None

from fastapi import HTTPException

from utils.auth import require_httpx
from services.stt.openai_stt import run_openai_stt


async def run_openai_audio_understanding(
    *,
    content: bytes,
    filename: str,
    content_type: str,
    prompt: str,
    api_key: str,
    stt_model: str = "gpt-4o-mini-transcribe",
    model: str = "gpt-4o-mini",
) -> Dict:
    require_httpx("openai audio understanding")
    if not api_key.strip():
        raise HTTPException(status_code=400, detail="api_key is required for openai audio understanding")

    stt = await run_openai_stt(content=content, filename=filename, api_key=api_key, model=stt_model)
    transcript = (stt.get("text") or "").strip()
    if not transcript:
        raise HTTPException(status_code=502, detail="OpenAI STT returned empty transcript for audio understanding")

    endpoint = "https://api.openai.com/v1/chat/completions"
    headers = {"Authorization": f"Bearer {api_key.strip()}", "Content-Type": "application/json"}
    user_prompt = prompt.strip() or "Summarize this audio."
    completion_payload = {
        "model": model,
        "messages": [
            {"role": "system", "content": "You analyze audio transcripts and return concise, accurate results."},
            {"role": "user", "content": f"{user_prompt}\n\nTranscript:\n{transcript}"},
        ],
        "temperature": 0.2,
    }
    try:
        async with httpx.AsyncClient(timeout=120.0) as client:
            resp = await client.post(endpoint, headers=headers, json=completion_payload)
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"OpenAI audio-understanding request failed: {exc}") from exc
    if resp.status_code >= 400:
        raise HTTPException(
            status_code=502,
            detail=f"OpenAI audio-understanding error {resp.status_code}: {resp.text[:300]}",
        )
    try:
        data = resp.json()
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"OpenAI audio-understanding parse failed: {exc}") from exc

    text = (
        ((data.get("choices") or [{}])[0].get("message") or {}).get("content")
        or ""
    ).strip()

    return {
        "status": "success",
        "task": "audio_understanding",
        "provider": "openai",
        "text": text,
        "prompt": user_prompt,
        "transcript": transcript,
        "filename": filename,
        "content_type": content_type,
        "raw": data,
    }


async def run_openai_realtime_bootstrap(
    *,
    api_key: str,
    model: str = "gpt-4o-realtime-preview",
    voice: str = "alloy",
) -> Dict:
    require_httpx("openai realtime bootstrap")
    if not api_key.strip():
        raise HTTPException(status_code=400, detail="api_key is required for openai realtime")

    endpoint = "https://api.openai.com/v1/realtime/sessions"
    headers = {"Authorization": f"Bearer {api_key.strip()}", "Content-Type": "application/json"}
    payload = {
        "model": model,
        "voice": voice,
    }
    try:
        async with httpx.AsyncClient(timeout=60.0) as client:
            resp = await client.post(endpoint, headers=headers, json=payload)
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"OpenAI realtime bootstrap request failed: {exc}") from exc
    if resp.status_code >= 400:
        raise HTTPException(status_code=502, detail=f"OpenAI realtime bootstrap error {resp.status_code}: {resp.text[:300]}")
    try:
        data = resp.json()
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"OpenAI realtime bootstrap parse failed: {exc}") from exc

    client_secret = ((data.get("client_secret") or {}).get("value")) or ""
    expires_at = ((data.get("client_secret") or {}).get("expires_at")) or data.get("expires_at")
    ws_url = f"wss://api.openai.com/v1/realtime?model={model}"
    return {
        "status": "success",
        "task": "realtime_dialogue",
        "provider": "openai_realtime",
        "message": "OpenAI realtime bootstrap ready. Use client_secret with ws_url in your realtime client.",
        "ws_url": ws_url,
        "client_secret": client_secret,
        "expires_at": expires_at,
        "raw": data,
    }
