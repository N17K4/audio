from pathlib import Path
from config import RAG_USER_ROOT
from logging_setup import setup_logging, logger

RAG_ROOT = RAG_USER_ROOT

# 与 agent/graph.py 保持一致：所有 OpenAI 兼容服务商的接口地址
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


def query_collection(
    name: str,
    question: str,
    top_k: int = 5,
    provider: str = "ollama",
    model: str = "qwen2.5:7b",
    api_key: str = "",
    ollama_url: str = "http://127.0.0.1:11434",
) -> str:
    """
    从知识库检索相关片段，再用指定语言模型组织成自然语言回答。

    两步流程：
      1. Embedding（始终用 Ollama nomic-embed-text）：把问题转成向量，找最相关的片段
      2. LLM（用指定服务商）：把检索到的片段 + 问题合并，生成最终回答
    """
    try:
        from llama_index.core import StorageContext, load_index_from_storage, Settings
        from llama_index.embeddings.ollama import OllamaEmbedding
        from llama_index.vector_stores.faiss import FaissVectorStore
        import faiss
    except ImportError as e:
        raise RuntimeError(f"RAG 依赖未安装: {e}") from e

    coll_dir = RAG_ROOT / name
    if not coll_dir.exists():
        raise FileNotFoundError(f"知识库 '{name}' 不存在")

    # ── Step 1: Embedding 模型（固定用 Ollama nomic-embed-text）─────────────
    # nomic-embed-text 专门做语义向量，不是聊天模型
    # ollama_url 用于指向本地 Ollama 服务
    embed_model = OllamaEmbedding(
        model_name="nomic-embed-text",
        base_url=ollama_url,
    )

    # ── Step 2: 语言模型（根据 provider 选择）────────────────────────────────
    if provider == "ollama":
        from llama_index.llms.ollama import Ollama
        llm = Ollama(model=model, base_url=ollama_url, request_timeout=120.0)

    elif provider == "gemini":
        from llama_index.llms.gemini import Gemini
        import os
        os.environ["GOOGLE_API_KEY"] = api_key
        llm = Gemini(model=f"models/{model}")

    elif provider in OPENAI_COMPAT_URLS:
        # 所有 OpenAI 兼容服务商：用 llama-index 的 OpenAILike 或 OpenAI
        base_url = OPENAI_COMPAT_URLS[provider]
        if provider == "openai":
            from llama_index.llms.openai import OpenAI
            import os
            os.environ["OPENAI_API_KEY"] = api_key
            llm = OpenAI(model=model)
        else:
            # 其余兼容服务商用 OpenAILike，可自定义 base_url
            from llama_index.llms.openai_like import OpenAILike
            llm = OpenAILike(
                model=model,
                api_base=base_url,
                api_key=api_key,
                is_chat_model=True,
                request_timeout=120.0,
            )
    else:
        raise ValueError(f"不支持的服务商: {provider}")

    # 设置全局默认，避免 llama-index 自动寻找未配置的 LLM
    Settings.llm = llm
    Settings.embed_model = embed_model

    # ── 加载 FAISS 向量索引 ──────────────────────────────────────────────────
    faiss_index = faiss.read_index(str(coll_dir / "vector_store.faiss"))
    vector_store = FaissVectorStore(faiss_index=faiss_index)
    storage_context = StorageContext.from_defaults(
        vector_store=vector_store,
        persist_dir=str(coll_dir),
    )
    index = load_index_from_storage(storage_context, embed_model=embed_model)

    # top_k：检索最相关的 k 个片段，k 越大回答越全面但速度越慢
    query_engine = index.as_query_engine(similarity_top_k=top_k, llm=llm)
    response = query_engine.query(question)
    return str(response)
