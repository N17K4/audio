"""
Job 相关数据结构定义。
JOBS / TRAIN_JOBS 字典在 job_queue.py 中定义，此处仅作类型说明。
"""
from typing import Dict, Optional, Any


# Job 字典的典型结构（用于文档/类型提示）
class JobDict(Dict):
    """
    id: str
    type: str           # "vc" | "tts"
    label: str
    provider: str
    is_local: bool
    status: str         # "queued" | "running" | "completed" | "failed"
    created_at: float
    started_at: Optional[float]
    completed_at: Optional[float]
    result_url: Optional[str]
    result_text: Optional[str]
    error: Optional[str]
    # 内部字段（不对外暴露）
    _ref_audio_tmp: Optional[str]
    _input_tmp: Optional[str]
    _task: Any
    """
    pass


class TrainJobDict(Dict):
    """
    job_id: str
    status: str         # "queued" | "running" | "completed" | "failed"
    voice_id: str
    voice_name: str
    dataset: str
    created_at: str
    started_at: Optional[str]
    finished_at: Optional[str]
    voice_id: Optional[str]
    result: Optional[dict]
    error: Optional[str]
    """
    pass
