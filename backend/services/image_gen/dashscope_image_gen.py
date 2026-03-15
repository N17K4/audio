import asyncio
import uuid
from typing import Dict

try:
    import httpx
except Exception:
    httpx = None

from fastapi import HTTPException

from config import BACKEND_HOST, BACKEND_PORT, DOWNLOAD_DIR
from utils.auth import require_httpx


async def run_dashscope_image_gen(
    *, prompt: str, api_key: str, model: str = "wanx2.1-t2i-turbo", size: str = "1024*1024"
) -> Dict:
    require_httpx("dashscope image gen")
    if not api_key.strip():
        raise HTTPException(status_code=400, detail="api_key is required for DashScope image generation")

    submit_url = "https://dashscope.aliyuncs.com/api/v1/services/aigc/text2image/image-synthesis"
    headers = {
        "Authorization": f"Bearer {api_key.strip()}",
        "Content-Type": "application/json",
        "X-DashScope-Async": "enable",
    }
    payload = {
        "model": model or "wanx2.1-t2i-turbo",
        "input": {"prompt": prompt},
        "parameters": {"size": size or "1024*1024", "n": 1},
    }
    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.post(submit_url, headers=headers, json=payload)
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"DashScope submit failed: {exc}") from exc
    if resp.status_code >= 400:
        raise HTTPException(status_code=502, detail=f"DashScope error {resp.status_code}: {resp.text[:300]}")

    data = resp.json()
    task_id = (data.get("output") or {}).get("task_id")
    if not task_id:
        raise HTTPException(status_code=502, detail=f"DashScope returned no task_id: {data}")

    poll_url = f"https://dashscope.aliyuncs.com/api/v1/tasks/{task_id}"
    poll_headers = {"Authorization": f"Bearer {api_key.strip()}"}

    for _ in range(60):
        await asyncio.sleep(3)
        try:
            async with httpx.AsyncClient(timeout=30.0) as client:
                poll_resp = await client.get(poll_url, headers=poll_headers)
        except Exception as exc:
            raise HTTPException(status_code=502, detail=f"DashScope poll failed: {exc}") from exc

        poll_data = poll_resp.json()
        status = (poll_data.get("output") or {}).get("task_status", "")

        if status == "SUCCEEDED":
            results = (poll_data.get("output") or {}).get("results") or []
            if not results:
                raise HTTPException(status_code=502, detail="DashScope SUCCEEDED but no results")
            url = results[0].get("url", "")
            if not url:
                raise HTTPException(status_code=502, detail="DashScope result has no URL")
            try:
                async with httpx.AsyncClient(timeout=60.0) as client:
                    img_resp = await client.get(url)
                img_data = img_resp.content
            except Exception as exc:
                raise HTTPException(status_code=502, detail=f"Failed to download DashScope image: {exc}") from exc

            file_id = str(uuid.uuid4())[:8]
            output_path = DOWNLOAD_DIR / f"{file_id}_img_gen.png"
            output_path.write_bytes(img_data)
            result_url = f"http://{BACKEND_HOST}:{BACKEND_PORT}/download/{output_path.name}"
            return {"status": "success", "task": "image_gen", "provider": "dashscope", "result_url": result_url}

        if status in ("FAILED", "CANCELED"):
            raise HTTPException(status_code=502, detail=f"DashScope task {status}: {poll_data}")

    raise HTTPException(status_code=504, detail="DashScope image generation timed out (180s)")
