"""MiniMax TTS — t2a_v2 REST API。
凭证格式：api_key 字段填 `{group_id}:{api_key}`，后端拆分使用。
"""
import uuid
from typing import Dict

try:
    import httpx
except Exception:
    httpx = None

from fastapi import HTTPException

from config import DOWNLOAD_DIR
from utils.auth import require_httpx

MINIMAX_TTS_URL = "https://api.minimax.chat/v1/t2a_v2"

DEFAULT_VOICE = "male-qn-qingse"   # MiniMax 默认男声


async def run_minimax_tts(
    *,
    text: str,
    api_key: str,
    voice: str = "",
    model: str = "speech-02-hd",
) -> Dict:
    require_httpx("minimax tts")
    raw = api_key.strip()
    if not raw:
        raise HTTPException(status_code=400, detail="MiniMax TTS 需要凭证，格式：{group_id}:{api_key}")

    if ":" not in raw:
        raise HTTPException(
            status_code=400,
            detail="MiniMax TTS 凭证格式错误，请填写 {group_id}:{api_key}（在 MiniMax 控制台获取）",
        )
    group_id, real_key = raw.split(":", 1)
    group_id = group_id.strip()
    real_key = real_key.strip()
    if not group_id or not real_key:
        raise HTTPException(status_code=400, detail="MiniMax TTS 凭证格式错误：group_id 或 api_key 为空")

    model_id = model.strip() or "speech-02-hd"
    voice_id = voice.strip() or DEFAULT_VOICE

    headers = {
        "Authorization": f"Bearer {real_key}",
        "Content-Type": "application/json",
    }
    payload = {
        "model": model_id,
        "text": text,
        "stream": False,
        "voice_setting": {
            "voice_id": voice_id,
            "speed": 1.0,
            "vol": 1.0,
            "pitch": 0,
        },
        "audio_setting": {
            "sample_rate": 32000,
            "bitrate": 128000,
            "format": "mp3",
        },
    }

    try:
        async with httpx.AsyncClient(timeout=60.0) as client:
            resp = await client.post(
                f"{MINIMAX_TTS_URL}?GroupId={group_id}",
                headers=headers,
                json=payload,
            )
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"MiniMax TTS 请求失败: {exc}") from exc

    if resp.status_code >= 400:
        raise HTTPException(status_code=502, detail=f"MiniMax TTS 错误 {resp.status_code}: {resp.text[:300]}")

    try:
        data = resp.json()
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"MiniMax TTS 响应解析失败: {exc}") from exc

    # 检查业务错误码
    base_resp = data.get("base_resp") or {}
    if base_resp.get("status_code", 0) != 0:
        raise HTTPException(
            status_code=502,
            detail=f"MiniMax TTS 业务错误 {base_resp.get('status_code')}: {base_resp.get('status_msg', '未知错误')}",
        )

    # 音频数据为 hex 编码
    audio_hex = (data.get("data") or {}).get("audio", "")
    if not audio_hex:
        raise HTTPException(status_code=502, detail=f"MiniMax TTS 未返回音频数据: {data}")

    try:
        audio_bytes = bytes.fromhex(audio_hex)
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"MiniMax TTS 音频 hex 解码失败: {exc}") from exc

    out_path = DOWNLOAD_DIR / f"tts_{uuid.uuid4().hex[:8]}.mp3"
    out_path.write_bytes(audio_bytes)
    return {"status": "success", "task": "tts", "provider": "minimax_tts", "result_url": f"/download/{out_path.name}"}
