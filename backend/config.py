import json
import os
import platform
from pathlib import Path
from typing import Dict

APP_ROOT = Path(__file__).resolve().parent.parent
# dev: APP_ROOT = プロジェクトルート、prod: APP_ROOT = Resources/
# backend/ が extraResources に移動したため、parent.parent はどちらも正しいルートを指す
RESOURCES_ROOT = APP_ROOT
RUNTIME_ROOT = APP_ROOT / "runtime"
WRAPPERS_ROOT = Path(__file__).resolve().parent / "wrappers"

# dev / prod 判定：dev にだけ .git がある（prod には含まれない）
IS_DEV = (APP_ROOT / ".git").exists()


def _get_user_data_base() -> Path:
    """ユーザーデータのベースディレクトリを返す。"""
    if IS_DEV:
        return RUNTIME_ROOT
    _sys = platform.system()
    if _sys == "Darwin":
        return Path.home() / "Library" / "Application Support" / "AI-Workshop"
    elif _sys == "Windows":
        return Path(os.environ.get("LOCALAPPDATA", str(Path.home() / "AppData" / "Local"))) / "AI-Workshop"
    else:
        return Path.home() / ".local" / "share" / "AI-Workshop"


_USER_DATA_BASE = _get_user_data_base()

# ml packages / checkpoints：dev は runtime/ 配下、prod はユーザーディレクトリ
ML_PACKAGES_DIR: Path = _USER_DATA_BASE / "ml"
CHECKPOINTS_ROOT: Path = _USER_DATA_BASE / "checkpoints"

USER_DATA_ROOT = Path(os.getenv("USER_DATA_ROOT", str(APP_ROOT / "user_data"))).resolve()
RVC_VOICES_DIR = USER_DATA_ROOT / "rvc"
RVC_USER_VOICES_DIR = RVC_VOICES_DIR / "user"
SEED_VC_VOICES_DIR = USER_DATA_ROOT / "seed_vc"
SEED_VC_USER_VOICES_DIR = SEED_VC_VOICES_DIR / "user"
FISH_SPEECH_DIR = USER_DATA_ROOT / "fish_speech"
RAG_ROOT = USER_DATA_ROOT / "rag"
RAG_USER_ROOT = RAG_ROOT / "user"
AGENT_DIR = USER_DATA_ROOT / "agent"
UPLOADS_DIR = USER_DATA_ROOT / "uploads"
RVC_ENGINE_JSON = WRAPPERS_ROOT / "rvc" / "engine.json"
FISH_SPEECH_ENGINE_JSON = WRAPPERS_ROOT / "fish_speech" / "engine.json"
GPT_SOVITS_ENGINE_JSON = WRAPPERS_ROOT / "gpt_sovits" / "engine.json"
COSYVOICE_ENGINE_JSON = WRAPPERS_ROOT / "cosyvoice" / "engine.json"
SEED_VC_ENGINE_JSON = WRAPPERS_ROOT / "seed_vc" / "engine.json"
WHISPER_ENGINE_JSON = WRAPPERS_ROOT / "whisper" / "engine.json"
FASTER_WHISPER_ENGINE_JSON = WRAPPERS_ROOT / "faster_whisper" / "engine.json"

# dev + prod 统一：Electron 传入 LOGS_DIR 环境变量；未传则回退到 APP_ROOT/logs/
_LOGS_DIR_ENV = os.getenv("LOGS_DIR", "").strip()
LOGS_DIR: Path = Path(_LOGS_DIR_ENV).resolve() if _LOGS_DIR_ENV else (APP_ROOT / "logs")

# 通用缓存目录（音频、训练数据等）；Electron 传入环境变量，未传则回退到 APP_ROOT 下
_CACHE_DIR_ENV = os.getenv("CACHE_DIR", "").strip()
CACHE_DIR: Path = Path(_CACHE_DIR_ENV).resolve() if _CACHE_DIR_ENV else (APP_ROOT / "cache")
DOWNLOAD_DIR = CACHE_DIR
TRAIN_DATA_DIR = CACHE_DIR / "train-data"

# HF 缓存在 checkpoints/hf_cache/ 下，与其他模型权重统一管理
HF_CACHE_DIR: Path = CHECKPOINTS_ROOT / "hf_cache"

BACKEND_HOST = os.getenv("BACKEND_HOST", "127.0.0.1")
BACKEND_PORT = int(os.getenv("BACKEND_PORT", "8000"))

# 本地任务队列上限（queued+running）
MAX_LOCAL_QUEUE = 5

# ─── 用户设置（持久化到 user_data/settings.json）────────────────────────────
SETTINGS_PATH = USER_DATA_ROOT / "settings.json"


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


_ENGINE_VOICES = {
    "rvc": (RVC_VOICES_DIR, RVC_USER_VOICES_DIR),
    "seed_vc": (SEED_VC_VOICES_DIR, SEED_VC_USER_VOICES_DIR),
}


def get_voices_dir(engine: str) -> Path:
    return _ENGINE_VOICES.get(engine, _ENGINE_VOICES["rvc"])[0]


def get_user_voices_dir(engine: str) -> Path:
    return _ENGINE_VOICES.get(engine, _ENGINE_VOICES["rvc"])[1]


def setup_dirs():
    for d in [
        RVC_VOICES_DIR, RVC_USER_VOICES_DIR,
        SEED_VC_VOICES_DIR, SEED_VC_USER_VOICES_DIR,
        FISH_SPEECH_DIR, RAG_USER_ROOT, AGENT_DIR,
        UPLOADS_DIR, DOWNLOAD_DIR, TRAIN_DATA_DIR, LOGS_DIR, CHECKPOINTS_ROOT,
    ]:
        d.mkdir(parents=True, exist_ok=True)


setup_dirs()
