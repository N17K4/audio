# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

---

## 项目概述

Electron 桌面应用，用于 AI 音频处理（音色转换、TTS、STT、实时对话、音频理解）。三进程架构：Electron 外壳 → FastAPI 后端 → Next.js 前端。

支持两种运行模式：
- **Electron 桌面版**：`npx electron .` 启动，IPC 桥接前后端
- **Docker Web 版**：`pnpm run docker` 启动，浏览器访问

---

## 代码结构

### 前端（`frontend/`）

Next.js + TypeScript，静态导出（`output: 'export'`），Pages Router。

```
frontend/
├── types/index.ts          # 所有 TypeScript 类型
├── constants/index.ts      # 常量（TASK_LABELS、PROVIDER_LABELS、模型列表等）
├── utils/index.ts          # safeJson、waitForBackend、rlog
├── hooks/
│   ├── useBackend.ts       # 后端连接、capabilities、voices、engineVersions
│   ├── useJobs.ts          # 任务队列轮询、addInstantJobResult
│   ├── useTTS.ts           # TTS 状态 + runTts
│   ├── useVC.ts            # VC 状态 + handleVoiceConvert、录音
│   ├── useASR.ts           # ASR 状态 + runAsr
│   ├── useLLM.ts           # LLM 聊天状态 + sendLlmMessage
│   ├── useVoiceChat.ts     # 语音对话 pipeline
│   └── useMediaConvert.ts  # 格式转换状态 + runMediaConvert
├── components/
│   ├── shared/             # ModelInput、ProviderRow、OutputDirRow、VoiceSelector、CreateVoicePanel
│   ├── icons/              # TaskIcon、HomeIcon、TasksIcon
│   ├── layout/             # Sidebar（含拖拽 resize、NavItem）
│   ├── panels/             # TtsPanel、VcPanel、AsrPanel、LlmPanel、VoiceChatPanel、MediaPanel
│   ├── HomePanel.tsx       # 首页功能卡片
│   ├── TaskList.tsx        # 任务队列列表
│   └── SystemPanel.tsx     # 系统工具（健康检查、磁盘、日志）
└── pages/index.tsx         # 布局 + 路由 + 组合 hooks，~960 行
```

`pages/index.tsx` 只负责：导航状态、共享设置（apiKey / outputDir / providerMap）、组合所有 hooks、主布局渲染。

**任务结果展示**：所有任务（TTS / VC / ASR / 格式转换）执行完成后统一在「任务列表」页显示结果，各功能页面不展示成功/失败信息。云端即时任务通过 `addInstantJobResult` 创建本地 job 记录，本地队列任务通过后端 `/jobs` 轮询。

### 后端（`backend/`）

FastAPI，模块化结构。

```
backend/
├── main.py             # app init + include_router，~35 行
├── config.py           # 路径常量（APP_ROOT、MODEL_ROOT 等）、TASK_CAPABILITIES
├── logging_setup.py    # setup_logging()、模块级 logger
├── job_queue.py        # JOBS/TRAIN_JOBS 字典、LOCAL_SEM、_make_job、_run_vc_job、_run_tts_job
├── utils/
│   ├── auth.py         # parse_cloud_auth_header（明文/bearer:/header: 语法）、require_httpx
│   ├── engine.py       # get_embedded_python、get_ffmpeg_binary、detect_*_script、get_*_command_template、build_engine_env
│   └── voices.py       # read_voice_meta、list_voices、get_voice_or_404、copy_to_output_dir
├── services/
│   ├── tts/            # openai_tts、gemini_tts、elevenlabs_tts、fish_speech_tts
│   ├── stt/            # openai_stt、gemini_stt、whisper_stt
│   ├── vc/             # local_vc（run_local_inference_or_raise、run_cloud_convert、run_seed_vc_cmd）
│   ├── llm/            # openai_llm、gemini_llm、ollama_llm、github_llm
│   └── media.py        # FFmpeg 转换
└── routers/
    ├── health.py       # GET /health、GET /runtime/info、GET /capabilities
    ├── voices.py       # GET /voices、POST /voices/create
    ├── jobs.py         # GET/DELETE /jobs、GET/DELETE /jobs/{job_id}
    ├── convert.py      # POST /convert（VC）
    ├── train.py        # POST /train、GET /train/{job_id}
    └── tasks.py        # POST /tasks/tts|stt|llm|realtime|audio-understanding|media-convert
```

