import logging
import logging.handlers
from config import LOGS_DIR


def setup_logging() -> logging.Logger:
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
    _logger = logging.getLogger("backend")
    return _logger


logger = setup_logging()
