# 安装阶段全览

本文档描述开发环境从零到完整运行所需的 5 个安装阶段，按依赖顺序排列。

---

## Stage 1: `pnpm run setup` + `pnpm run runtime`

> setup: `scripts/setup.sh`（mise + pnpm + poetry）
> runtime: `scripts/runtime.py`　｜　运行环境：**系统 Python**

環境初始化。setup.sh で開発ツール、runtime.py で嵌入式 Python + backend 依赖 + 全引擎 pip 包 + 源码 + FFmpeg/Pandoc。

### 1/4 嵌入式 Python

| 平台 | 版本 | 保存路径 |
|------|------|----------|
| macOS | python-build-standalone 3.12.9 | `runtime/python/mac/` |
| Windows | python.org embed 3.10.11 | `runtime/python/win/` |

### 2/4 Backend 依赖

将 fastapi、uvicorn、httpx 等后端框架安装到嵌入式 Python 的 site-packages。

### 3/4 基础引擎（pip_packages + 源码）

| 引擎 | pip_packages（装入嵌入式 Python） | 源码 | 源码保存路径 |
|------|----------------------------------|------|-------------|
| fish_speech | huggingface_hub, setuptools, wheel, loguru, natsort, soundfile, loralib, pyrootutils, pydantic, rich, click, tqdm, tiktoken | HF zip `fish_speech_v1.5.0.zip` / 回退 git clone tag `v1.5.0` | `runtime/engine/fish_speech/` |
| gpt_sovits | huggingface_hub, setuptools, wheel, cn2an, pypinyin, jieba, wordsegment, g2p_en, LangSegment | HF zip `gpt_sovits_v2.zip` / 回退 git clone | `runtime/engine/gpt_sovits/` |
| seed_vc | huggingface_hub, setuptools, wheel | HF zip `seed_vc_51383efd.zip` / 回退 git clone commit `51383efd` | `runtime/engine/seed_vc/` |
| rvc | rvc-python==0.1.5, setuptools | 自动生成 `infer.py` | `runtime/engine/rvc/` |
| faster_whisper | faster-whisper==1.2.1 | —（无源码） | — |
| facefusion | —（无 pip_packages） | git clone tag `3.5.4` | `runtime/engine/facefusion/` |

### 4/4 工具二进制

| 工具 | 来源 | 大小 | 保存路径 |
|------|------|------|----------|
| FFmpeg | evermeet.cx (macOS) / BtbN GitHub (Windows) | ~70–90 MB | `runtime/bin/{mac\|win}/ffmpeg` |
| Pandoc | GitHub Releases v3.6.4 | ~25 MB | `runtime/bin/{mac\|win}/pandoc` |

### 4/5 额外引擎（pip_packages + 源码）

| 引擎 | pip_packages（装入嵌入式 Python） | 源码 |
|------|----------------------------------|------|
| flux | gguf, diffusers>=0.32, accelerate, sentencepiece, protobuf | — |
| got_ocr | transformers>=4.48, tiktoken, verovio, pymupdf | — |
| liveportrait | imageio, imageio-ffmpeg, av, omegaconf, einops, safetensors, onnx, onnxruntime, scikit-image, pykalman | HF zip `liveportrait_49784e87.zip` / 回退 git clone → `runtime/engine/liveportrait/` |
| sd | diffusers>=0.21, accelerate, safetensors | — |
| wan | diffusers>=0.30, accelerate, imageio, imageio-ffmpeg | — |
| whisper | *(pip_packages 为空，跳过)* | — |

### 再安装方式

```bash
# 全量重装
rm -rf runtime/
python3 scripts/runtime.py

# 单引擎重装（例：seed_vc）
rm -rf runtime/engine/seed_vc/
python3 scripts/runtime.py --engine seed_vc
```

---

