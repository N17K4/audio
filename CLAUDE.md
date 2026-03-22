# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

---

## 项目概述

Electron 桌面应用 **AI Workshop**，用于 AI 音频/图像/视频处理。三进程架构：Electron 外壳 → FastAPI 后端 → Next.js 前端。

支持两种运行模式：
- **Electron 桌面版**：`pnpm run dev` 启动
- **Docker Web 版**：`docker-compose up` 启动，浏览器访问

---

## 代码结构

```
.
├── electron/                  # Electron 主进程
│   ├── main.js                # 入口：启动后端、创建窗口
│   ├── paths.js               # 路径常量（PROJECT_ROOT、getResRoot、getCheckpointsDir）
│   ├── constants.js           # 引擎列表、阶段配置、脚本映射
│   ├── state.js               # 全局状态（窗口引用、进程句柄）
│   ├── windows.js             # 窗口创建与管理
│   ├── ipc-app.js             # 应用 IPC（引擎安装、烟雾测试等）
│   ├── ipc-setup.js           # 首次启动引导 IPC（ml + checkpoints 并行下载）
│   ├── preload.js             # 渲染进程 IPC 桥接
│   ├── setup-guide-preload.js # 引导页 preload
│   ├── overview-preload.js    # 概览页 preload
│   ├── overview.html          # 概览页
│   ├── setup-guide.html       # 引导页
│   ├── logger.js              # 日志工具
│   └── utils.js               # 端口分配、后端就绪检测
├── frontend/                  # Next.js 前端（Pages Router, 静态导出）
│   ├── pages/index.tsx        # 布局 + 路由 + 组合 hooks
│   ├── pages/_app.tsx         # App 入口
│   ├── types/index.ts         # TypeScript 类型
│   ├── constants/index.ts     # 常量
│   ├── utils/index.ts         # 工具函数
│   ├── hooks/                 # 按功能拆分的 hooks
│   │   ├── useBackend.ts      # 后端连接、capabilities、voices
│   │   ├── useJobs.ts         # 任务队列轮询
│   │   ├── useTTS.ts / useVC.ts / useASR.ts / useLLM.ts
│   │   ├── useVoiceChat.ts / useMediaConvert.ts / useDocConvert.ts
│   │   ├── useAgent.ts / useRag.ts / useFinetune.ts
│   │   └── useImageExt.ts / useMisc.ts / useToolbox.ts
│   ├── components/
│   │   ├── shared/            # 共享组件（ModelInput、ProviderRow、VoiceSelector、ComboSelect、FileDrop 等）
│   │   ├── layout/            # Sidebar、TopNav
│   │   ├── panels/            # 功能面板（TtsPanel、VcPanel、AsrPanel、LlmPanel、
│   │   │                      #   ImageGenPanel、ImageI2IPanel、VideoGenPanel、
│   │   │                      #   AgentPanel、RagPanel、FinetunePanel、DocPanel、
│   │   │                      #   MediaPanel、MiscPanel、ToolboxPanel、VoiceChatPanel）
│   │   ├── HomePanel.tsx      # 首页
│   │   ├── TaskList.tsx       # 任务队列列表
│   │   └── SystemPanel.tsx    # 系统工具
│   └── styles/globals.css     # Tailwind CSS
├── backend/                   # FastAPI 后端
│   ├── main.py                # app init + include_router
│   ├── config.py              # 路径常量、TASK_CAPABILITIES
│   ├── models.py              # Pydantic 模型
│   ├── logging_setup.py       # 日志配置
│   ├── job_queue.py           # 任务队列
│   ├── utils/
│   │   ├── auth.py            # API Key 解析（明文 / bearer: / header:）
│   │   ├── engine.py          # 嵌入式 Python / FFmpeg 路径、引擎检测、build_engine_env
│   │   ├── voices.py          # 音色管理
│   │   ├── audio.py           # 音频处理工具
│   │   └── audit.py           # 审计日志
│   ├── services/
│   │   ├── tts/               # OpenAI / Gemini / Fish Speech / ElevenLabs / GPT-SoVITS / DashScope / Cartesia / MiniMax
│   │   ├── stt/               # OpenAI / Gemini / Whisper / Faster Whisper / Groq / Deepgram / DashScope
│   │   ├── vc/                # local_vc（RVC / Seed-VC 子进程 + 云端 httpx）
│   │   ├── llm/               # OpenAI / Gemini / Ollama / GitHub / Anthropic / OpenAI-compat
│   │   ├── image_gen/         # OpenAI / Gemini / Stability / DashScope / Flux / SD / ComfyUI
│   │   ├── image_i2i/         # FaceFusion / ComfyUI
│   │   ├── image_understand/  # OpenAI / Gemini / Anthropic / Ollama
│   │   ├── video_gen/         # WAN / Kling
│   │   ├── lipsync/           # LivePortrait
│   │   ├── ocr/               # GOT-OCR
│   │   ├── rag/               # indexer + querier
│   │   ├── agent/             # graph + tools
│   │   ├── finetune/          # LoRA trainer
│   │   └── media.py           # FFmpeg 转换
│   ├── routers/
│   │   ├── health.py          # GET /health, /runtime/info, /capabilities
│   │   ├── voices.py          # GET /voices, POST /voices/create
│   │   ├── jobs.py            # GET/DELETE /jobs
│   │   ├── convert.py         # POST /convert（VC）
│   │   ├── train.py           # POST /train
│   │   ├── tasks.py           # POST /tasks/{tts,stt,llm,realtime,...}
│   │   ├── rag.py             # RAG 相关
│   │   ├── agent.py           # Agent 相关
│   │   └── finetune.py        # LoRA 微调
│   └── wrappers/              # 引擎封装脚本（git 跟踪）
│       ├── manifest.json      # 版本清单（引擎依赖、checkpoint URL、voices 定义）
│       ├── fish_speech/       # inference.py、fish_speech_worker.py、fish_speech_cli.py、engine.json
│       ├── seed_vc/           # inference.py、seed_vc_worker.py、engine.json
│       ├── rvc/               # infer_cli.py、train.py、engine.json
│       ├── faster_whisper/    # inference.py、engine.json
│       ├── whisper/           # inference.py、engine.json
│       ├── gpt_sovits/        # inference.py、engine.json
│       ├── facefusion/        # inference.py
│       ├── liveportrait/      # inference.py
│       ├── cosyvoice/         # engine.json
│       ├── flux/ sd/ wan/     # inference.py
│       ├── got_ocr/           # inference.py
│       └── finetune/          # train.py
├── scripts/                   # 构建与安装脚本
│   ├── setup.sh               # 一键开发环境初始化（mise + pnpm + poetry）
│   ├── runtime.py             # 嵌入式 Python 下载 + backend 依赖 + 引擎源码 clone + FFmpeg/Pandoc
│   ├── runtime.sh             # runtime.py 的 shell 入口
│   ├── ml_base.py             # ML 基础包安装（torch 等）→ runtime/ml/
│   ├── ml_extra.py            # ML 进阶包安装（faiss、llama-index 等）
│   ├── checkpoints_base.py    # 基础引擎 checkpoint 下载入口
│   ├── checkpoints_extra.py   # 额外引擎 checkpoint 下载入口
│   ├── _checkpoint_download.py # checkpoint 下载核心逻辑（HF hub / HTTP）
│   ├── afterPack.js           # electron-builder 打包后钩子（Python 路径修复 + fairseq patch）
│   └── dist.sh                # 打包脚本
├── runtime/                   # 运行时文件（整个目录 gitignored）
│   ├── python/
│   │   ├── mac/               # macOS 嵌入式 Python（bin/python3）
│   │   └── win/               # Windows 嵌入式 Python（python.exe）
│   ├── bin/
│   │   ├── mac/               # macOS FFmpeg、Pandoc
│   │   └── win/               # Windows FFmpeg、Pandoc
│   ├── engine/                # 引擎源码（runtime.py clone）
│   │   ├── fish_speech/
│   │   ├── seed_vc/
│   │   ├── gpt_sovits/
│   │   ├── facefusion/
│   │   └── liveportrait/
│   ├── checkpoints/           # 模型权重（checkpoints_base.py 下载）
│   │   ├── fish_speech/
│   │   ├── seed_vc/
│   │   ├── rvc/
│   │   ├── faster_whisper/
│   │   └── hf_cache/
│   └── ml/                    # ML 包（ml_base.py 安装，通过 PYTHONPATH 引用）
├── user_data/                 # 用户数据（git 跟踪模板，运行时写入）
│   ├── settings.json          # 用户设置
│   ├── uploads/               # 用户上传文件
│   └── {engine}/              # 各引擎用户数据（fish_speech、rvc、seed_vc、rag、agent）
├── tests/
│   ├── conftest.py            # sys.path 注入
│   ├── test_cloud_api_models.py  # 云端 API 测试（httpx mock）
│   ├── test_local_models.py      # 本地推理测试（subprocess mock）
│   ├── test_ollama.py            # Ollama 测试
│   ├── smoke_test.py             # 基础烟雾测试
│   └── smoke_test2.py            # 进阶烟雾测试（RAG / Agent / LoRA）
├── docs/                      # 文档
│   ├── MODELS.md              # 模型说明
│   ├── CLOUD_PROVIDERS_ZH.md  # 云端服务商说明
│   ├── ADVANCED_AI_FEATURES.md
│   ├── install-stages.md      # 安装阶段说明
│   └── rag_agent_lora.md      # RAG/Agent/LoRA 说明
├── assets/                    # 应用图标（icon.png、icon.icns）
├── .github/workflows/
│   └── build-mac.yml          # CI：单 macOS runner 双平台构建（macOS + Windows）
├── logs/                      # 开发模式日志输出目录
├── cache/                     # 临时缓存（任务输出文件等）
├── dist/                      # electron-builder 打包输出
├── Dockerfile.backend         # Docker 后端镜像
├── Dockerfile.frontend        # Docker 前端镜像
├── docker-compose.yml         # Docker 编排
├── .mise.toml                 # mise 工具版本管理（Node.js、Python、Poetry）
├── package.json               # pnpm scripts 入口
└── launch-dist.sh / .bat      # 打包产物本地测试启动脚本
```

