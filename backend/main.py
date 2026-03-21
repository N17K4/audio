import os
import shutil
import sys

os.environ.setdefault("PYTHONIOENCODING", "utf-8")

import uvicorn
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from config import APP_ROOT, DOWNLOAD_DIR, BACKEND_HOST, BACKEND_PORT, RUNTIME_ROOT, ML_PACKAGES_DIR
from logging_setup import logger
from routers import health, voices, jobs, convert, train, tasks, rag, agent, finetune, system

# ---------------------------------------------------------------------------
# runtime/ml/ を sys.path に追加（torch 等の ML パッケージを import 可能にする）
# ---------------------------------------------------------------------------
_ml_dir = ML_PACKAGES_DIR
if _ml_dir.is_dir():
    _ml_str = str(_ml_dir)
    if _ml_str not in sys.path:
        sys.path.append(_ml_str)
        logger.info("sys.path に ML パッケージディレクトリを追加: %s", _ml_str)

# ---------------------------------------------------------------------------
# ML パッケージの衝突防止クリーンアップ
# runtime/ml/ に torch 等をインストールした際、backend 本体の軽量依存と
# バージョン競合するパッケージが紛れ込むことがある。起動時に除去する。
# ---------------------------------------------------------------------------
_ML_CONFLICT_PREFIXES = [
    "pydantic_core", "pydantic-", "pydantic.",
    "fastapi", "starlette", "uvicorn",
    "httpx", "httpcore", "anyio", "sniffio",
    "typing_extensions", "annotated_types",
]

def _cleanup_ml_conflicts() -> None:
    if not _ml_dir.is_dir():
        return
    for entry in _ml_dir.iterdir():
        lower = entry.name.lower().replace("-", "_")
        for prefix in _ML_CONFLICT_PREFIXES:
            pp = prefix.replace("-", "_")
            if lower == pp or lower.startswith(pp + "-") or lower.startswith(pp + "."):
                try:
                    if entry.is_dir():
                        shutil.rmtree(entry)
                    else:
                        entry.unlink()
                    logger.info("ML 衝突パッケージを削除: %s", entry.name)
                except Exception:
                    pass
                break

_cleanup_ml_conflicts()

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.mount("/download", StaticFiles(directory=str(DOWNLOAD_DIR)), name="download")

app.include_router(health.router)
app.include_router(voices.router)
app.include_router(jobs.router)
app.include_router(convert.router)
app.include_router(train.router)
app.include_router(tasks.router)
app.include_router(rag.router)
app.include_router(agent.router)
app.include_router(finetune.router)
app.include_router(system.router)

# 静态前端必须最后挂载，否则 mount("/") 会拦截所有 POST 请求返回 405
frontend_out = APP_ROOT / "frontend" / "out"
if frontend_out.exists():
    app.mount("/", StaticFiles(directory=str(frontend_out), html=True), name="static")

logger.info("启动路径: APP_ROOT=%s  BACKEND_HOST=%s  BACKEND_PORT=%s", APP_ROOT, BACKEND_HOST, BACKEND_PORT)

if __name__ == "__main__":
    uvicorn.run(app, host=BACKEND_HOST, port=BACKEND_PORT)
