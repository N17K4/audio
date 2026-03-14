import asyncio
import base64
import json
import logging
import logging.handlers
import os
import shutil
import subprocess
import tempfile
import traceback
import uuid
from datetime import datetime
from pathlib import Path
from typing import Dict, List, Optional

try:
    import httpx
except Exception:
    httpx = None

import uvicorn
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

app = FastAPI()
BACKEND_HOST = os.getenv("BACKEND_HOST", "127.0.0.1")
BACKEND_PORT = int(os.getenv("BACKEND_PORT", "8000"))

APP_ROOT = Path(__file__).resolve().parent.parent
# 打包后 Electron 传入 RESOURCES_ROOT=process.resourcesPath（Contents/Resources/）
# dev 模式下默认为项目根目录（runtime/、checkpoints/ 均在此处）
RESOURCES_ROOT = Path(os.getenv("RESOURCES_ROOT", str(APP_ROOT))).resolve()
RUNTIME_ROOT = RESOURCES_ROOT / "runtime"

MODEL_ROOT = Path(os.getenv("MODEL_ROOT", str(APP_ROOT / "models"))).resolve()
VOICES_DIR = MODEL_ROOT / "voices"
UPLOADS_DIR = MODEL_ROOT / "uploads"
RVC_RUNTIME_CONFIG_PATH = MODEL_ROOT / "rvc_runtime.json"
FISH_SPEECH_ENGINE_JSON = RUNTIME_ROOT / "fish_speech" / "engine.json"
SEED_VC_ENGINE_JSON = RUNTIME_ROOT / "seed_vc" / "engine.json"
WHISPER_ENGINE_JSON = RUNTIME_ROOT / "whisper" / "engine.json"

RUNTIME_TEMP_DIR = Path(tempfile.gettempdir()) / "ai-tool-temp"
DOWNLOAD_DIR = RUNTIME_TEMP_DIR / "download"
TRAIN_DATA_DIR = RUNTIME_TEMP_DIR / "train-data"
# dev + prod 统一：Electron 传入 LOGS_DIR 环境变量；未传则回退到 APP_ROOT/logs/
_LOGS_DIR_ENV = os.getenv("LOGS_DIR", "").strip()
LOGS_DIR: Path = Path(_LOGS_DIR_ENV).resolve() if _LOGS_DIR_ENV else (APP_ROOT / "logs")

for d in [VOICES_DIR, UPLOADS_DIR, DOWNLOAD_DIR, TRAIN_DATA_DIR, LOGS_DIR]:
    d.mkdir(parents=True, exist_ok=True)

# ─── Manifest（产物固化清单）────────────────────────────────────────────────────
_MANIFEST_PATH = RUNTIME_ROOT / "manifest.json"


def _load_manifest() -> Dict:
    if _MANIFEST_PATH.exists():
        try:
            return json.loads(_MANIFEST_PATH.read_text(encoding="utf-8-sig"))
        except Exception as e:
            logger.warning("manifest.json 读取失败: %s", e)
    return {}


_MANIFEST: Dict = _load_manifest()


def get_checkpoint_dir(engine: str) -> str:
    """从 manifest 读取引擎的 checkpoint 目录，返回绝对路径字符串。
    env_key 环境变量优先于 manifest 配置。"""
    engines = (_MANIFEST.get("engines") or {})
    cfg = engines.get(engine, {})
    env_key = cfg.get("env_key") or f"{engine.upper()}_CHECKPOINT_DIR"
    env_val = os.getenv(env_key, "").strip()
    if env_val:
        return env_val
    rel = cfg.get("checkpoint_dir", f"checkpoints/{engine}")
    return str((RESOURCES_ROOT / rel).resolve())


def build_engine_env(engine: str) -> Dict[str, str]:
    """为子进程构建包含 CHECKPOINT_DIR 注入的环境变量字典。"""
    engines = (_MANIFEST.get("engines") or {})
    cfg = engines.get(engine, {})
    env_key = cfg.get("env_key") or f"{engine.upper()}_CHECKPOINT_DIR"
    # HF 缓存统一指向 checkpoints/hf_cache（绝对路径，避免相对路径错位）
    hf_cache = str(RESOURCES_ROOT / "checkpoints" / "hf_cache")
    merged = {
        **os.environ,
        env_key: get_checkpoint_dir(engine),
        "HF_HUB_CACHE": hf_cache,
        "HUGGINGFACE_HUB_CACHE": hf_cache,   # 兼容旧版
        "TOKENIZERS_PARALLELISM": "false",
    }
    # 所有引擎都强制离线：额外模型须通过 pnpm run checkpoints 预先下载
    merged["HF_HUB_OFFLINE"] = "1"
    merged["TRANSFORMERS_OFFLINE"] = "1"
    return merged


# ─── 日志配置 ──────────────────────────────────────────────────────────────────
# 每次启动清空旧日志
try:
    _log_file = LOGS_DIR / "backend.log"
    if _log_file.exists():
        _log_file.write_text("", encoding="utf-8")
except Exception:
    pass

_handlers: list = [logging.StreamHandler()]
try:
    _file_handler = logging.handlers.RotatingFileHandler(
        LOGS_DIR / "backend.log", maxBytes=5 * 1024 * 1024, backupCount=5, encoding="utf-8"
    )
    _file_handler.setFormatter(logging.Formatter("%(asctime)s [%(levelname)s] %(name)s: %(message)s"))
    _handlers.append(_file_handler)
except Exception:
    pass
logging.basicConfig(level=logging.INFO, handlers=_handlers)
logging.getLogger("uvicorn").setLevel(logging.WARNING)
logging.getLogger("uvicorn.access").setLevel(logging.WARNING)
logging.getLogger("httpx").setLevel(logging.WARNING)
logging.getLogger("httpcore").setLevel(logging.WARNING)
logger = logging.getLogger("backend")
logger.info("启动路径: APP_ROOT=%s  RESOURCES_ROOT=%s  RUNTIME_ROOT=%s", APP_ROOT, RESOURCES_ROOT, RUNTIME_ROOT)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.mount("/download", StaticFiles(directory=str(DOWNLOAD_DIR)), name="download")

TRAIN_JOBS: Dict[str, Dict] = {}

# ─── Job 队列 ────────────────────────────────────────────────────────────────
# 所有异步任务（TTS / VC）的状态存储，key=job_id
JOBS: Dict[str, Dict] = {}
# 本地推理信号量：同时只允许 1 个本地推理（RVC/Seed-VC/FishSpeech 共享 GPU/CPU 内存）
LOCAL_SEM = asyncio.Semaphore(1)
# 本地任务队列上限（queued+running）
MAX_LOCAL_QUEUE = 5

TASK_CAPABILITIES = {
    "asr": ["whisper", "openai", "gemini"],
    "llm": ["gemini", "openai", "ollama", "github"],
    "tts": ["fish_speech", "openai", "gemini", "elevenlabs"],
    "vc": ["seed_vc", "local_rvc", "elevenlabs"],
}

# Cloud provider references:
# - Voice changer API doc: https://elevenlabs.io/docs/api-reference/speech-to-speech/convert
# - API pricing page: https://elevenlabs.io/pricing/api
# - Voice changer pricing FAQ: https://help.elevenlabs.io/hc/en-us/articles/24938328105873-How-much-does-Voice-Changer-cost
ELEVENLABS_BASE_URL = "https://api.elevenlabs.io"
ELEVENLABS_STS_PATH_TEMPLATE = "/v1/speech-to-speech/{voice_id}"


def parse_cloud_auth_header(provider: str, api_key: str) -> Dict[str, str]:
    """
    Build auth headers for cloud voice-changer providers.
    Supported api_key input formats:
    - Plain key: inferred by provider
    - "bearer:xxxxx": force Authorization: Bearer xxxxx
    - "header:Header-Name:xxxxx": force custom header
    """
    key = api_key.strip()
    p = provider.strip().lower()
    if not key:
        return {}

    lower = key.lower()
    if lower.startswith("header:"):
        # header:Header-Name:VALUE
        parts = key.split(":", 2)
        if len(parts) == 3 and parts[1].strip() and parts[2].strip():
            return {parts[1].strip(): parts[2].strip()}
    if lower.startswith("bearer:"):
        return {"Authorization": f"Bearer {key.split(':', 1)[1].strip()}"}

    if p == "elevenlabs":
        return {"xi-api-key": key}
    if p == "azure":
        # Azure API Management / Azure AI common key header.
        return {"api-key": key}
    if p == "aws":
        # API Gateway common key header.
        return {"x-api-key": key}

    return {"Authorization": f"Bearer {key}"}


def require_httpx(feature: str):
    if httpx is None:
        raise HTTPException(
            status_code=500,
            detail=f"{feature} requires 'httpx' in runtime environment. Please run setup again.",
        )


def read_voice_meta(voice_dir: Path) -> Dict:
    meta_path = voice_dir / "meta.json"
    meta = {}
    if meta_path.exists():
        try:
            meta = json.loads(meta_path.read_text(encoding="utf-8"))
        except Exception:
            meta = {}

    voice_id = meta.get("voice_id") or voice_dir.name
    name = meta.get("name") or voice_dir.name.replace("_", " ").title()

    model_candidates = [
        "model.pth",
        "model.onnx",
        "model.pt",
        "model.safetensors",
    ]
    found_model = None
    for candidate in model_candidates:
        if (voice_dir / candidate).exists():
            found_model = candidate
            break

    inference_mode = meta.get("inference_mode", "copy")
    inference_command = meta.get("inference_command", "")
    ref_candidates = ["reference.wav", "reference.mp3", "ref.wav"]
    found_ref = next((str((voice_dir / r).resolve()) for r in ref_candidates if (voice_dir / r).exists()), "")
    engine = meta.get("engine", "rvc")
    # RVC 需要模型文件(.pth)；Fish Speech / Seed-VC 只需参考音频
    if engine == "rvc":
        is_ready = bool(found_model)
    else:
        is_ready = bool(found_ref) or bool(found_model)

    return {
        "voice_id": voice_id,
        "name": name,
        "engine": engine,
        "sample_rate": meta.get("sample_rate", 44100),
        "model_file": meta.get("model_file", found_model),
        "index_file": meta.get("index_file", "index.index" if (voice_dir / "index.index").exists() else None),
        "path": str(voice_dir),
        "is_ready": is_ready,
        "inference_mode": inference_mode,
        "inference_command": inference_command,
        "reference_audio": found_ref,
        "updated_at": datetime.fromtimestamp(voice_dir.stat().st_mtime).isoformat(),
    }


