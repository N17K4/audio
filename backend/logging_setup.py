import logging
import logging.handlers
from config import LOGS_DIR

_fmt = logging.Formatter("%(asctime)s [%(levelname)s] %(name)s: %(message)s")


def setup_logging() -> logging.Logger:
    # 每次启动清空旧日志
    try:
        _log_file = LOGS_DIR / "backend.log"
        if _log_file.exists():
            _log_file.write_text("", encoding="utf-8")
    except Exception:
        pass

    # 直接挂到 "backend" logger，而不是 root logger
    # uvicorn.run() 会调用 dictConfig 覆盖 root logger 的 handlers，
    # 但不会影响应用自定义 logger 上的 handlers。
    _logger = logging.getLogger("backend")
    _logger.setLevel(logging.INFO)
    _logger.propagate = False  # 不再依赖 root logger 传播

    # 清除旧 handlers（防止重复添加）
    _logger.handlers.clear()

    # stdout
    _sh = logging.StreamHandler()
    _sh.setFormatter(_fmt)
    _logger.addHandler(_sh)

    # 文件
    try:
        _fh = logging.handlers.RotatingFileHandler(
            LOGS_DIR / "backend.log", maxBytes=5 * 1024 * 1024, backupCount=5, encoding="utf-8"
        )
        _fh.setFormatter(_fmt)
        _logger.addHandler(_fh)
    except Exception:
        pass

    # 抑制噪音 logger
    for _noisy in ("uvicorn", "uvicorn.access", "httpx", "httpcore"):
        logging.getLogger(_noisy).setLevel(logging.WARNING)

    return _logger


logger = setup_logging()
