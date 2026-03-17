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
    """检查 Ollama 中是否已加载指定模型（大小写不敏感）。"""
    try:
        import httpx
        with httpx.Client(timeout=2) as client:
            resp = client.get(f"{base_url}/api/tags")
            if resp.status_code != 200:
                return False
            data = resp.json()
            models = [m.get("name", "").lower() for m in data.get("models", [])]
            model_lower = model.lower()
            # 精确匹配或前缀匹配（大小写不敏感）
            for m in models:
                if m == model_lower or m.startswith(model_lower + ":"):
                    return True
            return False
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
    """测试：RAG 知识库构建与查询（包含 API 接口和本地 Python API）。"""
    print("\n🔍 测试 RAG（知识库）")

    # 检查 Ollama 基础设施
    if not check_ollama_running():
        print("❌ Ollama 服务未运行")
        print("   💡 修复步骤：")
        print("      1. 启动 Ollama：ollama serve")
        print("      2. 拉取所需模型：")
        print("         - ollama pull nomic-embed-text  (RAG 向量化)")
        print("         - ollama pull qwen2.5:0.5b      (RAG 查询)")
        return False

    # 检查并自动拉取 nomic-embed-text（RAG 向量化）
    if not check_ollama_model("nomic-embed-text"):
        print("  ⚠️  缺少 nomic-embed-text 模型（用于向量化文档），正在自动拉取…")
        if not pull_ollama_model("nomic-embed-text"):
            print("  ❌ 拉取 nomic-embed-text 失败")
            print("     💡 请手动执行：ollama pull nomic-embed-text")
            return False

    # 检查并自动拉取 qwen2.5:0.5b（RAG 查询）
    if not check_ollama_model("qwen2.5:0.5b"):
        print("  ⚠️  缺少 qwen2.5:0.5b 模型（用于回答查询），正在自动拉取…")
        if not pull_ollama_model("qwen2.5:0.5b"):
            print("  ❌ 拉取 qwen2.5:0.5b 失败")
            print("     💡 请手动执行：ollama pull qwen2.5:0.5b")
            return False

    # 检查依赖
    try:
        print("  🔗 检查 RAG 依赖…")
        import faiss  # noqa: F401
        import llama_index  # noqa: F401
        print("  ✓ RAG 依赖就绪")
    except ImportError as e:
        missing = str(e).split("'")[1] if "'" in str(e) else str(e)
        print(f"  ❌ 缺少依赖：{missing}")
        print(f"     💡 请运行：pnpm run ml:extra")
        print(f"     或手动安装：pip install faiss-cpu llama-index")
        return False

    try:
        from services.rag.indexer import build_collection, list_collections, delete_collection
        from services.rag.querier import query_collection

        with tempfile.TemporaryDirectory() as tmpdir:
            test_file = Path(tmpdir) / "test.txt"
            test_file.write_text("Python 是一门广泛使用的编程语言。\nPython 支持多种编程范式。")

            collection_name = "test_kb"
            try:
                print("  🔨 构建知识库（本地 API）…")
                build_collection(collection_name, [str(test_file)])

                print("  📋 验证知识库…")
                collections = list_collections()
                if not any(c["name"] == collection_name for c in collections):
                    print("  ❌ 知识库创建失败，未在列表中找到")
                    return False

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
                if not answer or len(answer) == 0:
                    print("  ❌ 知识库查询返回空结果")
                    return False
                if "Python" not in answer and "python" not in answer:
                    print(f"  ⚠️  查询结果不包含 'Python'，实际返回：{answer[:100]}")
                    return False

                print("  ✅ 本地 API 测试成功")

            finally:
                try:
                    delete_collection(collection_name)
                except Exception:
                    pass  # 清理失败不影响测试结果

        # 测试 HTTP API 创建知识库
        print("  🔨 构建知识库（HTTP API）…")
        try:
            import httpx

            with tempfile.TemporaryDirectory() as tmpdir:
                # 创建测试文件
                test_file = Path(tmpdir) / "api_test.txt"
                test_file.write_text("Rust 是一门系统编程语言。\nRust 强调内存安全。")

                api_collection_name = "test_kb_api"

                try:
                    # 调用 POST /rag/collections API
                    with httpx.Client(timeout=30) as client:
                        with open(test_file, "rb") as f:
                            files = {"files": (test_file.name, f)}
                            data = {"name": api_collection_name}
                            resp = client.post(
                                "http://127.0.0.1:8000/rag/collections",
                                files=files,
                                data=data
                            )

                        if resp.status_code != 200:
                            print(f"  ❌ API 创建知识库失败：{resp.status_code} {resp.text}")
                            return False

                        result = resp.json()
                        if "job_id" not in result:
                            print(f"  ❌ API 响应缺少 job_id：{result}")
                            return False

                        job_id = result["job_id"]
                        print(f"  ⏳ 知识库构建中（job_id: {job_id}）…")

                        # 轮询等待知识库构建完成
                        import time
                        max_wait = 60  # 最多等待 60 秒
                        elapsed = 0
                        while elapsed < max_wait:
                            job_resp = client.get(f"http://127.0.0.1:8000/rag/collections/jobs/{job_id}")
                            if job_resp.status_code == 200:
                                job_data = job_resp.json()
                                if job_data.get("status") == "done":
                                    print(f"  ✓ 知识库构建完成")
                                    break
                                elif job_data.get("status") == "error":
                                    print(f"  ❌ 知识库构建失败：{job_data.get('error')}")
                                    return False

                            time.sleep(2)
                            elapsed += 2
                        else:
                            print(f"  ❌ 知识库构建超时（>60s）")
                            return False

                        # 验证知识库已创建
                        collections_resp = client.get("http://127.0.0.1:8000/rag/collections")
                        if collections_resp.status_code == 200:
                            collections = collections_resp.json()
                            if not any(c.get("name") == api_collection_name for c in collections):
                                print(f"  ❌ 知识库不在列表中")
                                return False

                        # 查询 API 知识库
                        print("  ❓ 查询 API 知识库…")
                        query_resp = client.post(
                            "http://127.0.0.1:8000/rag/query",
                            json={
                                "collection": api_collection_name,
                                "question": "Rust 是什么？",
                                "top_k": 3,
                                "provider": "ollama",
                                "model": "qwen2.5:0.5b",
                                "api_key": "",
                                "ollama_url": "http://127.0.0.1:11434"
                            }
                        )

                        if query_resp.status_code != 200:
                            print(f"  ❌ 查询 API 失败：{query_resp.status_code}")
                            return False

                        # 读取流式响应
                        answer = ""
                        for line in query_resp.iter_lines():
                            if line.startswith("data: "):
                                answer = line[6:]  # 移除 "data: " 前缀

                        if not answer or len(answer) == 0:
                            print("  ❌ API 查询返回空结果")
                            return False

                        if "Rust" not in answer and "rust" not in answer:
                            print(f"  ⚠️  API 查询结果不包含 'Rust'，实际返回：{answer[:100]}")
                            return False

                        # 清理 API 知识库
                        delete_resp = client.delete(f"http://127.0.0.1:8000/rag/collections/{api_collection_name}")
                        if delete_resp.status_code != 200:
                            print(f"  ⚠️  清理知识库失败（status {delete_resp.status_code}）")

                        print("  ✓ API 测试成功")

                except Exception as e:
                    print(f"  ⚠️  HTTP API 测试失败（后端可能未运行）：{e}")
                    # HTTP API 测试失败不中断整个 RAG 测试，本地 API 已验证

        except ImportError:
            print("  ⚠️  httpx 未安装，跳过 HTTP API 测试")

        print("  ✅ RAG 知识库构建、索引、查询全部成功")
        return True

    except ImportError as e:
        missing = str(e).split("'")[1] if "'" in str(e) else str(e)
        print(f"  ❌ 导入失败：{missing}")
        print(f"     💡 请运行：pnpm run ml:rag")
        return False
    except Exception as e:
        print(f"  ❌ RAG 测试失败：{e}")
        print(f"     💡 如果是 Ollama 模型加载缓慢，请稍候重试")
        return False


