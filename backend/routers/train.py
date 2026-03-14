import asyncio
import json
import traceback
import uuid
from datetime import datetime
from pathlib import Path

from fastapi import APIRouter, File, Form, HTTPException, UploadFile

from config import TRAIN_DATA_DIR, VOICES_DIR, RUNTIME_ROOT
from job_queue import TRAIN_JOBS
from logging_setup import logger
from utils.engine import get_embedded_python, build_engine_env

router = APIRouter()

_TRAIN_SCRIPT = RUNTIME_ROOT / "rvc" / "train.py"


async def run_rvc_training(
    job_id: str,
    voice_id: str,
    voice_name: str,
    dataset_path: Path,
    epochs: int,
    f0_method: str,
    sample_rate: int,
) -> None:
    """调用 runtime/rvc/train.py 子进程执行真实 RVC 训练，解析 stdout 进度行更新 TRAIN_JOBS。"""
    TRAIN_JOBS[job_id]["status"] = "running"
    TRAIN_JOBS[job_id]["started_at"] = datetime.utcnow().isoformat()

    voice_dir = VOICES_DIR / voice_id

    if not _TRAIN_SCRIPT.exists():
        TRAIN_JOBS[job_id]["status"] = "failed"
        TRAIN_JOBS[job_id]["finished_at"] = datetime.utcnow().isoformat()
        TRAIN_JOBS[job_id]["error"] = f"训练脚本不存在: {_TRAIN_SCRIPT}"
        return

    try:
        py = get_embedded_python()
    except RuntimeError as e:
        TRAIN_JOBS[job_id]["status"] = "failed"
        TRAIN_JOBS[job_id]["finished_at"] = datetime.utcnow().isoformat()
        TRAIN_JOBS[job_id]["error"] = f"嵌入式 Python 未找到: {e}"
        return

    cmd = [
        py, str(_TRAIN_SCRIPT),
        "--dataset", str(dataset_path),
        "--voice-dir", str(voice_dir),
        "--voice-id", voice_id,
        "--voice-name", voice_name,
        "--epochs", str(epochs),
        "--f0-method", f0_method,
        "--sample-rate", str(sample_rate),
    ]

    env = build_engine_env("rvc")
    # 训练时允许联网下载（如需要），仅 inference 时强制离线
    env.pop("HF_HUB_OFFLINE", None)
    env.pop("TRANSFORMERS_OFFLINE", None)

    logger.info("[train] 启动训练子进程: job_id=%s voice_id=%s", job_id, voice_id)

    try:
        proc = await asyncio.create_subprocess_exec(
            *cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            env=env,
        )

        # 读取 stderr 至 buffer（避免管道堵塞）
        stderr_lines: list[str] = []

        async def _drain_stderr():
            assert proc.stderr
            async for line in proc.stderr:
                decoded = line.decode(errors="replace").rstrip()
                stderr_lines.append(decoded)
                logger.debug("[train][stderr] %s", decoded)

        stderr_task = asyncio.create_task(_drain_stderr())

        # 实时解析 stdout 进度 JSON
        assert proc.stdout
        async for raw_line in proc.stdout:
            line_str = raw_line.decode(errors="replace").strip()
            if not line_str:
                continue
            try:
                msg = json.loads(line_str)
                TRAIN_JOBS[job_id]["progress"] = msg.get("progress", 0)
                TRAIN_JOBS[job_id]["step"] = msg.get("step", "")
                TRAIN_JOBS[job_id]["message"] = msg.get("message", "")
                logger.info("[train] 进度 %s%%: %s", msg.get("progress", 0), msg.get("message", ""))
            except json.JSONDecodeError:
                logger.debug("[train][stdout] %s", line_str)

        await stderr_task
        rc = await proc.wait()

        if rc != 0:
            err_tail = "\n".join(stderr_lines[-20:])
            msg = TRAIN_JOBS[job_id].get("message", "")
            TRAIN_JOBS[job_id]["status"] = "failed"
            TRAIN_JOBS[job_id]["finished_at"] = datetime.utcnow().isoformat()
            TRAIN_JOBS[job_id]["error"] = (
                f"训练失败 (code={rc})"
                + (f": {msg}" if msg else "")
                + (f"\n{err_tail}" if err_tail else "")
            )
            logger.error("[train] 训练失败 code=%d job_id=%s\n%s", rc, job_id, err_tail)
            return

    except asyncio.CancelledError:
        TRAIN_JOBS[job_id]["status"] = "failed"
        TRAIN_JOBS[job_id]["finished_at"] = datetime.utcnow().isoformat()
        TRAIN_JOBS[job_id]["error"] = "已中断"
        raise
    except Exception as exc:
        TRAIN_JOBS[job_id]["status"] = "failed"
        TRAIN_JOBS[job_id]["finished_at"] = datetime.utcnow().isoformat()
        TRAIN_JOBS[job_id]["error"] = str(exc)
        logger.error("[train] 训练异常: %s", traceback.format_exc())
        return
    finally:
        # 清理上传的数据集文件
        try:
            dataset_path.unlink(missing_ok=True)
        except Exception:
            pass

    TRAIN_JOBS[job_id]["status"] = "completed"
    TRAIN_JOBS[job_id]["finished_at"] = datetime.utcnow().isoformat()
    TRAIN_JOBS[job_id]["voice_id"] = voice_id
    TRAIN_JOBS[job_id]["result"] = {
        "message": "训练完成",
        "voice_dir": str(VOICES_DIR / voice_id),
    }
    logger.info("[train] 训练完成 job_id=%s voice_id=%s", job_id, voice_id)


@router.post("/train")
async def train_voice(
    dataset: UploadFile = File(...),
    voice_id: str = Form(...),
    voice_name: str = Form(""),
    epochs: int = Form(0),
    f0_method: str = Form("harvest"),
    sample_rate: int = Form(40000),
):
    if not voice_id.strip():
        raise HTTPException(status_code=400, detail="voice_id 不能为空")

    safe_voice_id = "".join(
        ch for ch in voice_id.strip().lower() if ch.isalnum() or ch in ("_", "-")
    )
    if not safe_voice_id:
        raise HTTPException(status_code=400, detail="voice_id 含无效字符")

    safe_voice_name = voice_name.strip() or safe_voice_id
    ext = Path(dataset.filename or "dataset.zip").suffix or ".zip"
    job_id = str(uuid.uuid4())
    dataset_path = TRAIN_DATA_DIR / f"{job_id}{ext}"

    with open(dataset_path, "wb") as f:
        f.write(await dataset.read())

    TRAIN_JOBS[job_id] = {
        "job_id": job_id,
        "status": "queued",
        "progress": 0,
        "step": "",
        "message": "",
        "voice_id": safe_voice_id,
        "voice_name": safe_voice_name,
        "dataset": str(dataset_path),
        "created_at": datetime.utcnow().isoformat(),
    }

    asyncio.create_task(
        run_rvc_training(
            job_id, safe_voice_id, safe_voice_name,
            dataset_path, epochs, f0_method, sample_rate,
        )
    )

    return {"status": "accepted", "job_id": job_id, "message": "训练任务已提交"}


@router.get("/train/{job_id}")
async def get_train_job(job_id: str):
    job = TRAIN_JOBS.get(job_id)
    if not job:
        raise HTTPException(status_code=404, detail=f"任务不存在: {job_id}")
    return job
