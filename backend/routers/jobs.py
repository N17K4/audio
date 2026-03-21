from fastapi import APIRouter, HTTPException

from job_queue import JOBS, _job_public, _cleanup_old_jobs
from routers.health import _clear_task_log

router = APIRouter()


@router.get("/jobs")
async def list_jobs():
    _cleanup_old_jobs()
    jobs = sorted(JOBS.values(), key=lambda j: j.get("created_at", 0), reverse=True)
    return {"jobs": [_job_public(j) for j in jobs]}


@router.get("/jobs/{job_id}")
async def get_job(job_id: str):
    job = JOBS.get(job_id)
    if not job:
        raise HTTPException(status_code=404, detail=f"任务不存在: {job_id}")
    return _job_public(job)


@router.delete("/jobs/{job_id}")
async def delete_job(job_id: str):
    job = JOBS.pop(job_id, None)
    if not job:
        raise HTTPException(status_code=404, detail=f"任务不存在: {job_id}")
    task = job.get("_task")
    if task and not task.done():
        task.cancel()
    return {"ok": True}


@router.delete("/jobs")
async def clear_jobs(status: str = "done"):
    """status=done 清除已完成/失败；status=all 清除全部。"""
    if status == "all":
        removed = len(JOBS)
        JOBS.clear()
    else:
        to_del = [jid for jid, j in JOBS.items() if j["status"] in ("completed", "failed")]
        for jid in to_del:
            JOBS.pop(jid, None)
        removed = len(to_del)
    _clear_task_log()
    return {"ok": True, "removed": removed}
