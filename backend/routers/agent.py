import json
import time as _time
import uuid
from fastapi import APIRouter
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from logging_setup import logger
from job_queue import JOBS
from services.agent.tools import TOOLS
router = APIRouter(prefix="/agent", tags=["agent"])


class AgentRunRequest(BaseModel):
    task: str
    tools: list[str] = []
    provider: str = "ollama"
    model: str = "qwen2.5:7b"
    api_key: str = ""
    ollama_url: str = "http://127.0.0.1:11434"


@router.get("/tools")
async def list_tools():
    return [
        {"name": name, "desc": info["desc"], "args": info["args"]}
        for name, info in TOOLS.items()
    ]


@router.post("/run")
async def run_agent(req: AgentRunRequest):
    from services.agent.graph import run_react_agent

    job_id = str(uuid.uuid4())
    now = _time.time()
    JOBS[job_id] = {
        "id": job_id, "type": "toolbox",
        "label": f"Agent — {req.task[:40]}", "provider": req.provider,
        "is_local": True, "status": "running",
        "created_at": now, "started_at": now, "completed_at": None,
        "result_url": None, "result_text": None, "error": None,
        "_params": {"task": req.task, "model": req.model},
    }

    def generate():
        last_chunk = ""
        try:
            for chunk in run_react_agent(
                task=req.task,
                tool_names=req.tools,
                provider=req.provider,
                model=req.model,
                api_key=req.api_key,
                ollama_url=req.ollama_url,
            ):
                last_chunk = chunk
                yield f"data: {chunk}\n\n"
            if job_id in JOBS:
                JOBS[job_id]["status"] = "completed"
                JOBS[job_id]["completed_at"] = _time.time()
                JOBS[job_id]["result_text"] = last_chunk[:200] if last_chunk else None
        except Exception as e:
            if job_id in JOBS:
                JOBS[job_id]["status"] = "failed"
                JOBS[job_id]["completed_at"] = _time.time()
                JOBS[job_id]["error"] = str(e)
            raise

    return StreamingResponse(generate(), media_type="text/event-stream")
