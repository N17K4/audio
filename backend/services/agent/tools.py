import subprocess
import os
from pathlib import Path
from config import MODEL_ROOT

WORKSPACE = MODEL_ROOT / "agent_workspace"
WORKSPACE.mkdir(parents=True, exist_ok=True)


def web_search_tool(query: str) -> str:
    """使用 DuckDuckGo 搜索网络"""
    try:
        from duckduckgo_search import DDGS
        with DDGS() as ddgs:
            results = list(ddgs.text(query, max_results=5))
        return "\n\n".join(
            f"**{r['title']}**\n{r['href']}\n{r['body']}" for r in results
        )
    except ImportError:
        return "[错误] duckduckgo-search 未安装"
    except Exception as e:
        return f"[搜索错误] {e}"


def python_exec_tool(code: str) -> str:
    """在沙箱中执行 Python 代码（限时 10s）"""
    try:
        result = subprocess.run(
            ["python3", "-c", code],
            capture_output=True, text=True, timeout=10,
            env={**os.environ, "PYTHONDONTWRITEBYTECODE": "1"},
        )
        output = result.stdout or ""
        if result.stderr:
            output += f"\n[stderr]\n{result.stderr}"
        return output or "[无输出]"
    except subprocess.TimeoutExpired:
        return "[错误] 执行超时（10s）"
    except Exception as e:
        return f"[错误] {e}"


def file_read_tool(filename: str) -> str:
    """读取 agent_workspace 下的文件"""
    target = WORKSPACE / Path(filename).name
    if not target.exists():
        return f"[错误] 文件不存在: {filename}"
    return target.read_text(encoding="utf-8", errors="replace")


def file_write_tool(filename: str, content: str) -> str:
    """写入文件到 agent_workspace"""
    target = WORKSPACE / Path(filename).name
    target.write_text(content, encoding="utf-8")
    return f"已写入: {target}"


def rag_retrieval_tool(collection: str, question: str) -> str:
    """从知识库检索信息"""
    try:
        from services.rag.querier import query_collection
        return query_collection(collection, question)
    except Exception as e:
        return f"[RAG 错误] {e}"


TOOLS = {
    "web_search": {"fn": web_search_tool, "desc": "搜索互联网获取最新信息", "args": ["query"]},
    "python_exec": {"fn": python_exec_tool, "desc": "执行 Python 代码片段", "args": ["code"]},
    "file_read": {"fn": file_read_tool, "desc": "读取工作区文件", "args": ["filename"]},
    "file_write": {"fn": file_write_tool, "desc": "写入内容到工作区文件", "args": ["filename", "content"]},
    "rag_retrieval": {"fn": rag_retrieval_tool, "desc": "从本地知识库检索相关信息", "args": ["collection", "question"]},
}
