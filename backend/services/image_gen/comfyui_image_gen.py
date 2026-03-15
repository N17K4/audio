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

# 标准文生图 workflow（使用 ComfyUI 内置 SDXL 节点）
_TXT2IMG_WORKFLOW = {
    "3": {
        "class_type": "KSampler",
        "inputs": {
            "cfg": 7,
            "denoise": 1,
            "latent_image": ["5", 0],
            "model": ["4", 0],
            "negative": ["7", 0],
            "positive": ["6", 0],
            "sampler_name": "euler",
            "scheduler": "normal",
            "seed": 0,
            "steps": 20,
        },
    },
    "4": {
        "class_type": "CheckpointLoaderSimple",
        "inputs": {"ckpt_name": "PLACEHOLDER"},
    },
    "5": {
        "class_type": "EmptyLatentImage",
        "inputs": {"batch_size": 1, "height": 1024, "width": 1024},
    },
    "6": {
        "class_type": "CLIPTextEncode",
        "inputs": {"clip": ["4", 1], "text": "PLACEHOLDER"},
    },
    "7": {
        "class_type": "CLIPTextEncode",
        "inputs": {"clip": ["4", 1], "text": "low quality, bad anatomy"},
    },
    "8": {
        "class_type": "VAEDecode",
        "inputs": {"samples": ["3", 0], "vae": ["4", 2]},
    },
    "9": {
        "class_type": "SaveImage",
        "inputs": {"filename_prefix": "comfy_gen", "images": ["8", 0]},
    },
}


async def run_comfyui_image_gen(
    *, prompt: str, comfy_url: str = "http://127.0.0.1:8188",
    model: str = "", aspect_ratio: str = "1:1",
) -> Dict:
    if not httpx:
        raise HTTPException(status_code=500, detail="httpx 未安装，ComfyUI 调用不可用")

    # 解析宽高
    w, h = _parse_aspect(aspect_ratio)
    workflow = _build_workflow(prompt, model, w, h)
    client_id = str(uuid.uuid4())
    payload = {"prompt": workflow, "client_id": client_id}

    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.post(f"{comfy_url}/prompt", json=payload)
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"ComfyUI 连接失败: {exc}") from exc

    if resp.status_code >= 400:
        raise HTTPException(status_code=502, detail=f"ComfyUI 提交失败 {resp.status_code}: {resp.text[:300]}")

    prompt_id = resp.json().get("prompt_id", "")
    if not prompt_id:
        raise HTTPException(status_code=502, detail="ComfyUI 未返回 prompt_id")

    logger.info("[comfyui] prompt_id=%s, 等待完成…", prompt_id)

    # 轮询 /history/{prompt_id}
    outputs = await _poll_history(comfy_url, prompt_id, timeout=300)

    # 获取输出图片
    images = []
    for node_out in outputs.values():
        for img in (node_out.get("images") or []):
            images.append(img)

    if not images:
        raise HTTPException(status_code=502, detail="ComfyUI 生成完成但未找到输出图片")

    img_meta = images[0]
    filename = img_meta["filename"]
    subfolder = img_meta.get("subfolder", "")
    img_type = img_meta.get("type", "output")

    try:
        async with httpx.AsyncClient(timeout=60.0) as client:
            params = {"filename": filename, "subfolder": subfolder, "type": img_type}
            dl_resp = await client.get(f"{comfy_url}/view", params=params)
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"ComfyUI 下载图片失败: {exc}") from exc

    task_id = str(uuid.uuid4())[:8]
    output_path = DOWNLOAD_DIR / f"{task_id}_comfyui_gen.png"
    output_path.write_bytes(dl_resp.content)

    result_url = f"http://{BACKEND_HOST}:{BACKEND_PORT}/download/{output_path.name}"
    return {
        "status": "success",
        "task": "image_gen",
        "provider": "comfyui",
        "result_url": result_url,
        "result_text": "",
    }


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


def _parse_aspect(aspect_ratio: str) -> tuple:
    """将 aspect_ratio 字符串解析为 (width, height)。支持 '1:1'、'16:9'、'1024x1024' 等格式。"""
    if "x" in aspect_ratio:
        parts = aspect_ratio.split("x")
        return int(parts[0]), int(parts[1])
    if ":" in aspect_ratio:
        parts = aspect_ratio.split(":")
        ratio_w, ratio_h = int(parts[0]), int(parts[1])
        base = 1024
        # 保持总像素约 1M
        w = int(base * (ratio_w / max(ratio_w, ratio_h)) ** 0.5 * (ratio_w / ratio_h) ** 0.5)
        h = int(base * (ratio_h / max(ratio_w, ratio_h)) ** 0.5 * (ratio_h / ratio_w) ** 0.5)
        w = (w // 64) * 64 or 1024
        h = (h // 64) * 64 or 1024
        return w, h
    return 1024, 1024


def _build_workflow(prompt: str, model: str, w: int, h: int) -> Dict:
    import copy
    import random
    wf = copy.deepcopy(_TXT2IMG_WORKFLOW)
    wf["6"]["inputs"]["text"] = prompt
    wf["5"]["inputs"]["width"] = w
    wf["5"]["inputs"]["height"] = h
    wf["3"]["inputs"]["seed"] = random.randint(0, 2 ** 32 - 1)
    # 若未指定模型，用 ComfyUI 服务器上已加载的默认模型
    if model:
        wf["4"]["inputs"]["ckpt_name"] = model
    else:
        # 留一个无效占位符，ComfyUI 会报错提示可用模型；生产环境须填写
        wf["4"]["inputs"]["ckpt_name"] = model or "v1-5-pruned-emaonly.ckpt"
    return wf
