"""RAG / Agent / LoRA 进阶功能集成测试（HTTP API）

所有测试通过 HTTP API 调用后端，模拟前端真实流程。

前置要求：
  - 后端运行中（npm run dev）
  - RAG & Agent：Ollama 运行中 + nomic-embed-text / qwen2.5:0.5b 模型
  - LoRA：互联网连接（用于 HuggingFace 模型下载）

运行：
  python tests/smoke_test2.py
"""
import json
import os
import sys
import tempfile
from pathlib import Path


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

BASE_URL = f"http://127.0.0.1:{os.environ.get('BACKEND_PORT', '8000')}"


def _check_backend_running():
    """检查后端是否运行中。"""
    try:
        import httpx
        with httpx.Client(timeout=5) as client:
            resp = client.get(f"{BASE_URL}/health")
            return resp.status_code == 200
    except Exception:
        return False


def _check_rag_prerequisites():
    """检查 RAG 测试的前置条件（后端 + Ollama + 模型），返回 True 表示就绪。"""
    if not _check_backend_running():
        print("  ❌ 后端未运行，请先启动 npm run dev")
        return False

    if not check_ollama_running():
        print("❌ Ollama 服务未运行")
        print("   💡 修复步骤：")
        print("      1. 启动 Ollama：ollama serve")
        print("      2. 拉取所需模型：")
        print("         - ollama pull nomic-embed-text  (RAG 向量化)")
        print("         - ollama pull qwen2.5:0.5b      (RAG 查询)")
        return False

    if not check_ollama_model("nomic-embed-text"):
        print("  ⚠️  缺少 nomic-embed-text 模型（用于向量化文档），正在自动拉取…")
        if not pull_ollama_model("nomic-embed-text"):
            print("  ❌ 拉取 nomic-embed-text 失败")
            return False

    if not check_ollama_model("qwen2.5:0.5b"):
        print("  ⚠️  缺少 qwen2.5:0.5b 模型（用于回答查询），正在自动拉取…")
        if not pull_ollama_model("qwen2.5:0.5b"):
            print("  ❌ 拉取 qwen2.5:0.5b 失败")
            return False

    return True


def _wait_build_job(client, job_id, max_wait=120):
    """轮询知识库构建任务直到完成，返回 True/False。"""
    import time
    elapsed = 0
    while elapsed < max_wait:
        resp = client.get(f"{BASE_URL}/rag/collections/jobs/{job_id}")
        if resp.status_code == 200:
            data = resp.json()
            if data.get("status") == "done":
                return True
            elif data.get("status") == "error":
                print(f"  ❌ 知识库构建失败：{data.get('error')}")
                return False
        time.sleep(2)
        elapsed += 2
    print(f"  ❌ 知识库构建超时（>{max_wait}s）")
    return False


def test_rag_build():
    """测试：RAG 创建知识库（通过 HTTP API，与前端流程一致）。"""
    print("\n🔍 测试 RAG 创建知识库")

    if not _check_rag_prerequisites():
        return False

    import httpx

    collection_name = "test_kb"

    try:
        with tempfile.TemporaryDirectory() as tmpdir:
            test_file = Path(tmpdir) / "test.txt"
            test_file.write_text("Python 是一门广泛使用的编程语言。\nPython 支持多种编程范式。")

            with httpx.Client(timeout=30) as client:
                # 清理可能残留的同名知识库
                client.delete(f"{BASE_URL}/rag/collections/{collection_name}")

                # 上传文件创建知识库
                with open(test_file, "rb") as f:
                    print(f"  📤 POST /rag/collections")
                    print(f"     name: {collection_name}, 文件: {test_file.name}")
                    resp = client.post(
                        f"{BASE_URL}/rag/collections",
                        files={"files": (test_file.name, f)},
                        data={"name": collection_name},
                    )

                print(f"     HTTP {resp.status_code}")
                if resp.status_code != 200:
                    print(f"  ❌ 创建知识库失败：{resp.text}")
                    return False

                result = resp.json()
                job_id = result.get("job_id")
                if not job_id:
                    print(f"  ❌ 响应缺少 job_id：{result}")
                    return False

                print(f"  ⏳ 构建中（job_id: {job_id[:8]}…）…")
                if not _wait_build_job(client, job_id):
                    return False
                print(f"  ✓ 知识库构建完成")

                # 验证知识库在列表中
                print(f"  📤 GET /rag/collections")
                collections_resp = client.get(f"{BASE_URL}/rag/collections")
                if collections_resp.status_code == 200:
                    collections = collections_resp.json()
                    print(f"     知识库列表：{json.dumps(collections, ensure_ascii=False)}")
                    if not any(c.get("name") == collection_name for c in collections):
                        print(f"  ❌ 知识库不在列表中")
                        return False

                # 清理
                client.delete(f"{BASE_URL}/rag/collections/{collection_name}")

        print("  ✅ 通过 — RAG 创建知识库（HTTP API）")
        return True

    except Exception as e:
        print(f"  ❌ 失败 — RAG 创建知识库：{e}")
        return False


