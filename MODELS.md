# 本地模型安装指南

## 安装流程

```
pnpm run setup          # 安装 Python 运行时、克隆引擎源码、安装 pip 依赖
pnpm run checkpoints    # 下载模型 checkpoint（可指定 --engine <name> 单独下载）
npx electron .          # 启动应用（严禁在此阶段触发任何网络下载）
```

> **严格限制**：所有模型、引擎源码、Python 包的下载**必须且只能**在 `setup` / `checkpoints` / `dist` 阶段完成。应用运行期间环境变量 `HF_HUB_OFFLINE=1` 强制生效，严禁任何运行时网络请求。

---

## 模型总览

| 功能 | 模型 | 状态 | RTX 4050 16G | MBP 32G (Apple Silicon) | checkpoint 大小 |
|---|---|---|---|---|---|
| 图像生成 | Flux.1-Schnell GGUF Q4_K_S | ✅ 已支持 | ✅ CUDA | ✅ MPS | ~17 GB（GGUF 6.7 + T5/CLIP/VAE ~10）|
| 图像生成 | ComfyUI（本地代理） | ✅ 已支持 | ✅ | ✅ | 视工作流而定 |
| 图像生成 | OpenAI / Gemini / Stability / DashScope | ✅ 云端 | ✅ | ✅ | — |
| 换脸/换图 | FaceFusion 3.x | ✅ 已支持 | ✅ CUDA | ⚠️ CPU 模式（较慢） | ~300 MB（换脸模型）|
| 换脸/换图 | ComfyUI img2img | ✅ 已支持 | ✅ | ✅ | 视工作流而定 |
| 换脸/换图 | Replicate API | 【暂不支持】 | — | — | — |
| 视频生成 | Wan 2.1 T2V-1.3B（本地） | ✅ 已支持 | ✅ 推荐 | ✅ 32G 充裕 | ~15.6 GB |
| 视频生成 | Kling API | ✅ 已支持（云端） | ✅ | ✅ | — |
| 视频生成 | Wan Video / Runway / Pika / Sora | 【暂不支持】 | — | — | — |
| OCR / 文档 | GOT-OCR2.0（本地） | ✅ 已支持 | ✅ | ✅ | ~1.5 GB |
| OCR / 文档 | OpenAI / Gemini / Claude（视觉） | ✅ 云端 | ✅ | ✅ | — |
| OCR / 文档 | Azure Document Intelligence | 【暂不支持】 | — | — | — |
| 口型同步 | LivePortrait FP16（本地） | ✅ 已支持 | ✅ | ✅ MPS | ~800 MB |
| 口型同步 | SadTalker / HeyGen / D-ID | 【暂不支持】 | — | — | — |
| TTS | Fish Speech 1.5（本地） | ✅ 已支持 | ✅ | ✅ | ~1 GB |
| 音色转换 | Seed-VC 2.0（本地） | ✅ 已支持 | ✅ | ✅ | ~2.7 GB |
| 音色转换 | RVC v2（本地） | ✅ 已支持 | ✅ | ✅ | ~760 MB（仅训练用） |
| STT | Faster Whisper base（本地） | ✅ 已支持 | ✅ | ✅ | ~150 MB |

---

## 磁盘占用详细说明

### 新增引擎（扩展功能）

| 引擎 | 文件 | 大小 | 存储位置 | 必须 | 安装阶段 |
|---|---|---|---|---|---|
| **Flux** GGUF Transformer | `flux1-schnell-Q4_K_S.gguf` | 6.5 GB | `checkpoints/flux/` | ✅ | `pnpm run checkpoints` |
| **Flux** 基础组件 | T5-XXL + CLIP-L + VAE | ~10 GB | `checkpoints/hf_cache/` | ✅ 必须² | `pnpm run checkpoints` |
| **Wan 2.1** T2V-1.3B | Transformer + umt5-XXL + VAE | ~15.6 GB | `checkpoints/hf_cache/` | ❌ 可选² | `pnpm run checkpoints` |
| **GOT-OCR2.0** | GOT-OCR-2.0-hf 全量 | ~1.5 GB | `checkpoints/hf_cache/` | ✅ | `pnpm run checkpoints` |
| **LivePortrait** FP16 | 特征提取器 + 生成器权重 | ~800 MB | pip 包内置³ | ✅ | `pnpm run setup` |
| **FaceFusion** | 换脸模型（inswapper_128 等） | ~300 MB | FaceFusion 自管理⁴ | ✅ | 手动 `install.py` |