依赖方向：`config` → `utils` → `services` → `routers` → `main`，严禁逆向。

---

## 进程模型

`electron/main.js` 启动 `backend/main.py` 子进程（自动分配端口）。`electron/paths.js` 统一管理路径：

```javascript
// 所有路径基于同一个 root
const resRoot = app.isPackaged ? process.resourcesPath : PROJECT_ROOT;
// 嵌入式 Python、引擎、checkpoints、ML 包全在 resRoot/runtime/ 下
```

开发模式加载 `localhost:3000`，生产模式加载 `frontend/out/index.html`。前端通过 `window.electronAPI` 获取后端地址；无 Electron 时回退 `http://127.0.0.1:8000`。

---

## 打包结构（electron-builder）

**打入安装包的**（extraResources）：
- `runtime/python/{mac,win}/` — 嵌入式 Python + 轻量 pip_packages
- `runtime/bin/{mac,win}/` — FFmpeg、Pandoc
- `runtime/engine/` — 引擎源码（fish_speech、seed_vc、facefusion、gpt_sovits 等）

**不打包，用户首次启动下载的**：
- `runtime/checkpoints/` — 模型权重（通过 `checkpoints_base.py`）
- `runtime/ml/` — ML 包（torch 等，通过 `ml_base.py`）

关键：`scripts/*.py` 在打包后由嵌入式 Python 执行（`sys.executable` 即嵌入式 Python），不需要运行时查找 Python 路径。