def test_rag_query():
    """测试：RAG 知识库提问（通过 HTTP API，与前端流程一致）。"""
    print("\n🔍 测试 RAG 知识库提问")

    if not _check_rag_prerequisites():
        return False

    import httpx

    collection_name = "test_kb_query"

    try:
        with tempfile.TemporaryDirectory() as tmpdir:
            test_file = Path(tmpdir) / "test.txt"
            test_file.write_text("Python 是一门广泛使用的编程语言。\nPython 支持多种编程范式。\nPython 由 Guido van Rossum 创建。")

            with httpx.Client(timeout=60) as client:
                # 清理残留
                client.delete(f"{BASE_URL}/rag/collections/{collection_name}")

                # 先创建知识库
                with open(test_file, "rb") as f:
                    print(f"  📤 POST /rag/collections（查询前置）")
                    resp = client.post(
                        f"{BASE_URL}/rag/collections",
                        files={"files": (test_file.name, f)},
                        data={"name": collection_name},
                    )

                if resp.status_code != 200:
                    print(f"  ❌ 创建知识库失败：{resp.text}")
                    return False

                job_id = resp.json().get("job_id")
                print(f"  ⏳ 构建中（job_id: {job_id[:8]}…）…")
                if not _wait_build_job(client, job_id):
                    return False
                print(f"  ✓ 知识库构建完成")

                # 查询知识库（SSE 流）
                query_body = {
                    "collection": collection_name,
                    "question": "Python 是什么？",
                    "top_k": 3,
                    "provider": "ollama",
                    "model": "qwen2.5:0.5b",
                    "api_key": "",
                    "ollama_url": "http://127.0.0.1:11434",
                }
                print(f"  📤 POST /rag/query")
                print(f"     请求参数：{json.dumps(query_body, ensure_ascii=False)}")

                with client.stream("POST", f"{BASE_URL}/rag/query", json=query_body) as query_resp:
                    print(f"     HTTP {query_resp.status_code}")
                    if query_resp.status_code != 200:
                        print(f"  ❌ 查询 API 失败")
                        return False

                    answer = ""
                    for line in query_resp.iter_lines():
                        if line.startswith("data: "):
                            answer = line[6:]

                print(f"     响应：{answer[:200] if answer else '(空)'}")

                if not answer or len(answer) == 0:
                    print("  ❌ 查询返回空结果")
                    return False

                # 清理
                client.delete(f"{BASE_URL}/rag/collections/{collection_name}")

        print("  ✅ 通过 — RAG 知识库提问（HTTP API）")
        return True

    except Exception as e:
        print(f"  ❌ 失败 — RAG 知识库提问：{e}")
        return False


def test_agent():
    """测试：Agent ReAct 循环（通过 HTTP API，与前端流程一致）。"""
    print("\n🔍 测试 Agent（智能体）")

    if not _check_backend_running():
        print("  ❌ 后端未运行，请先启动 npm run dev")
        return False

    if not check_ollama_running():
        print("  ❌ Ollama 服务未运行")
        print("     💡 启动 Ollama：ollama serve && ollama pull qwen2.5:0.5b")
        return False

    if not check_ollama_model("qwen2.5:0.5b"):
        print("  ⚠️  缺少 qwen2.5:0.5b 模型，正在自动拉取…")
        if not pull_ollama_model("qwen2.5:0.5b"):
            print("  ❌ 拉取 qwen2.5:0.5b 失败")
            return False

    import httpx

    agent_body = {
        "task": "计算 10 + 5 的结果",
        "tools": [],
        "provider": "ollama",
        "model": "qwen2.5:0.5b",
        "api_key": "",
        "ollama_url": "http://127.0.0.1:11434",
    }

    try:
        print(f"  📤 POST /agent/run")
        print(f"     参数：{json.dumps(agent_body, ensure_ascii=False)}")

        with httpx.Client(timeout=120) as client:
            final_answer = ""
            chunk_count = 0

            with client.stream("POST", f"{BASE_URL}/agent/run", json=agent_body) as resp:
                print(f"     HTTP {resp.status_code}")
                if resp.status_code != 200:
                    print(f"  ❌ Agent 请求失败：{resp.status_code}")
                    return False

                for line in resp.iter_lines():
                    if line.startswith("data: "):
                        chunk_count += 1
                        final_answer = line[6:]

            print(f"     共收到 {chunk_count} 个 chunk")
            print(f"     最终响应：{final_answer[:200] if final_answer else '(空)'}")

            if not final_answer or len(final_answer) == 0:
                print("  ❌ Agent 未返回结果")
                return False

        print("  ✅ 通过 — Agent ReAct 循环执行成功（HTTP API）")
        return True

    except Exception as e:
        print(f"  ❌ 失败 — Agent：{e}")
        return False