依赖方向：`config` → `utils` → `services` → `routers` → `main`，严禁逆向。

---

## 核心 API 端点

| Endpoint | Purpose |
|---|---|
| `POST /convert` | 音色转换 — 本地（RVC/Seed-VC 子进程）或云端（httpx） |
| `POST /tasks/tts` | TTS via OpenAI / Gemini / Fish Speech / ElevenLabs |
| `POST /tasks/stt` | STT via OpenAI / Gemini / Whisper |
| `POST /tasks/realtime` | 实时对话 WebSocket 引导 |
| `POST /tasks/audio-understanding` | 音频理解分析 |
| `POST /tasks/media-convert` | FFmpeg 格式转换 / 提取音频 / 截取片段 |
| `POST /train` | RVC 音色训练（6 段流程：预处理 → ContentVec 提取 → FAISS 索引 → 基础模型转换 → meta.json 生成） |
| `GET /voices` | 列出 `models/voices/` 下的音色模型 |
| `GET /jobs` | 任务队列列表 |

本地推理通过子进程调用引擎脚本，引擎解析优先级：`RVC_ENGINE_CMD_TEMPLATE` 环境变量 → `wrappers/rvc/engine.json` → 自动检测 `runtime/rvc/engine/`。

云端 API Key 语法：明文 key、`bearer:xxxxx`、`header:Name:value`。

---

## 模型与音色结构

```
models/
  voices/{voice_id}/
    meta.json          # 每个音色的推理配置（engine、command template 等）
    model.pth / .onnx  # 权重文件（gitignored）
    *.index            # RVC index 文件（可选，gitignored）
  uploads/             # 用户导入的音色包
```

`meta.json` 控制 `POST /convert` 的分发逻辑：`mode` 字段选择本地或云端；`inference.mode` 为 `copy`（调试直通）或 `command`（真实 RVC）。

---

## 特殊约束

- CORS 完全开放（`*`）— 桌面应用无跨域顾虑，intentional。
- 打包前必须重新构建 `frontend/out/`，生产模式 Electron 直接加载静态文件。
- 大型模型文件（`.pth`、`.onnx`、`.pt`、`.ckpt`、`.safetensors`）和 `runtime/`（整个目录）已 gitignore；wrapper 脚本已移至 `wrappers/`。
- `POST /train` 实现了完整的 RVC 训练流程（音频预处理 → ContentVec 特征提取 → FAISS 索引构建 → 基础模型转换）。fairseq 依赖在 Python 3.12 上存在 dataclass 不兼容问题（已在 train.py 中加入 patch）。

---

## 进程模型（Electron）

`main.js`（Electron 主进程）启动 `backend/main.py` 子进程，自动分配可用端口（默认 8000）。开发模式加载 `localhost:3000`，生产模式加载 `frontend/out/index.html`。`preload.js` 是 IPC 桥接，向渲染进程暴露后端 URL 和屏幕捕获等能力。

前端通过 `window.electronAPI` 获取后端地址；无 Electron 时（Docker/浏览器）回退到 `http://127.0.0.1:8000`。

---

## 日志规范

**开发模式**（`npx electron .`）：所有日志只走终端 stdout/stderr，不写文件。

**打包后（production）**：日志写到可执行文件旁的固定 `logs/` 目录，由 Electron 启动时计算并通过 `LOGS_DIR` 环境变量传给后端。

| 文件 | 内容 |
|---|---|
| `logs/backend.log` | Python FastAPI 日志（RotatingFileHandler 5 MB × 5 份） |
| `logs/electron.log` | Electron 主进程事件（窗口、IPC、启动/退出等） |
| `logs/frontend.log` | 前端 JS 未处理异常（`onerror` / `unhandledrejection`，经 IPC 写入） |

**实现位置**：
- `main.js`：`getLogsDir()` 计算目录，仅 `app.isPackaged` 时初始化文件流；`LOGS_DIR` 传给 Python 子进程
- `backend/logging_setup.py`：读取 `LOGS_DIR`，存在时才挂载 `RotatingFileHandler`
- `preload.js`：暴露 `logRenderer(level, message)` IPC（channel: `log:renderer`）
- `frontend/utils/index.ts`：`rlog()` 工具函数 + 全局错误监听，通过 IPC 写 `frontend.log`