> ² **Flux 基础组件**（~10 GB）包含 T5-XXL text encoder（~9.3 GB）、CLIP-L（~235 MB）、VAE（~335 MB）。GGUF 只是 Transformer 权重，缺少基础组件无法推理。`ignore_patterns` 会跳过仓库里的完整 Transformer 权重（`flux1-schnell.safetensors`，~24 GB），避免重复下载。门控仅指需要在 HuggingFace 登录并点击同意使用条款，免费无需申请资格，配置 `HF_TOKEN` 后 `pnpm run checkpoints` 自动下载。
> ² **Wan 2.1** manifest 标记 `required: false`，可手动触发：`pnpm run checkpoints --engine wan`。
> ³ **LivePortrait** 权重通过 `pip install liveportrait`（setup 阶段 `runtime_pip_packages`）随包下载，存入 pip 包数据目录，无独立 `checkpoints/` 条目。
> ⁴ **FaceFusion** 在执行 `runtime/facefusion/engine/install.py` 时自动下载所选换脸模型到引擎自己的 `models/` 目录。

### 原有引擎（音频功能）

| 引擎 | 文件 | 大小 | 存储位置 | 必须 |
|---|---|---|---|---|
| **Fish Speech 1.5** | `model.pth` | 500 MB | `checkpoints/fish_speech/` | ✅ |
| | `firefly-gan-vq-fsq-8x1024-21hz-generator.pth` | 500 MB | `checkpoints/fish_speech/` | ✅ |
| | `config.json` + `tokenizer.tiktoken` 等 | ~5 MB | `checkpoints/fish_speech/` | ✅ |
| **Seed-VC 2.0** | `DiT_seed_v2_uvit_whisper_small_wavenet_bigvgan_pruned.pth` | 200 MB | `checkpoints/seed_vc/` | ✅ |
| | BigVGAN v2 声码器 | 1.3 GB | `checkpoints/hf_cache/` | ✅ |
| | Whisper-small（语义编码） | 950 MB | `checkpoints/hf_cache/` | ✅ |
| | campplus 说话人特征 | 25 MB | `checkpoints/` | ✅ |
| | RMVPE F0 提取器 | 200 MB | `checkpoints/` | ✅（F0 模式） |
| **RVC v2** | `hubert_base.pt`（训练用） | 360 MB | `checkpoints/rvc/` | ❌ 仅训练 |
| | `pretrained_v2/f0G40k.pth`（训练用） | 400 MB | `checkpoints/rvc/` | ❌ 仅训练 |
| **Faster Whisper** base | `base/model.bin` 等 | ~150 MB | `checkpoints/faster_whisper/base/` | ✅ |

### 全量磁盘估算

| 场景 | 预计总占用 |
|---|---|
| 仅音频功能（TTS + VC + STT） | ~5 GB |
| 音频 + OCR + LivePortrait | ~7.5 GB |
| 音频 + OCR + LivePortrait + Wan 2.1 + Flux（完整） | ~32 GB |

---

## 各引擎安装逻辑

### Flux.1-Schnell GGUF Q4_K_S（图像生成）

**安装阶段**：

