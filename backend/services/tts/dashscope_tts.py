"""DashScope TTS — CosyVoice 2（阿里云）。
提交异步任务 → 轮询至完成 → 下载音频文件。
"""
import asyncio
import uuid
from typing import Dict

try:
    import httpx
except Exception:
    httpx = None

from fastapi import HTTPException

from config import DOWNLOAD_DIR
from utils.auth import require_httpx

DASHSCOPE_TTS_SUBMIT = "https://dashscope.aliyuncs.com/api/v1/services/aigc/text2audio/generation"
DASHSCOPE_TASK_POLL  = "https://dashscope.aliyuncs.com/api/v1/tasks/{task_id}"

DEFAULT_VOICE = "longxiaochun_v2"   # 龙小淳 v2，CosyVoice 2 中文精品音色


async def run_dashscope_tts(
    *,
    text: str,
    api_key: str,
    voice: str = "",
    model: str = "cosyvoice-v2",
) -> Dict:
    require_httpx("dashscope tts")
    if not api_key.strip():
        raise HTTPException(status_code=400, detail="api_key is required for DashScope TTS")

    voice_id = voice.strip() or DEFAULT_VOICE
    model_id = model.strip() or "cosyvoice-v2"

    headers = {
        "Authorization": f"Bearer {api_key.strip()}",
        "Content-Type": "application/json",
        "X-DashScope-Async": "enable",
    }
    payload = {
        "model": model_id,
        "input": {"text": text, "voice": voice_id},
        "parameters": {"format": "mp3", "sample_rate": 22050, "volume": 50, "rate": 1.0, "pitch": 1.0},
    }

    # ── 提交任务 ──
    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.post(DASHSCOPE_TTS_SUBMIT, headers=headers, json=payload)
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"DashScope TTS 提交失败: {exc}") from exc
    if resp.status_code >= 400:
        raise HTTPException(status_code=502, detail=f"DashScope TTS 提交错误 {resp.status_code}: {resp.text[:300]}")

    try:
        submit_data = resp.json()
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"DashScope TTS 提交响应解析失败: {exc}") from exc

    task_id = (submit_data.get("output") or {}).get("task_id", "")
    if not task_id:
        raise HTTPException(status_code=502, detail=f"DashScope TTS 未返回 task_id: {submit_data}")

    # ── 轮询任务状态 ──
    poll_url = DASHSCOPE_TASK_POLL.format(task_id=task_id)
    poll_headers = {"Authorization": f"Bearer {api_key.strip()}"}
    audio_url = ""
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
            audio_url = (pd.get("output") or {}).get("audio_address", "")
            break
        if status == "FAILED":
            err = (pd.get("output") or {}).get("message", "未知错误")
            raise HTTPException(status_code=502, detail=f"DashScope TTS 任务失败: {err}")

    if not audio_url:
        raise HTTPException(status_code=502, detail="DashScope TTS 超时或未返回音频地址")

    # ── 下载音频 ──
    try:
        async with httpx.AsyncClient(timeout=60.0) as client:
            audio_resp = await client.get(audio_url)
        audio_resp.raise_for_status()
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"DashScope TTS 音频下载失败: {exc}") from exc

    out_path = DOWNLOAD_DIR / f"tts_{uuid.uuid4().hex[:8]}.mp3"
    out_path.write_bytes(audio_resp.content)
    return {"status": "success", "task": "tts", "provider": "dashscope", "result_url": f"/download/{out_path.name}"}
