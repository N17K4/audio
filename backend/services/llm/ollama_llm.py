from typing import Dict, List, Optional

try:
    import httpx
except Exception:
    httpx = None

from fastapi import HTTPException

from utils.auth import require_httpx


async def run_ollama_llm(*, prompt: str, model: str = "qwen2.5-coder:14b", base_url: str = "http://localhost:11434", messages: Optional[List[Dict]] = None) -> Dict:
    require_httpx("ollama llm")
    url = (base_url.rstrip("/") or "http://localhost:11434") + "/v1/chat/completions"
    msgs = messages if messages else [{"role": "user", "content": prompt}]
    payload = {"model": model or "qwen2.5-coder:14b", "messages": msgs}
    try:
        async with httpx.AsyncClient(timeout=120.0) as client:
            resp = await client.post(url, json=payload)
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Ollama LLM request failed: {exc}") from exc
    if resp.status_code >= 400:
        raise HTTPException(status_code=502, detail=f"Ollama LLM error {resp.status_code}: {resp.text[:300]}")
    try:
        data = resp.json()
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Ollama LLM parse failed: {exc}") from exc
    text = (((data.get("choices") or [{}])[0].get("message") or {}).get("content") or "").strip()
    return {"status": "success", "task": "llm", "provider": "ollama", "text": text, "raw": data}