def test_lora():
    """测试：LoRA 微调（通过 HTTP API，与前端流程一致）。"""
    print("\n🔍 测试 LoRA（微调）")

    if not _check_backend_running():
        print("  ❌ 后端未运行，请先启动 npm run dev")
        return False

    import httpx

    # 准备样例训练数据（与前端「导入样例数据」按钮一致）
    import time
    sample_data = [
        {"instruction": "什么是 AI？", "output": "AI 是人工智能，指由人制造出来的机器所表现出来的智能。"},
        {"instruction": "Python 是什么？", "output": "Python 是一种高级编程语言，以其简洁易读的语法著称。"},
        {"instruction": "如何学习编程？", "output": "学习编程的最好方法是通过大量的实践和项目开发。"},
        {"instruction": "云计算有什么优势？", "output": "云计算提供弹性扩展、成本优化和高可用性。"},
        {"instruction": "深度学习是什么？", "output": "深度学习是机器学习的一个分支，使用多层神经网络。"},
        {"instruction": "数据库的作用是什么？", "output": "数据库用于存储、管理和检索大量的结构化数据。"},
        {"instruction": "前端和后端的区别？", "output": "前端处理用户界面，后端处理业务逻辑和数据。"},
        {"instruction": "什么是 API？", "output": "API 是应用程序编程接口，允许不同应用间通信。"},
    ]
    jsonl_content = "\n".join(json.dumps(d, ensure_ascii=False) for d in sample_data)

    # 与前端 FinetunePanel 默认参数一致
    lora_params = {
        "model": "Qwen/Qwen2.5-0.5B",
        "lora_r": "4",
        "lora_alpha": "8",
        "num_epochs": "1",
        "batch_size": "2",
        "learning_rate": "2e-4",
        "max_seq_length": "64",
        "export_format": "adapter",
        "output_dir": str(Path(tempfile.gettempdir()) / "ai-workshop-temp" / "download"),
        "hf_token": "",
        "hf_mirror": "https://hf-mirror.com",
    }

    print(f"  📤 POST /finetune/start")
    print(f"     模型：{lora_params['model']}")
    print(f"     参数：r={lora_params['lora_r']}, α={lora_params['lora_alpha']}, "
          f"epochs={lora_params['num_epochs']}, seq_len={lora_params['max_seq_length']}")
    print(f"     数据：{len(sample_data)} 条样例")

    try:
        with httpx.Client(timeout=30) as client:
            # 提交微调任务（multipart/form-data，与前端一致）
            resp = client.post(
                f"{BASE_URL}/finetune/start",
                data=lora_params,
                files={"datasets": ("sample_train.jsonl", jsonl_content.encode(), "application/jsonl")},
            )

            if resp.status_code != 200:
                print(f"  ❌ 提交失败：{resp.status_code} {resp.text[:200]}")
                return False

            result = resp.json()
            job_id = result.get("job_id")
            if not job_id:
                print(f"  ❌ 后端未返回 job_id：{result}")
                return False

            print(f"  ⏳ 任务已提交（job_id: {job_id[:8]}…），轮询训练进度…")

            # 轮询 /finetune/jobs/{job_id}，与前端 FinetunePanel 轮询逻辑一致
            max_wait = 600  # 10 分钟超时（含模型下载）
            elapsed = 0
            last_progress = -1
            while elapsed < max_wait:
                time.sleep(3)
                elapsed += 3

                try:
                    job_resp = client.get(f"{BASE_URL}/finetune/jobs/{job_id}")
                    if job_resp.status_code != 200:
                        continue

                    job_data = job_resp.json()
                    status = job_data.get("status", "")
                    progress = job_data.get("progress", 0)
                    loss_curve = job_data.get("loss_curve", [])

                    # 进度有变化时打印
                    pct = int(progress * 100)
                    if pct != last_progress:
                        loss_str = f"  loss={loss_curve[-1]:.4f}" if loss_curve else ""
                        print(f"     进度：{pct}%{loss_str}")
                        last_progress = pct

                    if status == "done":
                        print(f"  ✓ 训练完成（{len(loss_curve)} steps）")
                        if loss_curve:
                            print(f"     最终 loss：{loss_curve[-1]:.4f}")
                        break

                    if status == "error":
                        log_tail = job_data.get("log_tail", [])
                        err_msg = log_tail[-1] if log_tail else "未知错误"
                        print(f"  ❌ 训练失败：{err_msg}")
                        return False

                except Exception:
                    continue
            else:
                print(f"  ❌ 训练超时（>{max_wait}s）")
                # 尝试取消
                try:
                    client.delete(f"{BASE_URL}/finetune/jobs/{job_id}")
                except Exception:
                    pass
                return False

        print("  ✅ 通过 — LoRA 微调（HTTP API）")
        return True

    except Exception as e:
        print(f"  ❌ 失败 — LoRA：{e}")
        return False


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
        "RAG创建知识库": test_rag_build(),
        "RAG知识库提问": test_rag_query(),
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