---

## 包管理规范

- JS/Node：一律用 `pnpm`，禁止 `npm`
- Python（开发环境 / backend）：一律用 `poetry`，禁止直接 `pip`
- Python（runtime 引擎依赖）：各引擎用自己的 `requirements.txt`，通过内置 pip 安装，不走 poetry

---

## Python 环境架构

| 层级 | 位置 | 内容 | 用途 |
|------|------|------|------|
| **Poetry 虚拟环境** | `~/.cache/pypoetry/virtualenvs/test001-*/` | backend 依赖（fastapi、uvicorn、httpx 等） | 开发模式后端（`poetry run uvicorn`） |
| **嵌入式 Python** | `runtime/mac/python/bin/python3` | backend 依赖 + `pip_packages`（轻量：rvc-python 等） | 生产模式后端、ML 脚本运行器 |
| **本地 ML 包** | `runtime/ml/`（开发） | torch、torchaudio、faiss、llama-index 等 | 开发模式 ML 包（gitignored） |
| **用户 ML 包** | `userData/python-packages/`（生产） | 同上 | 生产模式用户首次启动下载 |

### 核心原则

**嵌入式 Python 保持干净** — 只装轻量 `pip_packages`，不装 GB 级 ML 包。ML 包统一装到外部目录，通过 PYTHONPATH 引用。这样打包体积小，开发/生产环境路径一致。

```
开发模式：
  pnpm run setup          # setup_base.py：下载嵌入式 Python + backend 依赖 + pip_packages + 引擎源码 + FFmpeg
  pnpm run ml / ml:extra  # 装 ML 包到 runtime/ml/（不污染嵌入式 Python）
  npx electron .          # main.js 设 PYTHONPATH=runtime/ml/

生产模式（用户下载 .app）：
  app 启动后端            # PYTHONPATH=userData/python-packages/
  首次启动引导            # ml_base.py / ml_extra.py --target userData/python-packages/
```

### PYTHONPATH 配置

**开发模式（main.js）：**
```javascript
// PYTHONPATH 指向 runtime/ml/（pnpm run ml 安装的 ML 包）
PYTHONPATH: [
  path.join(__dirname, 'backend'),
  path.join(__dirname, 'runtime', 'ml')
].join(path.delimiter)
```

**生产模式（main.js）：**
```javascript
PYTHONPATH: [
  path.join(__dirname, 'backend'),
  getUserPackagesDir()  // userData/python-packages/
].join(path.delimiter)
```

---

## 脚本分层架构（pnpm scripts）

```bash
# ─── 一键初始化 + 启动开发 ────────────────────────────────────────────────
pnpm run all            # setup → runtime → ml → checkpoints → dev（完整初始化 + 启动）

# ─── 环境初始化（用系统 Python 运行）──────────────────────────────────────
pnpm run setup          # = python3 scripts/setup_base.py
  # 下载嵌入式 Python + backend 依赖 + 基础引擎 pip_packages + 源码 + FFmpeg + pandoc
pnpm run setup:extra    # = python3 scripts/setup_extra.py
  # 额外引擎 pip_packages + 源码（liveportrait 等）

# ─── 嵌入式 Python 初始化 ──────────────────────────────────────────────────
pnpm run runtime        # = bash scripts/runtime.sh
  # 在嵌入式 Python 上安装 backend 依赖 + 引擎 pip_packages

# ─── ML 运行库（用嵌入式 Python 运行）─────────────────────────────────────
pnpm run ml             # = runtime/.../python3 scripts/ml_base.py
  # 安装 torch、torchaudio、transformers 等 → runtime/ml/
pnpm run ml:extra       # = runtime/.../python3 scripts/ml_extra.py
  # 安装 faiss、llama-index、peft 等 → runtime/ml/
  # 支持分组：ml:rag / ml:agent / ml:lora

# ─── 模型权重下载 ──────────────────────────────────────────────────────────
pnpm run checkpoints       # 基础模型（Fish Speech、RVC、Seed-VC、FaceFusion 等）
pnpm run checkpoints:extra # 额外模型（RAG、Agent 等）

# ─── 开发模式 ──────────────────────────────────────────────────────────────
pnpm run dev            # 启动 Electron + Next.js 前端（localhost:3000）
```

