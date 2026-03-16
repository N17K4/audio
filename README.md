# 个人项目规范备忘
单人团队，readme只记录跨项目可复用规范，无需考虑辅助团开发本项目的团队笔记。
跨项目可复用的架构决策、工程规范和操作模式。

---

## 技术栈选型

### 包管理

- **JS/Node**：一律用 `pnpm`，禁止 `npm`
- **Python（开发环境）**：一律用 `poetry`，禁止直接 `pip`
- **Python（运行时引擎）**：各引擎用独立 `requirements.txt`，安装到嵌入式 Python，不走 poetry

### 前端

- 框架：Next.js（Pages Router）+ TypeScript + Tailwind CSS
- 桌面端静态导出：`next.config.js` 设置 `output: 'export'`，Electron 直接加载 `frontend/out/`

### 后端

- 框架：FastAPI + uvicorn，单进程

---

## 项目结构规范

### 前端模块化（Next.js）

```
frontend/
├── types/index.ts          # 所有 TypeScript 类型集中管理
├── constants/index.ts      # 所有常量（标签、配置、映射表等）
├── utils/index.ts          # 纯工具函数（无副作用）
├── hooks/                  # 自定义 hooks，每个业务领域一个文件
│   ├── useBackend.ts       # 后端连接、capabilities、voices
│   ├── useJobs.ts          # 任务队列 + 轮询
│   └── use{Feature}.ts     # 每个功能模块的状态 + 逻辑
├── components/
│   ├── shared/             # 跨页面复用的原子组件
│   ├── icons/              # SVG 图标组件
│   ├── layout/             # 布局组件（Sidebar 等）
│   └── panels/             # 各功能页面的面板组件
└── pages/index.tsx         # 只做布局 + 路由 + 组合 hooks，~100-200 行
```

Hook 设计：状态和逻辑通过参数（prop-drilling）传递，不用 Context。Context 留给真正的全局状态（主题、认证等）。

### 后端模块化（FastAPI）

```
backend/
├── main.py             # 只做 app init + include_router，~30-50 行
├── config.py           # 路径常量、全局配置
├── logging_setup.py    # 日志配置
├── job_queue.py        # 异步任务队列（全局变量 + 调度逻辑）
├── utils/              # 无副作用工具（auth 解析、engine 检测、文件操作）
├── services/           # 业务逻辑（按功能域：tts/stt/vc/llm/media）
└── routers/            # FastAPI 路由，每个文件对应一组端点
```

依赖方向：`config` → `utils` → `services` → `routers` → `main`，严禁逆向。

---

## Electron + FastAPI Sidecar 架构

```
Electron 主进程（main.js）
  ├── 启动 Python 子进程（backend/main.py）
  ├── 自动分配可用端口（默认 8000）
  └── preload.js → IPC 桥接 → 渲染进程

渲染进程（Next.js）
  ├── 开发模式：加载 localhost:3000（热重载）
  └── 生产模式：加载 frontend/out/index.html（静态文件）
```

**运行时 Python 嵌入**：打包时将整个 Python 解释器 + 依赖打入 `runtime/{platform}/python/`，用户无需安装 Python。通过 `get_embedded_python()` 动态解析路径，实现零配置部署。

---

## Python 依赖安装规范

**只允许在以下阶段安装，严禁在请求处理路径中动态 `pip install`：**

| 阶段 | 命令 | 说明 |
|---|---|---|
| 初始化 | `pnpm run setup` | 开发环境依赖 |
| 模型下载 | `pnpm run checkpoints` | 引擎依赖安装到嵌入式 Python |
| 打包 | `pnpm run dist` | 确保所有依赖就位 |

缺包的正确处理：在 manifest 的 `pip_packages` 中声明 → checkpoints 阶段统一安装 → 引擎脚本只负责 import，缺包时打印错误并以非零退出码退出。

---

## 日志规范

**开发模式**：只写 stdout/stderr，不写文件。

**生产（打包后）**：写到可执行文件旁的 `logs/` 目录，通过 `LOGS_DIR` 环境变量传递路径。