def list_voices() -> List[Dict]:
    voices = []
    for p in sorted(VOICES_DIR.iterdir()):
        if p.is_dir():
            voices.append(read_voice_meta(p))
    return voices


def get_voice_or_404(voice_id: str) -> Dict:
    voices = list_voices()
    for v in voices:
        if v["voice_id"] == voice_id:
            return v
    raise HTTPException(status_code=404, detail=f"Voice not found: {voice_id}")


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
        )
    except Exception as exc:
        logger.error("RVC 推理命令执行异常: %s", exc)
        raise HTTPException(status_code=500, detail=f"Inference command execution failed: {exc}") from exc

    if completed.returncode != 0:
        stdout = (completed.stdout or "").strip()[:2000]
        stderr = (completed.stderr or "").strip()[:2000]
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


def get_default_rvc_command_template() -> str:
    """
    Optional global default command template from models/rvc_runtime.json.
    Example:
    {
      "python": "python",
      "infer_script": "C:\\\\rvc\\\\infer_cli.py",
      "args_template": "--input {input} --output {output} --model {model} --index {index}"
    }
    """
    logger.debug("[rvc-cmd] rvc_runtime.json=%s exists=%s", RVC_RUNTIME_CONFIG_PATH, RVC_RUNTIME_CONFIG_PATH.exists())
    # 1) User config takes priority.
    if RVC_RUNTIME_CONFIG_PATH.exists():
        try:
            data = json.loads(RVC_RUNTIME_CONFIG_PATH.read_text(encoding="utf-8-sig"))
        except Exception as e:
            logger.warning("[rvc-cmd] rvc_runtime.json 读取失败: %s", e)
            data = {}
        infer_script = (data.get("infer_script") or "").strip()
        args_template = (data.get("args_template") or "").strip()
        if infer_script and args_template:
            if not Path(infer_script).exists():
                logger.debug("[rvc-cmd] rvc_runtime.json infer_script 不存在: %s，转入自动探测", infer_script)
            else:
                try:
                    python_cmd = (data.get("python") or "").strip() or get_embedded_python()
                except RuntimeError:
                    python_cmd = (data.get("python") or "python").strip()
                tpl = f'"{python_cmd}" "{infer_script}" {args_template}'
                logger.debug("[rvc-cmd] rvc_runtime.json 命令模板: %s", tpl)
                return tpl
        logger.debug("[rvc-cmd] rvc_runtime.json infer_script/args_template 为空或脚本不存在，转入自动探测")

    # 2) Auto-detect common local paths (no manual config needed).
    auto_script = detect_rvc_infer_script()
    if auto_script:
        try:
            py = get_embedded_python()
            tpl = (
                f'"{py}" "{auto_script}" '
                "--input {input} --output {output} --model {model} --index {index}"
            )
            logger.debug("[rvc-cmd] 自动构建命令模板: %s", tpl)
            return tpl
        except RuntimeError as e:
            logger.error("[rvc-cmd] 获取嵌入式 Python 失败: %s", e)
            return ""
    logger.warning("[rvc-cmd] 未找到 RVC 推理脚本，本地推理不可用")
    return ""


def get_embedded_python() -> str:
    """返回平台对应的嵌入式 Python 路径（runtime/mac 或 runtime/win）。找不到则抛出 RuntimeError。"""
    import sys as _sys
    if _sys.platform == "win32":
        candidates = [
            RUNTIME_ROOT / "win" / "python" / "python.exe",
        ]
        platform_name = "win"
    else:
        candidates = [
            RUNTIME_ROOT / "mac" / "python" / "bin" / "python3",
            RUNTIME_ROOT / "mac" / "python" / "bin" / "python",
        ]
        platform_name = "mac"
    for p in candidates:
        exists = p.exists()
        logger.debug("[embedded-python] 检查 %s → %s", p, "✓" if exists else "✗")
        if exists:
            resolved = str(p.resolve())
            logger.debug("[embedded-python] 使用 %s", resolved)
            return resolved
    msg = f"嵌入式 Python 未找到。请将对应平台的 Python 放置于 runtime/{platform_name}/python/ 目录。"
    logger.error("[embedded-python] %s", msg)
    raise RuntimeError(msg)


def get_ffmpeg_binary() -> str:
    """返回 FFmpeg 可执行路径。优先打包的静态二进制，开发模式回退到系统 ffmpeg。"""
    import sys as _sys
    import shutil as _shutil
    if _sys.platform == "win32":
        bundled = RUNTIME_ROOT / "win" / "bin" / "ffmpeg.exe"
    else:
        bundled = RUNTIME_ROOT / "mac" / "bin" / "ffmpeg"
    if bundled.exists():
        logger.debug("[ffmpeg] 使用打包二进制: %s", bundled)
        return str(bundled.resolve())
    system_ffmpeg = _shutil.which("ffmpeg")
    if system_ffmpeg:
        logger.debug("[ffmpeg] 使用系统 ffmpeg: %s", system_ffmpeg)
        return system_ffmpeg
    logger.warning("[ffmpeg] 未找到 FFmpeg，媒体转换功能不可用")
    return ""


def detect_rvc_infer_script() -> str:
    candidates = [
        RUNTIME_ROOT / "rvc" / "infer_cli.py",
        APP_ROOT / "rvc" / "infer_cli.py",
        APP_ROOT / "tools" / "rvc" / "infer_cli.py",
    ]
    for p in candidates:
        exists = p.exists()
        logger.debug("[detect-rvc] 检查 %s → %s", p, "✓" if exists else "✗")
        if exists:
            logger.debug("[detect-rvc] 找到脚本: %s", p)
            return str(p.resolve())
    logger.warning("[detect-rvc] 未找到任何 RVC 推理脚本，检查路径: %s", [str(c) for c in candidates])
    return ""


def detect_fish_speech_script() -> str:
    candidates = [
        RUNTIME_ROOT / "fish_speech" / "inference.py",
        RUNTIME_ROOT / "fish_speech" / "tools" / "inference_engine.py",
        RUNTIME_ROOT / "fish_speech" / "fish_speech" / "inference.py",
    ]
    for p in candidates:
        exists = p.exists()
        logger.debug("[detect-fish] 检查 %s → %s", p, "✓" if exists else "✗")
        if exists:
            logger.debug("[detect-fish] 找到脚本: %s", p)
            return str(p.resolve())
    logger.warning("[detect-fish] 未找到任何 Fish Speech 脚本，检查路径: %s", [str(c) for c in candidates])
    return ""


def get_fish_speech_command_template() -> str:
    logger.debug("[fish-cmd] engine.json=%s exists=%s", FISH_SPEECH_ENGINE_JSON, FISH_SPEECH_ENGINE_JSON.exists())
    if FISH_SPEECH_ENGINE_JSON.exists():
        try:
            data = json.loads(FISH_SPEECH_ENGINE_JSON.read_text(encoding="utf-8"))
            cmd = (data.get("command") or "").strip()
            if cmd:
                logger.debug("[fish-cmd] engine.json command: %s", cmd)
                return cmd
            logger.debug("[fish-cmd] engine.json command 为空，转入自动探测")
        except Exception as e:
            logger.warning("[fish-cmd] engine.json 读取失败: %s", e)
    script = detect_fish_speech_script()
    if script:
        try:
            py = get_embedded_python()
            tpl = f'"{py}" "{script}" --text {{text}} --output {{output}} --voice_ref {{voice_ref}}'
            logger.debug("[fish-cmd] 自动构建命令模板: %s", tpl)
            return tpl
        except RuntimeError as e:
            logger.error("[fish-cmd] 获取嵌入式 Python 失败: %s", e)
            return ""
    logger.warning("[fish-cmd] 未找到 Fish Speech 脚本，本地推理不可用")
    return ""


def detect_seed_vc_script() -> str:
    candidates = [
        RUNTIME_ROOT / "seed_vc" / "inference.py",
        RUNTIME_ROOT / "seed_vc" / "run_inference.py",
        RUNTIME_ROOT / "seed_vc" / "seed_vc" / "inference.py",
    ]
    for p in candidates:
        exists = p.exists()
        logger.debug("[detect-seedvc] 检查 %s → %s", p, "✓" if exists else "✗")
        if exists:
            logger.debug("[detect-seedvc] 找到脚本: %s", p)
            return str(p.resolve())
    logger.warning("[detect-seedvc] 未找到任何 Seed-VC 脚本，检查路径: %s", [str(c) for c in candidates])
    return ""


def get_seed_vc_command_template() -> str:
    logger.debug("[seedvc-cmd] engine.json=%s exists=%s", SEED_VC_ENGINE_JSON, SEED_VC_ENGINE_JSON.exists())
    if SEED_VC_ENGINE_JSON.exists():
        try:
            data = json.loads(SEED_VC_ENGINE_JSON.read_text(encoding="utf-8"))
            cmd = (data.get("command") or "").strip()
            if cmd:
                logger.debug("[seedvc-cmd] engine.json command: %s", cmd)
                return cmd
            logger.debug("[seedvc-cmd] engine.json command 为空，转入自动探测")
        except Exception as e:
            logger.warning("[seedvc-cmd] engine.json 读取失败: %s", e)
    script = detect_seed_vc_script()
    if script:
        try:
            py = get_embedded_python()
            tpl = f'"{py}" "{script}" --source {{input}} --target {{voice_ref}} --output {{output}}'
            logger.debug("[seedvc-cmd] 自动构建命令模板: %s", tpl)
            return tpl
        except RuntimeError as e:
            logger.error("[seedvc-cmd] 获取嵌入式 Python 失败: %s", e)
            return ""
    logger.warning("[seedvc-cmd] 未找到 Seed-VC 脚本，本地推理不可用")
    return ""


