"""OpenAI-compatible LLM helper — 复用于 Groq / DeepSeek / Mistral / xAI 等兼容 provider。"""
from typing import Dict, List, Optional

try:
    import httpx
except Exception:
    httpx = None

from fastapi import HTTPException

from utils.auth import require_httpx


async def run_openai_compat_llm(
    *,
    prompt: str,
    api_key: str,
    model: str,
    messages: Optional[List[Dict]],
    base_url: str,
    provider_name: str,
) -> Dict:
    require_httpx(f"{provider_name} llm")
    if not api_key.strip():
        raise HTTPException(status_code=400, detail=f"api_key is required for {provider_name} llm")
    endpoint = f"{base_url.rstrip('/')}/chat/completions"
    headers = {"Authorization": f"Bearer {api_key.strip()}", "Content-Type": "application/json"}
    msgs = messages if messages else [{"role": "user", "content": prompt}]
    payload = {"model": model, "messages": msgs}
    try:
        async with httpx.AsyncClient(timeout=120.0) as client:
            resp = await client.post(endpoint, headers=headers, json=payload)
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"{provider_name} LLM 请求失败: {exc}") from exc
    if resp.status_code >= 400:
        raise HTTPException(status_code=502, detail=f"{provider_name} LLM 错误 {resp.status_code}: {resp.text[:300]}")
    try:
        data = resp.json()
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"{provider_name} LLM 解析失败: {exc}") from exc
    text = (((data.get("choices") or [{}])[0].get("message") or {}).get("content") or "").strip()
    return {"status": "success", "task": "llm", "provider": provider_name, "text": text, "raw": data}
