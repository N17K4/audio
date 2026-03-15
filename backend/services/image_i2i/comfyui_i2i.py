import asyncio
import time
import uuid
from typing import Dict

try:
    import httpx
except Exception:
    httpx = None

from fastapi import HTTPException

from config import BACKEND_HOST, BACKEND_PORT, DOWNLOAD_DIR
from logging_setup import logger

# img2img workflow（使用 ComfyUI VAEEncode + KSampler）
_IMG2IMG_WORKFLOW = {
    "1": {
        "class_type": "LoadImage",
        "inputs": {"image": "PLACEHOLDER_SOURCE", "upload": "image"},
    },
    "2": {
        "class_type": "LoadImage",
        "inputs": {"image": "PLACEHOLDER_REF", "upload": "image"},
    },
    "3": {
        "class_type": "CheckpointLoaderSimple",
        "inputs": {"ckpt_name": "v1-5-pruned-emaonly.ckpt"},
    },
    "4": {
        "class_type": "VAEEncode",
        "inputs": {"pixels": ["1", 0], "vae": ["3", 2]},
    },
    "5": {
        "class_type": "CLIPTextEncode",
        "inputs": {"clip": ["3", 1], "text": "PLACEHOLDER_PROMPT"},
    },
    "6": {
        "class_type": "CLIPTextEncode",
        "inputs": {"clip": ["3", 1], "text": "low quality, bad anatomy"},
    },
    "7": {
        "class_type": "KSampler",
        "inputs": {
            "cfg": 7,
            "denoise": 0.75,
            "latent_image": ["4", 0],
            "model": ["3", 0],
            "negative": ["6", 0],
            "positive": ["5", 0],
            "sampler_name": "euler",
            "scheduler": "normal",
            "seed": 0,
            "steps": 20,
        },
    },
    "8": {
        "class_type": "VAEDecode",
        "inputs": {"samples": ["7", 0], "vae": ["3", 2]},
    },
    "9": {
        "class_type": "SaveImage",
        "inputs": {"filename_prefix": "comfy_i2i", "images": ["8", 0]},
    },
}


async def run_comfyui_i2i(
    *, source_image_bytes: bytes, source_filename: str,
    prompt: str = "", strength: float = 0.75,
    comfy_url: str = "http://127.0.0.1:8188",
    model: str = "",
) -> Dict:
    if not httpx:
        raise HTTPException(status_code=500, detail="httpx 未安装")

    # 上传源图片到 ComfyUI
    upload_name = await _upload_image(comfy_url, source_image_bytes, source_filename)

    import copy, random
    wf = copy.deepcopy(_IMG2IMG_WORKFLOW)
    wf["1"]["inputs"]["image"] = upload_name
    wf["5"]["inputs"]["text"] = prompt or "high quality"
    wf["7"]["inputs"]["denoise"] = strength
    wf["7"]["inputs"]["seed"] = random.randint(0, 2 ** 32 - 1)
    if model:
        wf["3"]["inputs"]["ckpt_name"] = model

    client_id = str(uuid.uuid4())
    payload = {"prompt": wf, "client_id": client_id}

    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.post(f"{comfy_url}/prompt", json=payload)
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"ComfyUI 连接失败: {exc}") from exc

    if resp.status_code >= 400:
        raise HTTPException(status_code=502, detail=f"ComfyUI 提交失败: {resp.text[:300]}")

    prompt_id = resp.json().get("prompt_id", "")
    if not prompt_id:
        raise HTTPException(status_code=502, detail="ComfyUI 未返回 prompt_id")

    outputs = await _poll_history(comfy_url, prompt_id, timeout=300)
    images = []
    for node_out in outputs.values():
        for img in (node_out.get("images") or []):
            images.append(img)

    if not images:
        raise HTTPException(status_code=502, detail="ComfyUI 生成完成但未找到输出图片")

    img_meta = images[0]
    try:
        async with httpx.AsyncClient(timeout=60.0) as client:
            params = {
                "filename": img_meta["filename"],
                "subfolder": img_meta.get("subfolder", ""),
                "type": img_meta.get("type", "output"),
            }
            dl_resp = await client.get(f"{comfy_url}/view", params=params)
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"ComfyUI 下载图片失败: {exc}") from exc

    task_id = str(uuid.uuid4())[:8]
    output_path = DOWNLOAD_DIR / f"{task_id}_comfyui_i2i.png"
    output_path.write_bytes(dl_resp.content)

    result_url = f"http://{BACKEND_HOST}:{BACKEND_PORT}/download/{output_path.name}"
    return {
        "status": "success",
        "task": "image_i2i",
        "provider": "comfyui",
        "result_url": result_url,
        "result_text": "",
    }


async def _upload_image(comfy_url: str, image_bytes: bytes, filename: str) -> str:
    """上传图片到 ComfyUI /upload/image，返回上传后的文件名。"""
    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            files = {"image": (filename, image_bytes, "image/png")}
            resp = await client.post(f"{comfy_url}/upload/image", files=files)
        if resp.status_code >= 400:
            raise HTTPException(status_code=502, detail=f"ComfyUI 图片上传失败: {resp.text[:200]}")
        return resp.json().get("name", filename)
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"ComfyUI 图片上传失败: {exc}") from exc


async def _poll_history(comfy_url: str, prompt_id: str, timeout: int = 300) -> Dict:
    deadline = time.time() + timeout
    async with httpx.AsyncClient(timeout=10.0) as client:
        while time.time() < deadline:
            try:
                resp = await client.get(f"{comfy_url}/history/{prompt_id}")
                if resp.status_code == 200:
                    data = resp.json()
                    if prompt_id in data:
                        return data[prompt_id].get("outputs", {})
            except Exception:
                pass
            await asyncio.sleep(2)
    raise HTTPException(status_code=504, detail="ComfyUI 生成超时（等待超过 5 分钟）")
