# AI 进阶功能：RAG · Agent · LoRA 微调

> 新增于 2026-03-17，基于现有 TTS/VC/STT/LLM 架构扩展三个进阶 AI 能力模块。

---

## 功能概览

| 模块 | 入口 | 核心技术 | 依赖 |
|------|------|----------|------|
| 知识库（RAG） | 侧边栏 → AI 进阶 → 知识库 | LlamaIndex + FAISS + Ollama Embeddings | `llama-index-core`, `faiss-cpu`, `pypdf` 等 |
| 智能体（Agent） | 侧边栏 → AI 进阶 → 智能体 | ReAct 循环 + 工具调用 | `langgraph`, `langchain-core`, `duckduckgo-search` |
| LoRA 微调 | 侧边栏 → AI 进阶 → 微调 | QLoRA + peft + trl | `peft`, `trl`, `bitsandbytes`, `accelerate` |

所有 Python 依赖通过 `wrappers/manifest.json` 的 `runtime_pip_packages` 字段声明，在用户安装引导阶段统一安装，**运行时不动态 pip install**。

---

## 一、知识库（RAG）

### 功能

- 上传本地文件（PDF / DOCX / TXT / XLSX）构建向量知识库
- 基于语义检索的知识库问答，流式输出回答
- 支持多个独立知识库，可增删管理

### 架构

```
frontend/hooks/useRag.ts
frontend/components/panels/RagPanel.tsx
        ↓ HTTP
backend/routers/rag.py
backend/services/rag/indexer.py   ← 构建 FAISS 索引
backend/services/rag/querier.py   ← 检索问答
        ↓ 持久化
models/rag/{collection_name}/
  ├── docstore.json
  ├── index_store.json
  ├── vector_store.faiss
  └── meta.json
```

### API

| 方法 | 路径 | 说明 |
|------|------|------|
| `POST` | `/rag/collections` | 上传文件 + 集合名，异步构建索引，返回 job_id |
| `GET` | `/rag/collections` | 列出所有知识库（名称、文档数、大小） |
| `DELETE` | `/rag/collections/{name}` | 删除指定知识库 |
| `GET` | `/rag/collections/jobs/{job_id}` | 查询构建任务状态 |
| `POST` | `/rag/query` | `{collection, question, top_k}` → SSE 流式回答 |

### Embedding 模型

使用 Ollama 本地模型 `nomic-embed-text`（768 维），需提前通过 `ollama pull nomic-embed-text` 下载。

---

## 二、智能体（Agent）

### 功能

- ReAct（Reasoning + Acting）循环，逐步推理并调用工具
- 流式展示每步的「思考 → 行动 → 观察」过程
- 支持 Ollama 本地模型和 OpenAI 云端模型
- 最终答案高亮显示

### 可用工具

| 工具 | 说明 | 参数 |
|------|------|------|
| `web_search` | DuckDuckGo 搜索，返回前 5 条结果 | `query` |
| `python_exec` | 沙箱执行 Python 代码，限时 10s | `code` |
| `file_read` | 读取 `models/agent_workspace/` 下文件 | `filename` |
| `file_write` | 写入文件到 `models/agent_workspace/` | `filename`, `content` |
| `rag_retrieval` | 从本地知识库检索信息 | `collection`, `question` |

### 架构

```
frontend/hooks/useAgent.ts
frontend/components/panels/AgentPanel.tsx
        ↓ HTTP + SSE
backend/routers/agent.py
backend/services/agent/graph.py    ← ReAct 循环主逻辑
backend/services/agent/tools.py    ← 工具实现
```

### API

| 方法 | 路径 | 说明 |
|------|------|------|
| `GET` | `/agent/tools` | 返回所有可用工具列表及说明 |
| `POST` | `/agent/run` | `{task, tools, provider, model, api_key}` → SSE 流式步骤 |

### SSE 数据格式

每条 `data:` 为一个 JSON 对象：

```json
{"type": "thought", "content": "我需要先搜索..."}
{"type": "action",  "tool": "web_search", "args": {"query": "..."}}
{"type": "observation", "content": "搜索结果..."}
{"type": "final",   "content": "综合以上信息..."}
```

---

## 三、LoRA 微调

### 功能