---

## 开发流程

```bash
pnpm run setup        # mise + pnpm + poetry（系统 Python）
pnpm run runtime      # 下载嵌入式 Python + 引擎源码 + FFmpeg（系统 Python 调用 runtime.py）
pnpm run ml           # torch 等 → runtime/ml/（嵌入式 Python）
pnpm run checkpoints  # 模型权重 → runtime/checkpoints/（嵌入式 Python）
pnpm run dev          # 启动 Electron + Next.js
```

### pnpm scripts 一览

| 命令 | 用途 |
|------|------|
| `pnpm dev` | Electron + Next.js 开发模式 |
| `pnpm setup` | mise + pnpm + poetry 环境初始化 |
| `pnpm runtime` | 下载嵌入式 Python + 引擎源码 + FFmpeg/Pandoc |
| `pnpm ml` | 安装基础 ML 包（torch 等）→ runtime/ml/ |
| `pnpm ml:extra` | 安装进阶 ML 包（RAG/Agent/LoRA） |
| `pnpm ml:rag` / `ml:agent` / `ml:lora` | 按组安装进阶 ML 包 |
| `pnpm checkpoints` | 下载基础引擎 checkpoint |
| `pnpm checkpoints:check` | 只检查 checkpoint 完整性，不下载 |
| `pnpm checkpoints:force` | 强制重新下载所有 checkpoint |
| `pnpm checkpoints:extra` | 下载额外引擎 checkpoint |
| `pnpm clean` | 清除 runtime/ml、checkpoints、engine |
| `pnpm reinstall` | clean + setup + ml + checkpoints |
| `pnpm all` | setup + runtime + ml + checkpoints + dev |
| `pnpm build:frontend` | 构建前端静态文件（out/） |
| `pnpm dist` | 打包 macOS 安装包 |
| `pnpm dist:win` | 打包 Windows 安装包 |
| `pnpm dist:both` | 打包 macOS + Windows |
| `pnpm docker` | docker compose up --build（本番构建） |
| `pnpm dd` | Docker 开发模式（源码挂载 + hot reload） |
| `pnpm ddd` | Docker 开发模式 + 强制重新 build 镜像 |
| `pnpm dds` | Docker 开发环境 down |

