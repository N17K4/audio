import base64
import time
import uuid
from typing import Dict, Optional

try:
    import httpx
except Exception:
    httpx = None

from fastapi import HTTPException

from config import BACKEND_HOST, BACKEND_PORT, DOWNLOAD_DIR
from logging_setup import logger
from utils.auth import require_httpx

_KLING_BASE = "https://api.klingai.com"


async def run_kling_video_gen(
    *,
    prompt: str,
    api_key: str,
    model: str = "kling-v2",
    duration: int = 5,
    mode: str = "t2v",
    image_bytes: Optional[bytes] = None,
    image_filename: str = "",
) -> Dict:
    require_httpx("kling video gen")
    if not api_key.strip():
        raise HTTPException(status_code=400, detail="api_key 是必填项（可灵 API Key）")

    headers = {
        "Authorization": f"Bearer {api_key.strip()}",
        "Content-Type": "application/json",
    }

    if mode == "i2v" and image_bytes:
        # 图生视频
        img_b64 = base64.b64encode(image_bytes).decode()
        endpoint = f"{_KLING_BASE}/v1/videos/image2video"
        payload = {
            "model_name": model or "kling-v2",
            "prompt": prompt,
            "image": img_b64,
            "duration": str(duration),
            "mode": "std",
        }
    else:
        # 文生视频
        endpoint = f"{_KLING_BASE}/v1/videos/text2video"
        payload = {
            "model_name": model or "kling-v2",
            "prompt": prompt,
            "duration": str(duration),
            "mode": "std",
            "aspect_ratio": "16:9",
        }

    try:
        async with httpx.AsyncClient(timeout=60.0) as client:
            resp = await client.post(endpoint, headers=headers, json=payload)
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"可灵 API 请求失败: {exc}") from exc

    if resp.status_code >= 400:
        raise HTTPException(status_code=502, detail=f"可灵 API 错误 {resp.status_code}: {resp.text[:300]}")

    data = resp.json()
    if data.get("code") != 0:
        raise HTTPException(status_code=502, detail=f"可灵 API 返回错误: {data.get('message', data)}")

    task_id = (data.get("data") or {}).get("task_id", "")
    if not task_id:
        raise HTTPException(status_code=502, detail="可灵 API 未返回 task_id")

    logger.info("[kling] task_id=%s, 等待视频生成…", task_id)

    # 轮询任务状态
    video_url = await _poll_kling_task(task_id, headers, timeout=600)

    # 下载视频
    try:
        async with httpx.AsyncClient(timeout=120.0) as client:
            dl_resp = await client.get(video_url)
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"可灵视频下载失败: {exc}") from exc

    file_id = str(uuid.uuid4())[:8]
    output_path = DOWNLOAD_DIR / f"{file_id}_kling_video.mp4"
    output_path.write_bytes(dl_resp.content)

    result_url = f"http://{BACKEND_HOST}:{BACKEND_PORT}/download/{output_path.name}"
    return {
        "status": "success",
        "task": "video_gen",
        "provider": "kling",
        "result_url": result_url,
        "result_text": "",
    }


async def _poll_kling_task(task_id: str, headers: Dict, timeout: int = 600) -> str:
    deadline = time.time() + timeout
    query_url = f"{_KLING_BASE}/v1/videos/text2video/{task_id}"
    async with httpx.AsyncClient(timeout=30.0) as client:
        while time.time() < deadline:
            try:
                resp = await client.get(query_url, headers=headers)
                if resp.status_code == 200:
                    data = resp.json()
                    task_data = (data.get("data") or {})
                    status = task_data.get("task_status", "")
                    if status == "succeed":
                        works = task_data.get("task_result", {}).get("videos", [])
                        if works:
                            return works[0].get("url", "")
                        raise HTTPException(status_code=502, detail="可灵任务完成但未找到视频 URL")
                    if status == "failed":
                        msg = task_data.get("task_status_msg", "未知错误")
                        raise HTTPException(status_code=502, detail=f"可灵视频生成失败: {msg}")
            except HTTPException:
                raise
            except Exception:
                pass
            import asyncio
            await asyncio.sleep(5)
    raise HTTPException(status_code=504, detail="可灵视频生成超时（等待超过 10 分钟）")
