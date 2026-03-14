import base64
from typing import Dict, List, Optional

try:
    import httpx
except Exception:
    httpx = None

from fastapi import HTTPException

from utils.auth import require_httpx


def extract_gemini_text(data: Dict) -> str:
    candidates = data.get("candidates") or []
    if not candidates:
        return ""
    parts = ((candidates[0] or {}).get("content") or {}).get("parts") or []
    chunks: List[str] = []
    for p in parts:
        t = p.get("text")
        if t:
            chunks.append(t)
    return "\n".join(chunks).strip()


async def run_gemini_llm(*, prompt: str, api_key: str, model: str = "gemini-2.5-flash", messages: Optional[List[Dict]] = None) -> Dict:
    require_httpx("gemini llm")
    if not api_key.strip():
        raise HTTPException(status_code=400, detail="api_key is required for gemini llm")
    endpoint = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={api_key.strip()}"
    # 将 OpenAI 格式的 messages 转为 Gemini contents 格式
    if messages:
        role_map = {"user": "user", "assistant": "model"}
        contents = [
            {"role": role_map.get(m.get("role", "user"), "user"), "parts": [{"text": m.get("content", "")}]}
            for m in messages
        ]
    else:
        contents = [{"parts": [{"text": prompt}]}]
    payload = {"contents": contents}
    try:
        async with httpx.AsyncClient(timeout=120.0) as client:
            resp = await client.post(endpoint, json=payload)
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Gemini LLM request failed: {exc}") from exc
    if resp.status_code >= 400:
        raise HTTPException(status_code=502, detail=f"Gemini LLM error {resp.status_code}: {resp.text[:300]}")
    try:
        data = resp.json()
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Gemini LLM parse failed: {exc}") from exc
    text = extract_gemini_text(data)
    return {"status": "success", "task": "llm", "provider": "gemini", "text": text, "raw": data}


async def run_gemini_audio_understanding(
    *,
    content: bytes,
    filename: str,
    content_type: str,
    prompt: str,
    api_key: str,
    model: str = "gemini-2.5-flash",
) -> Dict:
    require_httpx("gemini audio understanding")
    if not api_key.strip():
        raise HTTPException(status_code=400, detail="api_key is required for gemini audio understanding")
    endpoint = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={api_key.strip()}"
    audio_b64 = base64.b64encode(content).decode("ascii")
    payload = {
        "contents": [
            {
                "parts": [
                    {"text": prompt.strip() or "Summarize this audio."},
                    {
                        "inlineData": {
                            "mimeType": content_type or "audio/webm",
                            "data": audio_b64,
                        }
                    },
                ]
            }
        ]
    }
    try:
        async with httpx.AsyncClient(timeout=120.0) as client:
            resp = await client.post(endpoint, json=payload)
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Gemini audio-understanding request failed: {exc}") from exc
    if resp.status_code >= 400:
        raise HTTPException(
            status_code=502,
            detail=f"Gemini audio-understanding error {resp.status_code}: {resp.text[:300]}",
        )
    try:
        data = resp.json()
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Gemini audio-understanding parse failed: {exc}") from exc
    text = extract_gemini_text(data)
    return {
        "status": "success",
        "task": "audio_understanding",
        "provider": "gemini",
        "text": text,
        "prompt": prompt,
        "filename": filename,
        "raw": data,
    }


async def run_gemini_realtime_bootstrap(
    *,
    api_key: str,
    model: str = "gemini-2.0-flash-live-001",
    voice: str = "Kore",
) -> Dict:
    require_httpx("gemini realtime bootstrap")
    if not api_key.strip():
        raise HTTPException(status_code=400, detail="api_key is required for gemini realtime")

    # Minimal key/model probe so the UI can fail fast before user starts realtime client flow.
    probe_url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}?key={api_key.strip()}"
    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            probe_resp = await client.get(probe_url)
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Gemini realtime probe failed: {exc}") from exc
    if probe_resp.status_code >= 400:
        raise HTTPException(status_code=502, detail=f"Gemini realtime probe error {probe_resp.status_code}: {probe_resp.text[:300]}")

    ws_url = (
        "wss://generativelanguage.googleapis.com/ws/"
        "google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent"
        f"?key={api_key.strip()}"
    )
    setup_payload = {
        "model": f"models/{model}",
        "generationConfig": {
            "responseModalities": ["AUDIO"],
            "speechConfig": {
                "voiceConfig": {
                    "prebuiltVoiceConfig": {"voiceName": voice}
                }
            },
        },
    }
    return {
        "status": "success",
        "task": "realtime_dialogue",
        "provider": "gemini_live",
        "message": "Gemini live bootstrap ready. Use ws_url + setup payload in your realtime client.",
        "ws_url": ws_url,
        "setup": setup_payload,
    }
