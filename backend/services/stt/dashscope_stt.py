"""DashScope STT — Paraformer 异步转录（阿里云）。
提交异步任务 → 轮询至完成 → 返回文本。
"""
import asyncio
import base64
from pathlib import Path
from typing import Dict

try:
    import httpx
except Exception:
    httpx = None

from fastapi import HTTPException

from utils.auth import require_httpx

DASHSCOPE_STT_SUBMIT = "https://dashscope.aliyuncs.com/api/v1/services/audio/asr/transcription"
DASHSCOPE_TASK_POLL  = "https://dashscope.aliyuncs.com/api/v1/tasks/{task_id}"


async def run_dashscope_stt(
    *,
    content: bytes,
    filename: str,
    api_key: str,
    model: str = "paraformer-realtime-v2",
) -> Dict:
    require_httpx("dashscope stt")
    if not api_key.strip():
        raise HTTPException(status_code=400, detail="api_key is required for DashScope STT")

    ext = Path(filename).suffix.lstrip(".").lower() or "wav"
    audio_b64 = base64.b64encode(content).decode()
    model_id = model.strip() or "paraformer-realtime-v2"

    headers = {
        "Authorization": f"Bearer {api_key.strip()}",
        "Content-Type": "application/json",
        "X-DashScope-Async": "enable",
    }
    payload = {
        "model": model_id,
        "input": {
            "audio": audio_b64,
            "format": ext,
        },
    }

    # ── 提交任务 ──
    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.post(DASHSCOPE_STT_SUBMIT, headers=headers, json=payload)
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"DashScope STT 提交失败: {exc}") from exc
    if resp.status_code >= 400:
        raise HTTPException(status_code=502, detail=f"DashScope STT 提交错误 {resp.status_code}: {resp.text[:300]}")

    try:
        submit_data = resp.json()
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"DashScope STT 提交响应解析失败: {exc}") from exc

    task_id = (submit_data.get("output") or {}).get("task_id", "")
    if not task_id:
        raise HTTPException(status_code=502, detail=f"DashScope STT 未返回 task_id: {submit_data}")

    # ── 轮询任务状态 ──
    poll_url = DASHSCOPE_TASK_POLL.format(task_id=task_id)
    poll_headers = {"Authorization": f"Bearer {api_key.strip()}"}
    result_text = ""
    for _ in range(60):  # 最多等 60 × 2s = 120s
        await asyncio.sleep(2)
        try:
            async with httpx.AsyncClient(timeout=15.0) as client:
                pr = await client.get(poll_url, headers=poll_headers)
        except Exception:
            continue
        if pr.status_code >= 400:
            continue
        try:
            pd = pr.json()
        except Exception:
            continue
        status = (pd.get("output") or {}).get("task_status", "")
        if status == "SUCCEEDED":
            results = (pd.get("output") or {}).get("results", [])
            if results:
                result_text = results[0].get("transcription", "")
            break
        if status == "FAILED":
            err = (pd.get("output") or {}).get("message", "未知错误")
            raise HTTPException(status_code=502, detail=f"DashScope STT 任务失败: {err}")

    if not result_text and result_text != "":
        raise HTTPException(status_code=502, detail="DashScope STT 超时或未返回转录结果")

    return {
        "status": "success",
        "task": "stt",
        "provider": "dashscope",
        "text": result_text,
    }
