# RAG + Agent + LoRA 完整系统讲解

> 本文档包含所有核心文件的完整代码 + 逐行中文注释

---

## 📚 目录

1. [第1阶段：RAG 基础](#第1阶段rag-基础)
2. [第2阶段：Agent 进阶](#第2阶段agent-进阶)
3. [第3阶段：LoRA 微调高级](#第3阶段lora-微调高级)
4. [快速查询表](#快速查询表)

---

# 第1阶段：RAG 基础

## 1.1 数据类型定义 (frontend/types/index.ts)

```typescript
// ═══════════════════════════════════════════════════════════════
// RAG 知识库信息结构
// ═══════════════════════════════════════════════════════════════

export interface RagCollection {
  name: string;           // 知识库名称（如 "company_docs"）
  doc_count: number;      // 包含的文档数量（如 5 个 PDF）
  size_mb: number;        // 占用磁盘大小（如 2.3 MB）
  created_at: string;     // 创建时间（ISO 格式）
}

// 使用场景：
// const coll: RagCollection = {
//   name: "mybooks",
//   doc_count: 10,
//   size_mb: 45.2,
//   created_at: "2024-03-17T10:30:00Z"
// }
```

## 1.2 前端 Hook (frontend/hooks/useRag.ts)

```typescript
import { useState, useCallback } from 'react';
import { RagCollection } from '../types';

// ═══════════════════════════════════════════════════════════════
// useRag Hook - 管理 RAG 的所有状态和操作
// 作用：封装所有与后端 API 的交互
// ═══════════════════════════════════════════════════════════════

export function useRag(backendUrl: string) {
  // ─── 状态 1: 知识库列表 ─────────────────────────────────────
  // collections = [{name: "doc1", doc_count: 5, ...}, ...]
  // 页面加载时自动填充
  const [collections, setCollections] = useState<RagCollection[]>([]);

  // ─── 状态 2: 问答结果 ─────────────────────────────────────
  // 存储 LLM 生成的回答文本
  // 用户提问后，通过流式更新不断追加内容
  const [ragAnswer, setRagAnswer] = useState('');

  // ─── 状态 3: 加载状态 ─────────────────────────────────────
  // true = 正在等待回答，禁用提问按钮
  // false = 空闲状态，用户可以提问
  const [loading, setLoading] = useState(false);

  // ╔═══════════════════════════════════════════════════════════╗
  // ║ 函数 1: 获取知识库列表                                     ║
  // ║ 调用后端: GET /rag/collections                              ║
  // ╚═══════════════════════════════════════════════════════════╝
  const fetchCollections = useCallback(async () => {
    // 第 10 行: 发起 GET 请求
    const res = await fetch(`${backendUrl}/rag/collections`);
    // 返回示例：
    // [
    //   {name: "doc1", doc_count: 5, size_mb: 2.3, created_at: "2024-03-17..."},
    //   {name: "doc2", doc_count: 10, size_mb: 5.1, created_at: "2024-03-16..."}
    // ]

    // 第 11 行: 如果请求成功 (状态 200)
    if (res.ok)
      // 解析 JSON 并更新状态
      setCollections(await res.json());
  }, [backendUrl]);
  // useCallback 的好处：只有当 backendUrl 变化时才重新创建函数


  // ╔═══════════════════════════════════════════════════════════╗
  // ║ 函数 2: 构建知识库（上传文件 + 索引）                     ║
  // ║ 调用后端: POST /rag/collections (multipart/form-data)      ║
  // ╚═══════════════════════════════════════════════════════════╝
  const buildCollection = useCallback(async (name: string, files: File[]) => {
    // 第 15-16 行: 创建 FormData（用于文件上传）
    const form = new FormData();
    form.append('name', name);  // 库名：company_docs

    // 第 17 行: 把所有文件放入 form
    // 后端会接收到 files 列表
    files.forEach(f => form.append('files', f));

    // 第 18 行: POST 请求上传
    // FormData 自动设置 Content-Type: multipart/form-data
    const res = await fetch(`${backendUrl}/rag/collections`, {
      method: 'POST',
      body: form
    });

    // 后端返回: {job_id: "abc123...", status: "running"}
    // job_id 用于后续查询进度

    // 第 19 行: 解析返回值
    return await res.json();
  }, [backendUrl]);


  // ╔═══════════════════════════════════════════════════════════╗
  // ║ 函数 3: 删除知识库                                         ║
  // ║ 调用后端: DELETE /rag/collections/{name}                    ║
  // ╚═══════════════════════════════════════════════════════════╝
  const deleteCollection = useCallback(async (name: string) => {
    // 第 23 行: 发起 DELETE 请求
    // encodeURIComponent：把名称编码为 URL 安全格式
    // 例如："my docs" → "my%20docs"
    await fetch(
      `${backendUrl}/rag/collections/${encodeURIComponent(name)}`,
      { method: 'DELETE' }
    );

    // 第 24 行: 删除成功后，重新拉取列表
    // 这样 UI 会自动更新，删除的库消失
    await fetchCollections();
  }, [backendUrl, fetchCollections]);


  // ╔═══════════════════════════════════════════════════════════╗
  // ║ 函数 4: 知识库问答（核心！）                              ║
  // ║ 调用后端: POST /rag/query                                  ║
  // ║ 返回方式: SSE 流式返回（Server-Sent Events）              ║
  // ╚═══════════════════════════════════════════════════════════╝
  const queryRag = useCallback(async (collection: string, question: string) => {
    // 第 28 行: 清空旧答案
    setRagAnswer('');

    // 第 29 行: 打开加载状态
    setLoading(true);

    try {
      // 第 31-35 行: 发送查询请求
      const res = await fetch(`${backendUrl}/rag/query`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          collection,    // 要查询的知识库
          question       // 用户问题
        }),
      });
      // 后端不会立即返回完整答案
      // 而是流式返回：data: 第一块\n\ndata: 第二块\n\n...

      // 第 36-48 行: 处理流式响应（SSE）
      const reader = res.body!.getReader();
      // getReader() 返回一个流读取器，可以分块读取数据

      const decoder = new TextDecoder();
      // 用于把 Uint8Array 字节转成字符串

      let buf = '';
      // 缓冲区：因为数据可能分多次到达
      // 例如第一次到达 "data: 你好"，第二次到达 "\n\ndata: 世界"

      while (true) {
        // 第 40 行: 读一块数据
        const { done, value } = await reader.read();
        // done: 是否读完了所有数据
        // value: 这次读到的 Uint8Array 字节数组

        if (done) break;
        // 没有更多数据了，退出循环

        // 第 42 行: 把字节转成字符串，加到缓冲区
        buf += decoder.decode(value, { stream: true });
        // 例如：buf = 'data: 你\n\ndata: 好'

        // 第 43 行: 用 "\n\n" 分割成完整的 SSE 事件
        const lines = buf.split('\n\n');
        // 例如：['data: 你', 'data: 好', '']

        // 第 44 行: 最后一项可能不完整，保留在缓冲区
        buf = lines.pop() || '';
        // 例如：pop() 返回 ''，buf 变成 ''
        // 下次新数据来时，会继续拼接

        // 第 45-47 行: 处理每个完整的事件
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            // 去掉 "data: " 前缀，只保留内容
            // 追加到 answer 状态
            // 这就是为什么用户能看到答案逐字出现！
            setRagAnswer(prev => prev + line.slice(6));
          }
        }
      }
    } finally {
      // 第 50 行: 不管成功还是失败，关闭加载状态
      setLoading(false);
    }
  }, [backendUrl]);

  // 第 54 行: 返回所有函数和状态，给 RagPanel 使用
  return {
    collections,           // 知识库列表
    ragAnswer,            // 当前回答
    loading,              // 加载中标志
    fetchCollections,     // 获取列表函数
    buildCollection,      // 构建函数
    deleteCollection,     // 删除函数
    queryRag              // 查询函数
  };
}
```

## 1.3 后端路由 (backend/routers/rag.py)

```python
# ═══════════════════════════════════════════════════════════════
# RAG API 路由
# 包含 4 个端点：列表、创建、删除、查询
# ═══════════════════════════════════════════════════════════════

import asyncio, uuid, shutil
from pathlib import Path
from fastapi import APIRouter, UploadFile, File, Form, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from logging_setup import logger

# 第 12 行: 创建 APIRouter，所有路由前缀都是 /rag
router = APIRouter(prefix="/rag", tags=["rag"])

# 第 15 行: 内存中的任务字典
# 存放正在构建的知识库任务
# 结构：{job_id: {status: "running"/"done"/"error", name: "...", ...}}
_build_jobs: dict[str, dict] = {}


# ╔═══════════════════════════════════════════════════════════╗
# ║ 数据模型：查询请求                                         ║
# ╚═══════════════════════════════════════════════════════════╝
class QueryRequest(BaseModel):
    collection: str       # 知识库名称
    question: str         # 用户问题
    top_k: int = 5        # 检索最相关的 5 个段落
    provider: str = "ollama"          # LLM 服务商：ollama / openai / gemini
    model: str = "qwen2.5:7b"         # 模型名称
    api_key: str = ""                 # OpenAI API Key（如果用云端服务）
    ollama_url: str = "http://127.0.0.1:11434"  # Ollama 地址


# ╔═══════════════════════════════════════════════════════════╗
# ║ 端点 1: GET /rag/collections                              ║
# ║ 功能：列出所有已有的知识库                                ║
# ╚═══════════════════════════════════════════════════════════╝
@router.get("/collections")
async def list_collections():
    # 第 30 行: 导入后端服务
    from services.rag.indexer import list_collections

    # 第 31 行: 调用后端函数，返回库列表
    # 返回格式：[{name, doc_count, size_mb, created_at}, ...]
    return list_collections()


# ╔═══════════════════════════════════════════════════════════╗
# ║ 端点 2: DELETE /rag/collections/{name}                    ║
# ║ 功能：删除一个知识库                                      ║
# ╚═══════════════════════════════════════════════════════════╝
@router.delete("/collections/{name}")
async def delete_collection(name: str):
    # 第 36 行: 导入删除函数
    from services.rag.indexer import delete_collection

    # 第 37 行: 调用删除（会删除磁盘上的文件夹）
    delete_collection(name)

    # 第 38 行: 返回成功信号
    return {"ok": True}


# ╔═══════════════════════════════════════════════════════════╗
# ║ 端点 3: POST /rag/collections                             ║
# ║ 功能：上传文件，构建知识库（后台异步执行）               ║
# ║ 返回：job_id，前端可用此 ID 查询进度                      ║
# ╚═══════════════════════════════════════════════════════════╝
@router.post("/collections")
async def build_collection(
    name: str = Form(...),              # 从 form 数据中获取库名
    files: list[UploadFile] = File(...) # 从 form 数据中获取多个文件
):
    import tempfile, os
    from services.rag.indexer import build_collection

    # 第 50 行: 创建临时目录来临时存放上传的文件
    # tempfile.mkdtemp() 返回路径如：/tmp/tmpXXXXXX
    tmp_dir = tempfile.mkdtemp()

    saved_paths = []  # 保存的文件路径列表

    try:
        # 第 53-57 行: 循环保存每个上传的文件
        for f in files:
            # f.filename 是原始文件名，如 "document.pdf"
            dest = os.path.join(tmp_dir, f.filename)  # 完整路径

            with open(dest, "wb") as out:
                # 第 56 行: 读取上传的文件内容（async）
                out.write(await f.read())

            saved_paths.append(dest)

        # saved_paths = ["/tmp/tmpXXX/file1.pdf", "/tmp/tmpXXX/file2.txt", ...]

        # 第 59-60 行: 生成唯一的任务 ID，记录到内存
        job_id = str(uuid.uuid4())  # 生成 UUID，如 "a1b2c3d4-e5f6-..."
        _build_jobs[job_id] = {"status": "running", "name": name}

        # 第 62-69 行: 定义后台任务函数
        def run():
            # 这个函数会在线程池中执行，不阻塞 API 返回
            try:
                # 第 64 行: 调用真实的构建逻辑（耗时操作）
                # 包括：文件切片、向量化、存储到 FAISS
                result = build_collection(name, saved_paths)
                # result = {doc_count: 10, ...}

                # 第 65 行: 更新任务状态为完成
                _build_jobs[job_id].update({"status": "done", "result": result})

            except Exception as e:
                # 第 67 行: 如果出错，记录错误
                _build_jobs[job_id].update({"status": "error", "error": str(e)})

            finally:
                # 第 69 行: 无论成功还是失败，清理临时文件
                shutil.rmtree(tmp_dir, ignore_errors=True)

        # 第 71 行: 在线程池中执行后台任务
        # asyncio.get_event_loop() 获取当前事件循环
        # run_in_executor(None, run) 在默认线程池中运行 run()
        asyncio.get_event_loop().run_in_executor(None, run)

        # 第 72 行: 立即返回，告诉前端任务已提交
        # 前端会根据 job_id 定时查询进度
        return {"job_id": job_id, "status": "running"}

    except Exception as e:
        # 如果上传本身出错（如磁盘满），清理并返回错误
        shutil.rmtree(tmp_dir, ignore_errors=True)
        raise HTTPException(status_code=500, detail=str(e))


# ╔═══════════════════════════════════════════════════════════╗
# ║ 端点 4: POST /rag/query                                   ║
# ║ 功能：查询知识库，流式返回答案（SSE）                     ║
# ║ 核心特点：不是一次性返回，而是分块流式返回               ║
# ╚═══════════════════════════════════════════════════════════╝
@router.post("/query")
async def query_rag(req: QueryRequest):
    # 第 88 行: 导入查询函数
    from services.rag.querier import query_collection

    # 第 90-104 行: 定义异步生成器函数
    # 生成器会分块 yield（返回）数据给前端
    async def generate():
        try:
            # 第 92-99 行: 在线程池中执行查询（因为是 IO 密集操作）
            answer = await asyncio.get_event_loop().run_in_executor(
                None, lambda: query_collection(
                    req.collection,    # 知识库名
                    req.question,      # 问题
                    req.top_k,         # 检索 5 个段落
                    provider=req.provider,        # 使用哪个 LLM 服务商
                    model=req.model,              # 模型
                    api_key=req.api_key,          # API Key
                    ollama_url=req.ollama_url,    # Ollama 地址
                )
            )
            # answer = "根据文档，答案是..."（完整的自然语言回答）

            # 第 101 行: 以 SSE 格式返回
            # 格式：f"data: {内容}\n\n"
            # 前缀 "data: " + 答案文本 + 两个换行符
            yield f"data: {answer}\n\n"

        except Exception as e:
            # 如果出错，也用 SSE 格式返回错误信息
            yield f"data: [错误] {e}\n\n"

    # 第 105 行: 返回 SSE 流响应
    # StreamingResponse 会持续发送生成器产生的数据
    # media_type="text/event-stream" 告诉浏览器这是 SSE 流
    return StreamingResponse(generate(), media_type="text/event-stream")
```

## 1.4 后端服务：文件索引 (backend/services/rag/indexer.py)

```python
# ═══════════════════════════════════════════════════════════════
# RAG 知识库构建服务
# 核心：文件 → 切片 → 向量化 → FAISS 存储
# ═══════════════════════════════════════════════════════════════

import os, shutil, json
from pathlib import Path
from datetime import datetime
from config import MODEL_ROOT

logger = logging.getLogger(__name__)

# 第 12 行: 知识库根目录
# 所有知识库都存放在这里，如 models/rag/doc1/, models/rag/doc2/
RAG_ROOT = MODEL_ROOT / "rag"


def _collection_dir(name: str) -> Path:
    # 第 15-16 行: 获取某个知识库的目录路径
    # 例如：name="doc1" → return Path("models/rag/doc1")
    return RAG_ROOT / name


# ╔═══════════════════════════════════════════════════════════╗
# ║ 函数 1: 列出所有知识库                                    ║
# ║ 返回：[{name, doc_count, size_mb, created_at}, ...]       ║
# ╚═══════════════════════════════════════════════════════════╝
def list_collections() -> list[dict]:
    # 第 20 行: 确保 RAG_ROOT 目录存在
    RAG_ROOT.mkdir(parents=True, exist_ok=True)

    result = []

    # 第 22 行: 遍历 RAG_ROOT 下的所有子目录
    for d in sorted(RAG_ROOT.iterdir()):
        # 第 23 行: 只处理目录，忽略文件
        if not d.is_dir():
            continue

        # 第 25 行: 读取元数据文件 meta.json
        meta_file = d / "meta.json"
        meta = {}
        if meta_file.exists():
            # meta.json 包含：doc_count, created_at 等信息
            with open(meta_file) as f:
                meta = json.load(f)

        # 第 30 行: 计算目录总大小
        # d.rglob("*") 递归列出所有文件
        size_bytes = sum(p.stat().st_size for p in d.rglob("*") if p.is_file())

        # 第 31-36 行: 添加到结果列表
        result.append({
            "name": d.name,                        # 目录名，如 "doc1"
            "doc_count": meta.get("doc_count", 0), # 文档数，默认 0
            "size_mb": round(size_bytes / 1024 / 1024, 2),  # 转换为 MB
            "created_at": meta.get("created_at", ""),       # 创建时间
        })

    return result


# ╔═══════════════════════════════════════════════════════════╗
# ║ 函数 2: 构建知识库（核心！）                             ║
# ║ 输入：name="doc1", file_paths=["/tmp/file1.pdf", ...]     ║
# ║ 过程：读取 → 切片 → 向量化 → 存储                        ║
# ╚═══════════════════════════════════════════════════════════╝
def build_collection(name: str, file_paths: list[str]) -> dict:
    # 第 41-47 行: 导入依赖库
    # 这些库在 setup 阶段已经安装
    try:
        from llama_index.core import SimpleDirectoryReader, VectorStoreIndex, StorageContext
        from llama_index.embeddings.ollama import OllamaEmbedding
        from llama_index.vector_stores.faiss import FaissVectorStore
        import faiss
    except ImportError as e:
        raise RuntimeError(f"RAG 依赖未安装: {e}") from e

    # 第 49-50 行: 创建知识库目录
    # 例如：models/rag/doc1/
    coll_dir = _collection_dir(name)
    coll_dir.mkdir(parents=True, exist_ok=True)

    # ─── 步骤 1: 读取和切片文件 ─────────────────────────────
    # 第 52-57 行: 用临时目录来放置上传的文件
    import tempfile
    with tempfile.TemporaryDirectory() as tmp:
        # 把上传的文件都复制到临时目录
        for fp in file_paths:
            shutil.copy(fp, tmp)

        # SimpleDirectoryReader 自动识别 PDF、DOCX、TXT、XLSX
        # 返回 Document 对象列表
        docs = SimpleDirectoryReader(tmp).load_data()
    # docs = [Document(content="..."), Document(content="..."), ...]

    # ─── 步骤 2: 初始化 Embedding 模型 ──────────────────────
    # 第 59-62 行: 使用 Ollama 的 nomic-embed-text 模型
    # 这个模型把文本转成 768 维的向量
    embed_model = OllamaEmbedding(
        model_name="nomic-embed-text",
        base_url="http://127.0.0.1:11434",  # Ollama 服务地址
    )

    # ─── 步骤 3: 初始化 FAISS 向量库 ──────────────────────
    # 第 64-67 行: 创建 FAISS 索引
    d = 768  # nomic-embed-text 的向量维度
    faiss_index = faiss.IndexFlatL2(d)  # 用 L2 距离计算相似度
    vector_store = FaissVectorStore(faiss_index=faiss_index)
    storage_context = StorageContext.from_defaults(vector_store=vector_store)

    # ─── 步骤 4: 构建索引 ────────────────────────────────
    # 第 69-73 行: LlamaIndex 自动进行：
    //   1. 把每个 doc 切成小块（chunk）
    //   2. 对每个 chunk 用 embed_model 生成向量
    //   3. 存入 FAISS 索引
    VectorStoreIndex.from_documents(
        docs,
        storage_context=storage_context,
        embed_model=embed_model,
    )

    # 第 74 行: 持久化到磁盘
    # 保存到 models/rag/doc1/ 目录下
    // 包含：vector_store.faiss（向量索引）、metadata.json 等
    storage_context.persist(persist_dir=str(coll_dir))

    # ─── 步骤 5: 保存元数据 ──────────────────────────────
    # 第 76-81 行: 创建 meta.json 文件
    meta = {
        "doc_count": len(docs),                  // 文档数量
        "created_at": datetime.utcnow().isoformat(),  // ISO 时间戳
    }
    with open(coll_dir / "meta.json", "w") as f:
        json.dump(meta, f)

    # 第 83 行: 记录日志
    logger.info(f"RAG 集合构建完成: {name}, 文档数: {len(docs)}")

    # 第 84 行: 返回结果
    return {"name": name, "doc_count": len(docs)}


# ╔═══════════════════════════════════════════════════════════╗
# ║ 函数 3: 删除知识库                                       ║
// ║ 就是删除 models/rag/{name}/ 整个目录                    ║
// ╚═══════════════════════════════════════════════════════════╝
def delete_collection(name: str):
    // 第 88 行: 获取知识库目录
    coll_dir = _collection_dir(name)

    // 第 89-90 行: 如果存在，删除整个目录
    if coll_dir.exists():
        shutil.rmtree(coll_dir)
        logger.info(f"RAG 集合已删除: {name}")
```

## 1.5 后端服务：知识库查询 (backend/services/rag/querier.py)

```python
# ═══════════════════════════════════════════════════════════════
# RAG 查询服务
// 核心：检索相关文本段落 + 用 LLM 生成回答
// ═══════════════════════════════════════════════════════════════

from pathlib import Path
from config import MODEL_ROOT
from logging_setup import setup_logging

logger = setup_logging(__name__)

RAG_ROOT = MODEL_ROOT / "rag"

// 第 10-22 行: OpenAI 兼容的服务商列表
// 这些服务商都支持 OpenAI Chat Completions API 格式
// 只需要换 base_url 和 api_key 就能切换
OPENAI_COMPAT_URLS: dict[str, str] = {
    "openai":    "https://api.openai.com/v1",           // OpenAI 官方
    "deepseek":  "https://api.deepseek.com/v1",         // 深度求索
    "groq":      "https://api.groq.com/openai/v1",      // Groq（快速）
    "mistral":   "https://api.mistral.ai/v1",           // Mistral
    "xai":       "https://api.x.ai/v1",                 // X (Elon Musk 的 AI)
    // 中国服务商
    "qwen":      "https://dashscope.aliyuncs.com/compatible-mode/v1",  // 阿里通义千问
    "glm":       "https://open.bigmodel.cn/api/paas/v4",               // 智谱 GLM
    "moonshot":  "https://api.moonshot.cn/v1",                         // 月之暗面 Kimi
    "doubao":    "https://ark.cn-beijing.volces.com/api/v3",           // 字节豆包
    "hunyuan":   "https://api.hunyuan.cloud.tencent.com/v1",           // 腾讯混元
    "minimax":   "https://api.minimaxi.com/v1",                        // MiniMax
}


// ╔═══════════════════════════════════════════════════════════╗
// ║ 核心函数：从知识库检索 + 生成回答                        ║
// ║ 输入：name="doc1", question="什么是 RAG?"                 ║
// ║ 输出：完整的自然语言回答                                 ║
// ╚═══════════════════════════════════════════════════════════╝
def query_collection(
    name: str,
    question: str,
    top_k: int = 5,                            // 检索最相关的 5 个段落
    provider: str = "ollama",                  // LLM 服务商
    model: str = "qwen2.5:7b",                 // 模型名
    api_key: str = "",                         // API Key
    ollama_url: str = "http://127.0.0.1:11434",  // Ollama 地址
) -> str:
    """
    两步流程：
      1. Embedding：把问题转成向量，找最相关的段落
      2. LLM：把段落 + 问题合并，生成回答
    """

    // 第 41-47 行: 导入依赖库
    try:
        from llama_index.core import StorageContext, load_index_from_storage, Settings
        from llama_index.embeddings.ollama import OllamaEmbedding
        from llama_index.vector_stores.faiss import FaissVectorStore
        import faiss
    except ImportError as e:
        raise RuntimeError(f"RAG 依赖未安装: {e}") from e

    // 第 49-51 行: 检查知识库是否存在
    coll_dir = RAG_ROOT / name
    if not coll_dir.exists():
        raise FileNotFoundError(f"知识库 '{name}' 不存在")

    // ─── 步骤 1: 初始化 Embedding 模型 ──────────────────────
    // 第 56-59 行: Ollama 的 nomic-embed-text 模型
    // 用来把"问题"和"文档段落"都转成向量，然后计算相似度
    embed_model = OllamaEmbedding(
        model_name="nomic-embed-text",
        base_url=ollama_url,
    )

    // ─── 步骤 2: 初始化语言模型（支持多个服务商）────────────
    // 第 61-91 行: 根据 provider 选择使用哪个 LLM

    if provider == "ollama":
        // Ollama 本地模型（免费，不需要 API Key）
        from llama_index.llms.ollama import Ollama
        llm = Ollama(model=model, base_url=ollama_url, request_timeout=120.0)

    elif provider == "gemini":
        // Google Gemini 云端服务
        from llama_index.llms.gemini import Gemini
        import os
        os.environ["GOOGLE_API_KEY"] = api_key
        llm = Gemini(model=f"models/{model}")

    elif provider in OPENAI_COMPAT_URLS:
        // OpenAI 兼容的服务商（DeepSeek、Qwen、GLM 等）
        base_url = OPENAI_COMPAT_URLS[provider]

        if provider == "openai":
            // OpenAI 官方 API
            from llama_index.llms.openai import OpenAI
            import os
            os.environ["OPENAI_API_KEY"] = api_key
            llm = OpenAI(model=model)
        else:
            // 其他兼容服务商（深度求索、通义千问等）
            from llama_index.llms.openai_like import OpenAILike
            llm = OpenAILike(
                model=model,
                api_base=base_url,           // 服务商的 API 地址
                api_key=api_key,             // API Key
                is_chat_model=True,
                request_timeout=120.0,
            )
    else:
        raise ValueError(f"不支持的服务商: {provider}")

    // 第 94-95 行: 设置全局默认模型
    // LlamaIndex 内部会使用这些配置
    Settings.llm = llm
    Settings.embed_model = embed_model

    // ─── 步骤 3: 加载已构建的 FAISS 索引 ────────────────────
    // 第 98-104 行: 从磁盘读取之前保存的向量索引
    faiss_index = faiss.read_index(str(coll_dir / "vector_store.faiss"))
    vector_store = FaissVectorStore(faiss_index=faiss_index)
    storage_context = StorageContext.from_defaults(
        vector_store=vector_store,
        persist_dir=str(coll_dir),
    )
    index = load_index_from_storage(storage_context, embed_model=embed_model)

    // ─── 步骤 4: 执行查询 ────────────────────────────────
    // 第 107 行: 创建查询引擎
    // similarity_top_k=5: 找最相关的 5 个段落
    query_engine = index.as_query_engine(similarity_top_k=top_k, llm=llm)

    // 第 108 行: 执行查询
    // 内部流程：
    //   1. 把 question 用 embed_model 转成向量
    //   2. 在 FAISS 中搜索最相似的 5 个段落
    //   3. 把 [段落1, 段落2, ..., 问题] 喂给 LLM
    //   4. LLM 生成自然语言回答
    response = query_engine.query(question)

    // 第 109 行: 返回回答
    // response 是 Response 对象，str() 转成字符串
    return str(response)
```

---

# 第2阶段：Agent 进阶

## 2.1 数据类型定义 (frontend/types/index.ts)

```typescript
// ═══════════════════════════════════════════════════════════════
// Agent 步骤信息结构
// Agent 工作时会逐步 yield 这样的对象
// ═══════════════════════════════════════════════════════════════

export interface AgentStep {
  type: 'thought' | 'action' | 'observation' | 'final' | 'error';
  // 步骤类型：
  //   - 'thought'：Agent 的思考内容
  //   - 'action'：Agent 要执行哪个工具，参数是什么
  //   - 'observation'：工具执行的结果
  //   - 'final'：最终答案
  //   - 'error'：出错信息

  content?: string;        // 思考内容或最终答案（type 为 thought/final/error 时有值）
  tool?: string;           // 工具名称（type 为 action 时有值）
  args?: Record<string, unknown>;  // 工具参数（type 为 action 时有值）
}

// 使用示例：
// {type: 'thought', content: '用户问如何做番茄鸡蛋汤，需要搜索网络'}
// {type: 'action', tool: 'web_search', args: {query: '番茄鸡蛋汤做法'}}
// {type: 'observation', content: '根据搜索结果，番茄要先...'}
// {type: 'final', content: '番茄鸡蛋汤的做法是...'}
```

## 2.2 前端 Hook (frontend/hooks/useAgent.ts)

```typescript
import { useState, useCallback } from 'react';
import { AgentStep } from '../types';

// ═══════════════════════════════════════════════════════════════
// useAgent Hook - Agent 智能体的状态和操作
// ═══════════════════════════════════════════════════════════════

export function useAgent(backendUrl: string) {
  // ─── 状态 1: Agent 的执行步骤列表 ─────────────────────────
  // agentSteps = [
  //   {type: 'thought', content: '...'},
  //   {type: 'action', tool: 'web_search', args: {...}},
  //   {type: 'observation', content: '...'},
  //   ...
  // ]
  // 用户可以看到整个思考和行动过程
  const [agentSteps, setAgentSteps] = useState<AgentStep[]>([]);

  // ─── 状态 2: 运行中标志 ─────────────────────────────────
  // true = Agent 正在执行，禁用提交按钮
  // false = 空闲，用户可以提新任务
  const [running, setRunning] = useState(false);

  // ─── 状态 3: 可用工具列表 ─────────────────────────────────
  // availableTools = [
  //   {name: 'web_search', desc: '搜索互联网...'},
  //   {name: 'python_exec', desc: '执行 Python 代码...'},
  //   ...
  // ]
  const [availableTools, setAvailableTools] = useState<{ name: string; desc: string }[]>([]);

  // ╔═══════════════════════════════════════════════════════════╗
  // ║ 函数 1: 获取可用工具列表                                  ║
  // ║ 后端：GET /agent/tools                                    ║
  // ╚═══════════════════════════════════════════════════════════╝
  const fetchTools = useCallback(async () => {
    // 第 10 行: 获取后端的工具列表
    const res = await fetch(`${backendUrl}/agent/tools`);
    if (res.ok) setAvailableTools(await res.json());
    // 返回格式：
    // [
    //   {name: 'web_search', desc: '搜索互联网...', args: ['query']},
    //   {name: 'python_exec', desc: '执行 Python 代码...', args: ['code']},
    //   ...
    // ]
  }, [backendUrl]);

  // ╔═══════════════════════════════════════════════════════════╗
  // ║ 函数 2: 执行 Agent（核心！）                             ║
  // ║ 后端：POST /agent/run                                     ║
  // ║ 返回：流式 JSON，每行一个 AgentStep                      ║
  // ╚═══════════════════════════════════════════════════════════╝
  const runAgent = useCallback(async (
    task: string,         // 任务描述，如"搜索 Python 教程并总结"
    tools: string[],      // 要使用的工具，如 ['web_search', 'python_exec']
    provider: string,     // LLM 服务商
    model: string,        // 模型名
    apiKey: string,       // API Key
  ) => {
    // 第 21 行: 清空旧步骤
    setAgentSteps([]);

    // 第 22 行: 标记为运行中
    setRunning(true);

    try {
      // 第 24-28 行: 发送请求给后端
      const res = await fetch(`${backendUrl}/agent/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          task,                    // 任务
          tools,                   // 工具列表
          provider,                // LLM 服务商
          model,                   // 模型
          api_key: apiKey          // API Key
        }),
      });

      // 后端会流式返回：
      // data: {type: "thought", content: "..."}\n\n
      // data: {type: "action", tool: "web_search", args: {...}}\n\n
      // data: {type: "observation", content: "..."}\n\n
      // ...

      // 第 29-46 行: 处理流式响应（与 RAG 相同）
      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let buf = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buf += decoder.decode(value, { stream: true });
        const lines = buf.split('\n\n');
        buf = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              // 第 41 行: 解析 JSON 格式的 AgentStep
              const step = JSON.parse(line.slice(6));

              // 第 42 行: 追加到步骤列表
              // 这样 UI 会实时显示 Agent 的思考、行动、观察过程
              setAgentSteps(prev => [...prev, step]);
            } catch { /* ignore parse errors */ }
          }
        }
      }
    } finally {
      // 第 48 行: Agent 执行完毕，关闭运行标志
      setRunning(false);
    }
  }, [backendUrl]);

  // 第 52 行: 返回所有函数和状态
  return { agentSteps, running, availableTools, fetchTools, runAgent };
}
```

## 2.3 后端路由 (backend/routers/agent.py)

```python
# ═══════════════════════════════════════════════════════════════
// Agent API 路由
// 包含 2 个端点：列出工具、执行 Agent
// ═══════════════════════════════════════════════════════════════

