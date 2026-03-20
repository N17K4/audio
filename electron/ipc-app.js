const { app, BrowserWindow, ipcMain, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const { getCheckpointsDir, getUserPackagesDir, getResRoot, LOGS_DIR, CACHE_DIR, PROJECT_ROOT } = require('./paths');
const { createAppendLogger, downloadLogFilename } = require('./logger');
const state = require('./state');
const { getDirSize, dirExists, readManifest, findRvcBaseModelDirs } = require('./utils');
const { ENGINE_EXTRA_PATHS, STAGE_CLEAR_KEYS, STAGE_SCRIPTS, ALL_ENGINES, ML_INSTALL_GROUPS, CLEARABLE_DIRS } = require('./constants');
const { openSetupGuideWindow, openDualSetupConfigWindow } = require('./windows');
const { fetchRuntimeInfo } = require('./utils');

// checkpoints_extra 阶段管理的引擎
const EXTRA_CHECKPOINT_ENGINES = new Set(['cosyvoice', 'sd', 'flux', 'wan', 'got_ocr', 'liveportrait', 'whisper']);

function registerAppIpc() {

// ─── IPC：磁盘占用 ────────────────────────────────────────────────────────────
ipcMain.handle('app:getDiskUsage', () => {
  const resRoot = getResRoot();
  const isMac = process.platform === 'darwin';
  const runtimePlatform = isMac ? 'mac' : 'win';

  const ckptRoot = getCheckpointsDir();

  let _manifest = {};
  try {
    const mp = app.isPackaged
      ? path.join(resRoot, 'app', 'backend', 'wrappers', 'manifest.json')
      : path.join(resRoot, 'backend', 'wrappers', 'manifest.json');
    _manifest = JSON.parse(fs.readFileSync(mp, 'utf-8'));
  } catch { /**/ }
  const _eng  = (k) => (_manifest.engines?.[k] || {});
  const _ui   = (k) => (_eng(k).ui   || {});
  const _ver  = (k) => (_eng(k).version || '');
  const _size = (k) => (_ui(k).size_display || '');
  const _fmtVer = (v) => v ? (/^\d/.test(v) ? `v${v}` : v) : '';
  const _engLabel  = (k, suffix) => `${_ui(k).label || k} ${suffix}`.trim();
  const _ckptLabel = (k, suffix) => `${_ui(k).label || k}${suffix ? ' ' + suffix : ''}`.trim();
  const measureRes = (relPath) => {
    const full = path.join(resRoot, relPath);
    return dirExists(full) ? getDirSize(full) : 0;
  };
  const measureApp = (relPath) => {
    const full = path.join(PROJECT_ROOT, relPath);
    return dirExists(full) ? getDirSize(full) : 0;
  };
  const measureCkpt = (engine) => {
    const full = path.join(ckptRoot, engine);
    return dirExists(full) ? getDirSize(full) : 0;
  };
  const measureHfCache = (...repoIds) => {
    let total = 0;
    for (const repoId of repoIds) {
      const d = path.join(ckptRoot, 'hf_cache', `models--${repoId.replace('/', '--')}`);
      if (dirExists(d)) total += getDirSize(d);
    }
    return total;
  };

  const sitePackagesBase = isMac
    ? path.join(resRoot, `runtime/python/${runtimePlatform}/lib`)
    : path.join(resRoot, `runtime/python/${runtimePlatform}/Lib/site-packages`);
  const measureSitePackages = (...pkgNames) => {
    let total = 0;
    let spDir = sitePackagesBase;
    if (isMac) {
      try {
        const pyVer = fs.readdirSync(sitePackagesBase).find(n => n.startsWith('python'));
        if (pyVer) spDir = path.join(sitePackagesBase, pyVer, 'site-packages');
      } catch { /**/ }
    }
    for (const pkg of pkgNames) {
      try {
        for (const entry of fs.readdirSync(spDir)) {
          if (entry === pkg || entry.startsWith(pkg + '-') || entry.replace(/-/g, '_') === pkg) {
            const fp = path.join(spDir, entry);
            if (fs.statSync(fp).isDirectory()) total += getDirSize(fp);
          }
        }
      } catch { /**/ }
    }
    return total;
  };

  const rows = [
    // ════════════════════════════════════════════════════════════════════════
    // setup（pnpm run runtime）— 基础 + 扩展环境统一
    // ════════════════════════════════════════════════════════════════════════
    { key: 'python',             label: `Python 运行时（${runtimePlatform}）`,       sub: path.join(resRoot, `runtime/python/${runtimePlatform}`),     size: measureRes(`runtime/python/${runtimePlatform}`) + measureRes(`runtime/bin/${runtimePlatform}`),       estimatedSizeMb: 200,  stage: 'setup',
      desc: `来源: GitHub Releases (python-build-standalone)｜包含嵌入式 Python 3.12 解释器 + fastapi/uvicorn/httpx 等后端依赖 + FFmpeg (~70 MB) + Pandoc (~25 MB)` },
    { key: 'fish_speech_engine', label: _engLabel('fish_speech', '引擎源码'),        sub: path.join(resRoot, 'runtime/engine/fish_speech'),     size: measureRes('runtime/engine/fish_speech'),                                                           estimatedSizeMb: 5,    stage: 'setup',
      desc: `来源: HuggingFace｜回退: git clone fishaudio/fish-speech tag v1.5.0｜pip: huggingface_hub, loguru, soundfile, tiktoken 等` },
    { key: 'gpt_sovits_engine',  label: _engLabel('gpt_sovits', '引擎源码'),        sub: path.join(resRoot, 'runtime/engine/gpt_sovits'),      size: measureRes('runtime/engine/gpt_sovits'),                                                            estimatedSizeMb: 10,   stage: 'setup',
      desc: `来源: HuggingFace｜回退: git clone｜pip: cn2an, pypinyin, jieba, wordsegment, g2p_en, LangSegment` },
    { key: 'seed_vc_engine',     label: _engLabel('seed_vc', '引擎源码'),           sub: path.join(resRoot, 'runtime/engine/seed_vc'),         size: measureRes('runtime/engine/seed_vc'),                                                               estimatedSizeMb: 5,    stage: 'setup',
      desc: `来源: HuggingFace｜回退: git clone commit 51383efd｜pip: huggingface_hub, setuptools, wheel` },
    { key: 'flux_pip',           label: _engLabel('flux', 'pip 依赖'),              sub: '嵌入式 Python site-packages',                        size: measureSitePackages('gguf'),                                                                        estimatedSizeMb: 20,   stage: 'setup',
      desc: `来源: PyPI｜安装包: gguf, diffusers>=0.32, accelerate, sentencepiece, protobuf` },
    { key: 'got_ocr_pip',        label: _engLabel('got_ocr', 'pip 依赖'),           sub: '嵌入式 Python site-packages',                        size: measureSitePackages('verovio', 'pymupdf', 'fitz'),                                                  estimatedSizeMb: 15,   stage: 'setup',
      desc: `来源: PyPI｜安装包: transformers>=4.48, tiktoken, verovio, pymupdf` },
    { key: 'liveportrait_engine', label: _engLabel('liveportrait', '引擎 + pip'),   sub: path.join(resRoot, 'runtime/engine/liveportrait'),     size: measureRes('runtime/engine/liveportrait') + measureSitePackages('onnxruntime', 'pykalman'),          estimatedSizeMb: 50,   stage: 'setup',
      desc: `来源: HuggingFace｜回退: git clone｜pip: imageio, av, omegaconf, onnxruntime, scikit-image, pykalman` },
    { key: 'sd_pip',             label: _engLabel('sd', 'pip 依赖'),                sub: '嵌入式 Python site-packages',                        size: measureSitePackages('diffusers', 'accelerate', 'safetensors'),                                       estimatedSizeMb: 10,   stage: 'setup',
      desc: `来源: PyPI｜安装包: diffusers>=0.21, accelerate, safetensors` },
    { key: 'wan_pip',            label: _engLabel('wan', 'pip 依赖'),               sub: '嵌入式 Python site-packages',                        size: measureSitePackages('imageio', 'imageio_ffmpeg'),                                                   estimatedSizeMb: 5,    stage: 'setup',
      desc: `来源: PyPI｜安装包: diffusers>=0.30, accelerate, imageio, imageio-ffmpeg（部分与 sd/flux 共享）` },

    // ════════════════════════════════════════════════════════════════════════
    // ml_base（pnpm run ml）
    // ════════════════════════════════════════════════════════════════════════
    { key: 'python_packages', label: 'ML 依赖包（torch · torchaudio · transformers 等）', sub: getUserPackagesDir(), size: (() => { const d = getUserPackagesDir(); return dirExists(d) ? getDirSize(d) : 0; })(), estimatedSizeMb: 3000, stage: 'ml_base',
      desc: `来源: PyPI｜汇总 6 个基础引擎的 runtime_pip_packages 去重安装：torch, torchaudio, hydra-core, transformers, einops, librosa, scipy, soundfile, faiss-cpu, torchcrepe 等 (~20-30 包)。支持 PyPI 镜像加速` },

    // ════════════════════════════════════════════════════════════════════════
    // ml_extra（pnpm run ml:extra）
    // ════════════════════════════════════════════════════════════════════════
    { key: 'ml_extra_packages', label: 'ML 扩展包（RAG · Agent · LoRA）', sub: getUserPackagesDir() + '（与 ml_base 共享目录）', size: 0, estimatedSizeMb: 800, stage: 'ml_extra',
      desc: `来源: PyPI｜RAG 组: llama-index-core, faiss-cpu, llama-index-embeddings-ollama 等｜Agent 组: langgraph, langchain-core, duckduckgo-search｜LoRA 组: peft, trl, datasets, bitsandbytes, accelerate。支持按组单独安装` },

    // ════════════════════════════════════════════════════════════════════════
    // checkpoints_base（pnpm run checkpoints）
    // ════════════════════════════════════════════════════════════════════════
    { key: 'fish_speech_ckpt', label: _ckptLabel('fish_speech', '模型权重'), sub: path.join(ckptRoot, 'fish_speech'), size: measureCkpt('fish_speech'), estimatedSizeMb: 1000, stage: 'checkpoints_base',
      desc: `来源: HuggingFace (fishaudio/fish-speech-1.5)｜文件: model.pth (~500 MB), firefly-gan-vq-fsq 声码器 (~500 MB), config.json, tokenizer.tiktoken 等｜固定 commit SHA` },
    { key: 'gpt_sovits_ckpt',  label: _ckptLabel('gpt_sovits', '模型'),    sub: path.join(ckptRoot, 'gpt_sovits'),  size: measureCkpt('gpt_sovits'),  estimatedSizeMb: 3100, stage: 'checkpoints_base',
      desc: `来源: HuggingFace｜文件: chinese-hubert-base/ (~380 MB), chinese-roberta-wwm-ext-large/ (~1.3 GB), gsv-v2final-pretrained/s1bert25hz.ckpt (~600 MB), s2G2333k.pth (~800 MB)` },
    { key: 'seed_vc_ckpt',     label: _ckptLabel('seed_vc', '模型权重'),    sub: path.join(ckptRoot, 'seed_vc'),     size: measureCkpt('seed_vc'),     estimatedSizeMb: 200,  stage: 'checkpoints_base',
      desc: `来源: HuggingFace (Plachta/Seed-VC)｜文件: DiT_seed_v2_uvit_whisper_small_wavenet_bigvgan_pruned.pth (~200 MB) + config yml` },
    ...(() => {
      const found = findRvcBaseModelDirs();
      return [{ key: 'rvc_ckpt', label: _ckptLabel('rvc', '预训练模型'), sub: found[0] || path.join(ckptRoot, 'rvc'), size: found.reduce((s, p) => s + getDirSize(p), 0) + measureCkpt('rvc'), estimatedSizeMb: 760, stage: 'checkpoints_base',
        desc: `来源: HuggingFace (lj1995/VoiceConversionWebUI)｜文件: hubert_base.pt (~360 MB), pretrained_v2/f0G40k.pth (~400 MB)｜macOS arm64 自动跳过 FAISS index` }];
    })(),
    { key: 'faster_whisper_ckpt', label: _ckptLabel('faster_whisper', '模型'), sub: path.join(ckptRoot, 'faster_whisper'), size: measureCkpt('faster_whisper'), estimatedSizeMb: 1500, stage: 'checkpoints_base',
      desc: `来源: HuggingFace (Systran/faster-whisper-*)｜预下载 large-v3 + base 模型｜CTranslate2 格式，推理速度快于原版 Whisper` },
    { key: 'facefusion_ckpt', label: _ckptLabel('facefusion', 'ONNX 模型'), sub: path.join(resRoot, 'runtime', 'engine', 'facefusion'), size: measureRes(path.join('runtime', 'engine', 'facefusion')), estimatedSizeMb: 540, stage: 'checkpoints_base',
      desc: `来源: HuggingFace｜文件: retinaface_10g.onnx (~16 MB), arcface_w600k_r50.onnx (~166 MB), 2dfan4.onnx (~93 MB), inswapper_128_fp16.onnx (~265 MB)` },
    { key: 'seed_vc_hf_root', label: 'Seed-VC 附属模型（bigvgan · whisper · rmvpe · campplus）', sub: ckptRoot, size: (() => { let t = 0; for (const n of ['models--lj1995--VoiceConversionWebUI', 'models--funasr--campplus']) { const d = path.join(ckptRoot, n); if (dirExists(d)) t += getDirSize(d); } t += measureHfCache('nvidia/bigvgan_v2_22khz_80band_256x', 'openai/whisper-small'); return t; })(), estimatedSizeMb: 940, stage: 'checkpoints_base',
      desc: `来源: HuggingFace｜nvidia/bigvgan_v2_22khz_80band_256x 声码器 (~450 MB), openai/whisper-small 语义编码器 (~265 MB), funasr/campplus 说话人特征 (~25 MB), lj1995/VoiceConversionWebUI rmvpe F0 提取 (~200 MB)｜全部为 Seed-VC 离线推理必须，不可单独删除` },
    { key: 'voices', label: '内置音色（hutao-jp · Ayayaka · tsukuyomi 等）', sub: path.join(PROJECT_ROOT, 'user_data', 'rvc'), size: measureApp('user_data/rvc'), estimatedSizeMb: 325, stage: 'checkpoints_base',
      desc: `来源: HuggingFace｜RVC 格式音色: hutao-jp (.pth ~53 MB + .index ~65 MB), Ayayaka (.pth ~53 MB + .index ~101 MB), tsukuyomi (.pth ~53 MB)` },

    // ════════════════════════════════════════════════════════════════════════
    // checkpoints_extra（pnpm run checkpoints:extra）
    // ════════════════════════════════════════════════════════════════════════
    { key: 'cosyvoice_ckpt',    label: _ckptLabel('cosyvoice', '模型'),    sub: path.join(ckptRoot, 'cosyvoice'),                                      size: measureCkpt('cosyvoice'),                                             estimatedSizeMb: 3000, stage: 'checkpoints_extra',
      desc: `来源: HuggingFace｜CosyVoice 2 零样本语音克隆 TTS 模型权重（阿里通义实验室）` },
    { key: 'sd_ckpt',          label: _ckptLabel('sd', '模型'),          sub: path.join(ckptRoot, 'sd'),                                             size: (() => measureCkpt('sd') + measureHfCache('stabilityai/sd-turbo'))(),  estimatedSizeMb: 2300,  stage: 'checkpoints_extra',
      desc: `来源: HuggingFace (stabilityai/sd-turbo)｜SD-Turbo 完整模型｜无需 HF token` },
    { key: 'flux_ckpt',        label: _ckptLabel('flux', '模型'),        sub: path.join(ckptRoot, 'flux'),                                           size: (() => measureCkpt('flux') + measureHfCache('black-forest-labs/FLUX.1-schnell', 'city96/FLUX.1-schnell-gguf'))(), estimatedSizeMb: 16500, stage: 'checkpoints_extra',
      desc: `来源: HuggingFace｜GGUF Q4_K_S transformer (~6.5 GB) + FLUX.1-schnell base (T5-XXL + CLIP-L + VAE, ~10 GB)｜base 模型需 HF token` },
    { key: 'wan_ckpt',         label: _ckptLabel('wan', '模型'),         sub: path.join(ckptRoot, 'hf_cache', 'models--Wan-AI--Wan2.1-T2V-1.3B-Diffusers'), size: measureHfCache('Wan-AI/Wan2.1-T2V-1.3B-Diffusers'),              estimatedSizeMb: 15600, stage: 'checkpoints_extra',
      desc: `来源: HuggingFace (Wan-AI/Wan2.1-T2V-1.3B-Diffusers)｜文生视频模型：transformer ~5.3 GB + umt5-XXL 文本编码器 ~9.8 GB + VAE ~484 MB` },
    { key: 'got_ocr_ckpt',    label: _ckptLabel('got_ocr', '模型'),      sub: path.join(ckptRoot, 'hf_cache', 'models--stepfun-ai--GOT-OCR-2.0-hf'),  size: measureHfCache('stepfun-ai/GOT-OCR-2.0-hf'),                          estimatedSizeMb: 1500,  stage: 'checkpoints_extra',
      desc: `来源: HuggingFace (stepfun-ai/GOT-OCR-2.0-hf)｜通用 OCR 模型，支持中英日韩等多语种文档识别` },
    { key: 'liveportrait_ckpt', label: _ckptLabel('liveportrait', '模型'), sub: path.join(ckptRoot, 'hf_cache', 'models--KwaiVGI--LivePortrait'),      size: measureHfCache('KwaiVGI/LivePortrait'),                               estimatedSizeMb: 1800,  stage: 'checkpoints_extra',
      desc: `来源: HuggingFace (KwaiVGI/LivePortrait)｜面部动画驱动模型，用于口型同步和表情迁移` },
    { key: 'whisper_ckpt',     label: _ckptLabel('whisper', '模型'),      sub: path.join(ckptRoot, 'whisper'),                                        size: measureCkpt('whisper'),                                               estimatedSizeMb: 1500,  stage: 'checkpoints_extra',
      desc: `来源: HuggingFace (openai/whisper-large-v3)｜原版 Whisper 模型（当前默认引擎为 Faster Whisper，此为备选）` },

    // ════════════════════════════════════════════════════════════════════════
    // 缓存
    // ════════════════════════════════════════════════════════════════════════
    {
      key: 'cache',
      label: '缓存',
      sub: CACHE_DIR,
      size: (() => dirExists(CACHE_DIR) ? getDirSize(CACHE_DIR) : 0)(),
      clearable: true,
    },
    {
      key: 'logs',
      label: '日志文件',
      sub: LOGS_DIR,
      size: (() => dirExists(LOGS_DIR) ? getDirSize(LOGS_DIR) : 0)(),
      clearable: true,
    },
  ];

  return rows;
});

// ─── 统一清除逻辑 ───────────────────────────────────────────────────────────
function _clearAllUserData() {
  const clearable = CLEARABLE_DIRS();
  const errors = [];
  const rmDir = (d) => {
    try {
      if (dirExists(d)) fs.rmSync(d, { recursive: true, force: true });
    } catch (err) { errors.push(`${d}: ${err.message}`); }
  };

  const keysToDelete = Object.values(STAGE_CLEAR_KEYS).flat();
  for (const key of keysToDelete) {
    if (key === 'seed_vc_hf_root') {
      const ckptRoot = getCheckpointsDir();
      for (const name of ['models--lj1995--VoiceConversionWebUI', 'models--funasr--campplus']) {
        rmDir(path.join(ckptRoot, name));
      }
    } else {
      const dir = clearable[key];
      if (dir) rmDir(dir);
    }
  }

  rmDir(getCheckpointsDir());

  return errors.length > 0 ? { ok: false, error: errors.join('\n') } : { ok: true };
}

ipcMain.handle('app:clearUserData', () => {
  return _clearAllUserData();
});

ipcMain.handle('app:clearAndOpenSetup', async () => {
  const result = _clearAllUserData();
  if (!result.ok) return result;

  openDualSetupConfigWindow();
  return { ok: true };
});

// ─── IPC：删除模型 ────────────────────────────────────────────────────────────
ipcMain.handle('app:deleteModels', (_event, engine) => {
  const ckptRoot = getCheckpointsDir();
  const resRoot = getResRoot();
  const errors = [];

  if (engine === 'facefusion') {
    const engineDir = path.join(resRoot, 'runtime', 'engine', 'facefusion');
    if (dirExists(engineDir)) {
      try {
        fs.rmSync(engineDir, { recursive: true, force: true });
      } catch (err) {
        errors.push(`${engineDir}: ${err.message}`);
      }
    }
    return errors.length > 0 ? { ok: false, error: errors.join('\n') } : { ok: true };
  }

  const ckptDir = path.join(ckptRoot, engine);
  if (dirExists(ckptDir)) {
    try {
      fs.rmSync(ckptDir, { recursive: true, force: true });
    } catch (err) {
      errors.push(`${ckptDir}: ${err.message}`);
    }
  }

  if (engine === 'rvc') {
    for (const bmDir of findRvcBaseModelDirs()) {
      try {
        if (fs.existsSync(bmDir)) {
          fs.rmSync(bmDir, { recursive: true, force: true });
        }
      } catch (err) {
        errors.push(`${bmDir}: ${err.message}`);
      }
    }
  }

  const extras = ENGINE_EXTRA_PATHS[engine] || [];
  for (const rel of extras) {
    const fullPath = path.join(ckptRoot, rel);
    try {
      if (fs.existsSync(fullPath)) {
        fs.rmSync(fullPath, { recursive: true, force: true });
      }
    } catch (err) {
      errors.push(`${fullPath}: ${err.message}`);
    }
  }

  return errors.length > 0 ? { ok: false, error: errors.join('\n') } : { ok: true };
});

// ─── IPC：清空可清除目录 ──────────────────────────────────────────────────────
ipcMain.handle('app:clearDiskRow', (_event, key) => {
  const dirs = CLEARABLE_DIRS();
  if (!(key in dirs)) return { ok: false, error: `未知 key：${key}` };

  const errors = [];
  const rmDir = (d) => {
    try {
      if (dirExists(d)) fs.rmSync(d, { recursive: true, force: true });
    } catch (err) { errors.push(`${d}: ${err.message}`); }
  };

  if (key === 'seed_vc_hf_root') {
    const ckptRoot = getCheckpointsDir();
    for (const name of ['models--lj1995--VoiceConversionWebUI', 'models--funasr--campplus']) {
      rmDir(path.join(ckptRoot, name));
    }
    for (const name of ['models--nvidia--bigvgan_v2_22khz_80band_256x', 'models--openai--whisper-small']) {
      rmDir(path.join(ckptRoot, 'hf_cache', name));
    }
    return errors.length > 0 ? { ok: false, error: errors.join('\n') } : { ok: true };
  }

  const targetDir = dirs[key];
  if (!targetDir) return { ok: false, error: `未知 key：${key}` };
  try {
    if (dirExists(targetDir)) {
      for (const entry of fs.readdirSync(targetDir)) {
        fs.rmSync(path.join(targetDir, entry), { recursive: true, force: true });
      }
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

// ─── IPC：按安装阶段重新安装 ─────────────────────────────────────────────────
ipcMain.handle('app:reinstallStage', (_event, stage) => {
  const keys = STAGE_CLEAR_KEYS[stage];
  const scripts = STAGE_SCRIPTS[stage];
  if (!keys || !scripts) return { ok: false, error: `未知阶段：${stage}` };

  const dirs = CLEARABLE_DIRS();
  for (const key of keys) {
    const d = dirs[key];
    if (d && dirExists(d)) {
      try { fs.rmSync(d, { recursive: true, force: true }); } catch { /**/ }
    }
  }

  const resRoot = getResRoot();
  const isMac = process.platform === 'darwin';

  const userPkgDir = getUserPackagesDir();
  const ckptDir = getCheckpointsDir();
  fs.mkdirSync(userPkgDir, { recursive: true });
  fs.mkdirSync(ckptDir, { recursive: true });

  const env = {
    ...process.env,
    RESOURCES_ROOT: resRoot,
    CHECKPOINTS_DIR: ckptDir,
    PYTHONPATH: [path.join(PROJECT_ROOT, 'backend'), userPkgDir].join(path.delimiter),
    PYTHONIOENCODING: 'utf-8',
  };

  const setupLog = createAppendLogger(downloadLogFilename());
  setupLog.write('INFO', `reinstallStage stage=${stage} scripts=${scripts.map(s => s.script).join(', ')}`);

  function sendProgress(msg) {
    try { setupLog.write('PROGRESS', JSON.stringify(msg)); } catch { /**/ }
    if (state.mainWindow && !state.mainWindow.isDestroyed())
      state.mainWindow.webContents.send('engine:download:progress', msg);
  }

  async function runScripts() {
    for (const info of scripts) {
      const scriptPath = path.join(resRoot, info.script);
      let pyPath;
      if (info.useSystemPython) {
        pyPath = isMac ? 'python3' : 'python';
      } else {
        pyPath = isMac
          ? path.join(resRoot, 'runtime', 'python', 'mac', 'bin', 'python3')
          : path.join(resRoot, 'runtime', 'python', 'win', 'python.exe');
      }

      sendProgress({ type: 'log', message: `▶ 运行脚本: ${info.script}` });
      const code = await new Promise((resolve) => {
        const child = spawn(pyPath, [scriptPath], { env, shell: false });
        child.stdout.on('data', (chunk) => {
          for (const line of chunk.toString().split('\n')) {
            if (!line.trim()) continue;
            try { sendProgress(JSON.parse(line)); } catch { sendProgress({ type: 'log', message: line.trimEnd() }); }
          }
        });
        child.stderr.on('data', (data) => {
          for (const line of data.toString().split('\n')) {
            if (line.trim()) setupLog.write('STDERR', line.trimEnd());
          }
        });
        child.on('close', (c) => resolve(c));
        child.on('error', (err) => {
          setupLog.write('ERROR', `reinstallStage ${stage} ${info.script} error: ${err.message}`);
          resolve(-1);
        });
      });

      setupLog.write('INFO', `reinstallStage ${stage} ${info.script} exited code=${code}`);
      if (code !== 0) return { ok: false, exitCode: code };
    }
    return { ok: true };
  }

  return runScripts();
});

// ─── IPC：仅清除阶段目录（不重装）──────────────────────────────────────────
ipcMain.handle('app:clearStage', (_event, stage) => {
  const keys = STAGE_CLEAR_KEYS[stage];
  if (!keys) return { ok: false, error: `未知阶段：${stage}` };

  const dirs = CLEARABLE_DIRS();
  const errors = [];
  for (const key of keys) {
    const d = dirs[key];
    if (d && dirExists(d)) {
      try { fs.rmSync(d, { recursive: true, force: true }); } catch (err) { errors.push(`${d}: ${err.message}`); }
    }
  }
  return errors.length > 0 ? { ok: false, error: errors.join('\n') } : { ok: true };
});

// ─── IPC：清除阶段数据后打开引导页 ──────────────────────────────────────────
ipcMain.handle('app:clearStageAndOpenSetup', async (_event, stage) => {
  const keys = STAGE_CLEAR_KEYS[stage];
  if (!keys) return { ok: false, error: `未知阶段：${stage}` };

  const dirs = CLEARABLE_DIRS();
  for (const key of keys) {
    const d = dirs[key];
    if (d && dirExists(d)) {
      try { fs.rmSync(d, { recursive: true, force: true }); } catch { /**/ }
    }
  }

  let missingEngines = [];
  try {
    const runtimeInfo = await fetchRuntimeInfo(state.backendBaseUrl);
    missingEngines = Object.entries(runtimeInfo.engines || {})
      .filter(([, v]) => !v.ready)
      .map(([name, v]) => ({ engine: name, files: v.missing_checkpoints || [] }));
  } catch {}

  openSetupGuideWindow(missingEngines, stage);
  return { ok: true };
});

// ─── IPC：下载单个引擎 checkpoint ────────────────────────────────────────────
ipcMain.handle('app:downloadEngine', (_event, engine) => {
  const isMac = process.platform === 'darwin';
  const resRoot = getResRoot();
  const pyPath = isMac
    ? path.join(resRoot, 'runtime', 'python', 'mac', 'bin', 'python3')
    : path.join(resRoot, 'runtime', 'python', 'win', 'python.exe');
  const ckptDir = getCheckpointsDir();
  const userPkgDir = getUserPackagesDir();
  fs.mkdirSync(ckptDir, { recursive: true });
  fs.mkdirSync(userPkgDir, { recursive: true });

  let hfEndpoint = '', pypiMirror = '';
  try {
    const cfgPath = path.join(app.getPath('userData'), 'app-config.json');
    const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf-8'));
    hfEndpoint = (cfg.hfEndpoint || '').trim();
    pypiMirror = (cfg.pypiMirror || '').trim();
  } catch { /**/ }

  const env = {
    ...process.env,
    RESOURCES_ROOT: resRoot,
    CHECKPOINTS_DIR: ckptDir,
    PYTHONPATH: [path.join(PROJECT_ROOT, 'backend'), userPkgDir].join(path.delimiter),
    PYTHONIOENCODING: 'utf-8',
    ...(hfEndpoint ? { HF_ENDPOINT: hfEndpoint } : {}),
  };

  const setupLog = createAppendLogger(downloadLogFilename());
  setupLog.write('INFO', '═══════════════════════════════════════════════════════════');
  setupLog.write('INFO', `downloadEngine engine=${engine} pid=${process.pid}`);
  setupLog.write('INFO', `checkpoints_dir=${ckptDir}`);
  setupLog.write('INFO', `python_packages_dir=${userPkgDir}`);
  setupLog.write('INFO', `python=${pyPath}`);
  setupLog.write('INFO', `hf_endpoint=${hfEndpoint || '(empty)'}`);
  setupLog.write('INFO', `pypi_mirror=${pypiMirror || '(empty)'}`);

  function sendProgress(msg) {
    try { setupLog.write('PROGRESS', JSON.stringify(msg)); } catch { /**/ }
    if (state.mainWindow && !state.mainWindow.isDestroyed())
      state.mainWindow.webContents.send('engine:download:progress', msg);
  }

  function spawnScript(stageName, scriptPath, scriptArgs) {
    return new Promise((resolve) => {
      setupLog.write('INFO', `[${stageName}] spawn ${pyPath} ${[scriptPath, ...scriptArgs].join(' ')}`);
      const child = spawn(pyPath, [scriptPath, ...scriptArgs], { env, shell: false });
      child.stdout.on('data', (chunk) => {
        for (const line of chunk.toString().split('\n')) {
          if (!line.trim()) continue;
          try {
            sendProgress(JSON.parse(line));
          } catch {
            setupLog.write('STDOUT', `[${stageName}] ${line}`);
            sendProgress({ type: 'log', message: line.trimEnd() });
          }
        }
      });
      child.stderr.on('data', (data) => {
        for (const line of data.toString().split('\n')) {
          if (line.trim()) {
            setupLog.write('STDERR', `[${stageName}] ${line}`);
          }
        }
      });
      child.on('close', (code) => {
        setupLog.write('INFO', `[${stageName}] close code=${String(code)}`);
        resolve({ ok: code === 0, exitCode: code });
      });
      child.on('error', (err) => {
        setupLog.write('ERROR', `[${stageName}] spawn error: ${err.message}`);
        sendProgress({ type: 'log', message: `[${stageName}] 启动失败: ${err.message}` });
        resolve({ ok: false, error: err.message });
      });
    });
  }

  sendProgress({ type: 'log', message: `详细日志：${setupLog.path}` });

  const isExtraEngine = EXTRA_CHECKPOINT_ENGINES.has(engine);

  return (async () => {
    const mlGroup = ML_INSTALL_GROUPS[engine];
    if (mlGroup) {
      const groupLabel = { rag: 'RAG 知识库', agent: 'Agent 智能体', lora: 'LoRA 微调' }[mlGroup];
      sendProgress({ type: 'log', message: `▶ [${engine}] 安装 ${groupLabel} 依赖...` });
      const mlScript = path.join(PROJECT_ROOT, 'scripts', 'ml_extra.py');
      const mlArgs = ['--group', mlGroup, '--target', userPkgDir, '--json-progress'];
      if (pypiMirror) mlArgs.push('--pypi-mirror', pypiMirror);
      const mlResult = await spawnScript(`engine-ml-${engine}`, mlScript, mlArgs);
      if (!mlResult.ok) {
        sendProgress({ type: 'all_done', ok: false });
        setupLog.close();
        return mlResult;
      }
    }

    const setupScript = path.join(PROJECT_ROOT, 'scripts', 'runtime.py');
    sendProgress({ type: 'log', message: `▶ [${engine}] 安装引擎依赖 + 源码...` });
    const setupResult = await spawnScript(`engine-setup-${engine}`, setupScript, ['--engine', engine]);
    if (!setupResult.ok) {
      sendProgress({ type: 'all_done', ok: false });
      setupLog.close();
      return setupResult;
    }

    sendProgress({ type: 'log', message: `▶ [${engine}] 下载模型权重...` });
    const dlScript = path.join(PROJECT_ROOT, 'scripts', isExtraEngine ? 'checkpoints_extra.py' : 'checkpoints_base.py');
    const dlArgs = ['--engine', engine, '--json-progress'];
    if (hfEndpoint) dlArgs.push('--hf-endpoint', hfEndpoint);
    if (pypiMirror) dlArgs.push('--pypi-mirror', pypiMirror);
    const dlResult = await spawnScript(`engine-ckpt-${engine}`, dlScript, dlArgs);
    setupLog.close();
    return dlResult;
  })();
});

// ─── IPC：读取日志内容 ────────────────────────────────────────────────────────
ipcMain.handle('app:readLogFile', (_event, filename) => {
  const logPath = path.join(LOGS_DIR, filename);
  if (!fs.existsSync(logPath)) return { ok: false, content: `（${filename} 暂不存在）` };
  try {
    return { ok: true, content: fs.readFileSync(logPath, 'utf-8') };
  } catch (e) {
    return { ok: false, content: `读取失败：${e.message}` };
  }
});

// ─── IPC：打开日志目录 ────────────────────────────────────────────────────────
ipcMain.handle('app:openLogsDir', () => {
  fs.mkdirSync(LOGS_DIR, { recursive: true });
  shell.openPath(LOGS_DIR);
});

ipcMain.handle('app:openDir', (_event, dirPath) => {
  if (dirPath) shell.openPath(dirPath);
});

ipcMain.handle('app:saveRecording', async (_event, filename, buffer) => {
  const dir = path.join(app.getPath('userData'), 'recordings');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, filename), Buffer.from(buffer));
  return dir;
});

} // end registerAppIpc

module.exports = { registerAppIpc };
