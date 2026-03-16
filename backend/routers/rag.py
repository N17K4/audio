import asyncio
import uuid
import shutil
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, UploadFile, File, Form, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from logging_setup import logger
router = APIRouter(prefix="/rag", tags=["rag"])

# Simple in-memory job store for build jobs
_build_jobs: dict[str, dict] = {}


class QueryRequest(BaseModel):
    collection: str
    question: str
    top_k: int = 5
    provider: str = "ollama"           # 'ollama' 或 'openai'
    model: str = "qwen2.5:7b"         # 语言模型名称
    api_key: str = ""                  # OpenAI API Key
    ollama_url: str = "http://127.0.0.1:11434"  # Ollama 服务地址


@router.get("/collections")
async def list_collections():
    from services.rag.indexer import list_collections
    return list_collections()


@router.delete("/collections/{name}")
async def delete_collection(name: str):
    from services.rag.indexer import delete_collection
    delete_collection(name)
    return {"ok": True}


@router.post("/collections")
async def build_collection(
    name: str = Form(...),
    files: list[UploadFile] = File(...),
):
    import tempfile, os
    from services.rag.indexer import build_collection

    # Save uploaded files to temp directory
    tmp_dir = tempfile.mkdtemp()
    saved_paths = []
    try:
        for f in files:
            dest = os.path.join(tmp_dir, f.filename)
            with open(dest, "wb") as out:
                out.write(await f.read())
            saved_paths.append(dest)

        job_id = str(uuid.uuid4())
        _build_jobs[job_id] = {"status": "running", "name": name}

        def run():
            try:
                result = build_collection(name, saved_paths)
                _build_jobs[job_id].update({"status": "done", "result": result})
            except Exception as e:
                _build_jobs[job_id].update({"status": "error", "error": str(e)})
            finally:
                shutil.rmtree(tmp_dir, ignore_errors=True)

        asyncio.get_event_loop().run_in_executor(None, run)
        return {"job_id": job_id, "status": "running"}
    except Exception as e:
        shutil.rmtree(tmp_dir, ignore_errors=True)
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/collections/jobs/{job_id}")
async def get_build_job(job_id: str):
    job = _build_jobs.get(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="任务不存在")
    return job


@router.post("/query")
async def query_rag(req: QueryRequest):
    from services.rag.querier import query_collection

    async def generate():
        try:
            answer = await asyncio.get_event_loop().run_in_executor(
                None, lambda: query_collection(
                    req.collection, req.question, req.top_k,
                    provider=req.provider,
                    model=req.model,
                    api_key=req.api_key,
                    ollama_url=req.ollama_url,
                )
            )
            yield f"data: {answer}\n\n"
        except Exception as e:
            yield f"data: [错误] {e}\n\n"

    return StreamingResponse(generate(), media_type="text/event-stream")