import json
from fastapi import APIRouter
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from logging_setup import logger
from services.agent.tools import TOOLS

// 第 8 行: 创建路由器
router = APIRouter(prefix="/agent", tags=["agent"])


// 第 11-17 行: 数据模型：Agent 运行请求
class AgentRunRequest(BaseModel):
    task: str                          // 任务描述
    tools: list[str] = []              // 要使用的工具名称列表
    provider: str = "ollama"           // LLM 服务商
    model: str = "qwen2.5:7b"          // 模型名
    api_key: str = ""                  // API Key
    ollama_url: str = "http://127.0.0.1:11434"  // Ollama 地址


// ╔═══════════════════════════════════════════════════════════╗
// ║ 端点 1: GET /agent/tools                                 ║
// ║ 功能：列出所有可用的工具                                 ║
// ╚═══════════════════════════════════════════════════════════╝
@router.get("/tools")
async def list_tools():
    // 第 22-25 行: 返回所有工具信息
    return [
        {"name": name, "desc": info["desc"], "args": info["args"]}
        for name, info in TOOLS.items()
    ]
    // 返回格式：
    // [
    //   {name: 'web_search', desc: '搜索互联网...', args: ['query']},
    //   {name: 'python_exec', desc: '执行 Python 代码...', args: ['code']},
    //   ...
    // ]