def run_local_fish_speech_tts_cmd(text: str, output_path: Path, voice_ref: str = "") -> None:
    cmd_tpl = get_fish_speech_command_template()
    if not cmd_tpl:
        raise HTTPException(
            status_code=500,
            detail=(
                "[fish_speech] 未找到 Fish Speech 引擎。"
                "请将 fish-speech 仓库放置于 runtime/fish_speech/engine/ 目录，"
                "或在 runtime/fish_speech/engine.json 中配置 'command' 字段。"
                "（注意：fish-speech v2 需通过 API 服务器调用，请查看日志获取详细说明。）"
            ),
        )
    import shlex
    cmd = (
        cmd_tpl
        .replace("{text}", shlex.quote(text))
        .replace("{output}", str(output_path.resolve()))
        .replace("{voice_ref}", voice_ref or "")
    )
    try:
        completed = subprocess.run(
            cmd, shell=True, check=False, capture_output=True, text=True, timeout=600,
            env=build_engine_env("fish_speech"),
        )
    except subprocess.TimeoutExpired as exc:
        stdout = (exc.stdout or b"").decode(errors="replace").strip()[:2000] if exc.stdout else ""
        stderr = (exc.stderr or b"").decode(errors="replace").strip()[:2000] if exc.stderr else ""
        logger.error("Fish Speech 超时（600s）\ncmd: %s\nstdout: %s\nstderr: %s", cmd, stdout, stderr)
        raise HTTPException(status_code=500, detail=f"Fish Speech command timed out after 600s. stdout={stdout} stderr={stderr}") from exc
    except Exception as exc:
        logger.error("Fish Speech 启动失败: %s\ncmd: %s", exc, cmd)
        raise HTTPException(status_code=500, detail=f"Fish Speech command failed: {exc}") from exc
    if completed.returncode != 0:
        stdout = (completed.stdout or "").strip()[:2000]
        stderr = (completed.stderr or "").strip()[:2000]
        logger.error("Fish Speech 失败 (code=%s)\nstdout: %s\nstderr: %s", completed.returncode, stdout, stderr)
        raise HTTPException(status_code=500, detail=f"Fish Speech failed (code={completed.returncode}): {stderr}")
    if not output_path.exists() or output_path.stat().st_size <= 0:
        logger.error("Fish Speech 完成但输出文件缺失: %s", output_path)
        raise HTTPException(status_code=500, detail="Fish Speech finished but output file is missing/empty")


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
    try:
        completed = subprocess.run(
            cmd, shell=True, check=False, capture_output=True, text=True, timeout=600,
            env=build_engine_env("seed_vc"),
        )
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Seed-VC command failed: {exc}") from exc
    if completed.returncode != 0:
        stdout = (completed.stdout or "").strip()[:2000]
        stderr = (completed.stderr or "").strip()[:2000]
        logger.error("Seed-VC 失败 (code=%s)\nstdout: %s\nstderr: %s", completed.returncode, stdout, stderr)
        raise HTTPException(status_code=500, detail=f"Seed-VC failed (code={completed.returncode}): {stderr}")
    if not output_path.exists() or output_path.stat().st_size <= 0:
        logger.error("Seed-VC 完成但输出文件缺失: %s", output_path)
        raise HTTPException(status_code=500, detail="Seed-VC finished but output file is missing/empty")


def detect_whisper_script() -> str:
    candidates = [
        RUNTIME_ROOT / "whisper" / "inference.py",
    ]
    for p in candidates:
        exists = p.exists()
        logger.debug("[detect-whisper] 检查 %s → %s", p, "✓" if exists else "✗")
        if exists:
            logger.debug("[detect-whisper] 找到脚本: %s", p)
            return str(p.resolve())
    logger.warning("[detect-whisper] 未找到任何 Whisper 脚本，检查路径: %s", [str(c) for c in candidates])
    return ""


def get_whisper_command_template() -> str:
    logger.debug("[whisper-cmd] engine.json=%s exists=%s", WHISPER_ENGINE_JSON, WHISPER_ENGINE_JSON.exists())
    if WHISPER_ENGINE_JSON.exists():
        try:
            data = json.loads(WHISPER_ENGINE_JSON.read_text(encoding="utf-8"))
            cmd = (data.get("command") or "").strip()
            if cmd:
                logger.debug("[whisper-cmd] engine.json command: %s", cmd)
                return cmd
            logger.debug("[whisper-cmd] engine.json command 为空，转入自动探测")
        except Exception as e:
            logger.warning("[whisper-cmd] engine.json 读取失败: %s", e)
    script = detect_whisper_script()
    if script:
        try:
            py = get_embedded_python()
            tpl = f'"{py}" "{script}" --input {{input}} --output {{output}} --model {{model}}'
            logger.debug("[whisper-cmd] 自动构建命令模板: %s", tpl)
            return tpl
        except RuntimeError as e:
            logger.error("[whisper-cmd] 获取嵌入式 Python 失败: %s", e)
            return ""
    logger.warning("[whisper-cmd] 未找到 Whisper 脚本，本地推理不可用")
    return ""


async def run_whisper_stt(content: bytes, filename: str, model: str = "base") -> Dict:
    cmd_tpl = get_whisper_command_template()
    if not cmd_tpl:
        raise HTTPException(
            status_code=400,
            detail=(
                "Whisper 引擎未找到。请将 runtime/whisper/inference.py 放置于正确路径，"
                "或在 runtime/whisper/engine.json 中配置 'command' 字段。"
            ),
        )

    suffix = Path(filename).suffix or ".wav"
    with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as audio_tmp:
        audio_tmp.write(content)
        audio_tmp_path = audio_tmp.name

    txt_tmp_path = audio_tmp_path + ".txt"

    try:
        cmd = (
            cmd_tpl
            .replace("{input}", audio_tmp_path)
            .replace("{output}", txt_tmp_path)
            .replace("{model}", model)
        )
        try:
            completed = subprocess.run(
                cmd, shell=True, check=False, capture_output=True, text=True, timeout=600,
                env=build_engine_env("whisper"),
            )
        except Exception as exc:
            raise HTTPException(status_code=500, detail=f"Whisper command failed: {exc}") from exc

        if completed.returncode != 0:
            stdout = (completed.stdout or "").strip()[:2000]
            stderr = (completed.stderr or "").strip()[:2000]
            logger.error("Whisper 失败 (code=%s)\nstdout: %s\nstderr: %s", completed.returncode, stdout, stderr)
            raise HTTPException(
                status_code=500,
                detail=f"Whisper 失败 (code={completed.returncode}): {stderr}",
            )

        text = ""
        if Path(txt_tmp_path).exists():
            text = Path(txt_tmp_path).read_text(encoding="utf-8").strip()

        return {
            "status": "success",
            "task": "stt",
            "provider": "whisper",
            "text": text,
            "model": model,
            "filename": filename,
        }
    finally:
        for p in [audio_tmp_path, txt_tmp_path]:
            try:
                os.unlink(p)
            except Exception:
                pass


def copy_to_output_dir(src: Path, output_dir: str) -> None:
    """Copy result file to user-specified output directory if provided."""
    if not output_dir.strip():
        return
    try:
        dest = Path(output_dir.strip())
        dest.mkdir(parents=True, exist_ok=True)
        shutil.copy(src, dest / src.name)
    except Exception:
        pass  # Non-fatal: temp URL is still returned


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


async def run_openai_tts(text: str, api_key: str, model: str = "gpt-4o-mini-tts", voice: str = "alloy") -> Dict:
    require_httpx("openai tts")
    if not api_key.strip():
        raise HTTPException(status_code=400, detail="api_key is required for openai tts")
    endpoint = "https://api.openai.com/v1/audio/speech"
    payload = {"model": model, "voice": voice, "input": text}
    headers = {"Authorization": f"Bearer {api_key.strip()}", "Content-Type": "application/json"}
    try:
        async with httpx.AsyncClient(timeout=120.0) as client:
            resp = await client.post(endpoint, headers=headers, json=payload)
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"OpenAI TTS request failed: {exc}") from exc

    if resp.status_code >= 400:
        raise HTTPException(status_code=502, detail=f"OpenAI TTS error {resp.status_code}: {resp.text[:300]}")

    task_id = str(uuid.uuid4())
    output_path = DOWNLOAD_DIR / f"{task_id}_tts_openai.mp3"
    with open(output_path, "wb") as f:
        f.write(resp.content)
    return {
        "status": "success",
        "task": "tts",
        "provider": "openai",
        "result_url": f"http://{BACKEND_HOST}:{BACKEND_PORT}/download/{output_path.name}",
    }


async def run_openai_stt(content: bytes, filename: str, api_key: str, model: str = "gpt-4o-mini-transcribe") -> Dict:
    require_httpx("openai stt")
    if not api_key.strip():
        raise HTTPException(status_code=400, detail="api_key is required for openai stt")
    endpoint = "https://api.openai.com/v1/audio/transcriptions"
    headers = {"Authorization": f"Bearer {api_key.strip()}"}
    files = {"file": (filename, content, "audio/webm")}
    data = {"model": model}
    try:
        async with httpx.AsyncClient(timeout=120.0) as client:
            resp = await client.post(endpoint, headers=headers, data=data, files=files)
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"OpenAI STT request failed: {exc}") from exc

    if resp.status_code >= 400:
        raise HTTPException(status_code=502, detail=f"OpenAI STT error {resp.status_code}: {resp.text[:300]}")
    try:
        payload = resp.json()
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"OpenAI STT parse failed: {exc}") from exc

    return {
        "status": "success",
        "task": "stt",
        "provider": "openai",
        "text": payload.get("text", ""),
        "raw": payload,
    }


