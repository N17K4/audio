import subprocess
import uuid
from pathlib import Path
from typing import Dict, Optional

try:
    import httpx
except Exception:
    httpx = None

from fastapi import HTTPException

from config import APP_ROOT, DOWNLOAD_DIR, BACKEND_HOST, BACKEND_PORT, ELEVENLABS_BASE_URL, ELEVENLABS_STS_PATH_TEMPLATE
from logging_setup import logger
from utils.auth import parse_cloud_auth_header, require_httpx
from utils.engine import build_engine_env, get_default_rvc_command_template, get_seed_vc_command_template


def run_local_inference_or_raise(voice: Dict, input_path: Path, output_path: Path, extra_env: Optional[Dict] = None):
    """
    True local inference entrypoint.
    - inference_mode=copy: legacy fallback (debug only)
    - inference_mode=command: run user-provided command template from meta.json
      Supported placeholders:
      {input} {output} {model} {index} {voice_dir}
    """
    mode = (voice.get("inference_mode") or "copy").strip().lower()
    if mode == "copy":
        import shutil
        shutil.copy(input_path, output_path)
        return

    if mode != "command":
        raise HTTPException(status_code=400, detail=f"Unsupported inference_mode: {mode}")

    cmd_tpl = (voice.get("inference_command") or "").strip()
    if not cmd_tpl:
        cmd_tpl = get_default_rvc_command_template()
    if not cmd_tpl:
        raise HTTPException(
            status_code=400,
            detail=(
                "No inference command available. "
                "Put RVC infer script at runtime/rvc/infer_cli.py "
                "or configure models/rvc_runtime.json."
            ),
        )

    voice_dir = Path(voice["path"])
    model_file = voice.get("model_file")
    index_file = voice.get("index_file")
    model_path = str((voice_dir / model_file).resolve()) if model_file else ""
    index_path = str((voice_dir / index_file).resolve()) if index_file else ""

    def _q(p: str) -> str:
        """路径加引号（处理含空格的路径）。"""
        return f'"{p}"' if p else '""'

    cmd = (
        cmd_tpl.replace("{input}", _q(str(input_path.resolve())))
        .replace("{output}", _q(str(output_path.resolve())))
        .replace("{model}", _q(model_path))
        .replace("{index}", _q(index_path))
        .replace("{voice_dir}", _q(str(voice_dir.resolve())))
    )

    logger.debug("RVC 推理命令: %s", cmd)
    merged_env = build_engine_env("rvc")
    if extra_env:
        merged_env.update(extra_env)
    try:
        completed = subprocess.run(
            cmd,
            shell=True,
            check=False,
            capture_output=True,
            text=True,
            timeout=600,
            env=merged_env,
            cwd=str(APP_ROOT),  # fairseq/HuBERT 在 backend/ 目录下会 SIGSEGV，需从项目根目录启动
        )
    except Exception as exc:
        logger.error("RVC 推理命令执行异常: %s", exc)
        raise HTTPException(status_code=500, detail=f"Inference command execution failed: {exc}") from exc

    if completed.returncode != 0:
        stdout = (completed.stdout or "").strip()[:10000]
        stderr = (completed.stderr or "").strip()[:10000]
        logger.error("RVC 推理失败 (code=%s)\nstdout: %s\nstderr: %s", completed.returncode, stdout, stderr)
        raise HTTPException(
            status_code=500,
            detail=f"Inference command failed (code={completed.returncode}). stdout={stdout} stderr={stderr}",
        )
    logger.debug("RVC stdout: %s", (completed.stdout or "").strip()[:1000])
    if completed.stderr:
        logger.debug("RVC stderr: %s", (completed.stderr or "").strip()[:1000])

    if not output_path.exists() or output_path.stat().st_size <= 0:
        raise HTTPException(status_code=500, detail="Inference command finished but output file is missing/empty")