| 文件 | 内容 | 实现 |
|---|---|---|
| `logs/backend.log` | Python FastAPI 日志 | `RotatingFileHandler`，5 MB × 5 份 |
| `logs/electron.log` | 主进程事件 | `app.isPackaged` 时挂载文件流 |
| `logs/frontend.log` | 前端未处理异常 | `onerror` + `unhandledrejection` 经 IPC 写入 |

---

## 异步任务队列模式

适用于本地推理等耗时操作（TTS、VC 等）：

```
POST /tasks/xxx
  ├── 本地推理 → 返回 { job_id }，前端轮询 /jobs/{id}
  └── 云端 API  → 直接返回结果，前端创建 instant job 在任务列表展示

任务状态：queued → running → completed / failed
轮询间隔：1.5s，超时 3 分钟
并发控制：asyncio.Semaphore(1)（本地推理串行，避免显存争抢）
```

执行结果统一在任务列表展示，各功能页面不显示任务成功/失败信息。

---

## GitHub Actions 发布规范

### Workflow 触发条件

| 事件 | 触发 |
|---|---|
| `git push`（无 tag） | 不触发 |
| `git push --tags`（`v*` 格式） | 触发所有平台构建 |
| 手动 Run workflow | 随时可触发 |

### 发布流程

```bash
git tag v1.2.3
git push --tags
# → GitHub Actions 自动构建 Mac + Windows
# → 产物上传到 Releases，永久保留
```

- 手动触发产物：Artifacts 区域，保留 30 天
- tag 触发产物：Releases 页面，永久保留
- Public 仓库 GitHub Actions 完全免费，不限分钟数

---

## 子进程 stderr 继承死锁

**场景**：A（backend）用 `subprocess.run(capture_output=True)` 启动 B（adapter），B 用 `stderr=sys.stderr` 启动 C（persistent worker），C 常驻不退出。

**死锁原因**：`capture_output=True` 等价于 `communicate()`，它在内部线程里读 stderr pipe 直到 **EOF**。但 C 继承了这根 pipe 的写端，只要 C 不退出，EOF 永远不到，A 永远阻塞。

**解法**：B 启动 C 时使用 `stderr=subprocess.DEVNULL`（或独立文件），不让 C 继承来自 A 的 capture pipe。重要日志走协议层（如 Unix socket 响应）或独立日志文件，而非 pipe。

---

## 磁盘占用参考（Electron 打包后）

| 目录 | 内容 | 大小参考 |
|---|---|---|
| `runtime/{platform}/python/` | 嵌入式 Python + 引擎依赖 | Mac ~2.5 GB，Win ~3-5 GB |
| `checkpoints/fish_speech/` | Fish Speech 1.5 | ~800 MB |
| `checkpoints/seed_vc/` | Seed-VC | ~200 MB |
| `checkpoints/whisper/` | Whisper large-v3 | ~2.9 GB |
| `checkpoints/hf_cache/` | BigVGAN + Whisper-small | ~1.3 GB |

---

## 测试规范

测试文件放在 `tests/`，用 `pytest` + `unittest.mock`，**不连接真实服务**。

```bash
poetry run pytest tests/ -v
```

三类测试文件：
- `test_local_models.py`：本地推理（subprocess mock，Fish Speech / Whisper / RVC / Seed-VC）
- `test_cloud_api_models.py`：云端 API（httpx mock，无需真实 key）
- `test_ollama.py`：Ollama LLM（httpx mock）

测试通过 mock 隔离所有外部依赖，CI 可直接运行，不需要模型文件或 API Key。

---

## 大型二进制资产管理

超出 GitHub 100 MB 限制的二进制文件（模型权重、引擎源码 zip）存放在 HuggingFace dataset 仓库，通过 `huggingface_hub` 下载，不进 git。

```
GitHub 仓库           → 代码、配置、wrapper 脚本
HF dataset 仓库       → 引擎源码 zip、音色模型 .pth/.index、推理 ONNX
HF model 仓库         → 大型 checkpoint（fish speech、seed-vc、whisper 等）
```

在 `wrappers/manifest.json` 中用 `"repo_id"` + `"repo_type": "dataset"` 字段声明 HF dataset 下载，`download_checkpoints.py` 统一处理，支持 HF 镜像（`HF_ENDPOINT` 环境变量）。