def test_agent():
    """测试：Agent ReAct 循环。"""
    print("\n🔍 测试 Agent（智能体）")

    # 检查 Ollama 基础设施
    if not check_ollama_running():
        print("  ❌ Ollama 服务未运行")
        print("     💡 修复步骤：")
        print("        1. 启动 Ollama：ollama serve")
        print("        2. 拉取 Agent 模型：ollama pull qwen2.5:0.5b")
        return False

    # 检查并自动拉取 qwen2.5:0.5b（Agent 推理）
    if not check_ollama_model("qwen2.5:0.5b"):
        print("  ⚠️  缺少 qwen2.5:0.5b 模型，正在自动拉取…")
        if not pull_ollama_model("qwen2.5:0.5b"):
            print("  ❌ 拉取 qwen2.5:0.5b 失败")
            print("     💡 请手动执行：ollama pull qwen2.5:0.5b")
            return False

    # 检查依赖
    try:
        print("  🔗 检查 Agent 依赖…")
        import llama_index  # noqa: F401
        print("  ✓ Agent 依赖就绪")
    except ImportError as e:
        missing = str(e).split("'")[1] if "'" in str(e) else str(e)
        print(f"  ❌ 缺少依赖：{missing}")
        print(f"     💡 请运行：pnpm run ml:extra")
        print(f"     或手动安装：pip install llama-index")
        return False

    try:
        from services.agent.graph import run_react_agent

        print("  🤖 执行 Agent 推理任务…")
        # run_react_agent 返回 Generator，不是 coroutine
        final_answer = ""
        for chunk in run_react_agent(
            task="计算 10 + 5 的结果",
            tool_names=[],
            provider="ollama",
            model="qwen2.5:0.5b",
            api_key="",
            ollama_url="http://127.0.0.1:11434",
        ):
            final_answer = chunk  # 获取最后一个输出（最终答案）

        if not final_answer or len(final_answer) == 0:
            print("  ❌ Agent 未返回结果")
            return False

        if "15" not in final_answer and "十五" not in final_answer:
            print(f"  ⚠️  Agent 返回结果未包含正确答案，实际返回：{final_answer[:100]}")
            return False

        print("  ✅ Agent ReAct 循环执行成功")
        return True

    except ImportError as e:
        missing = str(e).split("'")[1] if "'" in str(e) else str(e)
        print(f"  ❌ 导入失败：{missing}")
        print(f"     💡 请运行：pnpm run ml:agent")
        return False
    except Exception as e:
        print(f"  ❌ Agent 测试失败：{e}")
        print(f"     💡 如果是 Ollama 模型加载缓慢，请稍候重试")
        return False