### 包管理规范
- JS/Node：一律用 `pnpm`，禁止 `npm`
- Python backend：一律用 `poetry`，禁止直接 `pip`

### 严禁运行时动态安装
引擎脚本只 import，缺包时打印错误 + 非零退出码。所有依赖在 setup / runtime / ml 阶段安装。

---

## manifest.json 依赖分类

`backend/wrappers/manifest.json` 的依赖结构：

- **`shared_runtime_pip_packages`**：全引擎共享的重型依赖（torch、transformers、numpy 等），避免各引擎重复声明
- **`pip_packages`**（各引擎）：轻量依赖，`runtime.py` 装入嵌入式 Python，打进安装包
- **`runtime_pip_packages`**（各引擎）：该引擎独有的重型 ML 包，装到 `runtime/ml/`（开发）或 `userData/python-packages/`（生产）

`ml_base.py` 和 `docker/backend.Dockerfile` 收集包时会合并 `shared_runtime_pip_packages` + 各引擎的 `runtime_pip_packages`。

---

## 测试

所有测试均为 E2E（端到端），直接调用真实 API，不 mock 任何依赖。

### E2E 烟雾测试（需后端运行 + 引擎环境）

```bash
# 1. 启动后端
pnpm run dev

# 2. 运行测试
# 方式 A：前端页面 TaskList → "运行烟雾测试 1/2"（推荐，SSE 流式显示结果）
# 方式 B：命令行直接执行
PYTHONPATH=backend runtime/python/mac/bin/python3 tests/smoke_test.py   # 基础（TTS/STT/VC/FFmpeg）
PYTHONPATH=backend runtime/python/mac/bin/python3 tests/smoke_test2.py  # 进阶（RAG/Agent/LoRA）
```

测试向真实后端发 HTTP 请求，需要嵌入式 Python + 引擎 + checkpoint 已就绪。

**判定规则**：日志中 ✅ = 通过、❌ = 失败。smoke_test.py 失败时抛 AssertionError；smoke_test2.py 失败时 `return False`（前端通过 exit code 和日志 ❌ 判定）。

### 开发环境 smoke test 完整步骤

```bash
# 1. 确保后端依赖就绪
pnpm run setup && pnpm run runtime && pnpm run ml && pnpm run checkpoints

# 2. 启动后端（后台）
PYTHONPATH=backend:runtime/ml poetry -C backend run uvicorn main:app --host 127.0.0.1 --port 8000 &

# 3. 等待后端就绪
curl -s http://127.0.0.1:8000/health

# 4. 运行 smoke test（用嵌入式 Python）
PYTHONPATH=backend/wrappers:runtime/ml BACKEND_PORT=8000 runtime/python/mac/bin/python3 tests/smoke_test.py

# 5. 清理
pkill -f "uvicorn main:app"
```

