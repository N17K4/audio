import json
import os
from pathlib import Path
from typing import Dict

APP_ROOT = Path(__file__).resolve().parent.parent
# 打包后 Electron 传入 RESOURCES_ROOT=process.resourcesPath（Contents/Resources/）
# dev 模式下默认为项目根目录（runtime/、checkpoints/ 均在此处）
RESOURCES_ROOT = Path(os.getenv("RESOURCES_ROOT", str(APP_ROOT))).resolve()
RUNTIME_ROOT = RESOURCES_ROOT / "runtime"
WRAPPERS_ROOT = RESOURCES_ROOT / "wrappers"

# 模型 checkpoints 目录：生产模式由 Electron 传入 CHECKPOINTS_DIR（userData/checkpoints/）
# 开发模式回退到项目根下的 checkpoints/
_CHECKPOINTS_DIR_ENV = os.getenv("CHECKPOINTS_DIR", "").strip()
CHECKPOINTS_ROOT = (
    Path(_CHECKPOINTS_DIR_ENV).resolve()
    if _CHECKPOINTS_DIR_ENV
    else RESOURCES_ROOT / "checkpoints"
)

MODEL_ROOT = Path(os.getenv("MODEL_ROOT", str(APP_ROOT / "models"))).resolve()
VOICES_DIR = MODEL_ROOT / "voices"
USER_VOICES_DIR = VOICES_DIR / "user"
UPLOADS_DIR = MODEL_ROOT / "uploads"
RVC_RUNTIME_CONFIG_PATH = MODEL_ROOT / "rvc_runtime.json"
FISH_SPEECH_ENGINE_JSON = WRAPPERS_ROOT / "fish_speech" / "engine.json"
GPT_SOVITS_ENGINE_JSON = WRAPPERS_ROOT / "gpt_sovits" / "engine.json"
COSYVOICE_ENGINE_JSON = WRAPPERS_ROOT / "cosyvoice" / "engine.json"
SEED_VC_ENGINE_JSON = WRAPPERS_ROOT / "seed_vc" / "engine.json"
WHISPER_ENGINE_JSON = WRAPPERS_ROOT / "whisper" / "engine.json"
FASTER_WHISPER_ENGINE_JSON = WRAPPERS_ROOT / "faster_whisper" / "engine.json"

# dev + prod 统一：Electron 传入 LOGS_DIR 环境变量；未传则回退到 APP_ROOT/logs/
_LOGS_DIR_ENV = os.getenv("LOGS_DIR", "").strip()
LOGS_DIR: Path = Path(_LOGS_DIR_ENV).resolve() if _LOGS_DIR_ENV else (APP_ROOT / "logs")

# 音频缓存与 logs 同级；Electron 传入环境变量，未传则回退到 APP_ROOT 下
_AUDIO_CACHE_ENV = os.getenv("AUDIO_CACHE_DIR", "").strip()
AUDIO_CACHE_DIR: Path = Path(_AUDIO_CACHE_ENV).resolve() if _AUDIO_CACHE_ENV else (APP_ROOT / "audio_cache")
DOWNLOAD_DIR = AUDIO_CACHE_DIR
TRAIN_DATA_DIR = AUDIO_CACHE_DIR / "train-data"

# HF 缓存在 checkpoints/hf_cache/ 下，与其他模型权重统一管理
HF_CACHE_DIR: Path = CHECKPOINTS_ROOT / "hf_cache"

BACKEND_HOST = os.getenv("BACKEND_HOST", "127.0.0.1")
BACKEND_PORT = int(os.getenv("BACKEND_PORT", "8000"))

# 本地任务队列上限（queued+running）
MAX_LOCAL_QUEUE = 5

# ─── 用户设置（持久化到 MODEL_ROOT/settings.json）────────────────────────────
SETTINGS_PATH = MODEL_ROOT / "settings.json"


def load_settings() -> Dict:
    if SETTINGS_PATH.exists():
        try:
            return json.loads(SETTINGS_PATH.read_text(encoding="utf-8"))
        except Exception:
            pass
    return {}


def save_settings(data: Dict) -> None:
    SETTINGS_PATH.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")


_SETTINGS: Dict = load_settings()
# 本地推理并发数：1（串行）~ 4，默认 1（保守安全）
LOCAL_CONCURRENCY: int = max(1, min(4, int(_SETTINGS.get("local_concurrency", 1))))

TASK_CAPABILITIES = {
    "tts": ["fish_speech", "gpt_sovits", "cosyvoice", "openai", "gemini", "elevenlabs", "cartesia", "dashscope", "minimax_tts"],
    "asr": ["faster_whisper", "whisper", "openai", "gemini", "groq", "deepgram", "dashscope"],
    "llm": ["gemini", "openai", "claude", "groq", "deepseek", "mistral", "xai", "ollama", "github",
            "qwen", "doubao", "hunyuan", "glm", "moonshot", "spark", "minimax", "baichuan"],
    "agent": ["ollama", "gemini", "openai", "deepseek", "groq", "mistral", "xai", "qwen", "doubao", "hunyuan", "glm", "moonshot", "minimax"],
    "vc":  ["seed_vc", "local_rvc", "elevenlabs"],
}

# Cloud provider references:
# - Voice changer API doc: https://elevenlabs.io/docs/api-reference/speech-to-speech/convert
# - API pricing page: https://elevenlabs.io/pricing/api
# - Voice changer pricing FAQ: https://help.elevenlabs.io/hc/en-us/articles/24938328105873-How-much-does-Voice-Changer-cost
ELEVENLABS_BASE_URL = "https://api.elevenlabs.io"
CARTESIA_BASE_URL = "https://api.cartesia.ai"
ELEVENLABS_STS_PATH_TEMPLATE = "/v1/speech-to-speech/{voice_id}"

# ─── Manifest（产物固化清单）────────────────────────────────────────────────────
_MANIFEST_PATH = WRAPPERS_ROOT / "manifest.json"


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
    for d in [VOICES_DIR, UPLOADS_DIR, DOWNLOAD_DIR, TRAIN_DATA_DIR, LOGS_DIR, CHECKPOINTS_ROOT]:
        d.mkdir(parents=True, exist_ok=True)


setup_dirs()
