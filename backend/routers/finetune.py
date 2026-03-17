import os
import tempfile
import shutil
from typing import List
from fastapi import APIRouter, UploadFile, File, Form, HTTPException
from pydantic import BaseModel

from logging_setup import logger
router = APIRouter(prefix="/finetune", tags=["finetune"])


@router.post("/start")
async def start_finetune(
    model: str = Form(...),
    datasets: List[UploadFile] = File(...),  # 支持多个文件
    lora_r: int = Form(16),
    lora_alpha: int = Form(32),
    num_epochs: int = Form(3),
    batch_size: int = Form(2),
    learning_rate: float = Form(2e-4),
    max_seq_length: int = Form(512),
    export_format: str = Form("adapter"),
    output_dir: str = Form(""),  # 用户指定的输出目录，为空时自动生成
    hf_token: str = Form(""),   # HuggingFace Token（私有模型需要）
    hf_mirror: str = Form(""),  # 镜像地址（中国大陆用 https://hf-mirror.com）
):
    from services.finetune.trainer import start_finetune_job

    # 如果用户指定了输出目录，使用用户指定的；否则自动生成临时目录
    if output_dir and output_dir.strip():
        work_dir = output_dir.strip()
        os.makedirs(work_dir, exist_ok=True)
    else:
        work_dir = tempfile.mkdtemp()

    # 合并多个数据集文件到单个 train.jsonl
    dataset_path = os.path.join(work_dir, "train.jsonl")
    with open(dataset_path, "wb") as out_f:
        for dataset in datasets:
            if dataset.filename:
                content = await dataset.read()
                out_f.write(content)
                # 确保每个文件末尾有换行符（防止 JSONL 格式问题）
                if content and not content.endswith(b'\n'):
                    out_f.write(b'\n')

    try:
        job_id = start_finetune_job(
            model=model,
            dataset_path=dataset_path,
            output_dir=work_dir,
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
        shutil.rmtree(work_dir, ignore_errors=True)
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