也可以通过前端页面 TaskList → "运行烟雾测试" 触发（Electron 环境自动配置所有路径）。

---

## 引擎源码管理规范

### git 跟踪的引擎源码（`runtime/engine/`）

`runtime/engine/` 下的引擎源码**已 git 跟踪**，不是 gitignored。各引擎对应的上游版本：

| 引擎 | 上游仓库 | 版本（tag/commit） | 说明 |
|------|---------|-------------------|------|
| Fish Speech | `fishaudio/fish-speech` | `v1.5.0` | tag |
| Seed-VC | `Plachtaa/seed-vc` | `51383efd` | commit（无官方 tag） |
| GPT-SoVITS | `RVC-Boss/GPT-SoVITS` | `20250606v2pro` | tag |
| FaceFusion | `facefusion/facefusion` | `3.5.4` | tag |
| LivePortrait | `KlingAIResearch/LivePortrait` | `49784e87` | commit |

**规则：**
- `runtime.py` 中的 clone 配置**必须使用 tag 或 commit ID**，严禁使用分支名（如 `main`）
- `manifest.json` 中的 checkpoint URL 和 `repo_id` **必须固定 revision（commit hash）**，严禁使用 `main`
  - URL 格式：`resolve/<commit_hash>/file.bin`，不用 `resolve/main/`
  - repo_id 格式：添加 `"revision": "<commit_hash>"` 字段
- 引擎源码变更后必须 commit 到 git
- checkpoint（manifest.json）必须与引擎源码版本匹配
- 手写的 wrapper 代码在 `backend/wrappers/`，与引擎源码分离
- **上游更新 checkpoint 不会影响已固定的版本**——通过 commit hash 始终可以下载到固定版本的文件

### 手写 wrapper 引擎（无 clone）

| 引擎 | 目录 |
|------|------|
| RVC | `backend/wrappers/rvc/`（通过 rvc-python pip 包推理） |
| Faster Whisper | `backend/wrappers/faster_whisper/` |
| Whisper | `backend/wrappers/whisper/` |

### 禁止直接修改 gitignored 的外部代码

`runtime/ml/`、`runtime/python/` 下的文件是 pip install 生成的，gitignored，下次构建会被覆盖。**严禁直接修改这些文件来修 bug**。

正确做法：
- **wrapper 层拦截**：在 `backend/wrappers/` 的适配器脚本中处理兼容性问题（如 monkey-patch）
- **安装后 patch**：在 `scripts/runtime.py` 或 `scripts/afterPack.js` 中添加自动 patch 步骤
- **manifest 声明**：缺少的依赖加到 `backend/wrappers/manifest.json` 的 `pip_packages` 或 `runtime_pip_packages`

---

## 特殊约束

- CORS 完全开放（`*`）— 桌面应用无跨域顾虑
- 打包前必须重新构建 `frontend/out/`
- 大型模型文件和 `runtime/` 整个目录已 gitignore
- fairseq 在 Python 3.12 有 dataclass 不兼容问题（afterPack.js 中有 patch）
- MPS 补丁（macOS Apple Silicon）：`runtime.py` 自动修补 fish_speech 的 `torch.isin` dtype 不匹配


## 开发规范：Electron / Web / Docker 兼容

- **优先使用 Web 标准 API 和后端 HTTP API**，禁止在前端代码中新增 `window.electronAPI` 调用
- 所有系统管理功能（磁盘占用、安装、清理等）统一通过 `backend/routers/system.py` 的 REST API 实现
- 文件下载使用 `<a download>` + 后端 `/download/` 端点，不使用 `shell.openPath()`
- **仅以下场景允许使用 Electron 原生功能**（必须用 `?.` 可选链保护）：
    - webapp 不需要的部分功能放在系统级菜单 / 托盘时
- 新增功能时，先确认 Docker/Web 模式下可用，再考虑 Electron 

---

## Docker / Web 版架构

### 文件一览