async def run_cloud_convert(
    *,
    content: bytes,
    filename: str,
    content_type: str,
    voice_id: str,
    provider: str,
    api_key: str,
    cloud_endpoint: str,
) -> Dict:
    require_httpx("cloud convert")
    use_provider = provider.strip().lower() or "custom"
    endpoint = cloud_endpoint.strip()
    if use_provider == "elevenlabs" and not endpoint:
        endpoint = f"{ELEVENLABS_BASE_URL}{ELEVENLABS_STS_PATH_TEMPLATE.format(voice_id=voice_id)}"
    if not endpoint:
        raise HTTPException(status_code=400, detail="cloud_endpoint is required in cloud mode")
    if not api_key.strip():
        raise HTTPException(status_code=400, detail="api_key is required in cloud mode")

    headers = {"X-Provider": use_provider}
    headers.update(parse_cloud_auth_header(use_provider, api_key))
    data = {}
    files = {"file": (filename, content, content_type or "application/octet-stream")}
    if use_provider != "elevenlabs":
        data["voice_id"] = voice_id

    try:
        async with httpx.AsyncClient(timeout=120.0) as client:
            resp = await client.post(endpoint, data=data, files=files, headers=headers)
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Cloud request failed: {exc}") from exc

    if resp.status_code >= 400:
        text = resp.text[:300]
        raise HTTPException(status_code=502, detail=f"Cloud provider error {resp.status_code}: {text}")

    content_type_resp = resp.headers.get("content-type", "").lower()
    if "application/json" in content_type_resp:
        try:
            payload = resp.json()
        except Exception as exc:
            raise HTTPException(status_code=502, detail=f"Cloud JSON parse failed: {exc}") from exc

        result_url = payload.get("result_url") or payload.get("url")
        if not result_url:
            raise HTTPException(status_code=502, detail="Cloud JSON response missing result_url/url")

        return {
            "status": "success",
            "message": "Converted by cloud provider",
            "provider": provider.strip() or "custom",
            "result_url": result_url,
            "cloud_response": payload,
        }

    # If cloud returns audio bytes directly, store and serve it from local /download.
    task_id = str(uuid.uuid4())
    output_ext = Path(filename).suffix or ".wav"
    output_path = DOWNLOAD_DIR / f"{task_id}_cloud_output{output_ext}"
    with open(output_path, "wb") as f:
        f.write(resp.content)

    return {
        "status": "success",
        "message": "Converted by cloud provider",
        "provider": provider.strip() or "custom",
        "result_url": f"http://{BACKEND_HOST}:{BACKEND_PORT}/download/{output_path.name}",
    }


def run_seed_vc_cmd(
    input_path: Path,
    output_path: Path,
    voice_ref: str = "",
    diffusion_steps: int = 10,
    pitch_shift: int = 0,
    f0_condition: bool = False,
    cfg_rate: float = 0.7,
    enable_postprocess: bool = True,
) -> None:
    cmd_tpl = get_seed_vc_command_template()
    if not cmd_tpl:
        raise HTTPException(
            status_code=400,
            detail=(
                "Seed-VC not found. Place seed-vc repo at runtime/seed_vc/ "
                "or configure runtime/seed_vc/engine.json with a 'command' template."
            ),
        )
    cmd = (
        cmd_tpl
        .replace("{input}", f'"{str(input_path.resolve())}"')
        .replace("{output}", f'"{str(output_path.resolve())}"')
        .replace("{voice_ref}", f'"{voice_ref}"' if voice_ref else '""')
    )
    # 追加高级参数（如果模板中无占位符则直接 append）
    extra_args = (
        f" --diffusion-steps {diffusion_steps}"
        f" --pitch-shift {pitch_shift}"
        f" --cfg-rate {cfg_rate}"
    )
    if f0_condition:
        extra_args += " --f0-condition"
    if not enable_postprocess:
        extra_args += " --no-postprocess"
    # 仅在模板无对应占位符时才追加（避免双重传递）
    if "{diffusion_steps}" not in cmd_tpl:
        cmd += extra_args
    logger.info("[Seed-VC] 启动子进程 (diffusion_steps=%s pitch_shift=%s f0=%s)", diffusion_steps, pitch_shift, f0_condition)
    logger.info("[Seed-VC] 输入: %s  参考: %s", input_path.name, Path(voice_ref).name if voice_ref else "(空)")
    try:
        completed = subprocess.run(
            cmd, shell=True, check=False, capture_output=True, text=True, timeout=1800,
            env=build_engine_env("seed_vc"),
        )
    except subprocess.TimeoutExpired as exc:
        stdout = (exc.stdout or b"").decode(errors="replace").strip()[:5000] if isinstance(exc.stdout, bytes) else (exc.stdout or "")[:5000]
        stderr = (exc.stderr or b"").decode(errors="replace").strip()[:5000] if isinstance(exc.stderr, bytes) else (exc.stderr or "")[:5000]
        logger.error("[Seed-VC] 超时 (1800s)\nstderr: %s\nstdout: %s", stderr, stdout)
        raise HTTPException(status_code=500, detail=f"Seed-VC 超时（1800s），请检查日志。stderr={stderr[:500]}") from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Seed-VC command failed: {exc}") from exc
    if completed.returncode != 0:
        stdout = (completed.stdout or "").strip()
        stderr = (completed.stderr or "").strip()
        logger.error("[Seed-VC] 失败 (code=%s)\nstderr (last 8000):\n%s\nstdout: %s", completed.returncode, stderr[-8000:], stdout[-2000:])
        raise HTTPException(status_code=500, detail=f"Seed-VC failed (code={completed.returncode}): {stderr}")
    if not output_path.exists() or output_path.stat().st_size <= 0:
        logger.error("[Seed-VC] 完成但输出文件缺失: %s", output_path)
        raise HTTPException(status_code=500, detail="Seed-VC finished but output file is missing/empty")
    logger.info("[Seed-VC] 完成，输出: %s (%.1f KB)", output_path.name, output_path.stat().st_size / 1024)