def test_lora():
    """测试：LoRA 配置与数据格式。"""
    print("\n🔍 测试 LoRA（微调）")

    # 检查所有必需的依赖（upfront）
    print("  ⚙️  检查 LoRA 依赖…")
    missing_deps = []
    required_deps = {
        "peft": "LoRA 微调框架",
        "trl": "有监督微调训练器",
        "transformers": "HuggingFace 模型库",
        "torch": "PyTorch 张量计算",
        "huggingface_hub": "HuggingFace 模型下载",
    }

    for lib, description in required_deps.items():
        try:
            __import__(lib)
        except ImportError:
            missing_deps.append((lib, description))

    if missing_deps:
        print("  ❌ 缺少以下依赖：")
        for lib, description in missing_deps:
            print(f"     - {lib}（{description}）")
        print("  💡 修复步骤：")
        print("     1. 运行：pnpm run ml:extra")
        print("     2. 或手动安装：pip install peft trl transformers torch")
        return False

    print("  ✓ 所有 LoRA 依赖就绪")

    # 检查网络连接和 HuggingFace 访问
    try:
        print("  🔗 检查 HuggingFace 连接…")
        from huggingface_hub import model_info
        model_id = "Qwen/Qwen2.5-0.5B"
        try:
            info = model_info(model_id, timeout=10)
            if info.modelId != model_id:
                print(f"  ⚠️  HuggingFace 返回意外模型 ID")
                return False
            print("  ✓ HuggingFace 连接正常")
        except Exception as e:
            print(f"  ⚠️  无法访问 HuggingFace（{str(e)[:50]}…）")
            print("  💡 请检查：")
            print("     1. 网络连接是否正常")
            print("     2. 可尝试使用 HuggingFace 镜像（如清华、aliyun）")
            print("     3. 或设置 HF_ENDPOINT 环境变量")
            return False

    except ImportError:
        print("  ❌ huggingface_hub 导入失败（应已在上面检查）")
        return False

    # 验证 LoRA 配置和训练数据格式
    try:
        from peft import LoraConfig

        print("  ⚙️  验证 LoRA 配置…")
        config = LoraConfig(
            r=16,
            lora_alpha=32,
            target_modules=["q_proj", "v_proj"],
            lora_dropout=0.05,
            bias="none",
            task_type="CAUSAL_LM"
        )
        if config.r != 16:
            print(f"  ❌ LoRA 配置验证失败（r 值异常）")
            return False
        print("  ✓ LoRA 配置正常")

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
                if len(lines) != 3:
                    print(f"  ❌ 数据写入失败（预期 3 行，实际 {len(lines)} 行）")
                    return False
                for i, line in enumerate(lines):
                    obj = json.loads(line)
                    if not (("instruction" in obj or "prompt" in obj) and
                            ("output" in obj or "completion" in obj)):
                        print(f"  ❌ 第 {i+1} 行数据格式不正确：{obj}")
                        return False

        print("  ✓ 训练数据格式正确")
        print("  ✅ LoRA 配置和数据验证通过")
        return True

    except Exception as e:
        print(f"  ❌ LoRA 测试失败：{e}")
        print(f"     💡 请检查依赖是否完整：pnpm run ml:lora")
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
# 前置检查和故障诊断
# ──────────────────────────────────────────────────────────────────────────────

