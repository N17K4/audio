from typing import Dict, List, Optional

try:
    import httpx
except Exception:
    httpx = None

from fastapi import HTTPException

from utils.auth import require_httpx

ANTHROPIC_VERSION = "2023-06-01"


async def run_claude_llm(
    *,
    prompt: str,
    api_key: str,
    model: str = "claude-opus-4-5",
    messages: Optional[List[Dict]] = None,
) -> Dict:
    require_httpx("claude llm")
    if not api_key.strip():
        raise HTTPException(status_code=400, detail="api_key is required for Claude LLM")
    endpoint = "https://api.anthropic.com/v1/messages"
    headers = {
        "x-api-key": api_key.strip(),
        "anthropic-version": ANTHROPIC_VERSION,
        "content-type": "application/json",
    }
    msgs = messages if messages else [{"role": "user", "content": prompt}]
    payload = {"model": model or "claude-opus-4-5", "max_tokens": 4096, "messages": msgs}
    try:
        async with httpx.AsyncClient(timeout=120.0) as client:
            resp = await client.post(endpoint, headers=headers, json=payload)
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Claude LLM 请求失败: {exc}") from exc
    if resp.status_code >= 400:
        raise HTTPException(status_code=502, detail=f"Claude LLM 错误 {resp.status_code}: {resp.text[:300]}")
    try:
        data = resp.json()
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Claude LLM 解析失败: {exc}") from exc
    content_blocks = data.get("content") or []
    text = " ".join(b.get("text", "") for b in content_blocks if b.get("type") == "text").strip()
    return {"status": "success", "task": "llm", "provider": "claude", "text": text, "raw": data}
