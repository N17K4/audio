from typing import Dict, List, Optional

try:
    import httpx
except Exception:
    httpx = None

from fastapi import HTTPException

from utils.auth import require_httpx


async def run_github_llm(*, prompt: str, api_key: str, model: str = "gpt-4o-mini", messages: Optional[List[Dict]] = None) -> Dict:
    require_httpx("github llm")
    if not api_key.strip():
        raise HTTPException(status_code=400, detail="api_key is required for github models llm")
    endpoint = "https://models.inference.ai.azure.com/chat/completions"
    headers = {"Authorization": f"Bearer {api_key.strip()}", "Content-Type": "application/json"}
    msgs = messages if messages else [{"role": "user", "content": prompt}]
    payload = {"model": model or "gpt-4o-mini", "messages": msgs}
    try:
        async with httpx.AsyncClient(timeout=120.0) as client:
            resp = await client.post(endpoint, headers=headers, json=payload)
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"GitHub Models LLM request failed: {exc}") from exc
    if resp.status_code >= 400:
        raise HTTPException(status_code=502, detail=f"GitHub Models LLM error {resp.status_code}: {resp.text[:300]}")
    try:
        data = resp.json()
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"GitHub Models LLM parse failed: {exc}") from exc
    text = (((data.get("choices") or [{}])[0].get("message") or {}).get("content") or "").strip()
    return {"status": "success", "task": "llm", "provider": "github", "text": text, "raw": data}
