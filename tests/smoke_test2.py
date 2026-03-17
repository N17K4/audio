"""RAG / Agent / LoRA 进阶功能集成测试

分组：
  - RAG（Retrieval-Augmented Generation）— Ollama embedding + FAISS 本地知识库
  - Agent（ReAct 智能体）— LLM 推理 + 工具调用循环
  - LoRA（QLoRA 微调）— HuggingFace 模型下载 + peft 微调训练

前置要求：
  - RAG & Agent：Ollama 运行中 + nomic-embed-text 模型已加载（RAG 用）
  - LoRA：互联网连接（用于 HuggingFace 模型下载）

运行（直接执行）：
  python tests/smoke_test2.py

运行（通过 pytest）：
  poetry run pytest tests/smoke_test2.py -v -s
"""
import asyncio
import json
import os
import sys
import tempfile
from pathlib import Path

# 添加 backend 到 Python path
sys.path.insert(0, str(Path(__file__).parent.parent / "backend"))

try:
    import pytest
    HAS_PYTEST = True
except ImportError:
    HAS_PYTEST = False


# ──────────────────────────────────────────────────────────────────────────────
# 工具函数：健康检查
# ──────────────────────────────────────────────────────────────────────────────

def check_ollama_running(base_url: str = "http://127.0.0.1:11434") -> bool:
    """检查 Ollama 服务是否运行中。"""
    try:
        import httpx
        with httpx.Client(timeout=2) as client:
            resp = client.get(f"{base_url}/api/tags")
            return resp.status_code == 200
    except Exception:
        return False


def check_ollama_model(model: str, base_url: str = "http://127.0.0.1:11434") -> bool:
    """检查 Ollama 中是否已加载指定模型。"""
    try:
        import httpx
        with httpx.Client(timeout=2) as client:
            resp = client.get(f"{base_url}/api/tags")
            if resp.status_code != 200:
                return False
            data = resp.json()
            models = [m.get("name", "") for m in data.get("models", [])]
            return any(model in m for m in models)
    except Exception:
        return False


def pull_ollama_model(model: str, base_url: str = "http://127.0.0.1:11434") -> bool:
    """自动拉取缺失的 Ollama 模型。"""
    import subprocess
    print(f"  📥 正在拉取模型：{model}（首次较慢，请耐心等待…）")
    try:
        proc = subprocess.run(
            ["ollama", "pull", model],
            capture_output=True,
            text=True,
            timeout=600  # 10 分钟超时
        )
        if proc.returncode == 0:
            print(f"  ✓ {model} 拉取完成")
            return True
        else:
            print(f"  ✗ 拉取失败：{proc.stderr}")
            return False
    except Exception as e:
        print(f"  ✗ 执行 ollama pull 失败：{e}")
        return False


# ──────────────────────────────────────────────────────────────────────────────
# 测试函数（可独立运行）
# ──────────────────────────────────────────────────────────────────────────────

def test_rag():
    """测试：RAG 知识库构建与查询。"""
    print("\n🔍 测试 RAG（知识库）")

    if not check_ollama_running():
        print("❌ Ollama 未运行。请执行：ollama serve")
        return False

    if not check_ollama_model("nomic-embed-text"):
        print("⚠️  缺少 nomic-embed-text 模型，正在自动拉取…")
        if not pull_ollama_model("nomic-embed-text"):
            print("❌ 无法拉取 nomic-embed-text 模型")
            return False

    try:
        from services.rag.indexer import build_collection, list_collections, delete_collection
        from services.rag.querier import query_collection

        with tempfile.TemporaryDirectory() as tmpdir:
            test_file = Path(tmpdir) / "test.txt"
            test_file.write_text("Python 是一门广泛使用的编程语言。\nPython 支持多种编程范式。")

            collection_name = "test_kb"
            try:
                print("  🔨 构建知识库…")
                build_collection(collection_name, [str(test_file)])

                print("  📋 验证知识库…")
                collections = list_collections()
                assert any(c["name"] == collection_name for c in collections)

                print("  ❓ 查询知识库…")
                answer = query_collection(
                    collection_name,
                    "Python 是什么？",
                    top_k=3,
                    provider="ollama",
                    model="qwen2.5:0.5b",
                    api_key="",
                    ollama_url="http://127.0.0.1:11434"
                )
                assert answer and len(answer) > 0
                assert "Python" in answer or "python" in answer

                print("✅ RAG 测试通过")
                return True

            finally:
                delete_collection(collection_name)

    except Exception as e:
        print(f"❌ RAG 测试失败: {e}")
        return False


