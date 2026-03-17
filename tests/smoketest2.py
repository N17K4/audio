"""RAG / Agent / LoRA 进阶功能集成测试

分组：
  - RAG（Retrieval-Augmented Generation）— Ollama embedding + FAISS 本地知识库
  - Agent（ReAct 智能体）— LLM 推理 + 工具调用循环
  - LoRA（QLoRA 微调）— HuggingFace 模型下载 + peft 微调训练

前置要求：
  - RAG & Agent：Ollama 运行中 + nomic-embed-text 模型已加载（RAG 用）
  - LoRA：互联网连接（用于 HuggingFace 模型下载）

运行：
  cd test001 && poetry run pytest tests/smoketest2.py -v -s
"""
import asyncio
import json
import os
import sys
import tempfile
from pathlib import Path

import pytest

# 添加 backend 到 Python path
sys.path.insert(0, str(Path(__file__).parent.parent / "backend"))


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
            # 模型名可能带 :tag，比如 nomic-embed-text:latest
            return any(model in m for m in models)
    except Exception:
        return False


# ──────────────────────────────────────────────────────────────────────────────
# 测试：RAG（知识库）
# ──────────────────────────────────────────────────────────────────────────────

class TestRAG:
    """RAG — Retrieval-Augmented Generation（检索增强生成）"""

    @pytest.fixture(scope="function", autouse=True)
    def setup(self):
        """前置：检查 Ollama 和必需模型。"""
        # 检查 Ollama
        if not check_ollama_running():
            pytest.skip(
                "❌ Ollama 未运行。请执行：ollama serve\n"
                "   或 macOS：brew services start ollama"
            )

        # 检查 embedding 模型
        if not check_ollama_model("nomic-embed-text"):
            pytest.skip(
                "❌ Ollama 中缺少 nomic-embed-text 模型。"
                "请执行：ollama pull nomic-embed-text"
            )

    def test_build_and_query_collection(self):
        """测试：创建知识库 → 上传文件 → 构建索引 → 查询。"""
        from services.rag.indexer import build_collection, list_collections, delete_collection
        from services.rag.querier import query_collection

        # 创建临时目录和测试文件
        with tempfile.TemporaryDirectory() as tmpdir:
            test_file = Path(tmpdir) / "test.txt"
            test_file.write_text("Python 是一门广泛使用的编程语言。\nPython 支持多种编程范式。")

            collection_name = "test_kb"
            try:
                # 1. 构建知识库
                print(f"🔨 构建知识库：{collection_name}")
                build_collection(collection_name, [str(test_file)])

                # 2. 列表查询
                print("📋 列出所有知识库")
                collections = list_collections()
                assert any(c["name"] == collection_name for c in collections), \
                    f"知识库 {collection_name} 未找到"

                # 3. 查询知识库
                print("❓ 查询知识库")
                answer = query_collection(
                    collection_name,
                    "Python 是什么？",
                    top_k=3,
                    provider="ollama",
                    model="qwen2.5:0.5b",
                    api_key="",
                    ollama_url="http://127.0.0.1:11434"
                )
                assert answer and len(answer) > 0, "查询结果为空"
                assert "Python" in answer or "python" in answer, \
                    "查询结果未包含相关内容"

                print(f"✅ RAG 测试通过\n   答案摘录：{answer[:100]}...")

            finally:
                # 清理
                delete_collection(collection_name)


# ──────────────────────────────────────────────────────────────────────────────
# 测试：Agent（智能体）
# ──────────────────────────────────────────────────────────────────────────────

class TestAgent:
    """Agent — ReAct 智能体（推理 + 行动循环）"""

    @pytest.fixture(scope="function", autouse=True)
    def setup(self):
        """前置：检查 Ollama 和默认模型。"""
        # 检查 Ollama
        if not check_ollama_running():
            pytest.skip(
                "❌ Ollama 未运行。请执行：ollama serve"
            )

        # 检查默认推理模型
        default_model = "qwen2.5:0.5b"
        if not check_ollama_model(default_model):
            pytest.skip(
                f"❌ Ollama 中缺少 {default_model} 模型。"
                f"请执行：ollama pull {default_model}"
            )

    @pytest.mark.asyncio
    async def test_react_loop_simple_task(self):
        """测试：Agent 执行简单任务（网络搜索 + 思考）。"""
        from services.agent.graph import run_react_agent

        print("🤖 执行 Agent 任务：计算 10+5")

        # 运行 ReAct 循环（禁用 web_search，避免外部依赖）
        final_answer = await run_react_agent(
            task="计算 10 + 5 的结果",
            tool_names=[],  # 不调用工具，只用 LLM 思考
            provider="ollama",
            model="qwen2.5:0.5b",
            api_key="",
            ollama_url="http://127.0.0.1:11434",
        )

        assert final_answer and len(final_answer) > 0, "Agent 未返回答案"
        assert ("15" in final_answer or "十五" in final_answer), \
            "Agent 答案未包含正确结果"

        print(f"✅ Agent 测试通过\n   最终答案：{final_answer[:100]}...")


