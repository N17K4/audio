import os
import tempfile
import shutil
from fastapi import APIRouter, UploadFile, File, Form, HTTPException
from pydantic import BaseModel

from logging_setup import logger
router = APIRouter(prefix="/finetune", tags=["finetune"])


@router.post("/start")
async def start_finetune(
    model: str = Form(...),
    dataset: UploadFile = File(...),
    lora_r: int = Form(16),
    lora_alpha: int = Form(32),
    num_epochs: int = Form(3),
    batch_size: int = Form(2),
    learning_rate: float = Form(2e-4),
    max_seq_length: int = Form(512),
    export_format: str = Form("adapter"),
    hf_token: str = Form(""),   # HuggingFace Token（私有模型需要）
    hf_mirror: str = Form(""),  # 镜像地址（中国大陆用 https://hf-mirror.com）
):
    from services.finetune.trainer import start_finetune_job

    tmp_dir = tempfile.mkdtemp()
    dataset_path = os.path.join(tmp_dir, dataset.filename or "train.jsonl")
    with open(dataset_path, "wb") as f:
        f.write(await dataset.read())

    try:
        job_id = start_finetune_job(
            model=model,
            dataset_path=dataset_path,
            output_dir=tmp_dir,
            lora_r=lora_r,
            lora_alpha=lora_alpha,
            num_epochs=num_epochs,
            batch_size=batch_size,
            learning_rate=learning_rate,
            max_seq_length=max_seq_length,
            export_format=export_format,
            hf_token=hf_token,
            hf_mirror=hf_mirror,
        )
        return {"job_id": job_id, "status": "running"}
    except Exception as e:
        shutil.rmtree(tmp_dir, ignore_errors=True)
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/jobs")
async def list_jobs():
    from services.finetune.trainer import list_jobs
    return list_jobs()


@router.get("/jobs/{job_id}")
async def get_job(job_id: str):
    from services.finetune.trainer import get_job_status
    try:
        return get_job_status(job_id)
    except KeyError:
        raise HTTPException(status_code=404, detail="任务不存在")


@router.delete("/jobs/{job_id}")
async def cancel_job(job_id: str):
    from services.finetune.trainer import cancel_job
    cancel_job(job_id)
    return {"ok": True}