async def run_gemini_tts(
    text: str,
    api_key: str,
    model: str = "gemini-2.5-flash-preview-tts",
    voice: str = "Kore",
) -> Dict:
    require_httpx("gemini tts")
    if not api_key.strip():
        raise HTTPException(status_code=400, detail="api_key is required for gemini tts")
    endpoint = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={api_key.strip()}"
    payload = {
        "contents": [{"parts": [{"text": text}]}],
        "generationConfig": {
            "responseModalities": ["AUDIO"],
            "speechConfig": {
                "voiceConfig": {
                    "prebuiltVoiceConfig": {"voiceName": voice}
                }
            },
        },
    }
    try:
        async with httpx.AsyncClient(timeout=120.0) as client:
            resp = await client.post(endpoint, json=payload)
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Gemini TTS request failed: {exc}") from exc
    if resp.status_code >= 400:
        raise HTTPException(status_code=502, detail=f"Gemini TTS error {resp.status_code}: {resp.text[:300]}")
    try:
        data = resp.json()
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Gemini TTS parse failed: {exc}") from exc

    candidates = data.get("candidates") or []
    if not candidates:
        raise HTTPException(status_code=502, detail="Gemini TTS response has no candidates")
    parts = ((candidates[0] or {}).get("content") or {}).get("parts") or []
    inline = None
    for p in parts:
        inline = p.get("inlineData") or p.get("inline_data")
        if inline:
            break
    if not inline:
        raise HTTPException(status_code=502, detail="Gemini TTS response has no audio payload")

    b64 = inline.get("data")
    mime = inline.get("mimeType") or inline.get("mime_type") or "audio/wav"
    if not b64:
        raise HTTPException(status_code=502, detail="Gemini TTS audio payload has no data")

    try:
        audio_bytes = base64.b64decode(b64)
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Gemini TTS audio decode failed: {exc}") from exc

    ext = ".wav" if "wav" in mime else ".mp3"
    task_id = str(uuid.uuid4())
    out = DOWNLOAD_DIR / f"{task_id}_tts_gemini{ext}"
    with open(out, "wb") as f:
        f.write(audio_bytes)

    return {
        "status": "success",
        "task": "tts",
        "provider": "gemini",
        "result_url": f"http://{BACKEND_HOST}:{BACKEND_PORT}/download/{out.name}",
        "mime_type": mime,
    }


async def run_fish_speech_tts(text: str, voice: str = "default", api_key: str = "", endpoint: str = "") -> Dict:
    # Try local Fish Speech CLI first
    local_cmd = get_fish_speech_command_template()
    if local_cmd:
        task_id = str(uuid.uuid4())
        output_path = DOWNLOAD_DIR / f"{task_id}_tts_fish_speech.wav"
        await asyncio.to_thread(run_local_fish_speech_tts_cmd, text, output_path, voice or "")
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
                "请将 fish-speech 仓库放置于 runtime/fish_speech/engine/ 目录，"
                "或在 runtime/fish_speech/engine.json 中配置 'command' 字段；"
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


async def run_gemini_stt(
    content: bytes,
    filename: str,
    content_type: str,
    api_key: str,
    model: str = "gemini-2.5-flash",
) -> Dict:
    require_httpx("gemini stt")
    if not api_key.strip():
        raise HTTPException(status_code=400, detail="api_key is required for gemini stt")
    endpoint = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={api_key.strip()}"
    audio_b64 = base64.b64encode(content).decode("ascii")
    payload = {
        "contents": [
            {
                "parts": [
                    {"text": "Transcribe this audio. Return plain text only."},
                    {
                        "inlineData": {
                            "mimeType": content_type or "audio/webm",
                            "data": audio_b64,
                        }
                    },
                ]
            }
        ]
    }
    try:
        async with httpx.AsyncClient(timeout=120.0) as client:
            resp = await client.post(endpoint, json=payload)
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Gemini STT request failed: {exc}") from exc
    if resp.status_code >= 400:
        raise HTTPException(status_code=502, detail=f"Gemini STT error {resp.status_code}: {resp.text[:300]}")
    try:
        data = resp.json()
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Gemini STT parse failed: {exc}") from exc

    candidates = data.get("candidates") or []
    if not candidates:
        raise HTTPException(status_code=502, detail="Gemini STT response has no candidates")
    parts = ((candidates[0] or {}).get("content") or {}).get("parts") or []
    text = ""
    for p in parts:
        if p.get("text"):
            text += p.get("text", "")
    return {
        "status": "success",
        "task": "stt",
        "provider": "gemini",
        "text": text.strip(),
        "raw": data,
        "filename": filename,
    }


def extract_gemini_text(data: Dict) -> str:
    candidates = data.get("candidates") or []
    if not candidates:
        return ""
    parts = ((candidates[0] or {}).get("content") or {}).get("parts") or []
    chunks: List[str] = []
    for p in parts:
        t = p.get("text")
        if t:
            chunks.append(t)
    return "\n".join(chunks).strip()


async def run_gemini_audio_understanding(
    *,
    content: bytes,
    filename: str,
    content_type: str,
    prompt: str,
    api_key: str,
    model: str = "gemini-2.5-flash",
) -> Dict:
    require_httpx("gemini audio understanding")
    if not api_key.strip():
        raise HTTPException(status_code=400, detail="api_key is required for gemini audio understanding")
    endpoint = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={api_key.strip()}"
    audio_b64 = base64.b64encode(content).decode("ascii")
    payload = {
        "contents": [
            {
                "parts": [
                    {"text": prompt.strip() or "Summarize this audio."},
                    {
                        "inlineData": {
                            "mimeType": content_type or "audio/webm",
                            "data": audio_b64,
                        }
                    },
                ]
            }
        ]
    }
    try:
        async with httpx.AsyncClient(timeout=120.0) as client:
            resp = await client.post(endpoint, json=payload)
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Gemini audio-understanding request failed: {exc}") from exc
    if resp.status_code >= 400:
        raise HTTPException(
            status_code=502,
            detail=f"Gemini audio-understanding error {resp.status_code}: {resp.text[:300]}",
        )
    try:
        data = resp.json()
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Gemini audio-understanding parse failed: {exc}") from exc
    text = extract_gemini_text(data)
    return {
        "status": "success",
        "task": "audio_understanding",
        "provider": "gemini",
        "text": text,
        "prompt": prompt,
        "filename": filename,
        "raw": data,
    }


async def run_gemini_realtime_bootstrap(
    *,
    api_key: str,
    model: str = "gemini-2.0-flash-live-001",
    voice: str = "Kore",
) -> Dict:
    require_httpx("gemini realtime bootstrap")
    if not api_key.strip():
        raise HTTPException(status_code=400, detail="api_key is required for gemini realtime")

    # Minimal key/model probe so the UI can fail fast before user starts realtime client flow.
    probe_url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}?key={api_key.strip()}"
    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            probe_resp = await client.get(probe_url)
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Gemini realtime probe failed: {exc}") from exc
    if probe_resp.status_code >= 400:
        raise HTTPException(status_code=502, detail=f"Gemini realtime probe error {probe_resp.status_code}: {probe_resp.text[:300]}")

    ws_url = (
        "wss://generativelanguage.googleapis.com/ws/"
        "google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent"
        f"?key={api_key.strip()}"
    )
    setup_payload = {
        "model": f"models/{model}",
        "generationConfig": {
            "responseModalities": ["AUDIO"],
            "speechConfig": {
                "voiceConfig": {
                    "prebuiltVoiceConfig": {"voiceName": voice}
                }
            },
        },
    }
    return {
        "status": "success",
        "task": "realtime_dialogue",
        "provider": "gemini_live",
        "message": "Gemini live bootstrap ready. Use ws_url + setup payload in your realtime client.",
        "ws_url": ws_url,
        "setup": setup_payload,
    }


async def run_openai_audio_understanding(
    *,
    content: bytes,
    filename: str,
    content_type: str,
    prompt: str,
    api_key: str,
    stt_model: str = "gpt-4o-mini-transcribe",
    model: str = "gpt-4o-mini",
) -> Dict:
    require_httpx("openai audio understanding")
    if not api_key.strip():
        raise HTTPException(status_code=400, detail="api_key is required for openai audio understanding")

    stt = await run_openai_stt(content=content, filename=filename, api_key=api_key, model=stt_model)
    transcript = (stt.get("text") or "").strip()
    if not transcript:
        raise HTTPException(status_code=502, detail="OpenAI STT returned empty transcript for audio understanding")

    endpoint = "https://api.openai.com/v1/chat/completions"
    headers = {"Authorization": f"Bearer {api_key.strip()}", "Content-Type": "application/json"}
    user_prompt = prompt.strip() or "Summarize this audio."
    completion_payload = {
        "model": model,
        "messages": [
            {"role": "system", "content": "You analyze audio transcripts and return concise, accurate results."},
            {"role": "user", "content": f"{user_prompt}\n\nTranscript:\n{transcript}"},
        ],
        "temperature": 0.2,
    }
    try:
        async with httpx.AsyncClient(timeout=120.0) as client:
            resp = await client.post(endpoint, headers=headers, json=completion_payload)
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"OpenAI audio-understanding request failed: {exc}") from exc
    if resp.status_code >= 400:
        raise HTTPException(
            status_code=502,
            detail=f"OpenAI audio-understanding error {resp.status_code}: {resp.text[:300]}",
        )
    try:
        data = resp.json()
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"OpenAI audio-understanding parse failed: {exc}") from exc

    text = (
        ((data.get("choices") or [{}])[0].get("message") or {}).get("content")
        or ""
    ).strip()

    return {
        "status": "success",
        "task": "audio_understanding",
        "provider": "openai",
        "text": text,
        "prompt": user_prompt,
        "transcript": transcript,
        "filename": filename,
        "content_type": content_type,
        "raw": data,
    }


