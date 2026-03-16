import asyncio
import base64
import hashlib
import hmac
import json
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


def _make_kling_jwt(access_key_id: str, secret_key: str) -> str:
    """用 AccessKeyId + SecretKey 生成可灵 JWT（HS256，有效期 30 分钟）。"""
    now = int(time.time())
    header = base64.urlsafe_b64encode(
        json.dumps({"alg": "HS256", "typ": "JWT"}, separators=(",", ":")).encode()
    ).rstrip(b"=").decode()
    payload = base64.urlsafe_b64encode(
        json.dumps({"iss": access_key_id, "exp": now + 1800, "nbf": now - 5}, separators=(",", ":")).encode()
    ).rstrip(b"=").decode()
    signing_input = f"{header}.{payload}"
    sig = hmac.new(secret_key.encode(), signing_input.encode(), hashlib.sha256).digest()
    signature = base64.urlsafe_b64encode(sig).rstrip(b"=").decode()
    return f"{signing_input}.{signature}"


def _build_kling_auth_header(api_key: str) -> str:
    """
    支持三种 API Key 格式：
      1. 官方复制格式：'Access Key: AR9M Secret Key: M8aT'  → 自动生成 JWT
      2. 简写格式：    'accessKeyId:secretKey'               → 自动生成 JWT
      3. 直接填 JWT token                                   → 直接使用
    """
    import re
    key = api_key.strip()
    # 官方格式：Access Key: <id> Secret Key: <secret>
    m = re.search(r'Access Key:\s*(\S+)\s+Secret Key:\s*(\S+)', key, re.IGNORECASE)
    if m:
        return _make_kling_jwt(m.group(1), m.group(2))
    # 简写格式：id:secret（不以 ey 开头，排除 JWT）
    if ":" in key and not key.startswith("ey"):
        parts = key.split(":", 1)
        return _make_kling_jwt(parts[0].strip(), parts[1].strip())
    return key


async def run_kling_video_gen(
    *,
    prompt: str,
    api_key: str,
    model: str = "kling-v1",
    duration: int = 5,
    mode: str = "t2v",
    image_bytes: Optional[bytes] = None,
    image_filename: str = "",
) -> Dict:
    require_httpx("kling video gen")
    if not api_key.strip():
        raise HTTPException(status_code=400, detail="api_key 是必填项（可灵 API Key）")

    token = _build_kling_auth_header(api_key)
    headers = {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json",
    }

    model_name = model or "kling-v1-5"
    # kling-v1 支持 std/pro；kling-v1-5 及以上只支持 pro
    gen_mode = "std" if model_name == "kling-v1" else "pro"

    if mode == "i2v" and image_bytes:
        # 图生视频
        img_b64 = base64.b64encode(image_bytes).decode()
        endpoint = f"{_KLING_BASE}/v1/videos/image2video"
        payload = {
            "model_name": model_name,
            "prompt": prompt,
            "image": img_b64,
            "duration": duration,
            "mode": gen_mode,
        }
    else:
        # 文生视频
        endpoint = f"{_KLING_BASE}/v1/videos/text2video"
        payload = {
            "model_name": model_name,
            "prompt": prompt,
            "duration": duration,
            "mode": gen_mode,
            "aspect_ratio": "16:9",
        }

    try:
        async with httpx.AsyncClient(timeout=60.0) as client:
            resp = await client.post(endpoint, headers=headers, json=payload)
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"可灵 API 请求失败: {exc}") from exc

    if resp.status_code >= 400:
        logger.error("[kling] API 错误 %s: %s", resp.status_code, resp.text[:500])
        raise HTTPException(status_code=502, detail=f"可灵 API 错误 {resp.status_code}: {resp.text[:300]}")

    data = resp.json()
    if data.get("code") != 0:
        raise HTTPException(status_code=502, detail=f"可灵 API 返回错误: {data.get('message', data)}")

    task_id = (data.get("data") or {}).get("task_id", "")
    if not task_id:
        raise HTTPException(status_code=502, detail="可灵 API 未返回 task_id")

    logger.info("[kling] task_id=%s, 等待视频生成…", task_id)

    # 轮询任务状态（i2v 和 t2v 使用不同查询接口）
    query_path = "image2video" if mode == "i2v" else "text2video"
    video_url = await _poll_kling_task(task_id, headers, query_path=query_path, timeout=600)

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


async def _poll_kling_task(task_id: str, headers: Dict, query_path: str = "text2video", timeout: int = 600) -> str:
    deadline = time.time() + timeout
    query_url = f"{_KLING_BASE}/v1/videos/{query_path}/{task_id}"
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
            await asyncio.sleep(5)
    raise HTTPException(status_code=504, detail="可灵视频生成超时（等待超过 10 分钟）")
