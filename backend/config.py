import json
import os
import tempfile
from pathlib import Path
from typing import Dict

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

BACKEND_HOST = os.getenv("BACKEND_HOST", "127.0.0.1")
BACKEND_PORT = int(os.getenv("BACKEND_PORT", "8000"))

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

# ─── Manifest（产物固化清单）────────────────────────────────────────────────────
_MANIFEST_PATH = RUNTIME_ROOT / "manifest.json"


def _load_manifest() -> Dict:
    if _MANIFEST_PATH.exists():
        try:
            return json.loads(_MANIFEST_PATH.read_text(encoding="utf-8-sig"))
        except Exception as e:
            import logging
            logging.getLogger("backend").warning("manifest.json 读取失败: %s", e)
    return {}


_MANIFEST: Dict = _load_manifest()


def setup_dirs():
    for d in [VOICES_DIR, UPLOADS_DIR, DOWNLOAD_DIR, TRAIN_DATA_DIR, LOGS_DIR]:
        d.mkdir(parents=True, exist_ok=True)


setup_dirs()