## Stage 2: `pnpm run ml`
 ┌──────────────────┬─────────────────────────────────┬──────────────────────────────────────────────────────┐    
  │                  │        pip_packages（①）        │              runtime_pip_packages（②）               │ 
  ├──────────────────┼─────────────────────────────────┼──────────────────────────────────────────────────────┤    
  │ サイズ           │ 軽量（数 MB）                   │ 重型（数 GB）                                        │ 
  ├──────────────────┼─────────────────────────────────┼──────────────────────────────────────────────────────┤ 
  │ 保存先           │ 嵌入式 Python の site-packages  │ runtime/ml/（開発）/                                 │    
  │                  │                                 │ userData/python-packages/（本番）                    │    
  ├──────────────────┼─────────────────────────────────┼──────────────────────────────────────────────────────┤    
  │ インストール時期 │ pnpm run runtime (CI/setup      │ pnpm run ml (開発) / ユーザー初回起動                │    
  │                  │ 段階)                           │                                                      │ 
  ├──────────────────┼─────────────────────────────────┼──────────────────────────────────────────────────────┤    
  │ 打包に含む？     │ はい                            │ いいえ                                               │ 
  ├──────────────────┼─────────────────────────────────┼──────────────────────────────────────────────────────┤    
  │ PYTHONPATH       │ 不要（Python 自体に内蔵）       │ 必要（main.js が設定）                               │
  │ で参照           │                                 │                                                      │    
  └──────────────────┴─────────────────────────────────┴──────────────────────────────────────────────────────┘
                                                                                                                   
  各エンジン別のパッケージ一覧                                                                                     
   
  ┌────────────────┬─────────────────────────────────────────┬─────────────────────────────────────────────┐       
  │    エンジン    │     ① pip_packages（嵌入式 Python）     │    ② runtime_pip_packages（runtime/ml/）    │
  ├────────────────┼─────────────────────────────────────────┼─────────────────────────────────────────────┤       
  │ Fish Speech    │ loguru, soundfile, loralib, tiktoken 等 │ torch, torchaudio, transformers, einops 等  │
  ├────────────────┼─────────────────────────────────────────┼─────────────────────────────────────────────┤
  │ GPT-SoVITS     │ cn2an, pypinyin, jieba, g2p_en 等       │ torch, torchaudio, transformers, librosa 等 │       
  ├────────────────┼─────────────────────────────────────────┼─────────────────────────────────────────────┤       
  │ RVC            │ rvc-python, fairseq（特殊処理）         │ torch, torchaudio, faiss-cpu, pyworld 等    │       
  ├────────────────┼─────────────────────────────────────────┼─────────────────────────────────────────────┤       
  │ Seed-VC        │ huggingface_hub                         │ torch, torchaudio, librosa, einops 等       │
  ├────────────────┼─────────────────────────────────────────┼─────────────────────────────────────────────┤       
  │ Faster Whisper │ faster-whisper==1.2.1                   │ なし                                        │
  ├────────────────┼─────────────────────────────────────────┼─────────────────────────────────────────────┤       
  │ FaceFusion     │ なし（エンジン内 requirements）         │ なし                                        │
  ├────────────────┼─────────────────────────────────────────┼─────────────────────────────────────────────┤       
  │ Flux/SD/Wan    │ diffusers, accelerate 等                │ torch, torchvision, Pillow 等               │
  └────────────────┴─────────────────────────────────────────┴─────────────────────────────────────────────┘       
                                                            

> 脚本：`scripts/ml_base.py`　｜　运行环境：**嵌入式 Python**

安装基础引擎的重型 ML 运行库。**不装入嵌入式 Python**，而是装到外部目录，通过 PYTHONPATH 引用。

### 安装目标

| 环境 | 目标路径 |
|------|----------|
| 开发模式 | `runtime/ml/` |
| 生产模式（用户首次启动） | `userData/python-packages/` |

### 安装内容

汇总 6 个基础引擎的 `pip_packages` + `runtime_pip_packages`，去重后统一安装。核心包如下：

| 来源引擎 | runtime_pip_packages |
|----------|---------------------|
| fish_speech | torch, torchaudio, hydra-core, transformers, einops, vector-quantize-pytorch |
| gpt_sovits | torch, torchaudio, transformers, einops, soundfile, librosa |
| seed_vc | torch, torchaudio, numpy, scipy, librosa==0.10.2, soundfile, einops, omegaconf, transformers |
| rvc | torch, torchaudio, av, faiss-cpu, ffmpeg-python, praat-parselmouth, pyworld, torchcrepe |
| faster_whisper | *(空)* |
| facefusion | *(空)* |

> 去重后约 20–30 个包，总计 ~2–4 GB（主要是 torch 系列）。

### 特殊机制

- **torch 版本锁定**：与嵌入式 Python 自带版本对齐，防止 transitive dependency 升级
- **冲突包清理**：安装后自动删除 target 目录中与嵌入式 Python 冲突的包（pydantic、fastapi、uvicorn 等）
- **并行下载**：先并行下载 wheel 到临时目录，再逐个安装（故障隔离）

### 再安装方式

```bash
# 全量重装
rm -rf runtime/ml/
runtime/python/mac/bin/python3 scripts/ml_base.py

# 指定 PyPI 镜像
runtime/python/mac/bin/python3 scripts/ml_base.py --pypi-mirror https://pypi.tuna.tsinghua.edu.cn/simple
```

---

## Stage 3: `pnpm run ml:extra`

> 脚本：`scripts/ml_extra.py`　｜　运行环境：**嵌入式 Python**

安装进阶功能的 ML 包。可按分组单独安装。

### 安装目标

同 Stage 3：`runtime/ml/`（开发）/ `userData/python-packages/`（生产）

