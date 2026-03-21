import asyncio
import subprocess
import uuid
from pathlib import Path
from typing import Dict

try:
    import httpx
except Exception:
    httpx = None

from fastapi import HTTPException

from config import DOWNLOAD_DIR, BACKEND_HOST, BACKEND_PORT
from logging_setup import logger
from utils.auth import require_httpx
from utils.engine import get_fish_speech_command_template, build_engine_env
from utils.audit import log_ai_call, log_ai_error


def run_local_fish_speech_tts_cmd(
    text: str, output_path: Path, voice_refs: list = [],
    top_p: float = 0.7, temperature: float = 0.7,
    repetition_penalty: float = 1.2, max_new_tokens: int = 1024,
) -> None:
    cmd_tpl = get_fish_speech_command_template()
    if not cmd_tpl:
        raise HTTPException(
            status_code=500,
            detail=(
                "[fish_speech] 未找到 Fish Speech 引擎。"
                "请将 fish-speech 仓库放置于 runtime/engine/fish_speech/ 目录，"
                "或在 backend/wrappers/fish_speech/engine.json 中配置 'command' 字段。"
                "（注意：fish-speech v2 需通过 API 服务器调用，请查看日志获取详细说明。）"
            ),
        )
    import shlex
    import sys as _sys
    _q = (lambda s: f'"{s}"') if _sys.platform == "win32" else shlex.quote
    refs_arg = " ".join(_q(r) for r in voice_refs if r) if voice_refs else '""'
    cmd = (
        cmd_tpl
        .replace("{text}", _q(text))
        .replace("{output}", str(output_path.resolve()))
        .replace("{voice_ref}", refs_arg)
    )
    if top_p != 0.7:
        cmd += f" --top_p {top_p}"
    if temperature != 0.7:
        cmd += f" --temperature {temperature}"
    if repetition_penalty != 1.2:
        cmd += f" --repetition_penalty {repetition_penalty}"
    if max_new_tokens != 1024:
        cmd += f" --max_new_tokens {max_new_tokens}"
    log_ai_call("fish_speech", {"text": text, "output": str(output_path), "voice_refs": voice_refs}, command=cmd)
    try:
        completed = subprocess.run(
            cmd, shell=True, check=False, capture_output=True, text=True, timeout=1200,
            env=build_engine_env("fish_speech"), encoding="utf-8", errors="replace",
        )
    except subprocess.TimeoutExpired as exc:
        stdout = (exc.stdout or b"").decode(errors="replace").strip()[:10000] if exc.stdout else ""
        stderr = (exc.stderr or b"").decode(errors="replace").strip()[:10000] if exc.stderr else ""
        logger.error("Fish Speech 超时（1200s）\ncmd: %s\nstdout: %s\nstderr: %s", cmd, stdout, stderr)
        log_ai_error("fish_speech", exc, stdout=stdout, stderr=stderr)
        raise HTTPException(status_code=500, detail=f"Fish Speech command timed out after 1200s. stdout={stdout} stderr={stderr}") from exc
    except Exception as exc:
        logger.error("Fish Speech 启动失败: %s\ncmd: %s", exc, cmd)
        raise HTTPException(status_code=500, detail=f"Fish Speech command failed: {exc}") from exc
    if completed.returncode != 0:
        stdout = (completed.stdout or "").strip()[:10000]
        stderr = (completed.stderr or "").strip()[:10000]
        logger.error("Fish Speech 失败 (code=%s)\nstdout: %s\nstderr: %s", completed.returncode, stdout, stderr)
        log_ai_error("fish_speech", RuntimeError("non-zero exit"), returncode=completed.returncode, stdout=stdout, stderr=stderr)
        raise HTTPException(status_code=500, detail=f"Fish Speech failed (code={completed.returncode}): {stderr}")
    if not output_path.exists() or output_path.stat().st_size <= 0:
        logger.error("Fish Speech 完成但输出文件缺失: %s", output_path)
        raise HTTPException(status_code=500, detail="Fish Speech finished but output file is missing/empty")


async def run_fish_speech_tts(
    text: str, voice: str = "", voice_refs: list = [], api_key: str = "", endpoint: str = "",
    top_p: float = 0.7, temperature: float = 0.7, repetition_penalty: float = 1.2, max_new_tokens: int = 1024,
) -> Dict:
    # Try local Fish Speech CLI first
    local_cmd = get_fish_speech_command_template()
    if local_cmd:
        task_id = str(uuid.uuid4())
        output_path = DOWNLOAD_DIR / f"{task_id}_tts_fish_speech.wav"
        effective_refs = voice_refs if voice_refs else ([voice] if voice else [])
        await asyncio.to_thread(
            run_local_fish_speech_tts_cmd, text, output_path, effective_refs,
            top_p=top_p, temperature=temperature,
            repetition_penalty=repetition_penalty, max_new_tokens=max_new_tokens,
        )
        return {
            "status": "success",
            "task": "tts",
            "provider": "fish_speech",
            "result_url": f"http://{BACKEND_HOST}:{BACKEND_PORT}/download/{output_path.name}",
        }

    # 没有本地引擎时，仅当用户明确配置了 endpoint 才走 HTTP API
    # （fish-speech v2 支持作为 HTTP 服务运行，但不默认假设 localhost:8080）
    if not endpoint.strip():
        raise HTTPException(
            status_code=400,
            detail=(
                "Fish Speech 引擎未找到。"
                "请将 fish-speech 仓库放置于 runtime/engine/fish_speech/ 目录，"
                "或在 backend/wrappers/fish_speech/engine.json 中配置 'command' 字段；"
                "如需调用 Fish Speech HTTP 服务，请在设置中填写服务地址（endpoint）。"
            ),
        )
    require_httpx("fish speech tts")
    headers = {"Content-Type": "application/json"}
    if api_key.strip():
        headers["Authorization"] = f"Bearer {api_key.strip()}"
    payload = {"text": text, "voice": voice or "default", "format": "wav"}
    try:
        async with httpx.AsyncClient(timeout=120.0) as client:
            resp = await client.post(endpoint, headers=headers, json=payload)
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Fish Speech TTS request failed: {exc}") from exc
    if resp.status_code >= 400:
        raise HTTPException(status_code=502, detail=f"Fish Speech TTS error {resp.status_code}: {resp.text[:300]}")
    content_type = resp.headers.get("content-type", "").lower()
    if "application/json" in content_type:
        try:
            data = resp.json()
            result_url = data.get("audio_url") or data.get("url")
            if result_url:
                return {"status": "success", "task": "tts", "provider": "fish_speech", "result_url": result_url}
        except Exception:
            pass
    task_id = str(uuid.uuid4())
    output_path = DOWNLOAD_DIR / f"{task_id}_tts_fish_speech.wav"
    with open(output_path, "wb") as f:
        f.write(resp.content)
    return {
        "status": "success",
        "task": "tts",
        "provider": "fish_speech",
        "result_url": f"http://{BACKEND_HOST}:{BACKEND_PORT}/download/{output_path.name}",
    }