async def run_openai_realtime_bootstrap(
    *,
    api_key: str,
    model: str = "gpt-4o-realtime-preview",
    voice: str = "alloy",
) -> Dict:
    require_httpx("openai realtime bootstrap")
    if not api_key.strip():
        raise HTTPException(status_code=400, detail="api_key is required for openai realtime")

    endpoint = "https://api.openai.com/v1/realtime/sessions"
    headers = {"Authorization": f"Bearer {api_key.strip()}", "Content-Type": "application/json"}
    payload = {
        "model": model,
        "voice": voice,
    }
    try:
        async with httpx.AsyncClient(timeout=60.0) as client:
            resp = await client.post(endpoint, headers=headers, json=payload)
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"OpenAI realtime bootstrap request failed: {exc}") from exc
    if resp.status_code >= 400:
        raise HTTPException(status_code=502, detail=f"OpenAI realtime bootstrap error {resp.status_code}: {resp.text[:300]}")
    try:
        data = resp.json()
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"OpenAI realtime bootstrap parse failed: {exc}") from exc

    client_secret = ((data.get("client_secret") or {}).get("value")) or ""
    expires_at = ((data.get("client_secret") or {}).get("expires_at")) or data.get("expires_at")
    ws_url = f"wss://api.openai.com/v1/realtime?model={model}"
    return {
        "status": "success",
        "task": "realtime_dialogue",
        "provider": "openai_realtime",
        "message": "OpenAI realtime bootstrap ready. Use client_secret with ws_url in your realtime client.",
        "ws_url": ws_url,
        "client_secret": client_secret,
        "expires_at": expires_at,
        "raw": data,
    }


async def run_mock_training(job_id: str, voice_id: str, voice_name: str, dataset_path: Path):
    TRAIN_JOBS[job_id]["status"] = "running"
    TRAIN_JOBS[job_id]["started_at"] = datetime.utcnow().isoformat()
    try:
        await asyncio.sleep(3)

        voice_dir = VOICES_DIR / voice_id
        voice_dir.mkdir(parents=True, exist_ok=True)

        # Placeholder artifacts so future conversion can reference this voice pack.
        (voice_dir / "model.pth").write_text(
            "placeholder model file for integration stage\n",
            encoding="utf-8",
        )
        meta = {
            "voice_id": voice_id,
            "name": voice_name,
            "engine": "rvc",
            "sample_rate": 44100,
            "model_file": "model.pth",
            "index_file": "index.index",
            "inference_mode": "command",
            "inference_command": "",
            "trained_from": str(dataset_path),
            "trained_at": datetime.utcnow().isoformat(),
            "note": "placeholder artifact; replace with real trained model files and inference_command",
        }
        (voice_dir / "meta.json").write_text(json.dumps(meta, ensure_ascii=False, indent=2), encoding="utf-8")

        TRAIN_JOBS[job_id]["status"] = "completed"
        TRAIN_JOBS[job_id]["finished_at"] = datetime.utcnow().isoformat()
        TRAIN_JOBS[job_id]["voice_id"] = voice_id
        TRAIN_JOBS[job_id]["result"] = {
            "message": "Training pipeline placeholder completed.",
            "voice_dir": str(voice_dir),
        }
    except Exception as exc:
        TRAIN_JOBS[job_id]["status"] = "failed"
        TRAIN_JOBS[job_id]["finished_at"] = datetime.utcnow().isoformat()
        TRAIN_JOBS[job_id]["error"] = str(exc)
        print(">>> training exception:")
        print(traceback.format_exc())


@app.get("/health")
async def health():
    return {
        "status": "ok",
        "host": BACKEND_HOST,
        "port": BACKEND_PORT,
        "model_root": str(MODEL_ROOT),
        "voices_count": len(list_voices()),
    }


@app.get("/runtime/info")
async def runtime_info():
    """返回各本地引擎的固化版本信息（来自 manifest.json）。"""
    engines_out = {}
    manifest_engines = (_MANIFEST.get("engines") or {})
    for name, cfg in manifest_engines.items():
        checkpoint_dir = get_checkpoint_dir(name)
        checkpoint_path = Path(checkpoint_dir)
        required_files = [f["path"] for f in cfg.get("checkpoint_files", []) if f.get("required")]
        missing = [p for p in required_files if not (checkpoint_path / p).exists()]
        engines_out[name] = {
            "version": cfg.get("version", "unknown"),
            "checkpoint_dir": checkpoint_dir,
            "ready": len(missing) == 0,
            "missing_checkpoints": missing,
        }
    return {
        "manifest_version": _MANIFEST.get("manifest_version", "1"),
        "engines": engines_out,
    }


@app.get("/voices")
async def get_voices():
    return {"voices": list_voices()}


