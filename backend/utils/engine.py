import json
import os
import subprocess
from pathlib import Path
from typing import Dict

from config import (
    APP_ROOT,
    RESOURCES_ROOT,
    RUNTIME_ROOT,
    RVC_RUNTIME_CONFIG_PATH,
    FISH_SPEECH_ENGINE_JSON,
    SEED_VC_ENGINE_JSON,
    WHISPER_ENGINE_JSON,
    _MANIFEST,
    CHECKPOINTS_ROOT,
)
from logging_setup import logger


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
        RUNTIME_ROOT / "rvc" / "engine" / "infer.py",   # download_checkpoints.py 自动生成
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


def build_engine_env(engine: str) -> Dict[str, str]:
    """为子进程构建包含 CHECKPOINT_DIR 注入的环境变量字典。"""
    engines = (_MANIFEST.get("engines") or {})
    cfg = engines.get(engine, {})
    env_key = cfg.get("env_key") or f"{engine.upper()}_CHECKPOINT_DIR"
    # HF 缓存统一指向 checkpoints/hf_cache（绝对路径，避免相对路径错位）
    hf_cache = str(CHECKPOINTS_ROOT / "hf_cache")
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
    # rel 格式为 "checkpoints/fish_speech"，去掉前缀后拼 CHECKPOINTS_ROOT
    if rel.startswith("checkpoints/"):
        return str((CHECKPOINTS_ROOT / rel[len("checkpoints/"):]).resolve())
    return str((RESOURCES_ROOT / rel).resolve())
