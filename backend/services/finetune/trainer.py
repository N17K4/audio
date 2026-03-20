import subprocess
import json
import uuid
import os
import shutil
import time as _time
from pathlib import Path
from datetime import datetime
import logging
from config import FISH_SPEECH_DIR, APP_ROOT
from utils.engine import get_embedded_python
from job_queue import JOBS

logger = logging.getLogger(__name__)

FINETUNE_ROOT = FISH_SPEECH_DIR

_jobs: dict[str, dict] = {}


def start_finetune_job(
    model: str,
    dataset_path: str,
    output_dir: str,
    lora_r: int = 16,
    lora_alpha: int = 32,
    num_epochs: int = 3,
    batch_size: int = 2,
    learning_rate: float = 2e-4,
    max_seq_length: int = 512,
    export_format: str = "adapter",
    hf_token: str = "",    # HuggingFace Token，传给子进程环境变量 HF_TOKEN
    hf_mirror: str = "",   # HF 镜像地址，传给 HF_ENDPOINT 让 transformers 自动走镜像
) -> str:
    job_id = str(uuid.uuid4())
    job_output_dir = str(FINETUNE_ROOT / job_id)
    os.makedirs(job_output_dir, exist_ok=True)

    script = APP_ROOT / "backend" / "wrappers" / "finetune" / "train.py"
    python = get_embedded_python()

    cmd = [
        str(python), str(script),
        "--model", model,
        "--dataset", dataset_path,
        "--output_dir", job_output_dir,
        "--lora_r", str(lora_r),
        "--lora_alpha", str(lora_alpha),
        "--num_epochs", str(num_epochs),
        "--batch_size", str(batch_size),
        "--learning_rate", str(learning_rate),
        "--max_seq_length", str(max_seq_length),
        "--export_format", export_format,
    ]

    now = _time.time()
    _jobs[job_id] = {
        "job_id": job_id,
        "status": "running",
        "model": model,
        "progress": 0.0,
        "loss_curve": [],
        "log_tail": [],
        "output_dir": job_output_dir,
        "export_format": export_format,
        "created_at": datetime.utcnow().isoformat(),
        "_process": None,
    }
    JOBS[job_id] = {
        "id": job_id, "type": "toolbox",
        "label": f"LoRA 微调 — {model}", "provider": "lora",
        "is_local": True, "status": "running",
        "created_at": now, "started_at": now, "completed_at": None,
        "result_url": None, "result_text": None, "error": None,
        "_params": {"model": model},
    }

    # 构建子进程环境变量：继承当前环境，再覆盖 HF 相关变量
    env = {**os.environ}
    if hf_token:
        env["HF_TOKEN"] = hf_token          # transformers 自动读取此变量做鉴权
    if hf_mirror:
        env["HF_ENDPOINT"] = hf_mirror      # transformers/datasets 走此镜像下载

    def run():
        try:
            proc = subprocess.Popen(
                cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True,
                env=env
            )
            _jobs[job_id]["_process"] = proc
            for line in proc.stdout:
                line = line.strip()
                _jobs[job_id]["log_tail"].append(line)
                if len(_jobs[job_id]["log_tail"]) > 100:
                    _jobs[job_id]["log_tail"] = _jobs[job_id]["log_tail"][-100:]
                try:
                    data = json.loads(line)
                    if "loss" in data:
                        _jobs[job_id]["loss_curve"].append(data["loss"])
                        total = data.get("total", 1)
                        step = data.get("step", 0)
                        _jobs[job_id]["progress"] = min(step / total, 1.0)
                    if data.get("status") == "done":
                        _jobs[job_id]["status"] = "done"
                except Exception:
                    pass
            proc.wait()
            if proc.returncode != 0 and _jobs[job_id]["status"] != "done":
                _jobs[job_id]["status"] = "error"
                if job_id in JOBS:
                    JOBS[job_id]["status"] = "failed"
                    JOBS[job_id]["completed_at"] = _time.time()
                    JOBS[job_id]["error"] = _jobs[job_id]["log_tail"][-1] if _jobs[job_id]["log_tail"] else "训练失败"
            elif _jobs[job_id]["status"] != "done":
                _jobs[job_id]["status"] = "done"
                _jobs[job_id]["progress"] = 1.0
            if _jobs[job_id]["status"] == "done" and job_id in JOBS:
                JOBS[job_id]["status"] = "completed"
                JOBS[job_id]["completed_at"] = _time.time()
        except Exception as e:
            _jobs[job_id]["status"] = "error"
            _jobs[job_id]["log_tail"].append(str(e))
            logger.error(f"微调任务失败: {e}")
            if job_id in JOBS:
                JOBS[job_id]["status"] = "failed"
                JOBS[job_id]["completed_at"] = _time.time()
                JOBS[job_id]["error"] = str(e)

    import threading
    threading.Thread(target=run, daemon=True).start()
    return job_id


def get_job_status(job_id: str) -> dict:
    job = _jobs.get(job_id)
    if not job:
        raise KeyError(f"任务不存在: {job_id}")
    result = {k: v for k, v in job.items() if not k.startswith("_")}
    return result


def list_jobs() -> list[dict]:
    return [{k: v for k, v in job.items() if not k.startswith("_")} for job in _jobs.values()]


def cancel_job(job_id: str):
    job = _jobs.get(job_id)
    if job and job.get("_process"):
        job["_process"].terminate()
        job["status"] = "cancelled"
    if job:
        output_dir = job.get("output_dir", "")
        if output_dir and Path(output_dir).exists():
            shutil.rmtree(output_dir, ignore_errors=True)
        _jobs.pop(job_id, None)