### manifest.json 中的包配置
- **pip_packages** — 轻量依赖（rvc-python、setuptools、munch 等），`setup_base.py` / `setup_extra.py` 阶段装入嵌入式 Python
- **runtime_pip_packages** — 重型 ML 包（torch、faiss、transformers 等），`ml_base.py` / `ml_extra.py` 装到 `runtime/ml/`（开发）或 `userData/python-packages/`（生产）
- **checkpoint_files** — 模型权重文件（Fish Speech ~1.2GB、RVC ~430MB、Seed-VC ~2.7GB、FaceFusion 13 个 ONNX ~1.8GB 等），`checkpoints_base.py` 通过 HuggingFace Hub 下载到 `runtime/checkpoints/`

---

## 烟雾测试两层架构

| 层级 | 文件 | 功能 | 环境 |
|------|------|------|------|
| **基础** | `tests/smoke_test.py` | TTS / STT / VC / 训练 / FFmpeg | 嵌入式 Python |
| **进阶** | `tests/smoke_test2.py` | RAG / Agent / LoRA | 嵌入式 Python |

### 运行方式
- 页面：TaskList → "运行烟雾测试 1/2"，前端流式显示日志 + 结果汇总
- 命令行：`runtime/mac/python/bin/python3 tests/smoke_test.py`
- Pytest：`poetry run pytest tests/smoke_test.py -v`

### 前端结果展示
后端返回 SSE 流，前端：
1. 流式显示所有详细日志
2. 解析"✅ 通过 — XXX"格式，提取结果汇总
3. 根据 exit code 判断成功/失败

---

## 依赖安装时机（强制规范）

### 三阶段分工

| 阶段 | 时机 | 脚本 | 安装到 | 内容 |
|------|------|------|--------|------|
| **CI 构建 / 开发 setup** | 打包前 | `setup_base.py` / `setup_extra.py` | 嵌入式 Python | 引擎源码 + `pip_packages`（轻量：rvc-python、setuptools 等） |
| **开发 ML** | 本地开发 | `ml_base.py` / `ml_extra.py` | `runtime/ml/` | `runtime_pip_packages`（torch、faiss、llama-index 等） |
| **用户首次启动** | 生产首次 | `ml_base.py` / `ml_extra.py --target userData/` | `userData/python-packages/` | 同上 |

### 开发流程

```bash
pnpm run setup        # 下载嵌入式 Python + backend 依赖 + 引擎 pip_packages + 源码 + FFmpeg
pnpm run runtime      # 在嵌入式 Python 上安装 backend 依赖 + 引擎 pip_packages
pnpm run ml           # torch 等 → runtime/ml/
pnpm run ml:extra     # faiss 等 → runtime/ml/（可选）
pnpm run checkpoints  # 模型权重 → runtime/checkpoints/
```

**打包：** `pnpm run dist`
```
安装包只包含：嵌入式 Python（仅 pip_packages，无 ML 包）+ 应用代码
不包含：runtime/ml/（gitignored）、runtime/checkpoints/（gitignored）
```

**生产用户首次启动：** 引导页面
```
阶段 1：ml_base.py --target userData/python-packages/（torch 等）
阶段 2：checkpoints_base.py（模型权重）
按需：ml_extra.py --target userData/python-packages/（faiss 等进阶功能）
```

### 严禁运行时动态安装

**禁止：**
- 在引擎脚本（`fish_speech_cli.py` 等）中调用 `pip install`
- 在后端处理请求时安装包
- 在用户触发的代码路径中动态装包

**正确做法：**
1. 在 `wrappers/manifest.json` 声明依赖：`pip_packages` 或 `runtime_pip_packages`
2. 轻量依赖在 CI 或 setup 阶段装（开发）
3. 重型依赖用户首次启动时装到 userData（生产）
4. 引擎脚本只 import，缺包时打印错误 + 非零退出码

## 分发架构与下载分工

### 三阶段下载分工