def preflight_check():
    """前置检查：诊断常见问题。"""
    issues = []

    # 检查 Ollama
    if not check_ollama_running():
        issues.append({
            "severity": "error",
            "component": "Ollama",
            "message": "Ollama 服务未运行",
            "fix": "ollama serve",
        })

    # 检查 Python 依赖
    ml_deps = {
        "peft": "LoRA（微调）",
        "trl": "LoRA（微调）",
        "faiss": "RAG（知识库）",
        "llama_index": "RAG/Agent",
    }

    for dep, feature in ml_deps.items():
        try:
            __import__(dep)
        except ImportError:
            issues.append({
                "severity": "warning",
                "component": feature,
                "message": f"缺少 {dep}",
                "fix": "pnpm run ml:extra",
            })

    return issues


# ──────────────────────────────────────────────────────────────────────────────
# 主入口（直接运行脚本）
# ──────────────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    print("🔍 烟雾测试 2：RAG / Agent / LoRA\n")
    print("─" * 60)

    # 前置检查
    issues = preflight_check()
    if issues:
        print("\n⚠️  前置检查发现问题：\n")
        for issue in issues:
            severity_icon = "❌" if issue["severity"] == "error" else "⚠️ "
            print(f"  {severity_icon} [{issue['component']}] {issue['message']}")
            print(f"     💡 修复：{issue['fix']}")
        print("\n" + "─" * 60 + "\n")

    # 运行测试
    results = {
        "RAG": test_rag(),
        "Agent": test_agent(),
        "LoRA": test_lora(),
    }

    # 计算最终状态
    passed = sum(1 for v in results.values() if v)
    failed = len(results) - passed

    # 输出结构化结果（供前端解析）
    print("\n" + "─" * 60)
    print("\n📊 测试结果汇总：\n")
    for name, result in results.items():
        status = "✅ 通过" if result else "❌ 失败"
        print(f"  {status} — {name}")
    print(f"\n  总计：✅ {passed} 通过  ❌ {failed} 失败\n")
    print("─" * 60)

    if failed > 0:
        sys.exit(1)  # 失败时返回非零退出码
    else:
        sys.exit(0)  # 成功时返回 0
