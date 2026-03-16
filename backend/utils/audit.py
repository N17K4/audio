"""审计日志工具：在调用 AI 模型前记录参数，失败时记录错误详情。

使用方式：
    from utils.audit import log_ai_call, log_ai_error

    log_ai_call("fish_speech", {"text": text, "voice_ref": voice_ref}, command=cmd)
    log_ai_error("fish_speech", exc, returncode=1, stdout=stdout, stderr=stderr)

过滤审计日志：
    grep '\[AUDIT\]' logs/backend.log
"""
import re
import traceback
from typing import Any, Dict, List, Optional, Union

from logging_setup import logger

# 参数名含这些关键词时，值替换为 ***
_SECRET_KEYS = frozenset({"api_key", "password", "token", "secret", "auth", "key"})
# 正则：匹配 OpenAI-style sk-xxx 以及 Bearer xxx
_SECRET_RE = re.compile(r'(sk-[A-Za-z0-9\-_]{8,}|Bearer\s+\S{8,})', re.IGNORECASE)


def _mask_params(params: Dict[str, Any]) -> Dict[str, Any]:
    out = {}
    for k, v in params.items():
        if any(s in k.lower() for s in _SECRET_KEYS):
            out[k] = "***"
        elif isinstance(v, str) and len(v) > 120:
            out[k] = v[:120] + "…"
        else:
            out[k] = v
    return out


def _cmd_repr(command: Union[str, List, None]) -> str:
    if command is None:
        return "(cloud API)"
    raw = " ".join(str(c) for c in command) if isinstance(command, list) else str(command)
    return _SECRET_RE.sub("***", raw)


def log_ai_call(
    service: str,
    params: Dict[str, Any],
    command: Union[str, List, None] = None,
) -> None:
    """在调用 AI 模型前调用，记录服务名、参数、执行命令。"""
    safe = _mask_params(params)
    params_str = "  ".join(f"{k}={v!r}" for k, v in safe.items())
    cmd_str = _cmd_repr(command)
    logger.info("[AUDIT] service=%s\n  params: %s\n  cmd: %s", service, params_str, cmd_str)


def log_ai_error(
    service: str,
    exc: Exception,
    returncode: Optional[int] = None,
    stdout: str = "",
    stderr: str = "",
    tail: int = 800,
) -> None:
    """在 AI 调用失败时记录错误、退出码、stdout/stderr 尾部。"""
    tb = traceback.format_exc()
    parts = [
        f"[AUDIT] FAILED service={service}",
        f"  error: {type(exc).__name__}: {exc}",
        f"  traceback:\n{tb.strip()}",
    ]
    if returncode is not None:
        parts.append(f"  returncode: {returncode}")
    if stderr:
        parts.append(f"  stderr (last {tail}):\n{stderr[-tail:]}")
    if stdout:
        parts.append(f"  stdout (last {tail}):\n{stdout[-tail:]}")
    logger.error("\n".join(parts))