| 文件 | 用途 |
|------|------|
| `docker/backend.Dockerfile` | 后端镜像（多阶段构建：builder + runtime） |
| `docker/frontend.Dockerfile` | 前端镜像（Node 构建 + nginx 托管） |
| `docker/frontend.dev.Dockerfile` | 前端开发用镜像（next dev + HMR） |
| `docker/nginx.conf` | nginx 配置（静态文件 + API 反向代理到 backend:8000） |
| `docker-compose.yml` | 本番用编排（backend + backend-gpu + frontend） |
| `docker-compose.dev.yml` | 开发用覆盖（源码挂载 + hot reload） |
| `.dockerignore` | 排除 runtime/、模型权重、electron/、node_modules 等 |
| `.github/workflows/build-docker.yml` | CI：构建并推送 Docker 镜像到 DockerHub |

### 后端镜像（docker/backend.Dockerfile）

- **多阶段构建**：builder（含编译器）→ runtime（slim，无编译器）
- Stage 1（builder）：venv 内で `poetry export` → `pip install` + manifest.json の `runtime_pip_packages` + fairseq/rvc 特殊安装
- Stage 2（runtime）：系统依赖（ffmpeg/pandoc/git/libsndfile1/libgl1）+ builder の venv コピー + 引擎源码 clone（`runtime.py --engines-only`）
- **Checkpoints 不打入镜像**，通过 volume 挂载：`/app/runtime/checkpoints`、`/app/user_data`、`/app/cache`、`/app/logs`
- 基础镜像：`python:3.12-slim`
- 入口：`python backend/main.py`

### 前端镜像（docker/frontend.Dockerfile）

- Stage 1：`node:20-alpine` + pnpm build → 静态文件 `out/`
- Stage 2：`nginx:alpine`，静态文件 + `docker/nginx.conf`
- nginx 逻辑：静态文件优先，未命中转发 `http://backend:8000`（`@backend`）
- `client_max_body_size 500M`（音频/视频上传）

### docker-compose.yml（本番）

- **backend**：端口 8000，4 个 named volume（checkpoints/user_data/cache/logs）
- **backend-gpu**：extends backend + NVIDIA GPU，需 `--profile gpu` 启用
- **frontend**：端口 3000→80，depends_on backend healthy
- 镜像名：`${DOCKERHUB_USERNAME}/ai-workshop-{backend,frontend}:${TAG:-latest}`

### docker-compose.dev.yml（开发覆盖）

```bash
docker-compose -f docker-compose.yml -f docker-compose.dev.yml up
```

- backend：源码挂载 `./backend:/app/backend` + `uvicorn --reload`
- frontend：使用 `docker/frontend.dev.Dockerfile`，源码挂载 + `pnpm dev`（HMR）
- 独立 volume `frontend_node_modules` 避免覆盖宿主 node_modules

### CI/CD（GitHub Actions）

| Workflow | 触发条件 | 作用 |
|----------|---------|------|
| `build-mac.yml` | `v*` tag push / 手动 | Electron 双端打包（macOS + Windows）→ GitHub Release |
| `build-docker.yml` | `d*` tag push / 手动 | Docker 双平台构建（amd64 + arm64）→ DockerHub Push |

**发版流程**：
```bash
# Electron 桌面版发布
git tag v1.0.3 && git push origin v1.0.3

# Docker Web 版发布
git tag d1.0.3 && git push origin d1.0.3
```

- `build-mac.yml`：单 macOS 14 runner 构建双端（mac + win），通过 `scripts/dist.sh --both` 打包，`scripts/upload.sh` 上传到 GitHub Release
- `build-docker.yml`：双平台（linux/amd64 + linux/arm64，QEMU + buildx），推送 DockerHub，tag 策略 `latest` + 版本号 + commit SHA，GHA cache 加速

### Docker 启动命令

```bash
# 本番模式
docker-compose up

# GPU 模式
docker-compose --profile gpu up

# 开发模式（源码热更新）
docker-compose -f docker-compose.yml -f docker-compose.dev.yml up

# 首次需要下载 checkpoints（volume 挂载后在容器内执行）
docker-compose exec backend python scripts/checkpoints_base.py
```

---

## 权限规范

执行脚本、读取文件、运行只读 shell 命令（grep、bash、cat、cd、ls、find 等）无需确认。