| 阶段 | 脚本调用 | 装什么 | 存到哪 |
|---|---|---|---|
| **CI 构建 / 开发 setup** | `setup_base.py` / `setup_extra.py` | 引擎源码 + `pip_packages`（轻量依赖） | 嵌入式 Python，打进安装包 |
| **开发 ML** | `pnpm run ml` / `ml:extra` | `runtime_pip_packages`（torch 等重型 ML 包） | `local_data/python-packages/`（gitignored） |
| **用户首次启动 Phase 1** | `ml_base.py --target userData/` | 同上 | `userData/python-packages/` |
| **用户首次启动 Phase 2** | `checkpoints_base.py` | 所有 `default_install: true` 引擎的 checkpoint + 内置音色 | `checkpoints/` + `models/voices/` |
| **开发模型** | `pnpm run checkpoints` | 同 Phase 2 | 同上 |

### pip_packages vs runtime_pip_packages

`wrappers/manifest.json` 每个引擎有两类依赖字段：

- **`pip_packages`**：轻量依赖（loguru、soundfile、rvc-python 等），`setup_base.py` / `setup_extra.py` 装入嵌入式 Python，打进安装包
- **`runtime_pip_packages`**：重型 ML 包（torch、torchaudio、transformers 等），体积几 GB，不打进包，装到外部目录（开发：`local_data/`，生产：`userData/`），通过 PYTHONPATH 引用

### 内置音色不打进安装包

内置音色（hutao-jp、Ayayaka、tsukuyomi、raiden 等）和其他引擎 checkpoint 一样，走用户首次启动引导下载，不在 CI 阶段下载打包。CI workflow 只跑 `setup_base.py`，不跑 `checkpoints_base.py`。

**原因**：安装包体积控制；引导流程已支持全量下载，无需单独处理音色。

### 用户引导下载的资产来源

| 内容 | 来源 |
|---|---|
| torch 等 ML 包 | PyPI（引导页支持配置清华/阿里云等镜像） |
| fish_speech / seed_vc / rvc checkpoints | HuggingFace 各原始仓库（固定 commit SHA） |
| facefusion ONNX 模型 | HF `N17K4/ai-workshop-assets` dataset |
| 内置音色 `.pth` / `.index` | HF `N17K4/ai-workshop-assets` dataset |

---

## 引擎源码管理

### wrappers/ 结构（全部 git 跟踪）
```
wrappers/
├── manifest.json              # 版本清单（引擎 pip 包、checkpoint URL、voices 定义）
├── rvc/                       # infer_cli.py、train.py、engine.json
├── whisper/                   # inference.py、engine.json
├── faster_whisper/            # inference.py、engine.json
├── fish_speech/               # inference.py、fish_speech_worker.py、fish_speech_cli.py、engine.json
├── seed_vc/                   # inference.py、seed_vc_worker.py、engine.json
├── got_ocr/                   # inference.py
├── liveportrait/              # inference.py
├── facefusion/                # inference.py
├── flux/                      # inference.py
├── sd/                        # inference.py
└── wan/                       # inference.py
```

`wrappers/manifest.json` 包含 `voices` 引擎定义，内置音色通过 `checkpoints_base.py` 从 HF `N17K4/ai-workshop-assets` dataset 下载到 `models/voices/`，不打包进安装包。

### runtime/ 结构（整个目录 gitignored）
```
runtime/
├── mac/、win/                 # embedded Python + ffmpeg + pandoc（setup 阶段安装）
│   ├── python/                # 嵌入式 Python 解释器
│   └── bin/                   # ffmpeg、pandoc 二进制（打包时加入 extraResources）
├── rvc/engine/                # setup_base.py 生成的 infer.py
├── fish_speech/engine/        # HF zip 下载 或 git clone fishaudio/fish-speech
├── seed_vc/engine/            # HF zip 下载 或 git clone seed-vc
├── facefusion/engine/         # HF zip 下载 或 git clone facefusion
├── liveportrait/engine/       # HF zip 下载 或 git clone liveportrait
└── ...                        # 其他引擎运行时文件
```

### HuggingFace 资产仓库
大型二进制资产（引擎源码 zip、内置音色、ONNX 模型）存放在 `N17K4/ai-workshop-assets`（dataset 类型）：

| 文件 | 说明 |
|------|------|
| `fish_speech_v1.5.0.zip` | fish-speech 引擎源码（精简后 ~60 KB） |
| `seed_vc_51383efd.zip` | seed-vc 引擎源码 |
| `liveportrait_49784e87.zip` | LivePortrait 引擎源码 |
| `facefusion_3.5.4.zip` | FaceFusion 引擎源码（不含 .assets） |
| `retinaface_10g.onnx` 等 | FaceFusion 推理模型（4 个 ONNX） |
| `hutao-jp/`、`Ayayaka/` 等 | 内置音色 `.pth` + `.index` 文件 |

