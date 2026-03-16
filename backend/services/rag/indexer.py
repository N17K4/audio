import os
import shutil
import json
from pathlib import Path
from datetime import datetime

import logging
from config import MODEL_ROOT

logger = logging.getLogger(__name__)

RAG_ROOT = MODEL_ROOT / "rag"


def _collection_dir(name: str) -> Path:
    return RAG_ROOT / name


def list_collections() -> list[dict]:
    RAG_ROOT.mkdir(parents=True, exist_ok=True)
    result = []
    for d in sorted(RAG_ROOT.iterdir()):
        if not d.is_dir():
            continue
        meta_file = d / "meta.json"
        meta = {}
        if meta_file.exists():
            with open(meta_file) as f:
                meta = json.load(f)
        size_bytes = sum(p.stat().st_size for p in d.rglob("*") if p.is_file())
        result.append({
            "name": d.name,
            "doc_count": meta.get("doc_count", 0),
            "size_mb": round(size_bytes / 1024 / 1024, 2),
            "created_at": meta.get("created_at", ""),
        })
    return result


def build_collection(name: str, file_paths: list[str]) -> dict:
    try:
        from llama_index.core import SimpleDirectoryReader, VectorStoreIndex, StorageContext
        from llama_index.embeddings.ollama import OllamaEmbedding
        from llama_index.vector_stores.faiss import FaissVectorStore
        import faiss
    except ImportError as e:
        raise RuntimeError(f"RAG 依赖未安装: {e}，请先在引导页安装 RAG 引擎依赖") from e

    coll_dir = _collection_dir(name)
    coll_dir.mkdir(parents=True, exist_ok=True)

    # Copy files to a temp dir for SimpleDirectoryReader
    import tempfile
    with tempfile.TemporaryDirectory() as tmp:
        for fp in file_paths:
            shutil.copy(fp, tmp)
        docs = SimpleDirectoryReader(tmp).load_data()

    embed_model = OllamaEmbedding(
        model_name="nomic-embed-text",
        base_url="http://127.0.0.1:11434",
    )

    d = 768  # nomic-embed-text dimension
    faiss_index = faiss.IndexFlatL2(d)
    vector_store = FaissVectorStore(faiss_index=faiss_index)
    storage_context = StorageContext.from_defaults(vector_store=vector_store)

    VectorStoreIndex.from_documents(
        docs,
        storage_context=storage_context,
        embed_model=embed_model,
    )
    storage_context.persist(persist_dir=str(coll_dir))

    meta = {
        "doc_count": len(docs),
        "created_at": datetime.utcnow().isoformat(),
    }
    with open(coll_dir / "meta.json", "w") as f:
        json.dump(meta, f)

    logger.info(f"RAG 集合构建完成: {name}, 文档数: {len(docs)}")
    return {"name": name, "doc_count": len(docs)}


def delete_collection(name: str):
    coll_dir = _collection_dir(name)
    if coll_dir.exists():
        shutil.rmtree(coll_dir)
        logger.info(f"RAG 集合已删除: {name}")
