import asyncio
import traceback
import uuid
from pathlib import Path
from typing import Dict

from config import MAX_LOCAL_QUEUE
from logging_setup import logger

# 所有异步任务（TTS / VC）的状态存储，key=job_id
JOBS: Dict[str, Dict] = {}
# 训练任务状态存储
TRAIN_JOBS: Dict[str, Dict] = {}
# 本地推理信号量：同时只允许 1 个本地推理（RVC/Seed-VC/FishSpeech 共享 GPU/CPU 内存）
LOCAL_SEM = asyncio.Semaphore(1)


def _make_job(job_type: str, label: str, provider: str, is_local: bool) -> Dict:
    import time as _t
    job_id = str(uuid.uuid4())
    job: Dict = {
        "id": job_id,
        "type": job_type,
        "label": label,
        "provider": provider,
        "is_local": is_local,
        "status": "queued",
        "created_at": _t.time(),
        "started_at": None,
        "completed_at": None,
        "result_url": None,
        "result_text": None,
        "error": None,
    }
    JOBS[job_id] = job
    return job


def _job_public(job: Dict) -> Dict:
    """返回不含内部字段的 job 副本。"""
    return {k: v for k, v in job.items() if not k.startswith("_")}


def _cleanup_old_jobs() -> None:
    """保留最近 100 条，自动删除已完成/失败且超过 1 小时的记录。"""
    import time as _time
    now = _time.time()
    stale = [
        jid for jid, j in JOBS.items()
        if j["status"] in ("completed", "failed")
        and now - j.get("created_at", now) > 3600
    ]
    for jid in stale:
        JOBS.pop(jid, None)
    # 超过 100 条时删最老的已完成/失败记录
    done = sorted(
        [(jid, j) for jid, j in JOBS.items() if j["status"] in ("completed", "failed")],
        key=lambda x: x[1].get("created_at", 0),
    )
    while len(JOBS) > 100 and done:
        jid, _ = done.pop(0)
        JOBS.pop(jid, None)


async def _run_vc_job(job_id: str, fn, *fn_args) -> None:
    """本地 VC 推理后台协程：等待信号量 → 运行 → 更新状态。"""
    import time as _t
    job = JOBS.get(job_id)
    if not job:
        return
    async with LOCAL_SEM:
        if JOBS.get(job_id) is None:
            return
        job["status"] = "running"
        job["started_at"] = _t.time()
        try:
            result_url = await asyncio.to_thread(fn, *fn_args)
            job["result_url"] = result_url
            job["status"] = "completed"
        except asyncio.CancelledError:
            job["status"] = "failed"
            job["error"] = "已中断"
            raise
        except Exception as exc:
            logger.error("VC job %s 失败: %s", job_id, traceback.format_exc())
            job["status"] = "failed"
            job["error"] = str(exc)
        finally:
            job["completed_at"] = _t.time()
            # 清理临时参考音频
            ref_tmp = job.pop("_ref_audio_tmp", None)
            if ref_tmp and Path(ref_tmp).exists():
                try:
                    Path(ref_tmp).unlink()
                except Exception:
                    pass
            # 清理输入文件
            input_tmp = job.pop("_input_tmp", None)
            if input_tmp and Path(input_tmp).exists():
                try:
                    Path(input_tmp).unlink()
                except Exception:
                    pass


async def _run_tts_job(job_id: str, fn, *fn_args) -> None:
    """TTS 后台协程：本地用信号量，云服务直接运行。"""
    import time as _t
    job = JOBS.get(job_id)
    if not job:
        return
    is_local = job.get("is_local", False)
    ctx = LOCAL_SEM if is_local else asyncio.nullcontext()
    async with ctx:
        if JOBS.get(job_id) is None:
            return
        job["status"] = "running"
        job["started_at"] = _t.time()
        try:
            result = await fn(*fn_args)
            job["result_url"] = result.get("result_url")
            job["result_text"] = result.get("text") or result.get("message") or ""
            job["status"] = "completed"
        except asyncio.CancelledError:
            job["status"] = "failed"
            job["error"] = "已中断"
            raise
        except Exception as exc:
            logger.error("TTS job %s 失败: %s", job_id, traceback.format_exc())
            job["status"] = "failed"
            job["error"] = str(exc)
        finally:
            job["completed_at"] = _t.time()
            ref_tmp = job.pop("_ref_audio_tmp", None)
            if ref_tmp and Path(ref_tmp).exists():
                try:
                    Path(ref_tmp).unlink()
                except Exception:
                    pass