// ╔═══════════════════════════════════════════════════════════╗
// ║ 端点 2: POST /agent/run                                  ║
// ║ 功能：执行 Agent，流式返回每一步（思考、行动、观察）    ║
// ╚═══════════════════════════════════════════════════════════╝
@router.post("/run")
async def run_agent(req: AgentRunRequest):
    // 第 30 行: 导入 Agent 执行函数
    from services.agent.graph import run_react_agent

    // 第 32-41 行: 定义生成器函数
    def generate():
        // 调用后端 Agent 执行函数
        // 它会 yield 每一步的结果（JSON 字符串）
        for chunk in run_react_agent(
            task=req.task,
            tool_names=req.tools,
            provider=req.provider,
            model=req.model,
            api_key=req.api_key,
            ollama_url=req.ollama_url,
        ):
            // 第 41 行: 以 SSE 格式返回每一步
            // chunk 已经是 JSON 字符串，直接放在 "data: " 后面
            yield f"data: {chunk}\n\n"

    // 第 43 行: 返回流响应
    return StreamingResponse(generate(), media_type="text/event-stream")
```

## 2.4 后端服务：工具定义 (backend/services/agent/tools.py)

```python
// ═══════════════════════════════════════════════════════════════
// Agent 工具库
// 每个工具都是一个独立的函数，Agent 会在需要时调用
// ═══════════════════════════════════════════════════════════════

