import json
from fastapi import APIRouter
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from logging_setup import logger
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

    def generate():
        for chunk in run_react_agent(
            task=req.task,
            tool_names=req.tools,
            provider=req.provider,
            model=req.model,
            api_key=req.api_key,
            ollama_url=req.ollama_url,
        ):
            yield f"data: {chunk}\n\n"

    return StreamingResponse(generate(), media_type="text/event-stream")