@app.post("/voices/create")
async def create_voice(
    voice_name: str = Form(...),
    engine: str = Form("rvc"),
    model_file: Optional[UploadFile] = File(None),
    index_file: Optional[UploadFile] = File(None),
    reference_audio: Optional[UploadFile] = File(None),
):
    """创建音色包：RVC 上传 .pth（+可选 .index），Fish Speech / Seed-VC 上传参考音频。"""
    safe = "".join(ch for ch in voice_name.strip().lower() if ch.isalnum() or ch in ["_", "-"])
    if not safe:
        raise HTTPException(status_code=400, detail="voice_name 包含无效字符")

    voice_id = f"{safe}_{int(datetime.utcnow().timestamp())}"
    voice_dir = VOICES_DIR / voice_id
    voice_dir.mkdir(parents=True, exist_ok=True)

    meta: Dict = {
        "voice_id": voice_id,
        "name": voice_name.strip(),
        "engine": engine,
        "sample_rate": 44100,
    }

    if model_file and model_file.filename:
        ext = Path(model_file.filename).suffix or ".pth"
        dst = voice_dir / f"model{ext}"
        dst.write_bytes(await model_file.read())
        meta["model_file"] = dst.name
        # RVC 有模型文件时启用命令推理模式
        if engine == "rvc":
            meta["inference_mode"] = "command"

    if index_file and index_file.filename:
        ext = Path(index_file.filename).suffix or ".index"
        dst = voice_dir / f"index{ext}"
        dst.write_bytes(await index_file.read())
        meta["index_file"] = dst.name

    if reference_audio and reference_audio.filename:
        ext = Path(reference_audio.filename).suffix or ".wav"
        dst = voice_dir / f"reference{ext}"
        dst.write_bytes(await reference_audio.read())
        meta["reference_audio"] = dst.name

    (voice_dir / "meta.json").write_text(
        json.dumps(meta, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    logger.info("创建音色: voice_id=%s engine=%s inference_mode=%s", voice_id, engine, meta.get("inference_mode", "copy"))

    return {"status": "ok", "voice_id": voice_id, "voice_name": voice_name.strip()}


@app.get("/capabilities")
async def get_capabilities():
    return {"tasks": TASK_CAPABILITIES}


@app.post("/train")
async def train_voice(
    dataset: UploadFile = File(...),
    voice_id: str = Form(...),
    voice_name: str = Form(""),
):
    if not voice_id.strip():
        raise HTTPException(status_code=400, detail="voice_id is required")

    safe_voice_id = "".join(ch for ch in voice_id.strip().lower() if ch.isalnum() or ch in ["_", "-"])
    if not safe_voice_id:
        raise HTTPException(status_code=400, detail="voice_id contains no valid characters")

    safe_voice_name = voice_name.strip() or safe_voice_id
    ext = Path(dataset.filename or "dataset.zip").suffix or ".zip"
    job_id = str(uuid.uuid4())
    dataset_path = TRAIN_DATA_DIR / f"{job_id}{ext}"

    with open(dataset_path, "wb") as f:
        f.write(await dataset.read())

    TRAIN_JOBS[job_id] = {
        "job_id": job_id,
        "status": "queued",
        "voice_id": safe_voice_id,
        "voice_name": safe_voice_name,
        "dataset": str(dataset_path),
        "created_at": datetime.utcnow().isoformat(),
    }

    asyncio.create_task(run_mock_training(job_id, safe_voice_id, safe_voice_name, dataset_path))

    return {
        "status": "accepted",
        "job_id": job_id,
        "message": "Training job queued",
    }


@app.get("/train/{job_id}")
async def get_train_job(job_id: str):
    job = TRAIN_JOBS.get(job_id)
    if not job:
        raise HTTPException(status_code=404, detail=f"Job not found: {job_id}")
    return job


# ─── Job 管理端点 ─────────────────────────────────────────────────────────────

def _job_public(job: Dict) -> Dict:
    """返回不含内部字段的 job 副本。"""
    return {k: v for k, v in job.items() if not k.startswith("_")}


def _cleanup_old_jobs() -> None:
    """保留最近 100 条，自动删除已完成/失败且超过 1 小时的记录。"""
    import time as _time
    now = _time.time()
    stale = [
        jid for jid, j in JOBS.items()
        if j["status"] in ("completed", "failed")
        and now - j.get("created_at", now) > 3600
    ]
    for jid in stale:
        JOBS.pop(jid, None)
    # 超过 100 条时删最老的已完成/失败记录
    done = sorted(
        [(jid, j) for jid, j in JOBS.items() if j["status"] in ("completed", "failed")],
        key=lambda x: x[1].get("created_at", 0),
    )
    while len(JOBS) > 100 and done:
        jid, _ = done.pop(0)
        JOBS.pop(jid, None)


@app.get("/jobs")
async def list_jobs():
    _cleanup_old_jobs()
    jobs = sorted(JOBS.values(), key=lambda j: j.get("created_at", 0), reverse=True)
    return {"jobs": [_job_public(j) for j in jobs]}


@app.get("/jobs/{job_id}")
async def get_job(job_id: str):
    job = JOBS.get(job_id)
    if not job:
        raise HTTPException(status_code=404, detail=f"任务不存在: {job_id}")
    return _job_public(job)


@app.delete("/jobs/{job_id}")
async def delete_job(job_id: str):
    job = JOBS.pop(job_id, None)
    if not job:
        raise HTTPException(status_code=404, detail=f"任务不存在: {job_id}")
    return {"ok": True}


@app.delete("/jobs")
async def clear_jobs(status: str = "done"):
    """status=done 清除已完成/失败；status=all 清除全部。"""
    if status == "all":
        removed = len(JOBS)
        JOBS.clear()
    else:
        to_del = [jid for jid, j in JOBS.items() if j["status"] in ("completed", "failed")]
        for jid in to_del:
            JOBS.pop(jid, None)
        removed = len(to_del)
    return {"ok": True, "removed": removed}


def _make_job(job_type: str, label: str, provider: str, is_local: bool) -> Dict:
    import time as _t
    job_id = str(uuid.uuid4())
    job: Dict = {
        "id": job_id,
        "type": job_type,
        "label": label,
        "provider": provider,
        "is_local": is_local,
        "status": "queued",
        "created_at": _t.time(),
        "started_at": None,
        "completed_at": None,
        "result_url": None,
        "result_text": None,
        "error": None,
    }
    JOBS[job_id] = job
    return job


async def _run_vc_job(job_id: str, fn, *fn_args) -> None:
    """本地 VC 推理后台协程：等待信号量 → 运行 → 更新状态。"""
    import time as _t
    job = JOBS.get(job_id)
    if not job:
        return
    async with LOCAL_SEM:
        if JOBS.get(job_id) is None:
            return
        job["status"] = "running"
        job["started_at"] = _t.time()
        try:
            result_url = await asyncio.to_thread(fn, *fn_args)
            job["result_url"] = result_url
            job["status"] = "completed"
        except Exception as exc:
            logger.error("VC job %s 失败: %s", job_id, traceback.format_exc())
            job["status"] = "failed"
            job["error"] = str(exc)
        finally:
            job["completed_at"] = _t.time()
            # 清理临时参考音频
            ref_tmp = job.pop("_ref_audio_tmp", None)
            if ref_tmp and Path(ref_tmp).exists():
                try:
                    Path(ref_tmp).unlink()
                except Exception:
                    pass
            # 清理输入文件
            input_tmp = job.pop("_input_tmp", None)
            if input_tmp and Path(input_tmp).exists():
                try:
                    Path(input_tmp).unlink()
                except Exception:
                    pass


async def _run_tts_job(job_id: str, fn, *fn_args) -> None:
    """TTS 后台协程：本地用信号量，云服务直接运行。"""
    import time as _t
    job = JOBS.get(job_id)
    if not job:
        return
    is_local = job.get("is_local", False)
    ctx = LOCAL_SEM if is_local else asyncio.nullcontext()
    async with ctx:
        if JOBS.get(job_id) is None:
            return
        job["status"] = "running"
        job["started_at"] = _t.time()
        try:
            result = await fn(*fn_args)
            job["result_url"] = result.get("result_url")
            job["result_text"] = result.get("text") or result.get("message") or ""
            job["status"] = "completed"
        except Exception as exc:
            logger.error("TTS job %s 失败: %s", job_id, traceback.format_exc())
            job["status"] = "failed"
            job["error"] = str(exc)
        finally:
            job["completed_at"] = _t.time()
            ref_tmp = job.pop("_ref_audio_tmp", None)
            if ref_tmp and Path(ref_tmp).exists():
                try:
                    Path(ref_tmp).unlink()
                except Exception:
                    pass


@app.post("/convert")
async def convert(
    file: UploadFile = File(...),
    voice_id: str = Form("default_female"),
    mode: str = Form("local"),
    provider: str = Form("custom"),
    api_key: str = Form(""),
    cloud_endpoint: str = Form(""),
    output_dir: str = Form(""),
    reference_audio: Optional[UploadFile] = File(None),
    # 通用
    pitch_shift: int = Form(0),
    # SeedVC 专属
    diffusion_steps: int = Form(10),
    f0_condition: bool = Form(False),
    cfg_rate: float = Form(0.7),
    enable_postprocess: bool = Form(True),
    # RVC 专属
    f0_method: str = Form("rmvpe"),
    filter_radius: int = Form(3),
    index_rate: float = Form(0.75),
    rms_mix_rate: float = Form(0.25),
):
    content = await file.read()
    if not content:
        raise HTTPException(status_code=400, detail="Uploaded file is empty.")

    ref_audio_tmp: Optional[Path] = None
    if reference_audio and reference_audio.filename:
        ref_ext = Path(reference_audio.filename).suffix or ".wav"
        ref_audio_tmp = DOWNLOAD_DIR / f"{uuid.uuid4()}_ref{ref_ext}"
        ref_audio_tmp.write_bytes(await reference_audio.read())

    # 云端模式：同步执行，直接返回结果（不走 job 队列）
    if mode.strip().lower() == "cloud":
        try:
            result = await run_cloud_convert(
                content=content,
                filename=file.filename or "record.webm",
                content_type=file.content_type or "application/octet-stream",
                voice_id=voice_id,
                provider=provider,
                api_key=api_key,
                cloud_endpoint=cloud_endpoint,
            )
        finally:
            if ref_audio_tmp and ref_audio_tmp.exists():
                try:
                    ref_audio_tmp.unlink()
                except Exception:
                    pass
        if result.get("result_url") and output_dir.strip():
            url_name = Path(result["result_url"]).name
            copy_to_output_dir(DOWNLOAD_DIR / url_name, output_dir)
        return result

    # 本地推理：检查队列容量
    local_active = sum(
        1 for j in JOBS.values() if j.get("is_local") and j["status"] in ("queued", "running")
    )
    if local_active >= MAX_LOCAL_QUEUE:
        if ref_audio_tmp and ref_audio_tmp.exists():
            ref_audio_tmp.unlink()
        raise HTTPException(
            status_code=429,
            detail=f"本地推理队列已满（{MAX_LOCAL_QUEUE} 个），请等待当前任务完成后再提交。",
        )

    # 保存输入文件
    file_ext = os.path.splitext(file.filename or "")[1] or ".wav"
    task_id = str(uuid.uuid4())
    input_path = DOWNLOAD_DIR / f"{task_id}_input{file_ext}"
    output_path = DOWNLOAD_DIR / f"{task_id}_output{file_ext}"
    input_path.write_bytes(content)

    prov = provider.strip().lower()
    filename_label = (file.filename or "audio").split("/")[-1]
    logger.info("convert: voice_id=%s provider=%s", voice_id, prov)

    # 构建推理函数（同步，供后台线程调用）
    def _run_vc_sync() -> str:
        if prov == "seed_vc":
            voice_ref = str(ref_audio_tmp) if ref_audio_tmp else ""
            if not voice_ref:
                try:
                    v = get_voice_or_404(voice_id)
                    voice_ref = v.get("reference_audio", "")
                except Exception:
                    pass
            logger.info("Seed-VC voice_ref=%s diffusion_steps=%s pitch_shift=%s", voice_ref, diffusion_steps, pitch_shift)
            run_seed_vc_cmd(input_path, output_path, voice_ref, diffusion_steps, pitch_shift, f0_condition, cfg_rate, enable_postprocess)
        else:
            voice = get_voice_or_404(voice_id)
            engine = voice.get("engine", "rvc").lower()
            logger.info("local engine=%s inference_mode=%s", engine, voice.get("inference_mode", "copy"))
            if engine == "seed_vc":
                voice_ref = str(ref_audio_tmp) if ref_audio_tmp else voice.get("reference_audio", "")
                run_seed_vc_cmd(input_path, output_path, voice_ref, diffusion_steps, pitch_shift, f0_condition, cfg_rate, enable_postprocess)
            else:
                rvc_extra_env = {
                    "RVC_F0_UP_KEY": str(pitch_shift),
                    "RVC_F0_METHOD": f0_method,
                    "RVC_FILTER_RADIUS": str(filter_radius),
                    "RVC_INDEX_RATE": str(index_rate),
                    "RVC_RMS_MIX_RATE": str(rms_mix_rate),
                }
                run_local_inference_or_raise(voice, input_path, output_path, rvc_extra_env)
        result_url = f"http://{BACKEND_HOST}:{BACKEND_PORT}/download/{task_id}_output{file_ext}"
        copy_to_output_dir(output_path, output_dir)
        return result_url

    job = _make_job("vc", f"音色转换 · {filename_label}", prov, is_local=True)
    job_id = job["id"]
    job["_ref_audio_tmp"] = str(ref_audio_tmp) if ref_audio_tmp else None
    job["_input_tmp"] = str(input_path)

    task = asyncio.create_task(_run_vc_job(job_id, _run_vc_sync))
    job["_task"] = task  # 防止 GC

    logger.info("convert job %s queued (provider=%s)", job_id, prov)
    return {"status": "queued", "job_id": job_id}


@app.post("/tasks/tts")
async def task_tts(
    text: str = Form(...),
    provider: str = Form("fish_speech"),
    api_key: str = Form(""),
    cloud_endpoint: str = Form(""),
    model: str = Form(""),
    voice: str = Form(""),
    voice_ref: str = Form(""),
    voice_id: str = Form(""),
    output_dir: str = Form(""),
    reference_audio: Optional[UploadFile] = File(None),
):
    if not text.strip():
        raise HTTPException(status_code=400, detail="text is required")
    p = provider.strip().lower()

    ref_audio_tmp: Optional[Path] = None
    if reference_audio and reference_audio.filename:
        ref_ext = Path(reference_audio.filename).suffix or ".wav"
        ref_audio_tmp = DOWNLOAD_DIR / f"{uuid.uuid4()}_tts_ref{ref_ext}"
        ref_audio_tmp.write_bytes(await reference_audio.read())

    ref = str(ref_audio_tmp) if ref_audio_tmp else (voice_ref.strip() or voice.strip())
    voice_id_str = voice_id.strip()
    if voice_id_str and p == "fish_speech" and not ref:
        try:
            v = get_voice_or_404(voice_id_str)
            ref = v.get("reference_audio", "")
        except Exception:
            ref = ""

    is_local = p == "fish_speech" and not cloud_endpoint.strip()

    # 本地队列容量检查
    if is_local:
        local_active = sum(
            1 for j in JOBS.values() if j.get("is_local") and j["status"] in ("queued", "running")
        )
        if local_active >= MAX_LOCAL_QUEUE:
            if ref_audio_tmp and ref_audio_tmp.exists():
                ref_audio_tmp.unlink()
            raise HTTPException(
                status_code=429,
                detail=f"本地推理队列已满（{MAX_LOCAL_QUEUE} 个），请等待当前任务完成后再提交。",
            )

    label = (text[:30] + "…") if len(text) > 30 else text
    job = _make_job("tts", f"TTS · {label}", p, is_local=is_local)
    job_id = job["id"]
    job["_ref_audio_tmp"] = str(ref_audio_tmp) if ref_audio_tmp else None

    async def _do_tts():
        if p == "fish_speech":
            return await run_fish_speech_tts(text=text, voice=ref, api_key=api_key, endpoint=cloud_endpoint)
        elif p == "openai":
            return await run_openai_tts(text=text, api_key=api_key, model=model or "gpt-4o-mini-tts", voice=voice or "alloy")
        elif p == "gemini":
            return await run_gemini_tts(text=text, api_key=api_key, model=model or "gemini-2.5-flash-preview-tts", voice=voice or "Kore")
        elif p == "elevenlabs":
            return await run_elevenlabs_tts(text=text, api_key=api_key, voice=voice or "", model=model or "")
        else:
            raise HTTPException(status_code=400, detail=f"Unsupported TTS provider: {provider}")

    async def _tts_with_copy():
        result = await _do_tts()
        if result.get("result_url") and output_dir.strip():
            url_name = Path(result["result_url"]).name
            copy_to_output_dir(DOWNLOAD_DIR / url_name, output_dir)
        return result

    task = asyncio.create_task(_run_tts_job(job_id, _tts_with_copy))
    job["_task"] = task

    logger.info("tts job %s queued (provider=%s local=%s)", job_id, p, is_local)
    return {"status": "queued", "job_id": job_id}


@app.post("/tasks/stt")
async def task_stt(
    file: UploadFile = File(...),
    provider: str = Form("openai"),
    api_key: str = Form(""),
    cloud_endpoint: str = Form(""),
    model: str = Form(""),
    output_dir: str = Form(""),
):
    content = await file.read()
    if not content:
        raise HTTPException(status_code=400, detail="Uploaded file is empty.")
    p = provider.strip().lower()
    if p == "openai":
        result = await run_openai_stt(
            content=content,
            filename=file.filename or "audio.webm",
            api_key=api_key,
            model=model or "gpt-4o-mini-transcribe",
        )
    elif p == "gemini":
        result = await run_gemini_stt(
            content=content,
            filename=file.filename or "audio.webm",
            content_type=file.content_type or "audio/webm",
            api_key=api_key,
            model=model or "gemini-2.5-flash",
        )
    elif p == "whisper":
        result = await run_whisper_stt(
            content=content,
            filename=file.filename or "audio.webm",
            model=model or "base",
        )
    else:
        raise HTTPException(status_code=400, detail=f"Unsupported STT provider: {provider}")
    if output_dir.strip() and result.get("text"):
        try:
            dest = Path(output_dir.strip())
            dest.mkdir(parents=True, exist_ok=True)
            txt_path = dest / f"transcript_{str(uuid.uuid4())[:8]}.txt"
            txt_path.write_text(result["text"], encoding="utf-8")
        except Exception:
            pass
    return result


@app.post("/tasks/realtime")
async def task_realtime(
    provider: str = Form("openai_realtime"),
    api_key: str = Form(""),
    cloud_endpoint: str = Form(""),
    model: str = Form(""),
    voice: str = Form(""),
):
    p = provider.strip().lower()
    if p == "openai_realtime":
        return await run_openai_realtime_bootstrap(
            api_key=api_key,
            model=model or "gpt-4o-realtime-preview",
            voice=voice or "alloy",
        )
    if p == "gemini_live":
        return await run_gemini_realtime_bootstrap(
            api_key=api_key,
            model=model or "gemini-2.0-flash-live-001",
            voice=voice or "Kore",
        )
    if p == "custom":
        if not cloud_endpoint.strip():
            raise HTTPException(status_code=400, detail="cloud_endpoint is required for custom realtime")
        headers = {"Content-Type": "application/json"}
        if api_key.strip():
            headers["Authorization"] = f"Bearer {api_key.strip()}"
        payload = {"provider": provider, "model": model, "voice": voice}
        try:
            async with httpx.AsyncClient(timeout=60.0) as client:
                resp = await client.post(cloud_endpoint.strip(), headers=headers, json=payload)
        except Exception as exc:
            raise HTTPException(status_code=502, detail=f"Custom realtime request failed: {exc}") from exc
        if resp.status_code >= 400:
            raise HTTPException(status_code=502, detail=f"Custom realtime error {resp.status_code}: {resp.text[:300]}")
        try:
            raw = resp.json()
        except Exception:
            raw = {"raw_text": resp.text[:300]}
        return {"status": "success", "task": "realtime_dialogue", "provider": "custom", "raw": raw}
    raise HTTPException(status_code=400, detail=f"Unsupported realtime provider: {provider}")


async def run_elevenlabs_tts(*, text: str, api_key: str, voice: str = "JBFqnCBsd6RMkjVDRTp2", model: str = "eleven_multilingual_v2") -> Dict:
    require_httpx("elevenlabs tts")
    if not api_key.strip():
        raise HTTPException(status_code=400, detail="api_key is required for elevenlabs tts")
    voice_id = voice.strip() or "JBFqnCBsd6RMkjVDRTp2"
    endpoint = f"{ELEVENLABS_BASE_URL}/v1/text-to-speech/{voice_id}"
    headers = {"xi-api-key": api_key.strip(), "Content-Type": "application/json", "Accept": "audio/mpeg"}
    payload = {"text": text, "model_id": model or "eleven_multilingual_v2", "voice_settings": {"stability": 0.5, "similarity_boost": 0.75}}
    try:
        async with httpx.AsyncClient(timeout=120.0) as client:
            resp = await client.post(endpoint, headers=headers, json=payload)
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"ElevenLabs TTS request failed: {exc}") from exc
    if resp.status_code >= 400:
        raise HTTPException(status_code=502, detail=f"ElevenLabs TTS error {resp.status_code}: {resp.text[:300]}")
    audio_bytes = resp.content
    out_path = DOWNLOAD_DIR / f"tts_{uuid.uuid4().hex[:8]}.mp3"
    out_path.write_bytes(audio_bytes)
    return {"status": "success", "task": "tts", "provider": "elevenlabs", "result_url": f"/download/{out_path.name}"}


async def run_ollama_llm(*, prompt: str, model: str = "qwen2.5-coder:14b", base_url: str = "http://localhost:11434", messages: Optional[List[Dict]] = None) -> Dict:
    require_httpx("ollama llm")
    url = (base_url.rstrip("/") or "http://localhost:11434") + "/v1/chat/completions"
    msgs = messages if messages else [{"role": "user", "content": prompt}]
    payload = {"model": model or "qwen2.5-coder:14b", "messages": msgs}
    try:
        async with httpx.AsyncClient(timeout=120.0) as client:
            resp = await client.post(url, json=payload)
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Ollama LLM request failed: {exc}") from exc
    if resp.status_code >= 400:
        raise HTTPException(status_code=502, detail=f"Ollama LLM error {resp.status_code}: {resp.text[:300]}")
    try:
        data = resp.json()
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Ollama LLM parse failed: {exc}") from exc
    text = (((data.get("choices") or [{}])[0].get("message") or {}).get("content") or "").strip()
    return {"status": "success", "task": "llm", "provider": "ollama", "text": text, "raw": data}


async def run_github_llm(*, prompt: str, api_key: str, model: str = "gpt-4o-mini", messages: Optional[List[Dict]] = None) -> Dict:
    require_httpx("github llm")
    if not api_key.strip():
        raise HTTPException(status_code=400, detail="api_key is required for github models llm")
    endpoint = "https://models.inference.ai.azure.com/chat/completions"
    headers = {"Authorization": f"Bearer {api_key.strip()}", "Content-Type": "application/json"}
    msgs = messages if messages else [{"role": "user", "content": prompt}]
    payload = {"model": model or "gpt-4o-mini", "messages": msgs}
    try:
        async with httpx.AsyncClient(timeout=120.0) as client:
            resp = await client.post(endpoint, headers=headers, json=payload)
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"GitHub Models LLM request failed: {exc}") from exc
    if resp.status_code >= 400:
        raise HTTPException(status_code=502, detail=f"GitHub Models LLM error {resp.status_code}: {resp.text[:300]}")
    try:
        data = resp.json()
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"GitHub Models LLM parse failed: {exc}") from exc
    text = (((data.get("choices") or [{}])[0].get("message") or {}).get("content") or "").strip()
    return {"status": "success", "task": "llm", "provider": "github", "text": text, "raw": data}