import subprocess, os
from pathlib import Path
from config import MODEL_ROOT

// 第 6 行: Agent 的工作目录
WORKSPACE = MODEL_ROOT / "agent_workspace"
WORKSPACE.mkdir(parents=True, exist_ok=True)


// ╔═══════════════════════════════════════════════════════════╗
// ║ 工具 1: web_search - 网络搜索                            ║
// ║ 输入：query (搜索词)                                      ║
// ║ 输出：搜索结果（标题、链接、摘要）                       ║
// ╚═══════════════════════════════════════════════════════════╝
def web_search_tool(query: str) -> str:
    """使用 DuckDuckGo 搜索网络"""
    try:
        // 使用 duckduckgo_search 库，不需要 API Key
        from duckduckgo_search import DDGS
        with DDGS() as ddgs:
            // 返回 5 个搜索结果
            results = list(ddgs.text(query, max_results=5))

        // 格式化结果
        return "\n\n".join(
            f"**{r['title']}**\n{r['href']}\n{r['body']}" for r in results
        )
    except ImportError:
        return "[错误] duckduckgo-search 未安装"
    except Exception as e:
        return f"[搜索错误] {e}"


// ╔═══════════════════════════════════════════════════════════╗
// ║ 工具 2: python_exec - 执行 Python 代码                   ║
// ║ 输入：code (Python 代码字符串)                           ║
// ║ 输出：代码执行结果（stdout 或 stderr）                  ║
// ║ 安全：限时 10 秒，防止死循环                            ║
// ╚═══════════════════════════════════════════════════════════╝
def python_exec_tool(code: str) -> str:
    """在沙箱中执行 Python 代码（限时 10s）"""
    try:
        // 第 28-31 行: 启动子进程执行 Python 代码
        result = subprocess.run(
            ["python3", "-c", code],           // 执行代码
            capture_output=True,               // 捕获输出
            text=True,                         // 返回字符串而非字节
            timeout=10,                        // 最多 10 秒
            env={**os.environ, "PYTHONDONTWRITEBYTECODE": "1"},
        )

        // 第 33 行: 获取 stdout（正常输出）
        output = result.stdout or ""

        // 第 34-35 行: 如果有 stderr（错误输出），也追加
        if result.stderr:
            output += f"\n[stderr]\n{result.stderr}"

        // 第 36 行: 如果没有任何输出，返回"无输出"
        return output or "[无输出]"

    except subprocess.TimeoutExpired:
        return "[错误] 执行超时（10s）"
    except Exception as e:
        return f"[错误] {e}"


// ╔═══════════════════════════════════════════════════════════╗
// ║ 工具 3: file_read - 读取工作区文件                       ║
// ║ 输入：filename (文件名)                                  ║
// ║ 输出：文件内容                                           ║
// ║ 注意：只能读 agent_workspace 目录下的文件，安全考虑      ║
// ╚═══════════════════════════════════════════════════════════╝
def file_read_tool(filename: str) -> str:
    """读取 agent_workspace 下的文件"""
    // 第 45 行: 构造完整路径（只允许在 WORKSPACE 下）
    target = WORKSPACE / Path(filename).name

    // 第 46-47 行: 检查文件是否存在
    if not target.exists():
        return f"[错误] 文件不存在: {filename}"

    // 第 48 行: 读取文件内容
    return target.read_text(encoding="utf-8", errors="replace")


// ╔═══════════════════════════════════════════════════════════╗
// ║ 工具 4: file_write - 写入工作区文件                      ║
// ║ 输入：filename (文件名), content (内容)                  ║
// ║ 输出：确认信息                                           ║
// ╚═══════════════════════════════════════════════════════════╝
def file_write_tool(filename: str, content: str) -> str:
    """写入文件到 agent_workspace"""
    // 第 53 行: 构造完整路径
    target = WORKSPACE / Path(filename).name

    // 第 54 行: 写入内容
    target.write_text(content, encoding="utf-8")

    // 第 55 行: 返回确认
    return f"已写入: {target}"


// ╔═══════════════════════════════════════════════════════════╗
// ║ 工具 5: rag_retrieval - 从知识库检索信息                 ║
// ║ 输入：collection (知识库名), question (问题)             ║
// ║ 输出：检索结果                                           ║
// ║ 注意：Agent 可以结合 RAG 使用，获取本地知识库信息        ║
// ╚═══════════════════════════════════════════════════════════╝
def rag_retrieval_tool(collection: str, question: str) -> str:
    """从知识库检索信息"""
    try:
        // 第 61 行: 导入 RAG 查询函数
        from services.rag.querier import query_collection

        // 第 62 行: 调用 RAG 查询
        return query_collection(collection, question)
    except Exception as e:
        return f"[RAG 错误] {e}"