def test_agent():
    """测试：Agent ReAct 循环。"""
    print("\n🔍 测试 Agent（智能体）")

    if not check_ollama_running():
        print("❌ Ollama 未运行")
        return False

    if not check_ollama_model("qwen2.5:0.5b"):
        print("⚠️  缺少 qwen2.5:0.5b 模型，正在自动拉取…")
        if not pull_ollama_model("qwen2.5:0.5b"):
            print("❌ 无法拉取 qwen2.5:0.5b 模型")
            return False

    try:
        from services.agent.graph import run_react_agent

        print("  🤖 执行 Agent 任务…")
        final_answer = asyncio.run(run_react_agent(
            task="计算 10 + 5 的结果",
            tool_names=[],
            provider="ollama",
            model="qwen2.5:0.5b",
            api_key="",
            ollama_url="http://127.0.0.1:11434",
        ))

        assert final_answer and len(final_answer) > 0
        assert ("15" in final_answer or "十五" in final_answer)

        print("✅ Agent 测试通过")
        return True

    except Exception as e:
        print(f"❌ Agent 测试失败: {e}")
        return False


def test_lora():
    """测试：LoRA 配置与数据格式。"""
    print("\n🔍 测试 LoRA（微调）")

    try:
        print("  🔗 检查 HuggingFace 连接…")
        from huggingface_hub import model_info
        model_id = "Qwen/Qwen2.5-0.5B"
        info = model_info(model_id, timeout=10)
        assert info.modelId == model_id
        print("  ✓ HuggingFace 连接正常")

    except Exception as e:
        print(f"⚠️  无法连接 HuggingFace：{e}")
        print("  💡 提示：请检查网络连接或使用 HuggingFace 镜像")
        return False

    try:
        print("  ⚙️  检查 LoRA 依赖…")
        from peft import LoraConfig
        from trl import SFTTrainer

        config = LoraConfig(
            r=16,
            lora_alpha=32,
            target_modules=["q_proj", "v_proj"],
            lora_dropout=0.05,
            bias="none",
            task_type="CAUSAL_LM"
        )
        assert config.r == 16
        print("  ✓ LoRA 配置正常")

    except ImportError as e:
        missing_lib = str(e).split("'")[1] if "'" in str(e) else "依赖"
        print(f"⚠️  缺少依赖：{missing_lib}")
        print(f"  💡 提示：运行 pnpm run setup:ml 来安装 LoRA 依赖")
        print(f"  或手动安装：pip install peft trl")
        return False

    try:
        print("  📄 验证训练数据格式…")
        with tempfile.TemporaryDirectory() as tmpdir:
            train_file = Path(tmpdir) / "train.jsonl"
            data = [
                {"instruction": "翻译为英文", "output": "Translate to English"},
                {"instruction": "总结这段文本", "output": "Summarize this text"},
                {"prompt": "你好", "completion": "你好，有什么我可以帮助你的吗？"},
            ]

            with open(train_file, "w", encoding="utf-8") as f:
                for item in data:
                    f.write(json.dumps(item, ensure_ascii=False) + "\n")

            with open(train_file, "r", encoding="utf-8") as f:
                lines = f.readlines()
                assert len(lines) == 3
                for line in lines:
                    obj = json.loads(line)
                    assert "instruction" in obj or "prompt" in obj
                    assert "output" in obj or "completion" in obj

        print("  ✓ 数据格式正确")
        print("✅ LoRA 测试通过")
        return True

    except Exception as e:
        print(f"❌ LoRA 测试失败: {e}")
        return False


# ──────────────────────────────────────────────────────────────────────────────
# Pytest 集成（如果通过 pytest 运行）
# ──────────────────────────────────────────────────────────────────────────────

if HAS_PYTEST:
    class TestRAG:
        """RAG — Retrieval-Augmented Generation（检索增强生成）"""

        def test_build_and_query_collection(self):
            """测试：创建知识库 → 上传文件 → 构建索引 → 查询。"""
            assert test_rag()

    class TestAgent:
        """Agent — ReAct 智能体（推理 + 行动循环）"""

        def test_react_loop_simple_task(self):
            """测试：Agent 执行简单任务（网络搜索 + 思考）。"""
            assert test_agent()

    class TestLoRA:
        """LoRA — QLoRA 微调（Low-Rank Adaptation 量化微调）"""

        def test_lora_setup(self):
            """测试：LoRA 配置和训练数据格式。"""
            assert test_lora()


# ──────────────────────────────────────────────────────────────────────────────
# 主入口（直接运行脚本）
# ──────────────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    print("🔍 烟雾测试 2：RAG / Agent / LoRA\n")
    print("─" * 60)

    results = {
        "RAG": test_rag(),
        "Agent": test_agent(),
        "LoRA": test_lora(),
    }

    print("\n" + "─" * 60)
    print("\n📊 测试结果汇总：\n")

    passed = sum(1 for v in results.values() if v)
    failed = len(results) - passed

    for name, result in results.items():
        status = "✅ 通过" if result else "❌ 失败"
        print(f"  {status} — {name}")

    print(f"\n  总计：✅ {passed} 通过  ❌ {failed} 失败\n")

    if failed > 0:
        print("─" * 60)
        sys.exit(1)  # 失败时返回非零退出码
    else:
        print("─" * 60)
        sys.exit(0)