async def run_openai_llm(*, prompt: str, api_key: str, model: str = "gpt-4o-mini", messages: Optional[List[Dict]] = None) -> Dict:
    require_httpx("openai llm")
    if not api_key.strip():
        raise HTTPException(status_code=400, detail="api_key is required for openai llm")
    endpoint = "https://api.openai.com/v1/chat/completions"
    headers = {"Authorization": f"Bearer {api_key.strip()}", "Content-Type": "application/json"}
    msgs = messages if messages else [{"role": "user", "content": prompt}]
    payload = {
        "model": model,
        "messages": msgs,
    }
    try:
        async with httpx.AsyncClient(timeout=120.0) as client:
            resp = await client.post(endpoint, headers=headers, json=payload)
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"OpenAI LLM request failed: {exc}") from exc
    if resp.status_code >= 400:
        raise HTTPException(status_code=502, detail=f"OpenAI LLM error {resp.status_code}: {resp.text[:300]}")
    try:
        data = resp.json()
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"OpenAI LLM parse failed: {exc}") from exc
    text = (((data.get("choices") or [{}])[0].get("message") or {}).get("content") or "").strip()
    return {"status": "success", "task": "llm", "provider": "openai", "text": text, "raw": data}


async def run_gemini_llm(*, prompt: str, api_key: str, model: str = "gemini-2.5-flash", messages: Optional[List[Dict]] = None) -> Dict:
    require_httpx("gemini llm")
    if not api_key.strip():
        raise HTTPException(status_code=400, detail="api_key is required for gemini llm")
    endpoint = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={api_key.strip()}"
    # 将 OpenAI 格式的 messages 转为 Gemini contents 格式
    if messages:
        role_map = {"user": "user", "assistant": "model"}
        contents = [
            {"role": role_map.get(m.get("role", "user"), "user"), "parts": [{"text": m.get("content", "")}]}
            for m in messages
        ]
    else:
        contents = [{"parts": [{"text": prompt}]}]
    payload = {"contents": contents}
    try:
        async with httpx.AsyncClient(timeout=120.0) as client:
            resp = await client.post(endpoint, json=payload)
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Gemini LLM request failed: {exc}") from exc
    if resp.status_code >= 400:
        raise HTTPException(status_code=502, detail=f"Gemini LLM error {resp.status_code}: {resp.text[:300]}")
    try:
        data = resp.json()
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Gemini LLM parse failed: {exc}") from exc
    text = extract_gemini_text(data)
    return {"status": "success", "task": "llm", "provider": "gemini", "text": text, "raw": data}