// ╔═══════════════════════════════════════════════════════════╗
// ║ 工具注册表                                               ║
// ║ 格式：{工具名: {fn: 函数, desc: 描述, args: 参数列表}}    ║
// ║ Agent 会通过这个表查找工具，后端会返回给前端显示         ║
// ╚═══════════════════════════════════════════════════════════╝
TOOLS = {
    "web_search": {
        "fn": web_search_tool,
        "desc": "搜索互联网获取最新信息",
        "args": ["query"]
    },
    "python_exec": {
        "fn": python_exec_tool,
        "desc": "执行 Python 代码片段",
        "args": ["code"]
    },
    "file_read": {
        "fn": file_read_tool,
        "desc": "读取工作区文件",
        "args": ["filename"]
    },
    "file_write": {
        "fn": file_write_tool,
        "desc": "写入内容到工作区文件",
        "args": ["filename", "content"]
    },
    "rag_retrieval": {
        "fn": rag_retrieval_tool,
        "desc": "从本地知识库检索相关信息",
        "args": ["collection", "question"]
    },
}
```

## 2.5 后端服务：Agent 执行引擎 (backend/services/agent/graph.py)

```python
// ═══════════════════════════════════════════════════════════════
// ReAct Agent 实现
// ReAct = Reasoning + Acting
// 通过思考→行动→观察的循环，让 AI 系统地解决复杂问题
// ═══════════════════════════════════════════════════════════════

import json, logging
from typing import Generator

logger = logging.getLogger(__name__)

// 第 9-22 行: OpenAI 兼容的服务商地址
// 与 RAG 中的一样
OPENAI_COMPAT_URLS: dict[str, str] = {
    "openai":    "https://api.openai.com/v1",
    "deepseek":  "https://api.deepseek.com/v1",
    "groq":      "https://api.groq.com/openai/v1",
    "mistral":   "https://api.mistral.ai/v1",
    "xai":       "https://api.x.ai/v1",
    "qwen":      "https://dashscope.aliyuncs.com/compatible-mode/v1",
    "glm":       "https://open.bigmodel.cn/api/paas/v4",
    "moonshot":  "https://api.moonshot.cn/v1",
    "doubao":    "https://ark.cn-beijing.volces.com/api/v3",
    "hunyuan":   "https://api.hunyuan.cloud.tencent.com/v1",
    "minimax":   "https://api.minimaxi.com/v1",
}


// ╔═══════════════════════════════════════════════════════════╗
// ║ ReAct Agent 核心函数                                     ║
// ║ 输入：task (任务), tool_names (工具列表), 以及 LLM 配置   ║
// ║ 输出：Generator，逐步 yield 每一步的 JSON 结果           ║
// ║ 最多 10 轮循环（防止无限循环）                          ║
// ╚═══════════════════════════════════════════════════════════╝
def run_react_agent(
    task: str,
    tool_names: list[str],
    provider: str,
    model: str,
    api_key: str = "",
    ollama_url: str = "http://127.0.0.1:11434",
) -> Generator[str, None, None]:
    """ReAct Agent，流式输出每个步骤（最多 10 轮）"""

    // 第 34 行: 导入工具
    from services.agent.tools import TOOLS

    // 第 36-40 行: 筛选用户选中的工具
    // 只保留 tool_names 中指定的工具
    selected_tools = {k: v for k, v in TOOLS.items() if k in tool_names}

    // 格式化工具描述（给 LLM 看）
    tools_desc = "\n".join(
        f"- {name}: {info['desc']}，参数: {info['args']}"
        for name, info in selected_tools.items()
    )

    // ─── 第 1 步: 构建系统提示 ──────────────────────────────
    // 第 42-53 行: 告诉 LLM 它要怎么工作
    system_prompt = f"""你是一个智能助手，使用 ReAct 方法解决任务。
可用工具：
{tools_desc}

每步格式：
思考: <分析当前情况>
行动: <工具名>(<参数JSON>)
观察: <工具结果>
...
最终答案: <综合所有信息的答案>

注意：行动参数必须是有效的 JSON 格式。"""

    // ─── 第 2 步: 初始化消息列表 ──────────────────────────────
    // 第 55-58 行: LLM 的对话历史
    messages = [
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": f"任务：{task}"},
    ]
    // messages = [
    //   {role: 'system', content: '你是一个智能助手...'},
    //   {role: 'user', content: '任务：...'}
    // ]

    // ─── 第 3 步: 定义 LLM 调用函数 ──────────────────────────────
    // 第 60-109 行: 根据 provider 调用不同的 LLM API
    def call_llm(msgs: list[dict]) -> str:
        """调用指定服务商的语言模型，返回回复文本"""
        import httpx

        if provider == "ollama":
            // Ollama 本地模型
            resp = httpx.post(
                f"{ollama_url.rstrip('/')}/api/chat",
                json={"model": model, "messages": msgs, "stream": False},
                timeout=120,
            )
            resp.raise_for_status()
            return resp.json()["message"]["content"]

        elif provider == "gemini":
            // Google Gemini 云端
            url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"

            // Gemini 的消息格式与 OpenAI 不同，需要转换
            contents = [
                {
                    "role": "user" if m["role"] == "user" else "model",
                    "parts": [{"text": m["content"]}]
                }
                for m in msgs if m["role"] != "system"
            ]

            resp = httpx.post(
                url,
                params={"key": api_key},
                json={"contents": contents},
                timeout=120,
            )
            resp.raise_for_status()
            return resp.json()["candidates"][0]["content"]["parts"][0]["text"]

        elif provider in OPENAI_COMPAT_URLS:
            // OpenAI 兼容的服务商（DeepSeek、Qwen 等）
            base_url = OPENAI_COMPAT_URLS[provider]

            resp = httpx.post(
                f"{base_url}/chat/completions",
                headers={
                    "Authorization": f"Bearer {api_key}",
                    "Content-Type": "application/json",
                },
                json={"model": model, "messages": msgs},
                timeout=120,
            )
            resp.raise_for_status()
            return resp.json()["choices"][0]["message"]["content"]

        else:
            raise ValueError(f"不支持的服务商: {provider}")

    // ─── 第 4 步: ReAct 主循环 ──────────────────────────────
    // 第 110-160+ 行: 循环执行思考→行动→观察
    for step in range(10):  // 最多 10 轮，防止无限循环
        try:
            // 第 112 行: 调用 LLM，获取这一轮的输出
            content = call_llm(messages)
            // content 可能是：
            // "思考: 用户问如何做番茄鸡蛋汤，我应该搜索网络\n
            //  行动: web_search({\"query\": \"番茄鸡蛋汤做法\"})\n
            //  观察: ..."

        except Exception as e:
            // 如果 LLM 调用出错
            yield json.dumps(
                {"type": "error", "content": str(e)},
                ensure_ascii=False
            )
            return

        // 第 117 行: 把 LLM 的回复添加到消息历史
        // 下一轮 call_llm 时会看到这些历史
        messages.append({"role": "assistant", "content": content})

        // ─── 解析"思考"部分 ──────────────────────────────
        // 第 119-121 行: 从 LLM 输出中提取"思考:"后面的文本
        if "思考:" in content:
            // 从"思考:"到"行动:"之间的文本就是思考内容
            thought = content.split("思考:")[1].split("行动:")[0].strip()

            // 流式返回思考步骤（JSON 格式）
            yield json.dumps(
                {"type": "thought", "content": thought},
                ensure_ascii=False
            )

        // ─── 解析"行动"部分 ──────────────────────────────
        // 第 123-139 行: 提取要执行的工具和参数
        if "行动:" in content:
            // 从"行动:"开始，到"观察:"为止
            action_part = content.split("行动:")[1]
            if "观察:" in action_part:
                action_part = action_part.split("观察:")[0]
            action_part = action_part.strip()
            // action_part = "web_search({\"query\": \"番茄....\"})"

            try:
                // 第 130 行: 提取工具名
                tool_name = action_part.split("(")[0].strip()
                // tool_name = "web_search"

                // 第 131 行: 提取参数部分
                args_str = action_part[len(tool_name):].strip()
                // args_str = "({\"query\": \"番茄\"})"

                // 第 132-134 行: 去掉括号，解析 JSON
                if args_str.startswith("(") and args_str.endswith(")"):
                    args_str = args_str[1:-1]
                args = json.loads(args_str) if args_str else {}
                // args = {"query": "番茄"}
            except Exception:
                // 解析失败时的兜底
                args = {}
                tool_name = action_part.split("(")[0].strip()

            // 第 139 行: 返回行动步骤
            yield json.dumps(
                {"type": "action", "tool": tool_name, "args": args},
                ensure_ascii=False
            )

            // ─── 执行工具 ──────────────────────────────
            // 第 141-148 行: 根据工具名调用对应的函数
            if tool_name in selected_tools:
                try:
                    fn = selected_tools[tool_name]["fn"]

                    // 调用工具函数
                    // 支持 dict 参数和 list 参数两种调用方式
                    observation = fn(**args) if isinstance(args, dict) else fn(*args) if isinstance(args, list) else fn(args)
                    // observation = "根据搜索，番茄要先..."

                except Exception as e:
                    // 工具执行出错
                    observation = f"[工具错误] {e}"
            else:
                // 工具不存在
                observation = f"[错误] 工具 '{tool_name}' 不可用"

            // 第 150 行: 返回观察步骤
            yield json.dumps(
                {"type": "observation", "content": str(observation)},
                ensure_ascii=False
            )

            // 第 151 行: 把观察结果添加到消息历史
            // LLM 下一轮会根据这个结果继续思考
            messages.append({"role": "user", "content": f"观察: {observation}"})

        // ─── 检查是否完成 ──────────────────────────────
        // 第 152-160 行: 如果 LLM 回复包含"最终答案"，就结束
        if "最终答案:" in content:
            // 提取最终答案
            final_answer = content.split("最终答案:")[1].strip()

            yield json.dumps(
                {"type": "final", "content": final_answer},
                ensure_ascii=False
            )
            return
