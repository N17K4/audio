const path = require('path');
const { getCheckpointsDir, getUserPackagesDir, getResRoot, LOGS_DIR, CACHE_DIR, PROJECT_ROOT } = require('./paths');

const ENGINE_EXTRA_PATHS = {
  seed_vc: [
    'rmvpe.pt',
    'models--funasr--campplus',
    'models--lj1995--VoiceConversionWebUI',
  ],
  wan: [
    path.join('hf_cache', 'models--Wan-AI--Wan2.1-T2V-1.3B-Diffusers'),
  ],
  got_ocr: [
    path.join('hf_cache', 'models--stepfun-ai--GOT-OCR-2.0-hf'),
  ],
  sd: [
    path.join('hf_cache', 'models--stabilityai--sd-turbo'),
  ],
  flux: [
    path.join('hf_cache', 'models--black-forest-labs--FLUX.1-schnell'),
    path.join('hf_cache', 'models--city96--FLUX.1-schnell-gguf'),
  ],
  liveportrait: [
    path.join('hf_cache', 'models--KwaiVGI--LivePortrait'),
  ],
};

const STAGE_CLEAR_KEYS = {
  ml_base:           ['python_packages'],
  ml_extra:          ['python_packages'],
  checkpoints_base:  ['fish_speech_ckpt', 'gpt_sovits_ckpt', 'seed_vc_ckpt', 'rvc_ckpt', 'faster_whisper_ckpt', 'facefusion_ckpt', 'seed_vc_hf_root', 'voices'],
  checkpoints_extra: ['cosyvoice_ckpt', 'sd_ckpt', 'flux_ckpt', 'wan_ckpt', 'got_ocr_ckpt', 'liveportrait_ckpt', 'whisper_ckpt'],
};

const STAGE_SCRIPTS = {
  setup:             [
    { script: 'scripts/runtime.py', useSystemPython: true },
  ],
  ml_base:           [{ script: 'scripts/ml_base.py',           useSystemPython: false }],
  ml_extra:          [{ script: 'scripts/ml_extra.py',          useSystemPython: false }],
  checkpoints_base:  [{ script: 'scripts/checkpoints_base.py',  useSystemPython: false }],
  checkpoints_extra: [{ script: 'scripts/checkpoints_extra.py', useSystemPython: false }],
};

const ALL_ENGINES = new Set([
  'fish_speech', 'gpt_sovits', 'seed_vc', 'rvc', 'faster_whisper', 'facefusion', 'voices',
  'agent_engine', 'finetune_engine', 'flux', 'got_ocr', 'liveportrait', 'rag_engine', 'sd', 'wan', 'whisper',
]);

const ML_INSTALL_GROUPS = {
  'rag_engine': 'rag',
  'agent_engine': 'agent',
  'finetune_engine': 'lora',
};

function CLEARABLE_DIRS() {
  const ckptRoot = getCheckpointsDir();
  const resRoot = getResRoot();
  const isMac = process.platform === 'darwin';
  const runtimePlatform = isMac ? 'mac' : 'win';
  return {
    python:           path.join(resRoot, `runtime/python/${runtimePlatform}`),
    python_packages:  getUserPackagesDir(),
    fish_speech_engine:  path.join(resRoot, 'runtime/engine/fish_speech'),
    seed_vc_engine:      path.join(resRoot, 'runtime/engine/seed_vc'),
    gpt_sovits_engine:   path.join(resRoot, 'runtime/engine/gpt_sovits'),
    liveportrait_engine: path.join(resRoot, 'runtime/engine/liveportrait'),
    seed_vc_hf_root: null,
    fish_speech_ckpt:  path.join(ckptRoot, 'fish_speech'),
    gpt_sovits_ckpt:   path.join(ckptRoot, 'gpt_sovits'),
    seed_vc_ckpt:      path.join(ckptRoot, 'seed_vc'),
    rvc_ckpt:          path.join(ckptRoot, 'rvc'),
    faster_whisper_ckpt: path.join(ckptRoot, 'faster_whisper'),
    facefusion_ckpt:   path.join(resRoot, 'runtime', 'engine', 'facefusion'),
    cosyvoice_ckpt:    path.join(ckptRoot, 'cosyvoice'),
    sd_ckpt:           path.join(ckptRoot, 'sd'),
    flux_ckpt:         path.join(ckptRoot, 'flux'),
    wan_ckpt:          path.join(ckptRoot, 'hf_cache', 'models--Wan-AI--Wan2.1-T2V-1.3B-Diffusers'),
    got_ocr_ckpt:      path.join(ckptRoot, 'hf_cache', 'models--stepfun-ai--GOT-OCR-2.0-hf'),
    liveportrait_ckpt: path.join(ckptRoot, 'hf_cache', 'models--KwaiVGI--LivePortrait'),
    whisper_ckpt:      path.join(ckptRoot, 'whisper'),
    voices:           path.join(PROJECT_ROOT, 'user_data', 'rvc', 'user'),
    cache:            CACHE_DIR,
    logs:             LOGS_DIR,
  };
}

module.exports = {
  ENGINE_EXTRA_PATHS,
  STAGE_CLEAR_KEYS,
  STAGE_SCRIPTS,
  ALL_ENGINES,
  ML_INSTALL_GROUPS,
  CLEARABLE_DIRS,
};