```
pnpm run setup --engine flux
  └─ setup-engines.py → pip install gguf diffusers>=0.32 accelerate sentencepiece protobuf
                         + 验证 GGUFQuantizationConfig 可用

pnpm run checkpoints --engine flux
  └─ download_checkpoints.py
       ├─ hf_hub_download(city96/FLUX.1-schnell-gguf, flux1-schnell-Q4_K_S.gguf)
       │    → checkpoints/flux/flux1-schnell-Q4_K_S.gguf（6.5 GB，无门控）
       └─ snapshot_download(black-forest-labs/FLUX.1-schnell,
            ignore_patterns=["flux1-schnell.safetensors"])
            → checkpoints/hf_cache/（~10 GB，需 HF Token + 同意使用条款）
```

**HuggingFace Token 配置（必须）**：

先在 HuggingFace 网站同意使用协议，然后配置 Token：

```bash
export HF_TOKEN=hf_xxxxx
# 或：
huggingface-cli login
```

**运行时行为**：
- `HF_HUB_OFFLINE=1` 强制离线，`HF_HUB_CACHE` 指向 `checkpoints/hf_cache/`
- inference.py 通过 `_find_gguf_file()` 在 `checkpoints/flux/` 中定位 `.gguf` 文件
- 基础组件通过 `from_pretrained("black-forest-labs/FLUX.1-schnell")` 从 HF cache 加载（离线）

**硬件说明**：
- RTX 4050（6 GB VRAM）：T5-XXL（~9.3 GB）超出显存，自动启用 sequential CPU offload。Transformer 在 GPU 上运行，T5-XXL 在 CPU RAM 执行，每步有 CPU↔GPU 搬运开销。生成 1024×1024 约 3-6 分钟。
- MBP 32G：MPS + float16，unified memory 无需 offload，生成 1024×1024 约 2-5 分钟。

---

### FaceFusion 3.x（换脸/换图）

**安装阶段（需手动执行）**：

`pnpm run setup` 不自动处理 FaceFusion，需手动操作：

```bash
# 步骤 1：克隆引擎源码（一次性）
git clone https://github.com/facefusion/facefusion.git runtime/facefusion/engine

# 步骤 2：运行 FaceFusion 安装程序（自动下载 Python + 模型）
cd runtime/facefusion/engine
python install.py --onnxruntime default    # CPU / MPS（Mac）
# 或：
python install.py --onnxruntime cuda       # NVIDIA GPU（Windows/Linux）
```

`install.py` 会下载 FaceFusion 所需换脸模型（inswapper_128 等，约 300 MB）到引擎自己的 `models/` 目录。

**运行时行为**：
- `runtime/facefusion/inference.py` 调用 `runtime/facefusion/engine/facefusion.py headless-run`
- 使用 `build_engine_env("facefusion")` 注入环境变量，包含 `HF_HUB_OFFLINE=1`

**硬件说明**：
- RTX 4050 16G：CUDA ONNX Runtime
- MBP 32G：ONNX Runtime 无 MPS 后端 → 自动回退 CPU 模式（速度较慢）

---

### Wan 2.1 T2V-1.3B（视频生成）

**安装阶段**：

```
pnpm run setup --engine wan
  └─ setup-engines.py → pip install diffusers>=0.30 accelerate imageio imageio-ffmpeg

pnpm run checkpoints --engine wan
  └─ download_checkpoints.py
       └─ snapshot_download(Wan-AI/Wan2.1-T2V-1.3B, required=false)
            → checkpoints/hf_cache/（~5 GB）
```

**运行时行为**：
- `HF_HUB_CACHE=checkpoints/hf_cache` + `HF_HUB_OFFLINE=1`
- `runtime/wan/inference.py` 通过 `WanPipeline.from_pretrained("Wan-AI/Wan2.1-T2V-1.3B")` 离线加载
- 帧数格式 `4n+1`（最少 17 帧），不符合时自动向上取整

**硬件说明**：
- RTX 4050 16G：推荐机型，~30s 生成 3s 视频（17 帧）
- MBP 32G：MPS 模式，~60s 生成 3s 视频

---

### GOT-OCR2.0（OCR / 文档）

**安装阶段**：