```

---

# 第3阶段：LoRA 微调高级

## 3.1 核心概念

```
什么是 LoRA？
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

LoRA = Low-Rank Adaptation（低秩适应）

原始模型：大的权重矩阵 W（比如 7B 参数，数十亿）
LoRA 思想：不训练 W，而训练两个小矩阵 A 和 B

推理时的计算：
  output = x @ W + x @ A @ B
         （原始部分）+（LoRA 新增部分）

为什么有效？
  - A 和 B 的参数量只有 W 的 ~1%（万分之几）
  - 模型大部分知识仍来自 W（冻结）
  - 只调整 A 和 B 以适应新任务（快速学习）

好处：
  ✓ 参数少：101% 参数量学到新知识
  ✓ 速度快：训练快 10 倍，内存占用低 10 倍
  ✓ 便携：LoRA 权重只有几 MB，可快速切换任务
  ✓ 质量：在相同硬件下，比全量微调更稳定

配置参数详解：
  - lora_r (秩/rank): 控制 A、B 矩阵的维度
    • 常用值：8, 16, 32, 64
    • 越小越快，但学习能力越弱
    • 推荐：数据少用 8，数据多用 16

  - lora_alpha (缩放因子): 控制 LoRA 部分的影响力
    • 通常设为 lora_r 的 2 倍（如 r=16 则 alpha=32）
    • 不需要调整，保持默认即可

  - num_epochs (训练轮数): 整个数据集过几遍
    • 数据少（<1000）：5～10 轮
    • 数据中等（1000-10000）：3～5 轮
    • 数据多（>10000）：2～3 轮

  - batch_size (批大小): 每步训练多少条样本
    • 越大越快，但占用更多显存
    • 如果 OOM（内存不足）：从 2 改成 1

  - learning_rate (学习率): 每步调整权重多少
    • 2e-4（0.0002）：常见起点
    • 太大：训练不稳定，loss 波动大
    • 太小：收敛慢，浪费时间

  - max_seq_length (最大长度): 每条样本最多多少 token
    • 512：大多数场景够用
    • 1024：如果文本较长
    • 超过会被截断，损失信息
```

## 3.2 数据格式

```
JSONL 格式（JSON Lines，每行一个 JSON 对象）

✓ 标准格式（推荐）:
{
  "instruction": "请用 5 个词总结这篇文章",
  "input": "昨天天气很好，我们去公园散步。",
  "output": "天气好，散步，公园，昨天，朋友"
}

✓ 简化格式:
{
  "instruction": "翻译成英文：早上好",
  "output": "Good morning"
}

✓ Alpaca 格式:
{
  "instruction": "你是一个营养师...",
  "input": "用户的数据",
  "output": "营养师的建议"
}

⚠️ 常见错误:
✗ {instruction, input, output, response} 混用（选一个）
✗ 在 JSON 中换行（要么去掉换行，要么转义 \n）
✗ 超大文本（input/output 若 >2000 words 会被截断）
```

## 3.3 数据类型定义 (frontend/types/index.ts)

```typescript
// ═══════════════════════════════════════════════════════════════
// Finetune 微调任务的状态和进度信息
// ═══════════════════════════════════════════════════════════════

export interface FinetuneJob {
  job_id: string;              // 任务 ID，唯一标识
  status: 'running' | 'done' | 'error' | 'cancelled';  // 状态
  model: string;               // 基座模型名（如 "Qwen/Qwen2.5-3B"）
  progress: number;            // 进度 0-1.0（如 0.35 表示 35%）
  loss_curve: number[];        // loss 值历史，用于绘制曲线
  log_tail: string[];          // 最近 100 行日志
  output_dir: string;          // 输出目录路径
  export_format: string;       // 导出格式（"adapter" 或 "merged"）
  created_at: string;          // 创建时间（ISO 格式）
}

// 使用示例：
// {
//   job_id: "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
//   status: "running",
//   model: "Qwen/Qwen2.5-3B",
//   progress: 0.65,           // 65% 完成
//   loss_curve: [2.5, 2.3, 2.1, 1.9, 1.7],  // loss 在下降，说明在学习
//   log_tail: ["Step 10: loss=1.95", "Step 11: loss=1.91", ...],
//   output_dir: "/tmp/finetune-output",
//   export_format: "adapter",
//   created_at: "2024-03-17T10:30:00Z"
// }
```

## 3.4 前端 Hook (frontend/hooks/useFinetune.ts)

```typescript
import { useState, useCallback, useRef } from 'react';
import { FinetuneJob } from '../types';

// ═══════════════════════════════════════════════════════════════
// useFinetune Hook - 微调任务的状态管理
// 核心特点：定时轮询后端，实时更新进度、loss、日志
// ═══════════════════════════════════════════════════════════════

export function useFinetune(backendUrl: string) {
  // ─── 状态 1: 任务列表 ──────────────────────────────────────
  // jobs = [
  //   {job_id: "xxx", status: "running", progress: 0.35, ...},
  //   {job_id: "yyy", status: "done", progress: 1.0, ...}
  // ]
  const [jobs, setJobs] = useState<FinetuneJob[]>([]);

  // ─── 状态 2: 当前选中的任务 ID ────────────────────────────
  // 用于显示某个任务的详细信息（进度条、loss 曲线、日志）
  const [currentJobId, setCurrentJobId] = useState<string | null>(null);

  // ─── 状态 3: 轮询定时器的引用 ────────────────────────────
  // 保存定时器 ID，方便后续取消（clearInterval）
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ╔═══════════════════════════════════════════════════════════╗
  // ║ 函数 1: 启动微调任务                                     ║
  // ║ 上传数据集 + LoRA 参数 → 后端启动训练                    ║
  // ║ 返回：job_id，前端用此 ID 后续查询进度                   ║
  // ╚═══════════════════════════════════════════════════════════╝
  const startFinetune = useCallback(async (params: {
    model: string;           // 基座模型 ID
    dataset: File;           // 训练数据文件（JSONL）
    lora_r: number;          // LoRA 秩
    lora_alpha: number;      // LoRA 缩放因子
    num_epochs: number;      // 训练轮数
    batch_size: number;      // 批大小
    learning_rate: number;   // 学习率
    max_seq_length: number;  // 最大序列长度
    export_format: string;   // 导出格式（adapter / merged）
  }) => {
    // 第 20 行: 创建 FormData（用于文件上传）
    const form = new FormData();

    // 第 21-29 行: 把所有参数放入 form
    form.append('model', params.model);
    form.append('dataset', params.dataset);  // 文件
    form.append('lora_r', String(params.lora_r));  // 注意：FormData 只支持字符串
    form.append('lora_alpha', String(params.lora_alpha));
    form.append('num_epochs', String(params.num_epochs));
    form.append('batch_size', String(params.batch_size));
    form.append('learning_rate', String(params.learning_rate));
    form.append('max_seq_length', String(params.max_seq_length));
    form.append('export_format', params.export_format);

    // 第 31 行: POST 请求启动训练
    const res = await fetch(`${backendUrl}/finetune/start`, {
      method: 'POST',
      body: form  // FormData 自动设置正确的 Content-Type
    });

    // 第 32 line: 解析返回值
    const data = await res.json();
    // data = {job_id: "a1b2c3d4...", status: "running"}

    // 第 33 line: 保存当前任务 ID（用于后续查询）
    setCurrentJobId(data.job_id);

    // 第 34 line: 返回任务 ID
    return data.job_id;
  }, [backendUrl]);

  // ╔═══════════════════════════════════════════════════════════╗
  // ║ 函数 2: 定时查询任务进度                                 ║
  // ║ 每 2 秒查询一次后端，更新 progress、loss、log_tail       ║
  // ║ 任务完成时自动停止轮询                                  ║
  // ╚═══════════════════════════════════════════════════════════╝
  const pollJob = useCallback((jobId: string) => {
    // 第 37 line: 如果已有轮询在进行，先停止它
    if (pollRef.current) clearInterval(pollRef.current);

    // 第 38-56 line: 启动新的轮询
    // 每 2000 毫秒（2 秒）查询一次
    pollRef.current = setInterval(async () => {
      // 查询这个任务的最新信息
      const res = await fetch(`${backendUrl}/finetune/jobs/${jobId}`);

      if (res.ok) {
        // 第 41 line: 解析返回的任务对象
        const job: FinetuneJob = await res.json();

        // 第 42-51 line: 更新 jobs 数组
        setJobs(prev => {
          // 在数组中找到对应的任务
          const idx = prev.findIndex(j => j.job_id === jobId);

          if (idx >= 0) {
            // 任务已存在，更新它
            const next = [...prev];  // 复制数组
            next[idx] = job;         // 更新该任务
            return next;
          }

          // 任务不存在，添加到列表
          return [...prev, job];
        });

        // 第 52-54 line: 检查任务是否完成
        if (job.status !== 'running') {
          // 任务完成/失败/取消，停止轮询
          clearInterval(pollRef.current!);
        }
      }
    }, 2000);  // 2 秒轮询一次
  }, [backendUrl]);

  // ╔═══════════════════════════════════════════════════════════╗
  // ║ 函数 3: 获取所有任务                                    ║
  // ║ 后端：GET /finetune/jobs                                 ║
  // ╚═══════════════════════════════════════════════════════════╝
  const fetchJobs = useCallback(async () => {
    // 第 60 line: 获取任务列表
    const res = await fetch(`${backendUrl}/finetune/jobs`);

    if (res.ok) setJobs(await res.json());
    // 返回：[{job_id, status, progress, ...}, ...]
  }, [backendUrl]);

  // ╔═══════════════════════════════════════════════════════════╗
  // ║ 函数 4: 取消任务                                         ║
  // ║ 后端：DELETE /finetune/jobs/{job_id}                     ║
  // ║ 会停止训练进程，删除临时文件                            ║
  // ╚═══════════════════════════════════════════════════════════╝
  const cancelJob = useCallback(async (jobId: string) => {
    // 第 65 line: 发送 DELETE 请求取消任务
    await fetch(`${backendUrl}/finetune/jobs/${jobId}`, { method: 'DELETE' });

    // 第 66 line: 从本地列表中删除该任务
    setJobs(prev => prev.filter(j => j.job_id !== jobId));
  }, [backendUrl]);

  // 第 69 line: 返回所有函数和状态
  return {
    jobs,                   // 任务列表
    currentJobId,          // 当前选中的任务 ID
    startFinetune,         // 启动训练函数
    pollJob,               // 开始轮询函数
    fetchJobs,             // 获取任务列表函数
    cancelJob              // 取消任务函数
  };
}
```

## 3.5 后端路由 (backend/routers/finetune.py)

```python
# ═══════════════════════════════════════════════════════════════
// Finetune API 路由
// 包含 4 个端点：启动、列表、查询、取消
// ═══════════════════════════════════════════════════════════════

