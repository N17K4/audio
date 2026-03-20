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
from utils.engine import get_gpt_sovits_command_template, build_engine_env
from utils.audit import log_ai_call, log_ai_error


def run_local_gpt_sovits_tts_cmd(
    text: str, output_path: Path, voice_refs: list = [], voice_meta: dict = None,
    text_lang: str = "auto", prompt_lang: str = "auto", ref_text: str = "",
    top_k: int = 15, top_p: float = 1.0, temperature: float = 1.0, speed: float = 1.0,
    repetition_penalty: float = 1.35, seed: int = -1,
    text_split_method: str = "cut5", batch_size: int = 1,
    parallel_infer: bool = True, fragment_interval: float = 0.3,
    sample_steps: int = 32,
) -> None:
    cmd_tpl = get_gpt_sovits_command_template()
    if not cmd_tpl:
        raise HTTPException(
            status_code=500,
            detail=(
                "[gpt_sovits] 未找到 GPT-SoVITS 引擎。"
                "请将 GPT-SoVITS 仓库放置于 runtime/gpt_sovits/engine/ 目录，"
                "或在 wrappers/gpt_sovits/engine.json 中配置 'command' 字段。"
            ),
        )
    import shlex
    refs_arg = " ".join(shlex.quote(r) for r in voice_refs if r) if voice_refs else '""'
    cmd = (
        cmd_tpl
        .replace("{text}", shlex.quote(text))
        .replace("{output}", str(output_path.resolve()))
        .replace("{voice_ref}", refs_arg)
    )
    # GPT-SoVITS 模型选择模式：通过 voice_meta 传递训练好的 GPT/SoVITS 模型路径
    if voice_meta:
        voice_dir = voice_meta.get("path", "")
        gpt_model = voice_meta.get("gpt_model", "")
        sovits_model = voice_meta.get("sovits_model", "")
        if voice_dir and gpt_model:
            gpt_path = str(Path(voice_dir) / gpt_model)
            cmd += f" --gpt_model {shlex.quote(gpt_path)}"
        if voice_dir and sovits_model:
            sovits_path = str(Path(voice_dir) / sovits_model)
            cmd += f" --sovits_model {shlex.quote(sovits_path)}"
        # voice_meta 中的 ref_text 作为默认值
        if not ref_text and voice_meta.get("ref_text"):
            ref_text = voice_meta["ref_text"]
    # 高级参数
    if text_lang and text_lang != "auto":
        cmd += f" --text_lang {shlex.quote(text_lang)}"
    if prompt_lang and prompt_lang != "auto":
        cmd += f" --prompt_lang {shlex.quote(prompt_lang)}"
    if ref_text:
        cmd += f" --ref_text {shlex.quote(ref_text)}"
    if top_k != 15:
        cmd += f" --top_k {int(top_k)}"
    if top_p != 1.0:
        cmd += f" --top_p {float(top_p)}"
    if temperature != 1.0:
        cmd += f" --temperature {float(temperature)}"
    if speed != 1.0:
        cmd += f" --speed {float(speed)}"
    if repetition_penalty != 1.35:
        cmd += f" --repetition_penalty {float(repetition_penalty)}"
    if seed != -1:
        cmd += f" --seed {int(seed)}"
    if text_split_method != "cut5":
        cmd += f" --text_split_method {shlex.quote(text_split_method)}"
    if batch_size != 1:
        cmd += f" --batch_size {int(batch_size)}"
    if not parallel_infer:
        cmd += " --no_parallel_infer"
    if fragment_interval != 0.3:
        cmd += f" --fragment_interval {float(fragment_interval)}"
    if sample_steps != 32:
        cmd += f" --sample_steps {int(sample_steps)}"
    log_ai_call("gpt_sovits", {"text": text, "output": str(output_path), "voice_refs": voice_refs}, command=cmd)
    try:
        completed = subprocess.run(
            cmd, shell=True, check=False, capture_output=True, text=True, timeout=1200,
            env=build_engine_env("gpt_sovits"), encoding="utf-8", errors="replace",
        )
    except subprocess.TimeoutExpired as exc:
        stdout = (exc.stdout or b"").decode(errors="replace").strip()[:10000] if exc.stdout else ""
        stderr = (exc.stderr or b"").decode(errors="replace").strip()[:10000] if exc.stderr else ""
        logger.error("GPT-SoVITS 超时（1200s）\ncmd: %s\nstdout: %s\nstderr: %s", cmd, stdout, stderr)
        log_ai_error("gpt_sovits", exc, stdout=stdout, stderr=stderr)
        raise HTTPException(status_code=500, detail=f"GPT-SoVITS command timed out after 1200s. stdout={stdout} stderr={stderr}") from exc
    except Exception as exc:
        logger.error("GPT-SoVITS 启动失败: %s\ncmd: %s", exc, cmd)
        raise HTTPException(status_code=500, detail=f"GPT-SoVITS command failed: {exc}") from exc
    if completed.returncode != 0:
        stdout = (completed.stdout or "").strip()[:10000]
        stderr = (completed.stderr or "").strip()[:10000]
        logger.error("GPT-SoVITS 失败 (code=%s)\nstdout: %s\nstderr: %s", completed.returncode, stdout, stderr)
        log_ai_error("gpt_sovits", RuntimeError("non-zero exit"), returncode=completed.returncode, stdout=stdout, stderr=stderr)
        raise HTTPException(status_code=500, detail=f"GPT-SoVITS failed (code={completed.returncode}): {stderr}")
    if not output_path.exists() or output_path.stat().st_size <= 0:
        logger.error("GPT-SoVITS 完成但输出文件缺失: %s", output_path)
        raise HTTPException(status_code=500, detail="GPT-SoVITS finished but output file is missing/empty")