### 分组内容

| 分组 | pnpm 命令 | 引擎 | runtime_pip_packages |
|------|-----------|------|---------------------|
| 全部 | `pnpm run ml:extra` | 全部 3 个引擎 | 见下 |
| RAG | `pnpm run ml:rag` | rag_engine | llama-index-core, llama-index-embeddings-ollama, llama-index-vector-stores-faiss, faiss-cpu, llama-index-llms-ollama, llama-index-llms-openai, llama-index-llms-gemini, pypdf, docx2txt, openpyxl |
| Agent | `pnpm run ml:agent` | agent_engine | langgraph, langchain-core, langchain-community, duckduckgo-search |
| LoRA | `pnpm run ml:lora` | finetune_engine | peft, trl, datasets, bitsandbytes, accelerate |

### 再安装方式

```bash
# 全量重装
runtime/python/mac/bin/python3 scripts/ml_extra.py

# 只装 RAG
runtime/python/mac/bin/python3 scripts/ml_extra.py --group rag
```

---

## Stage 4: `pnpm run checkpoints`

> 脚本：`scripts/checkpoints_base.py` → `scripts/_checkpoint_download.py`　｜　运行环境：**嵌入式 Python**

下载基础引擎的模型权重文件 + 内置音色。

### checkpoint_files（直接 URL 下载）

| 引擎 | 文件 | 大小 | 保存路径 |
|------|------|------|----------|
| fish_speech | model.pth | ~500 MB | `runtime/checkpoints/fish_speech/` |
| | config.json, special_tokens.json, tokenizer.tiktoken | <1 MB | |
| | firefly-gan-vq-fsq-8x1024-21hz-generator.pth | ~500 MB | |
| gpt_sovits | chinese-hubert-base/ (preprocessor_config.json, config.json, pytorch_model.bin) | ~380 MB | `runtime/checkpoints/gpt_sovits/` |
| | chinese-roberta-wwm-ext-large/ (config.json, tokenizer.json, pytorch_model.bin) | ~1.3 GB | |
| | gsv-v2final-pretrained/s1bert25hz-5kh-longer-epoch=12-step=369668.ckpt | ~600 MB | |
| | gsv-v2final-pretrained/s2G2333k.pth | ~800 MB | |
| seed_vc | DiT_seed_v2_uvit_whisper_small_wavenet_bigvgan_pruned.pth | ~200 MB | `runtime/checkpoints/seed_vc/` |
| | config_dit_mel_seed_uvit_whisper_small_wavenet.yml | <1 MB | |
| rvc | hubert_base.pt | ~360 MB | `runtime/checkpoints/rvc/` |
| | pretrained_v2/f0G40k.pth | ~400 MB | |
| facefusion | retinaface_10g.onnx | ~16 MB | `runtime/engine/facefusion/.assets/models/` |
| | arcface_w600k_r50.onnx | ~166 MB | |
| | 2dfan4.onnx | ~93 MB | |
| | inswapper_128_fp16.onnx | ~265 MB | |

### hf_cache_downloads（HuggingFace 缓存下载）

| 引擎 | repo_id | 内容 | 大小 | 保存路径 |
|------|---------|------|------|----------|
| seed_vc | nvidia/bigvgan_v2_22khz_80band_256x | BigVGAN 声码器 | ~1.3 GB | `runtime/checkpoints/hf_cache/` |
| seed_vc | openai/whisper-small | Whisper-small 语义编码器 | ~950 MB | `runtime/checkpoints/hf_cache/` |
| seed_vc | funasr/campplus (campplus_cn_common.bin) | 说话人特征提取 | ~25 MB | `runtime/checkpoints/`（根目录） |
| seed_vc | lj1995/VoiceConversionWebUI (rmvpe.pt) | RMVPE F0 提取器 | ~200 MB | `runtime/checkpoints/`（根目录） |

> **注意**：campplus 和 rmvpe 的 `cache_dir_rel` 为 `"runtime/checkpoints"`（不是 `"runtime/checkpoints/hf_cache"`），所以保存在 `runtime/checkpoints/models--funasr--campplus/` 和 `runtime/checkpoints/models--lj1995--VoiceConversionWebUI/`。UI 中显示为 `seed_vc_hf_root`。

### 内置音色（voices）

| 文件 | 大小 | 保存路径 |
|------|------|----------|
| hutao-jp/model.pth | ~53 MB | `models/voices/hutao-jp/` |
| hutao-jp/hutao.index | ~65 MB | |
| Ayayaka/model.pth | ~53 MB | `models/voices/Ayayaka/` |
| Ayayaka/ayaka.index | ~101 MB | |
| tsukuyomi/model.pth | ~53 MB | `models/voices/tsukuyomi/` |