import os, tempfile, shutil
from fastapi import APIRouter, UploadFile, File, Form, HTTPException
from pydantic import BaseModel

from logging_setup import logger

// 第 8 line: 创建路由器
router = APIRouter(prefix="/finetune", tags=["finetune"])


// ╔═══════════════════════════════════════════════════════════╗
// ║ 端点 1: POST /finetune/start                            ║
// ║ 功能：上传数据集，启动微调任务（后台异步执行）          ║
// ║ 返回：job_id，前端用此 ID 查询进度                       ║
// ╚═══════════════════════════════════════════════════════════╝
@router.post("/start")
async def start_finetune(
    model: str = Form(...),                    // 基座模型
    dataset: UploadFile = File(...),           // 训练数据文件
    lora_r: int = Form(16),                    // LoRA 秩
    lora_alpha: int = Form(32),                // LoRA 缩放因子
    num_epochs: int = Form(3),                 // 训练轮数
    batch_size: int = Form(2),                 // 批大小
    learning_rate: float = Form(2e-4),         // 学习率
    max_seq_length: int = Form(512),           // 最大序列长度
    export_format: str = Form("adapter"),      // 导出格式
    hf_token: str = Form(""),                  // HuggingFace Token
    hf_mirror: str = Form(""),                 // HF 镜像地址
):
    // 第 25 line: 导入启动函数
    from services.finetune.trainer import start_finetune_job

    // 第 27 line: 创建临时目录存放上传的数据集
    tmp_dir = tempfile.mkdtemp()

    // 第 28 line: 保存上传的文件
    dataset_path = os.path.join(tmp_dir, dataset.filename or "train.jsonl")

    // 第 29-30 line: 写入文件内容
    with open(dataset_path, "wb") as f:
        f.write(await dataset.read())

    try:
        // 第 33-46 line: 调用后端函数启动训练
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
            hf_token=hf_token,       // 用于下载私有模型
            hf_mirror=hf_mirror,     // 中国镜像：https://hf-mirror.com
        )

        // 第 47 line: 立即返回，训练在后台进行
        return {"job_id": job_id, "status": "running"}

    except Exception as e:
        // 如果启动失败，清理临时文件
        shutil.rmtree(tmp_dir, ignore_errors=True)
        raise HTTPException(status_code=500, detail=str(e))


// ╔═══════════════════════════════════════════════════════════╗
// ║ 端点 2: GET /finetune/jobs                              ║
// ║ 功能：列出所有微调任务                                  ║
// ║ 返回：[{job_id, status, progress, ...}, ...]             ║
// ╚═══════════════════════════════════════════════════════════╝
@router.get("/jobs")
async def list_jobs():
    // 第 55 line: 导入列表函数
    from services.finetune.trainer import list_jobs

    // 第 56 line: 返回所有任务
    return list_jobs()


// ╔═══════════════════════════════════════════════════════════╗
// ║ 端点 3: GET /finetune/jobs/{job_id}                     ║
// ║ 功能：查询单个任务的详细信息（进度、loss、日志等）      ║
// ╚═══════════════════════════════════════════════════════════╝
@router.get("/jobs/{job_id}")
async def get_job(job_id: str):
    // 第 61 line: 导入查询函数
    from services.finetune.trainer import get_job_status

    try:
        // 第 63 line: 返回任务信息
        return get_job_status(job_id)

    except KeyError:
        // 任务不存在
        raise HTTPException(status_code=404, detail="任务不存在")


// ╔═══════════════════════════════════════════════════════════╗
// ║ 端点 4: DELETE /finetune/jobs/{job_id}                  ║
// ║ 功能：取消某个任务                                      ║
// ╚═══════════════════════════════════════════════════════════╝
@router.delete("/jobs/{job_id}")
async def cancel_job(job_id: str):
    // 第 70 line: 导入取消函数
    from services.finetune.trainer import cancel_job

    // 第 71 line: 取消任务（停止进程，删除文件）
    cancel_job(job_id)

    // 第 72 line: 返回成功
    return {"ok": True}
```

## 3.6 后端服务：训练器 (backend/services/finetune/trainer.py)

```python
// ═══════════════════════════════════════════════════════════════
// Finetune 训练服务
// 核心：启动子进程运行 wrappers/finetune/train.py
// 实时监控：loss、进度、日志
// ═══════════════════════════════════════════════════════════════

import subprocess, json, uuid, os, shutil, threading
from pathlib import Path
from datetime import datetime
from config import MODEL_ROOT, APP_ROOT
from utils.engine import get_embedded_python

logger = logging.getLogger(__name__)

// 第 14 line: 所有微调任务输出目录
FINETUNE_ROOT = MODEL_ROOT / "finetune"
FINETUNE_ROOT.mkdir(parents=True, exist_ok=True)

// 第 17 line: 内存中存放所有任务的状态
// 结构：{job_id: {status, progress, loss_curve, log_tail, _process, ...}}
_jobs: dict[str, dict] = {}


// ╔═══════════════════════════════════════════════════════════╗
// ║ 函数 1: 启动微调任务                                     ║
// ║ 流程：                                                     ║
// ║   1. 生成 job_id                                         ║
// ║   2. 在线程中启动子进程运行 train.py                     ║
// ║   3. 实时收集 stdout（loss、进度、日志）                 ║
// ╚═══════════════════════════════════════════════════════════╝
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
    hf_token: str = "",      // HuggingFace Token（私有模型需要）
    hf_mirror: str = "",     // HF 镜像地址（中国用 https://hf-mirror.com）
) -> str:

    // 第 34 line: 生成唯一的任务 ID
    job_id = str(uuid.uuid4())

    // 第 35 line: 任务的输出目录
    job_output_dir = str(FINETUNE_ROOT / job_id)

    // 第 36 line: 创建输出目录
    os.makedirs(job_output_dir, exist_ok=True)

    // 第 38 line: 实际训练脚本的位置
    script = APP_ROOT / "wrappers" / "finetune" / "train.py"

    // 第 39 line: 获取嵌入式 Python 解释器（包含所有依赖）
    python = get_embedded_python()

    // 第 41-53 line: 构建子进程命令
    // 这样会执行：
    // /path/to/python /path/to/train.py --model Qwen/... --dataset ... --lora_r 16 ...
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

    // 第 55-66 line: 初始化任务状态对象
    _jobs[job_id] = {
        "job_id": job_id,
        "status": "running",           // 刚启动时是 running
        "model": model,
        "progress": 0.0,               // 进度 0-100%
        "loss_curve": [],              // loss 历史（用于画曲线）
        "log_tail": [],                // 最后 100 行日志
        "output_dir": job_output_dir,
        "export_format": export_format,
        "created_at": datetime.utcnow().isoformat(),
        "_process": None,              // 子进程对象（以 _ 开头表示内部字段）
    }

    // 第 69-73 line: 构建子进程环境变量
    // 继承当前环境，覆盖 HF 相关变量（用于下载模型）
    env = {**os.environ}
    if hf_token:
        env["HF_TOKEN"] = hf_token         // transformers 会读取此变量
    if hf_mirror:
        env["HF_ENDPOINT"] = hf_mirror     // datasets 会走此镜像下载

    // 第 75-110 line: 定义后台任务函数
    def run():
        try:
            // 第 77-80 line: 启动子进程
            // stdout=subprocess.PIPE：捕获标准输出
            // stderr=subprocess.STDOUT：标准错误合并到标准输出
            // text=True：返回字符串而非字节
            proc = subprocess.Popen(
                cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True,
                env=env
            )

            // 第 81 line: 保存进程对象（便于后续 terminate）
            _jobs[job_id]["_process"] = proc

            // 第 82-97 line: 实时读取输出，解析 loss 和进度
            for line in proc.stdout:
                line = line.strip()

                // 第 84 line: 保存到日志列表（只保留最后 100 行）
                _jobs[job_id]["log_tail"].append(line)
                if len(_jobs[job_id]["log_tail"]) > 100:
                    _jobs[job_id]["log_tail"] = _jobs[job_id]["log_tail"][-100:]

                // 第 87-97 line: 尝试解析 JSON 格式的进度信息
                // train.py 会输出格式如：
                // {"loss": 1.95, "step": 10, "total": 100}
                try:
                    data = json.loads(line)

                    // 第 89 line: 如果包含 loss 字段
                    if "loss" in data:
                        // 保存到 loss 曲线
                        _jobs[job_id]["loss_curve"].append(data["loss"])

                        // 计算进度百分比
                        total = data.get("total", 1)
                        step = data.get("step", 0)
                        _jobs[job_id]["progress"] = min(step / total, 1.0)

                    // 第 94 line: 如果 train.py 返回 "done"，标记为完成
                    if data.get("status") == "done":
                        _jobs[job_id]["status"] = "done"

                except Exception:
                    // 如果这行不是 JSON，忽略（可能是普通日志）
                    pass

            // 第 98 line: 等待子进程结束
            proc.wait()

            // 第 99-102 line: 根据返回码判断是否成功
            if proc.returncode != 0 and _jobs[job_id]["status"] != "done":
                // 非零返回码且还没被标记为 done，说明出错
                _jobs[job_id]["status"] = "error"
            elif _jobs[job_id]["status"] != "done":
                // 正常退出，标记为 done
                _jobs[job_id]["status"] = "done"
                _jobs[job_id]["progress"] = 1.0

        except Exception as e:
            // 任何异常都标记为 error
            _jobs[job_id]["status"] = "error"
            _jobs[job_id]["log_tail"].append(str(e))
            logger.error(f"微调任务失败: {e}")

    // 第 109-110 line: 在后台线程中运行
    // daemon=True：当主程序退出时，这个线程也会退出
    threading.Thread(target=run, daemon=True).start()

    // 第 111 line: 立即返回 job_id，不等待训练完成
    return job_id


