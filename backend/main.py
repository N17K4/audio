import uvicorn
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from config import APP_ROOT, DOWNLOAD_DIR, BACKEND_HOST, BACKEND_PORT
from logging_setup import logger
from routers import health, voices, jobs, convert, train, tasks

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.mount("/download", StaticFiles(directory=str(DOWNLOAD_DIR)), name="download")

# 静态前端（仅生产模式，打包后由 Electron 加载）
frontend_out = APP_ROOT / "frontend" / "out"
if frontend_out.exists():
    app.mount("/", StaticFiles(directory=str(frontend_out), html=True), name="static")

app.include_router(health.router)
app.include_router(voices.router)
app.include_router(jobs.router)
app.include_router(convert.router)
app.include_router(train.router)
app.include_router(tasks.router)

logger.info("启动路径: APP_ROOT=%s  BACKEND_HOST=%s  BACKEND_PORT=%s", APP_ROOT, BACKEND_HOST, BACKEND_PORT)

if __name__ == "__main__":
    uvicorn.run(app, host=BACKEND_HOST, port=BACKEND_PORT)