- QLoRA（4-bit 量化）微调本地小模型，显存需求低
- 支持预设模型（Qwen2.5 / LLaMA 3.2 系列）及自定义 HuggingFace 模型 ID
- 训练数据格式：JSONL，每行 `{"instruction": "...", "output": "..."}`
- 实时 loss 曲线 + 日志滚动
- 导出格式：仅 LoRA Adapter 或合并为完整模型

### 支持的基座模型

| 模型 | 参数量 | 推荐场景 |
|------|--------|----------|
| `Qwen/Qwen2.5-0.5B` | 0.5B | 快速实验 |
| `Qwen/Qwen2.5-1.5B` | 1.5B | 轻量部署 |
| `Qwen/Qwen2.5-3B` | 3B | 性能均衡 |
| `meta-llama/Llama-3.2-1B` | 1B | 英文任务 |

### 架构

```
frontend/hooks/useFinetune.ts
frontend/components/panels/FinetunePanel.tsx
        ↓ HTTP
backend/routers/finetune.py
backend/services/finetune/trainer.py   ← subprocess 任务管理 + 进度追踪
        ↓ 子进程
wrappers/finetune/train.py             ← QLoRA 训练 CLI
        ↓ 输出
models/finetune/{job_id}/              ← adapter / merged 模型
```

### API

| 方法 | 路径 | 说明 |
|------|------|------|
| `POST` | `/finetune/start` | 上传数据集 + 超参数，返回 job_id |
| `GET` | `/finetune/jobs` | 列出所有微调任务 |
| `GET` | `/finetune/jobs/{job_id}` | 轮询进度、loss 曲线、日志 |
| `DELETE` | `/finetune/jobs/{job_id}` | 终止并清理任务 |

### 超参数说明

| 参数 | 默认值 | 说明 |
|------|--------|------|
| `lora_r` | 16 | LoRA 秩，越大表达力越强但显存需求越高 |
| `lora_alpha` | 32 | 缩放系数，通常为 `lora_r × 2` |
| `num_epochs` | 3 | 训练轮次 |
| `batch_size` | 2 | 每步 batch 大小 |
| `learning_rate` | 2e-4 | 学习率 |
| `max_seq_length` | 512 | 最大输入序列长度（token） |

---

## 文件变更清单

### 新增文件

```
backend/
  services/rag/__init__.py
  services/rag/indexer.py
  services/rag/querier.py
  services/agent/__init__.py
  services/agent/tools.py
  services/agent/graph.py
  services/finetune/__init__.py
  services/finetune/trainer.py
  routers/rag.py
  routers/agent.py
  routers/finetune.py

wrappers/
  finetune/train.py

frontend/
  hooks/useRag.ts
  hooks/useAgent.ts
  hooks/useFinetune.ts
  components/panels/RagPanel.tsx
  components/panels/AgentPanel.tsx
  components/panels/FinetunePanel.tsx
```

### 修改文件

```
backend/main.py                          ← 注册 3 个新 router
wrappers/manifest.json                   ← 新增三组 runtime_pip_packages
frontend/types/index.ts                  ← 新增 RagCollection / AgentStep / FinetuneJob 类型
frontend/constants/index.ts              ← 新增 rag / agent / finetune 标签
frontend/components/layout/Sidebar.tsx   ← 新增「AI 进阶」导航入口
frontend/pages/index.tsx                 ← 集成三个新面板和 hook
```

---

## 快速验证

```bash
# RAG：构建知识库
curl -X POST http://127.0.0.1:8000/rag/collections \
  -F "name=test_kb" -F "files=@/tmp/test.pdf"

# RAG：查询
curl -X POST http://127.0.0.1:8000/rag/query \
  -H "Content-Type: application/json" \
  -d '{"collection":"test_kb","question":"文档讲了什么？"}'

# Agent：执行任务
curl -X POST http://127.0.0.1:8000/agent/run \
  -H "Content-Type: application/json" \
  -d '{"task":"搜索今天的 AI 新闻并总结","tools":["web_search"],"provider":"ollama","model":"qwen2.5:7b"}'

# 微调：启动训练
curl -X POST http://127.0.0.1:8000/finetune/start \
  -F "model=Qwen/Qwen2.5-0.5B" \
  -F "dataset=@/tmp/train.jsonl" \
  -F "num_epochs=3"

# 微调：轮询进度
curl http://127.0.0.1:8000/finetune/jobs/{job_id}
```