`setup_base.py` / `setup_extra.py` 的 `_download_engine_zip_from_hf()` 优先从 HF 下载引擎 zip，失败时回退 git clone。

### 版本锁定
- **fish_speech engine**：HF zip `fish_speech_v1.5.0.zip`（回退：git clone tag `v1.5.0`）
- **seed_vc engine**：HF zip `seed_vc_51383efd.zip`（回退：commit `51383efd`）
- **checkpoints**：所有 URL 固定到 HuggingFace commit SHA，即使上游 main 更新也不受影响
- **FaceFusion ONNX**：从 `N17K4/ai-workshop-assets` dataset 下载，不再依赖 GitHub Releases

### MPS 补丁（macOS Apple Silicon）
`setup_base.py` 的 `_patch_fish_speech_generate()` 在引擎就绪后自动修补两处 `torch.isin` dtype 不匹配：
- `tools/llama/generate.py`：`semantic_ids_tensor` 加 `dtype=codebooks.dtype`
- `fish_speech/models/text2semantic/llama.py`：`semantic_token_ids_tensor` 加 `dtype=inp.dtype`

---

## 六大链路验证

开发环境验证（需先运行 `pnpm run checkpoints`）：

```bash
PY=/path/to/runtime/mac/python/bin/python3.12
FISH_INF=wrappers/fish_speech/inference.py
SVC_INF=wrappers/seed_vc/inference.py
RVC_INF=runtime/rvc/engine/infer.py
WHISPER_INF=wrappers/whisper/inference.py
RVC_MODEL=models/voices/<voice_id>/model.pth
RVC_INDEX=models/voices/<voice_id>/<name>.index

# 链路 1: Fish Speech TTS（首次 ~7s 加载，后续 ~5s 推理）
$PY $FISH_INF --text "你好测试" --output /tmp/chain1.wav

# 链路 2: Seed-VC 基础（无 F0）
$PY $SVC_INF --source /tmp/chain1.wav --target /tmp/chain1.wav --output /tmp/chain2.wav --diffusion-steps 10

# 链路 3: Seed-VC 高级（F0 condition）
$PY $SVC_INF --source /tmp/chain1.wav --target /tmp/chain1.wav --output /tmp/chain3.wav --diffusion-steps 10 --f0-condition

# 链路 4: RVC 基础（无 index）
$PY $RVC_INF --input /tmp/chain1.wav --output /tmp/chain4.wav --model $RVC_MODEL

# 链路 5: RVC 高级（带 index）
$PY $RVC_INF --input /tmp/chain1.wav --output /tmp/chain5.wav --model $RVC_MODEL --index $RVC_INDEX

# 链路 6: Whisper STT
$PY $WHISPER_INF --input /tmp/chain1.wav --output /tmp/chain6.txt --model base
cat /tmp/chain6.txt
```

注意：
- fish_speech worker 持久化运行（首次启动慢，后续请求共享已加载模型）
- RVC 在 macOS arm64 自动跳过 FAISS index（faiss-cpu 不支持），只用 --model
- Whisper STT 输出纯文本到 .txt 文件

---

## 测试

```
tests/
├── conftest.py                 # sys.path 注入（backend/ → Python 导入路径）
├── test_cloud_api_models.py    # 云端 HTTP API 测试（httpx mock，无需真实 key）
├── test_local_models.py        # 本地推理测试（subprocess mock，Fish Speech / Whisper / RVC / Seed-VC）
└── test_ollama.py              # Ollama LLM 测试
```

运行方式（需先 `pnpm run setup`）：

```bash
# 全部测试
poetry run pytest tests/ -v

# 只跑本地推理
poetry run pytest tests/test_local_models.py -v

# 只跑云端 API
poetry run pytest tests/test_cloud_api_models.py -v
```

所有测试均通过 `unittest.mock` 模拟外部依赖（httpx、subprocess），不需要真实 API Key 或模型文件，可在 CI 中直接运行。

---

## 权限规范

执行脚本、读取文件、运行只读 shell 命令（grep、bash、cat、cd、ls、find 等）无需确认。