// ╔═══════════════════════════════════════════════════════════╗
// ║ 函数 2: 查询任务状态                                     ║
// ║ 返回除了 "_process" 外的所有字段（进度、loss、日志）    ║
// ╚═══════════════════════════════════════════════════════════╝
def get_job_status(job_id: str) -> dict:
    // 第 115 line: 查找任务
    job = _jobs.get(job_id)

    // 第 116 line: 任务不存在
    if not job:
        raise KeyError(f"任务不存在: {job_id}")

    // 第 118 line: 返回所有字段，除了以 "_" 开头的内部字段
    // 这样前端不会看到 "_process" 等内部状态
    result = {k: v for k, v in job.items() if not k.startswith("_")}
    return result


// 附加函数（简化版）：

def list_jobs() -> list[dict]:
    // 返回所有任务（去掉内部字段）
    return [
        {k: v for k, v in job.items() if not k.startswith("_")}
        for job in _jobs.values()
    ]


def cancel_job(job_id: str):
    // 取消任务：终止进程，标记为 cancelled
    if job_id in _jobs:
        job = _jobs[job_id]
        if job.get("_process"):
            job["_process"].terminate()  // 停止子进程
        job["status"] = "cancelled"
```

## 3.7 前端页面 (frontend/components/panels/FinetunePanel.tsx)

```typescript
// ═══════════════════════════════════════════════════════════════
// FinetunePanel - LoRA 微调页面
// 核心：选择模型 → 上传数据 → 配置超参数 → 启动训练 → 查看进度
// ═══════════════════════════════════════════════════════════════

// 第 1-31 line: 配置常数

// QLoRA 微调流程可视化
const FINETUNE_FLOW: FlowStep[] = [
  { label: '下载基座模型', tech: 'HuggingFace Hub' },  // 下载 Qwen、Llama 等基座模型
  { label: '4-bit 量化',   tech: 'bitsandbytes' },     // 用 4-bit 压缩模型以省显存
  { label: '挂载 LoRA 层', tech: 'peft.LoraConfig' },  // 在量化模型上挂 LoRA
  { label: '读取数据集',   tech: 'JSONL / datasets' },  // 加载训练数据
  { label: '本地训练',     tech: 'trl.SFTTrainer' },    // 使用 Hugging Face Trainer
  { label: '保存权重',     tech: 'adapter / merged' },  // 导出为 adapter 或 merged
];

// 预设基座模型（按大小排列）
const PRESET_MODELS = [
  { id: 'Qwen/Qwen2.5-0.5B', label: 'Qwen2.5-0.5B（最小，训练最快）' },
  { id: 'Qwen/Qwen2.5-1.5B', label: 'Qwen2.5-1.5B（均衡）' },
  { id: 'Qwen/Qwen2.5-3B',   label: 'Qwen2.5-3B（效果更好）' },
  { id: 'meta-llama/Llama-3.2-1B', label: 'Llama-3.2-1B（英文为主）' },
];

// 超参数说明（帮助用户理解每个参数的作用）
const PARAM_TIPS: Record<string, string> = {
  lora_r:
    'LoRA 秩：控制新增参数的数量，越大学得越细但越慢。外行用默认值 16 即可',
  lora_alpha:
    '缩放系数：一般设为 lora_r 的 2 倍。不需要改动',
  num_epochs:
    '训练轮次：整个数据集被过几遍。数据少用 5～10 轮，数据多用 3 轮',
  batch_size:
    '每步喂多少条数据：越大越快，但占内存越多。内存紧张时改为 1',
  learning_rate:
    '学习率：每步调整多大幅度。过大会不稳定，过小收敛慢。2e-4 是常见起点',
  max_seq_length:
    '最大序列长度：每条样本最多处理多少个 token。超过会被截断。512 适合大多数场景',
};

// 页面主组件
export default function FinetunePanel({ backendUrl }: Props) {
  // ── 表单状态 ────────────────────────────────────────────
  const [model, setModel] = useState(PRESET_MODELS[0].id);      // 预设模型
  const [customModel, setCustomModel] = useState('');           // 自定义模型 ID
  const [dataset, setDataset] = useState<File | null>(null);    // 训练数据文件

  // ── LoRA 超参数状态 ────────────────────────────────────
  const [loraR, setLoraR] = useState(16);                       // LoRA 秩
  const [loraAlpha, setLoraAlpha] = useState(32);               // LoRA 缩放因子
  const [numEpochs, setNumEpochs] = useState(3);                // 训练轮数
  const [batchSize, setBatchSize] = useState(2);                // 批大小
  const [learningRate, setLearningRate] = useState(2e-4);       // 学习率
  const [maxSeqLength, setMaxSeqLength] = useState(512);        // 最大序列长度
  const [exportFormat, setExportFormat] = useState('adapter');  // 导出格式

  // ── HuggingFace 配置 ─────────────────────────────────
  // 中国大陆需要配置镜像和 Token
  const [hfToken, setHfToken] = useState('');           // HF Token
  const [hfMirror, setHfMirror] = useState('');         // HF 镜像（如 https://hf-mirror.com）

  // ── 训练状态 ────────────────────────────────────────
  const [training, setTraining] = useState(false);      // 是否正在训练

  // 调用 useFinetune hook 获取训练管理函数
  const { jobs, currentJobId, startFinetune, pollJob, fetchJobs, cancelJob } = useFinetune(backendUrl);

  // 页面加载时获取任务列表
  useEffect(() => { fetchJobs(); }, [backendUrl]);

  // ── 启动训练 ───────────────────────────────────────
  const handleStart = async () => {
    if (!dataset) return;

    setTraining(true);
    try {
      // 调用 startFinetune hook
      const jobId = await startFinetune({
        model: customModel || model,  // 优先用自定义模型，否则用预设
        dataset,
        lora_r: loraR,
        lora_alpha: loraAlpha,
        num_epochs: numEpochs,
        batch_size: batchSize,
        learning_rate: learningRate,
        max_seq_length: maxSeqLength,
        export_format: exportFormat,
      });

      // 开始定时查询进度
      pollJob(jobId);

    } catch (e: any) {
      alert(`启动失败: ${e.message}`);
    } finally {
      setTraining(false);
    }
  };

  // 页面渲染逻辑（省略 UI 代码，只显示数据流向）
  return (
    <div>
      {/* 左侧：配置表单 */}
      <div>
        模型选择
        <select value={model} onChange={e => setModel(e.target.value)}>
          {PRESET_MODELS.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}
        </select>

        数据集上传
        <input type="file" onChange={e => setDataset(e.target.files?.[0] || null)} />

        LoRA 秩
        <input type="number" value={loraR} onChange={e => setLoraR(+e.target.value)} />
        <p>{PARAM_TIPS.lora_r}</p>

        批大小
        <input type="number" value={batchSize} onChange={e => setBatchSize(+e.target.value)} />

        {/* ... 其他参数 ... */}

        <button onClick={handleStart} disabled={training || !dataset}>
          {training ? '启动中...' : '开始微调'}
        </button>
      </div>

      {/* 右侧：任务列表和进度 */}
      <div>
        {jobs.map(job => (
          <div key={job.job_id}>
            <h4>{job.model}</h4>
            进度: {(job.progress * 100).toFixed(1)}%
            {/* Loss 曲线图表 */}
            <canvas data={job.loss_curve} />
            {/* 日志显示 */}
            <textarea value={job.log_tail.join('\n')} readOnly />
            {/* 取消按钮 */}
            {job.status === 'running' && (
              <button onClick={() => cancelJob(job.job_id)}>取消</button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
```

---

# 快速查询表

## 文件导航

| 文件 | 行数 | 难度 | 关键概念 |
|------|------|------|---------|
| `frontend/types/index.ts` | 94 | ⭐ | 数据类型定义 |
| `frontend/hooks/useRag.ts` | 56 | ⭐⭐ | 流式响应处理、FormData |
| `frontend/components/panels/RagPanel.tsx` | 402 | ⭐⭐⭐ | UI 组件、状态管理 |
| `backend/routers/rag.py` | 106 | ⭐⭐ | FastAPI 路由、后台任务 |
| `backend/services/rag/indexer.py` | 92 | ⭐⭐⭐ | 文件处理、向量化、FAISS |
| `backend/services/rag/querier.py` | 110 | ⭐⭐⭐ | 多服务商 LLM 调用 |
| `frontend/hooks/useAgent.ts` | 53 | ⭐⭐ | 流式 JSON 解析 |
| `backend/routers/agent.py` | 44 | ⭐ | SSE 流式响应 |
| `backend/services/agent/tools.py` | 74 | ⭐⭐ | 工具实现、安全沙箱 |
| `backend/services/agent/graph.py` | 160+ | ⭐⭐⭐⭐ | ReAct 循环、LLM 调用 |
| `frontend/hooks/useFinetune.ts` | 71 | ⭐⭐ | 定时轮询、任务管理 |

## 关键代码片段速查

| 需求 | 代码位置 | 关键行数 |
|------|---------|---------|
| 上传文件 | `RagPanel.tsx` | 92-123 |
| SSE 流式响应 | `useRag.ts` | 36-48 |
| FormData 处理 | `useRag.ts` | 15-19 |
| LLM 多服务商 | `querier.py` | 62-91 |
| ReAct 循环 | `graph.py` | 110-160 |
| 工具执行 | `graph.py` | 141-150 |
| 后台任务 | `rag.py` | 62-71 |

---

**🎓 学习建议**

1. 第一次阅读：快速浏览，了解整体架构
2. 第二次阅读：深入逐行讲解，理解实现细节
3. 第三次阅读：对照代码，自己注释一遍
4. 最后：尝试实现一个新功能（如添加新工具）

---

**最后，打印这个文件，带着它开始学习吧！🚀**