> 来源：HuggingFace dataset `N17K4/ai-workshop-assets`

### 特殊处理

- **faster_whisper**：通过 `prefetch_faster_whisper_model()` 预下载 large-v3 和 base 模型
- **rvc**：通过 `prefetch_rvc_base_models()` 预下载基础模型
- **facefusion**：先 clone 引擎源码（若 Stage 1 未完成），再下载 ONNX 模型

### 再安装方式

```bash
# 全量检查
pnpm run checkpoints:check

# 全量重新下载
pnpm run checkpoints:force

# 单引擎重装
runtime/python/mac/bin/python3 scripts/checkpoints_base.py --engine seed_vc

# 只重装 HF 缓存部分（删除后重跑）
rm -rf runtime/checkpoints/hf_cache/models--nvidia--bigvgan_v2_22khz_80band_256x/
rm -rf runtime/checkpoints/hf_cache/models--openai--whisper-small/
rm -rf runtime/checkpoints/models--funasr--campplus/
rm -rf runtime/checkpoints/models--lj1995--VoiceConversionWebUI/
pnpm run checkpoints --engine seed_vc
```

---

## Stage 5: `pnpm run checkpoints:extra`

> 脚本：`scripts/checkpoints_extra.py` → `scripts/_checkpoint_download.py`　｜　运行环境：**嵌入式 Python**

下载可选引擎的模型权重。体积较大，按需安装。

### 下载内容

| 引擎 | 内容 | 大小 | 保存路径 | 备注 |
|------|------|------|----------|------|
| flux | GGUF Q4_K_S transformer | ~6.5 GB | `runtime/checkpoints/flux/` | 无需 HF token |
| flux | FLUX.1-schnell base (T5-XXL + CLIP-L + VAE) | ~10 GB | `runtime/checkpoints/hf_cache/` | **需 HF token** |
| sd | SD-Turbo 完整模型 | ~2.3 GB | `runtime/checkpoints/sd/` | 无需 HF token |
| wan | Wan2.1-T2V-1.3B-Diffusers | ~15.6 GB | `runtime/checkpoints/hf_cache/` | |
| got_ocr | GOT-OCR-2.0-hf | ~1.5 GB | `runtime/checkpoints/hf_cache/` | |
| liveportrait | KwaiVGI/LivePortrait | ~1.8 GB | `runtime/checkpoints/hf_cache/` | |
| whisper | *(无 URL，暂不预下载)* | ~1.5 GB | — | 当前 faster_whisper 为默认引擎 |

### 再安装方式

```bash
# 全量下载
pnpm run checkpoints:extra

# 单引擎下载
runtime/python/mac/bin/python3 scripts/checkpoints_extra.py --engine flux

# 强制重新下载
runtime/python/mac/bin/python3 scripts/checkpoints_extra.py --engine wan --force
```

---

## 完整依赖链路图

```
Stage 1: pnpm run setup ─────────────────── 系统 Python 运行
   │  嵌入式 Python + backend 依赖
   │  + 6 引擎 pip_packages + 源码 + FFmpeg/Pandoc
   │
Stage 2: pnpm run setup:extra ───────────── 嵌入式 Python 运行
   │  可选引擎 pip_packages + LivePortrait 源码
   │
Stage 3: pnpm run ml ────────────────────── 嵌入式 Python 运行
   │  torch/torchaudio 等 → runtime/ml/
   │
Stage 4: pnpm run ml:extra ──────────────── 嵌入式 Python 运行（可选）
   │  RAG/Agent/LoRA 包 → runtime/ml/
   │
Stage 5: pnpm run checkpoints ───────────── 嵌入式 Python 运行
   │  基础引擎 checkpoint + 内置音色 + HF 缓存
   │
Stage 6: pnpm run checkpoints:extra ─────── 嵌入式 Python 运行（可选）
      可选引擎 checkpoint（Flux/SD/Wan/GOT-OCR/LivePortrait）
```

### 最小可运行集合

运行基础功能（TTS + VC + STT）至少需要完成：

```bash
pnpm run setup        # Stage 1
pnpm run ml           # Stage 3
pnpm run checkpoints  # Stage 5
```

### 磁盘占用估算

| 阶段 | 增量大小 |
|------|----------|
| Stage 1 | ~500 MB（Python ~200MB + pip ~200MB + FFmpeg ~70MB + Pandoc ~25MB） |
| Stage 2 | ~100 MB（轻量 pip 包） |
| Stage 3 | ~2–4 GB（torch 系列） |
| Stage 4 | ~500 MB–1 GB（视分组） |
| Stage 5 | ~8–10 GB（所有基础 checkpoint + 音色） |
| Stage 6 | ~20–40 GB（视选装引擎，Flux + Wan 最大） |