```
pnpm run setup --engine got_ocr
  └─ setup-engines.py → pip install transformers>=4.37 tiktoken verovio

pnpm run checkpoints --engine got_ocr
  └─ download_checkpoints.py
       └─ snapshot_download(stepfun-ai/GOT-OCR-2.0-hf)
            → checkpoints/hf_cache/（~1.5 GB）
```

**运行时行为**：
- `HF_HUB_CACHE=checkpoints/hf_cache` + `HF_HUB_OFFLINE=1`
- `runtime/got_ocr/inference.py` 通过 `AutoModelForCausalLM.from_pretrained("stepfun-ai/GOT-OCR-2.0-hf")` 离线加载

**硬件说明**：两台机器均可流畅运行，显存占用 ~2 GB。

---

### LivePortrait FP16（口型同步）

**安装阶段**：

```
pnpm run setup --engine liveportrait
  └─ setup-engines.py → pip install imageio imageio-ffmpeg av omegaconf einops safetensors
                         + pip install liveportrait（runtime_pip_packages，含模型权重 ~800 MB）
```

`pip install liveportrait` 在 setup 阶段执行，权重随包内置，无需单独 `checkpoints`。

也可克隆源码（二选一）：

```bash
git clone https://github.com/KwaiVGI/LivePortrait.git runtime/liveportrait/engine
```

**运行时行为**：
- `runtime/liveportrait/inference.py` 调用 `runtime/liveportrait/engine/inference.py`（源码模式）或通过已安装的 `liveportrait` 包入口（pip 模式）
- 不依赖 HF cache，权重路径由 liveportrait 包自身管理

**硬件说明**：
- RTX 4050 16G：CUDA，~5s/段
- MBP 32G：MPS，~10s/段

---

### ComfyUI（图像生成 / 换图）

ComfyUI 为独立服务，本应用通过代理转发：

```bash
# 需单独启动，本应用不负责管理 ComfyUI 进程
python main.py --listen 127.0.0.1 --port 8188
```

应用内选择「ComfyUI（本地）」时，后端向 `http://127.0.0.1:8188` 转发请求，轮询 `/history/{prompt_id}` 直到完成。

---

## Kling API 配置（视频生成）

可灵 API 为云端服务，无需本地算力：

1. 在可灵开放平台申请 API Key
2. 在应用「设置」中填入 Kling API Key
3. 视频生成页选择「Kling」即可

---

## 全量 / 单引擎安装命令

```bash
# 全部安装
pnpm run setup
pnpm run checkpoints

# 单引擎安装
pnpm run setup --engine flux
pnpm run setup --engine got_ocr
pnpm run setup --engine wan
pnpm run setup --engine liveportrait

pnpm run checkpoints --engine flux
pnpm run checkpoints --engine got_ocr
pnpm run checkpoints --engine wan
# LivePortrait 无独立 checkpoints 步骤，setup 阶段已完成
# FaceFusion 无 pnpm 命令，见上方手动步骤
```

---

## 运行时限制

应用运行期间（`npx electron .` 或打包版）**完全禁止**：

- 任何 `pip install` / `pip download` 调用
- 任何 `huggingface_hub.snapshot_download()` / `hf_hub_download()` 在线请求（`HF_HUB_OFFLINE=1` 强制执行）
- 任何向外部 CDN / HuggingFace / S3 的模型下载请求

若启动时报错：

| 错误信息 | 原因 | 解决方法 |
|---|---|---|
| `OSError: We're offline` | HF 模型未下载 | 执行对应 `pnpm run checkpoints --engine <name>` |
| `ModuleNotFoundError` | pip 依赖未安装 | 执行对应 `pnpm run setup --engine <name>` |
| `FileNotFoundError: *.gguf` | Flux GGUF 未下载 | `pnpm run checkpoints --engine flux` |
| `No such file or directory: facefusion.py` | FaceFusion 引擎未克隆 | 见 FaceFusion 手动安装步骤 |