@app.post("/tasks/llm")
async def task_llm(
    prompt: str = Form(""),
    messages: str = Form(""),   # JSON 数组 [{role, content}, ...]，优先于 prompt
    provider: str = Form("gemini"),
    api_key: str = Form(""),
    cloud_endpoint: str = Form(""),
    model: str = Form(""),
):
    # 解析多轮历史
    parsed_messages: Optional[List[Dict]] = None
    if messages.strip():
        try:
            parsed_messages = json.loads(messages)
        except Exception:
            pass

    if not parsed_messages and not prompt.strip():
        raise HTTPException(status_code=400, detail="prompt 或 messages 必须提供其一")

    p = provider.strip().lower()
    if p == "gemini":
        return await run_gemini_llm(prompt=prompt, api_key=api_key, model=model or "gemini-2.5-flash", messages=parsed_messages)
    if p == "openai":
        return await run_openai_llm(prompt=prompt, api_key=api_key, model=model or "gpt-4o-mini", messages=parsed_messages)
    if p == "ollama":
        return await run_ollama_llm(prompt=prompt, model=model or "qwen2.5-coder:14b", base_url=cloud_endpoint or "http://localhost:11434", messages=parsed_messages)
    if p == "github":
        return await run_github_llm(prompt=prompt, api_key=api_key, model=model or "gpt-4o-mini", messages=parsed_messages)
    raise HTTPException(status_code=400, detail=f"Unsupported LLM provider: {provider}")


@app.post("/tasks/audio-understanding")
async def task_audio_understanding(
    file: UploadFile = File(...),
    provider: str = Form("gemini"),
    prompt: str = Form("Summarize this audio."),
    api_key: str = Form(""),
    cloud_endpoint: str = Form(""),
    model: str = Form(""),
):
    content = await file.read()
    if not content:
        raise HTTPException(status_code=400, detail="Uploaded file is empty.")
    p = provider.strip().lower()
    if p == "openai":
        return await run_openai_audio_understanding(
            content=content,
            filename=file.filename or "audio.webm",
            content_type=file.content_type or "audio/webm",
            prompt=prompt,
            api_key=api_key,
            stt_model="gpt-4o-mini-transcribe",
            model=model or "gpt-4o-mini",
        )
    if p == "gemini":
        return await run_gemini_audio_understanding(
            content=content,
            filename=file.filename or "audio.webm",
            content_type=file.content_type or "audio/webm",
            prompt=prompt,
            api_key=api_key,
            model=model or "gemini-2.5-flash",
        )
    if p == "custom":
        if not cloud_endpoint.strip():
            raise HTTPException(status_code=400, detail="cloud_endpoint is required for custom audio understanding")
        headers = {}
        if api_key.strip():
            headers["Authorization"] = f"Bearer {api_key.strip()}"
        files = {"file": (file.filename or "audio.webm", content, file.content_type or "audio/webm")}
        data = {"prompt": prompt, "model": model}
        try:
            async with httpx.AsyncClient(timeout=120.0) as client:
                resp = await client.post(cloud_endpoint.strip(), headers=headers, files=files, data=data)
        except Exception as exc:
            raise HTTPException(status_code=502, detail=f"Custom audio understanding request failed: {exc}") from exc
        if resp.status_code >= 400:
            raise HTTPException(status_code=502, detail=f"Custom audio understanding error {resp.status_code}: {resp.text[:300]}")
        try:
            payload = resp.json()
        except Exception:
            payload = {"raw_text": resp.text[:300]}
        return {"status": "success", "task": "audio_understanding", "provider": "custom", "raw": payload}
    raise HTTPException(status_code=400, detail=f"Unsupported audio_understanding provider: {provider}")


@app.post("/tasks/media-convert")
async def task_media_convert(
    file: UploadFile = File(...),
    action: str = Form("convert"),      # convert | extract_audio | clip
    output_format: str = Form("mp3"),   # mp3 | wav | m4a
    start_time: str = Form(""),         # HH:MM:SS，clip 时用
    duration: str = Form(""),           # HH:MM:SS，clip 时用
    output_dir: str = Form(""),
):
    """媒体格式转换：音频互转、视频提取音频、截取片段。依赖 FFmpeg 静态二进制。"""
    ffmpeg = get_ffmpeg_binary()
    if not ffmpeg:
        raise HTTPException(
            status_code=500,
            detail=(
                "FFmpeg 未找到。请运行 pnpm run checkpoints 下载 FFmpeg 静态二进制，"
                "或在系统中安装 FFmpeg 并确保其在 PATH 中。"
            ),
        )

    content = await file.read()
    if not content:
        raise HTTPException(status_code=400, detail="上传文件为空")

    act = action.strip().lower()
    fmt = output_format.strip().lower() or "mp3"
    if fmt not in ("mp3", "wav", "m4a"):
        raise HTTPException(status_code=400, detail=f"不支持的输出格式: {fmt}")

    task_id = str(uuid.uuid4())
    in_ext = os.path.splitext(file.filename or "")[1] or ".bin"
    input_path = DOWNLOAD_DIR / f"{task_id}_mc_input{in_ext}"
    output_path = DOWNLOAD_DIR / f"{task_id}_mc_output.{fmt}"

    input_path.write_bytes(content)

    try:
        if act == "convert":
            cmd = [ffmpeg, "-y", "-i", str(input_path), str(output_path)]
        elif act == "extract_audio":
            cmd = [ffmpeg, "-y", "-i", str(input_path), "-vn", str(output_path)]
        elif act == "clip":
            if not start_time.strip():
                raise HTTPException(status_code=400, detail="clip 操作需要 start_time")
            cmd = [ffmpeg, "-y", "-ss", start_time.strip()]
            if duration.strip():
                cmd += ["-t", duration.strip()]
            cmd += ["-i", str(input_path), str(output_path)]
        else:
            raise HTTPException(status_code=400, detail=f"不支持的 action: {action}")

        logger.info("[media-convert] action=%s fmt=%s cmd=%s", act, fmt, " ".join(cmd))
        completed = await asyncio.to_thread(
            subprocess.run, cmd, capture_output=True, text=True, timeout=300
        )
        if completed.returncode != 0:
            stderr = (completed.stderr or "").strip()[:1000]
            logger.error("[media-convert] FFmpeg 失败: %s", stderr)
            raise HTTPException(status_code=500, detail=f"FFmpeg 处理失败: {stderr}")

        if not output_path.exists() or output_path.stat().st_size == 0:
            raise HTTPException(status_code=500, detail="FFmpeg 完成但输出文件缺失或为空")

        copy_to_output_dir(output_path, output_dir)
        result_url = f"http://{BACKEND_HOST}:{BACKEND_PORT}/download/{output_path.name}"
        return {
            "status": "success",
            "task": "media_convert",
            "action": act,
            "output_format": fmt,
            "result_url": result_url,
            "size_bytes": output_path.stat().st_size,
        }
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("[media-convert] 异常:\n%s", traceback.format_exc())
        raise HTTPException(status_code=500, detail=f"媒体转换失败: {exc}")
    finally:
        if input_path.exists():
            try:
                input_path.unlink()
            except Exception:
                pass


if __name__ == "__main__":
    uvicorn.run(app, host=BACKEND_HOST, port=BACKEND_PORT)