async def run_gpt_sovits_tts(
    text: str, voice: str = "", voice_meta: dict = None, voice_refs: list = [],
    api_key: str = "", endpoint: str = "",
    text_lang: str = "auto", prompt_lang: str = "auto", ref_text: str = "",
    top_k: int = 15, top_p: float = 1.0, temperature: float = 1.0, speed: float = 1.0,
    repetition_penalty: float = 1.35, seed: int = -1,
    text_split_method: str = "cut5", batch_size: int = 1,
    parallel_infer: bool = True, fragment_interval: float = 0.3,
    sample_steps: int = 32,
) -> Dict:
    # Try local GPT-SoVITS CLI first
    local_cmd = get_gpt_sovits_command_template()
    if local_cmd:
        task_id = str(uuid.uuid4())
        output_path = DOWNLOAD_DIR / f"{task_id}_tts_gpt_sovits.wav"
        effective_refs = voice_refs if voice_refs else ([voice] if voice else [])
        await asyncio.to_thread(
            run_local_gpt_sovits_tts_cmd, text, output_path, effective_refs, voice_meta,
            text_lang, prompt_lang, ref_text,
            top_k, top_p, temperature, speed,
            repetition_penalty, seed, text_split_method, batch_size,
            parallel_infer, fragment_interval, sample_steps,
        )
        return {
            "status": "success",
            "task": "tts",
            "provider": "gpt_sovits",
            "result_url": f"http://{BACKEND_HOST}:{BACKEND_PORT}/download/{output_path.name}",
        }

    # 没有本地引擎时，仅当用户明确配置了 endpoint 才走 HTTP API
    if not endpoint.strip():
        raise HTTPException(
            status_code=400,
            detail=(
                "GPT-SoVITS 引擎未找到。"
                "请将 GPT-SoVITS 仓库放置于 runtime/gpt_sovits/engine/ 目录，"
                "或在 wrappers/gpt_sovits/engine.json 中配置 'command' 字段；"
                "如需调用 GPT-SoVITS HTTP 服务，请在设置中填写服务地址（endpoint）。"
            ),
        )
    require_httpx("gpt-sovits tts")
    headers = {"Content-Type": "application/json"}
    if api_key.strip():
        headers["Authorization"] = f"Bearer {api_key.strip()}"
    payload = {
        "text": text,
        "text_lang": text_lang or "auto",
        "prompt_lang": prompt_lang or "auto",
    }
    if ref_text:
        payload["prompt_text"] = ref_text
    if top_k != 15:
        payload["top_k"] = top_k
    if top_p != 1.0:
        payload["top_p"] = top_p
    if temperature != 1.0:
        payload["temperature"] = temperature
    if speed != 1.0:
        payload["speed_factor"] = speed
    if repetition_penalty != 1.35:
        payload["repetition_penalty"] = repetition_penalty
    if seed != -1:
        payload["seed"] = seed
    if text_split_method != "cut5":
        payload["text_split_method"] = text_split_method
    if batch_size != 1:
        payload["batch_size"] = batch_size
    if not parallel_infer:
        payload["parallel_infer"] = False
    if fragment_interval != 0.3:
        payload["fragment_interval"] = fragment_interval
    if sample_steps != 32:
        payload["sample_steps"] = sample_steps
    if voice_refs:
        payload["ref_audio_path"] = voice_refs[0]
    try:
        async with httpx.AsyncClient(timeout=120.0) as client:
            resp = await client.post(endpoint, headers=headers, json=payload)
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"GPT-SoVITS TTS request failed: {exc}") from exc
    if resp.status_code >= 400:
        raise HTTPException(status_code=502, detail=f"GPT-SoVITS TTS error {resp.status_code}: {resp.text[:300]}")
    content_type = resp.headers.get("content-type", "").lower()
    if "application/json" in content_type:
        try:
            data = resp.json()
            result_url = data.get("audio_url") or data.get("url")
            if result_url:
                return {"status": "success", "task": "tts", "provider": "gpt_sovits", "result_url": result_url}
        except Exception:
            pass
    task_id = str(uuid.uuid4())
    output_path = DOWNLOAD_DIR / f"{task_id}_tts_gpt_sovits.wav"
    with open(output_path, "wb") as f:
        f.write(resp.content)
    return {
        "status": "success",
        "task": "tts",
        "provider": "gpt_sovits",
        "result_url": f"http://{BACKEND_HOST}:{BACKEND_PORT}/download/{output_path.name}",
    }