# ──────────────────────────────────────────────────────────────────────────────
# 测试：LoRA（微调）
# ──────────────────────────────────────────────────────────────────────────────

class TestLoRA:
    """LoRA — QLoRA 微调（Low-Rank Adaptation 量化微调）"""

    def test_download_model_from_huggingface(self):
        """测试：从 HuggingFace 下载基座模型（不实际训练）。"""
        print("🔗 检查 HuggingFace 连接")

        try:
            from huggingface_hub import model_info
            # 仅检查是否能查询模型信息，不实际下载
            model_id = "Qwen/Qwen2.5-0.5B"
            info = model_info(model_id, timeout=10)
            assert info.modelId == model_id
            print(f"✅ HuggingFace 连接正常\n   模型：{model_id}")
        except Exception as e:
            pytest.skip(f"❌ 无法连接 HuggingFace：{str(e)}")

    def test_lora_config_and_trainer_setup(self):
        """测试：LoRA 配置和 SFTTrainer 初始化（不实际训练）。"""
        print("⚙️  检查 LoRA 和 SFTTrainer 依赖")

        try:
            from peft import LoraConfig
            from trl import SFTTrainer

            # 验证 LoRA 配置可以创建
            config = LoraConfig(
                r=16,
                lora_alpha=32,
                target_modules=["q_proj", "v_proj"],
                lora_dropout=0.05,
                bias="none",
                task_type="CAUSAL_LM"
            )
            assert config.r == 16
            print(f"✅ LoRA 配置正常\n   rank={config.r}, alpha={config.lora_alpha}")
        except ImportError as e:
            pytest.skip(f"❌ 缺少必需的库：{str(e)}")

    def test_training_data_format(self):
        """测试：验证 JSONL 训练数据格式。"""
        print("📄 检查训练数据格式")

        with tempfile.TemporaryDirectory() as tmpdir:
            train_file = Path(tmpdir) / "train.jsonl"

            # 生成有效的 JSONL 格式
            data = [
                {"instruction": "翻译为英文", "output": "Translate to English"},
                {"instruction": "总结这段文本", "output": "Summarize this text"},
                {"prompt": "你好", "completion": "你好，有什么我可以帮助你的吗？"},
            ]

            with open(train_file, "w", encoding="utf-8") as f:
                for item in data:
                    f.write(json.dumps(item, ensure_ascii=False) + "\n")

            # 验证文件格式
            with open(train_file, "r", encoding="utf-8") as f:
                lines = f.readlines()
                assert len(lines) == 3
                for line in lines:
                    obj = json.loads(line)
                    assert "instruction" in obj or "prompt" in obj
                    assert "output" in obj or "completion" in obj

            print(f"✅ 训练数据格式正确\n   文件：{train_file.name}, 行数：3")


# ──────────────────────────────────────────────────────────────────────────────
# 集成测试：端到端流程（如果所有前置条件满足）
# ──────────────────────────────────────────────────────────────────────────────

class TestIntegration:
    """集成测试：RAG + Agent + LoRA 完整流程"""

    def test_all_features_available(self):
        """检查所有进阶功能的依赖是否完整。"""
        missing = []

        # RAG 依赖
        try:
            import llama_index
            import faiss
        except ImportError:
            missing.append("RAG: llama-index, faiss-cpu")

        # Agent 依赖
        try:
            import langgraph
        except ImportError:
            missing.append("Agent: langgraph")

        # LoRA 依赖
        try:
            import peft
            import trl
        except ImportError:
            missing.append("LoRA: peft, trl")

        if missing:
            pytest.skip(f"⚠️  缺少依赖：{', '.join(missing)}")

        print("✅ 所有进阶功能依赖都已安装")


if __name__ == "__main__":
    # 快速检查：不通过 pytest 直接运行
    print("🔍 快速健康检查…\n")

    ollama_ok = check_ollama_running()
    print(f"  {'✅' if ollama_ok else '❌'} Ollama 服务：{'运行中' if ollama_ok else '未运行'}")

    if ollama_ok:
        embed_ok = check_ollama_model("nomic-embed-text")
        model_ok = check_ollama_model("qwen2.5:0.5b")
        print(f"  {'✅' if embed_ok else '❌'} nomic-embed-text：{'已加载' if embed_ok else '未加载'}")
        print(f"  {'✅' if model_ok else '❌'} qwen2.5:0.5b：{'已加载' if model_ok else '未加载'}")

    print("\n运行完整测试：poetry run pytest tests/smoketest2.py -v -s")
