import type { TaskType, CapabilityMap } from '../types';

// ─── 常量 ──────────────────────────────────────────────────────────────────
export const TASK_LABELS: Record<TaskType, string> = {
  tts: '文本转语音',
  vc: '音色转换',
  asr: '语音转文字',
  llm: '聊天',
  voice_chat: '语音聊天',
  media: '音视频转换',
  doc:  '文档工具',
  misc: 'AI扩展',
};

export const TASK_PHASES: Record<string, string[]> = {
  tts:              ['准备请求', '合成语音中', '写入输出文件'],
  vc:               ['上传音频', '推理转换中', '写入转换结果'],
  asr:              ['上传音频', '语音识别中', '整理转录文字'],
  llm:              ['发送消息', '等待模型回复'],
  voice_chat:       ['处理中'],
  media:            ['上传文件', 'FFmpeg 转换中', '写入输出文件'],
  doc:              ['上传文件', '处理中', '写入输出文件'],
  image_gen:        ['发送请求', '图像生成中', '保存结果'],
  image_i2i:        ['上传图片', '图像处理中', '保存结果'],
  video_gen:        ['发送请求', '视频生成中', '保存结果'],
  image_understand: ['上传图片', '分析中', '返回结果'],
  translate:        ['发送请求', '翻译中', '返回结果'],
};

export const DEFAULT_CAPS: CapabilityMap = {
  tts: ['fish_speech', 'gemini', 'openai', 'elevenlabs', 'cartesia', 'dashscope', 'minimax_tts'],
  vc: ['seed_vc', 'local_rvc', 'elevenlabs'],
  asr: ['faster_whisper', 'whisper', 'gemini', 'openai', 'groq', 'deepgram', 'dashscope'],
  llm: ['gemini', 'openai', 'claude', 'groq', 'deepseek', 'mistral', 'xai', 'ollama', 'github',
        'qwen', 'doubao', 'hunyuan', 'glm', 'moonshot', 'spark', 'minimax', 'baichuan'],
  media: [],
  doc:   [],
  misc:  [],
};

export const PROVIDER_LABELS: Record<string, string> = {
  // ── 本地引擎 ──
  fish_speech:    'Fish Speech（本地）',
  seed_vc:        'Seed-VC（本地 · zero-shot，仅需参考音频，无需训练模型）',
  local_rvc:      'RVC（本地 · 需提前训练专属音色，音质精准）',
  faster_whisper: 'Faster Whisper（本地 · 推荐，速度快）',
  whisper:        'Whisper · OpenAI（本地原版）',
  ollama:         'Ollama（本地 LLM 服务）',
  comfyui:        'ComfyUI（本地服务）',
  facefusion:     'FaceFusion 3.x（本地 · 换脸专用）',
  liveportrait:   'LivePortrait（本地 · 需驱动视频提供表情动作）',
  sadtalker:      'SadTalker（本地 · 图片 + 音频驱动口型）',
  got_ocr:        'GOT-OCR 2.0（本地 · 公式 / 表格识别强）',
  wan_local:      'Wan 2.1（本地 · 无需 API Key）',
  // ── 国际云端 ──
  openai:     'OpenAI',
  gemini:     'Gemini · Google（有免费额度）',
  elevenlabs: 'ElevenLabs',
  cartesia:   'Cartesia',
  dashscope:  'DashScope · 阿里云',
  deepgram:   'Deepgram',
  groq:       'Groq（有免费额度）',
  claude:     'Claude · Anthropic',
  deepseek:   'DeepSeek（推理 / 代码强）',
  mistral:    'Mistral AI',
  xai:        'Grok · xAI',
  github:     'GitHub Models · Microsoft（有免费额度）',
  stability:  'Stability AI',
  replicate:  'Replicate',
  kling:      '可灵 · 快手',
  wan_video:  '万象视频 · 阿里云',
  pika:       'Pika',
  runway:     'RunwayML（Gen-3）',
  sora:       'Sora · OpenAI',
  azure_doc:  'Document Intelligence · Azure',
  heygen:     'HeyGen（云端）',
  did:        'D-ID（云端）',
  // ── 中国云端 ──
  qwen:        '通义千问 · 阿里云',
  doubao:      '豆包 · 字节跳动',
  hunyuan:     '混元 · 腾讯（Lite 永久免费）',
  glm:         'GLM · 智谱 AI（4-Flash 永久免费）',
  moonshot:    'Kimi · 月之暗面',
  spark:       '星火 · 科大讯飞（Lite 每天免费）',
  minimax:     'MiniMax',
  baichuan:    '百川 AI',
  minimax_tts: 'MiniMax TTS',
};

// 各服务商常用模型列表（用于 datalist 下拉提示）
// 留空时后端实际使用的默认模型，用于 placeholder 提示
export const DEFAULT_MODELS: Record<string, Record<string, string>> = {
  tts: {
    openai:      'tts-1',
    gemini:      'gemini-2.5-flash-preview-tts',
    elevenlabs:  'eleven_multilingual_v2',
    cartesia:    'sonic-2',
    dashscope:   'cosyvoice-v2',
    fish_speech: '',
    minimax_tts: 'speech-02-hd',
  },
  asr: {
    openai:          'whisper-1',
    gemini:          'gemini-2.5-flash',
    faster_whisper:  'base',
    whisper:         'base',
    groq:            'whisper-large-v3-turbo',
    deepgram:        'nova-3',
    dashscope:       'paraformer-realtime-v2',
  },
  llm: {
    openai:    'gpt-4o-mini',
    gemini:    'gemini-2.5-flash',
    claude:    'claude-opus-4-5',
    groq:      'llama-3.3-70b-versatile',
    deepseek:  'deepseek-chat',
    mistral:   'mistral-small-latest',
    xai:       'grok-3-mini',
    ollama:    'qwen2.5:14b',
    github:    'gpt-4o-mini',
    // 中国云端 API
    qwen:      'qwen-plus',
    doubao:    '',
    hunyuan:   'hunyuan-lite',
    glm:       'glm-4-flash',
    moonshot:  'moonshot-v1-8k',
    spark:     'lite',
    minimax:   'MiniMax-Text-01',
    baichuan:  'Baichuan4-Air',
  },
};

export const PROVIDER_MODELS: Record<string, Record<string, string[]>> = {
  tts: {
    openai:      ['gpt-4o-mini-tts', 'tts-1', 'tts-1-hd'],
    gemini:      ['gemini-2.5-flash-preview-tts', 'gemini-2.0-flash-live-001'],
    elevenlabs:  ['eleven_multilingual_v2', 'eleven_flash_v2_5', 'eleven_turbo_v2_5'],
    cartesia:    ['sonic-2', 'sonic-english'],
    dashscope:   ['cosyvoice-v2', 'cosyvoice-v1'],
    fish_speech: [],
    minimax_tts: ['speech-02-hd', 'speech-02-turbo', 'speech-01-hd'],
  },
  asr: {
    openai:          ['gpt-4o-mini-transcribe', 'gpt-4o-transcribe', 'whisper-1'],
    gemini:          ['gemini-2.5-flash', 'gemini-2.0-flash'],
    faster_whisper:  ['tiny', 'base', 'small', 'medium', 'large-v2', 'large-v3', 'large-v3-turbo', 'distil-large-v3'],
    whisper:         ['base', 'small', 'medium', 'large', 'large-v3', 'turbo'],
    groq:            ['whisper-large-v3-turbo', 'whisper-large-v3', 'distil-whisper-large-v3-en'],
    deepgram:        ['nova-3', 'nova-2', 'enhanced', 'base'],
    dashscope:       ['paraformer-realtime-v2', 'paraformer-v2', 'paraformer-8k-v1'],
  },
  llm: {
    openai:   ['gpt-4o-mini', 'gpt-4o', 'gpt-4.1-mini', 'gpt-4.1'],
    gemini:   ['gemini-2.5-flash', 'gemini-2.5-pro', 'gemini-2.0-flash'],
    claude:   ['claude-opus-4-5', 'claude-sonnet-4-5', 'claude-haiku-4-5-20251001', 'claude-3-5-sonnet-20241022'],
    groq:     ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant', 'mixtral-8x7b-32768', 'gemma2-9b-it'],
    deepseek: ['deepseek-chat', 'deepseek-reasoner'],
    mistral:  ['mistral-small-latest', 'mistral-large-latest', 'codestral-latest'],
    xai:      ['grok-3-mini', 'grok-3', 'grok-2-1212'],
    ollama:   ['qwen2.5-coder:14b', 'qwen2.5-coder:7b', 'qwen2.5:14b', 'qwen3:14b', 'llama3.3', 'mistral'],
    github:   ['gpt-4o-mini', 'gpt-4o', 'meta-llama-3.3-70b-instruct', 'deepseek-r1'],
    // 中国云端 API
    qwen:     ['qwen-plus', 'qwen-turbo', 'qwen-max', 'qwen-long', 'qwen2.5-72b-instruct'],
    doubao:   [],   // 用户需自填 ep-xxx
    hunyuan:  ['hunyuan-lite', 'hunyuan-standard', 'hunyuan-pro', 'hunyuan-turbo'],
    glm:      ['glm-4-flash', 'glm-4-flashx', 'glm-4-air', 'glm-4-plus'],
    moonshot: ['moonshot-v1-8k', 'moonshot-v1-32k', 'moonshot-v1-128k'],
    spark:    ['lite', 'pro', 'pro-128k', 'max', 'max-32k'],
    minimax:  ['MiniMax-Text-01', 'abab6.5s-chat', 'abab5.5-chat'],
    baichuan: ['Baichuan4-Air', 'Baichuan4-Turbo', 'Baichuan3-Turbo'],
  },
};

// 图像生成 providers
export const IMAGE_GEN_PROVIDERS = ['openai', 'gemini', 'stability', 'dashscope'];
export const IMAGE_GEN_PROVIDER_LABELS: Record<string, string> = {
  openai:    'DALL-E · OpenAI',
  gemini:    'Imagen · Google（有免费额度）',
  stability: 'Stable Diffusion · Stability AI',
  dashscope: '万象 · 阿里云（DashScope）',
};
export const IMAGE_GEN_MODELS: Record<string, string[]> = {
  openai:    ['dall-e-3', 'dall-e-2'],
  gemini:    ['imagen-3.0-generate-002', 'imagen-3.0-fast-generate-001'],
  stability: ['sd3-large-turbo', 'sd3-large', 'sd3-medium', 'core', 'ultra'],
  dashscope: ['wanx2.1-t2i-turbo', 'wanx2.1-t2i-plus', 'wanx-v1'],
};
export const IMAGE_GEN_SIZES: Record<string, string[]> = {
  openai:    ['1024x1024', '1024x1792', '1792x1024'],
  gemini:    ['1:1', '16:9', '9:16', '4:3', '3:4'],
  stability: ['1:1', '16:9', '9:16', '4:3', '3:4', '21:9'],
  dashscope: ['1024*1024', '720*1280', '1280*720'],
};

// 图像理解 providers
export const IMAGE_UNDERSTAND_PROVIDERS = ['gemini', 'openai', 'claude', 'ollama'];
export const IMAGE_UNDERSTAND_PROVIDER_LABELS: Record<string, string> = {
  openai:  'GPT-4o Vision · OpenAI',
  gemini:  'Gemini Vision · Google（有免费额度）',
  claude:  'Claude Vision · Anthropic',
  ollama:  'Ollama Vision（本地 · LLaVA 等）',
};
export const IMAGE_UNDERSTAND_MODELS: Record<string, string[]> = {
  openai:  ['gpt-4o-mini', 'gpt-4o', 'gpt-4.1-mini', 'gpt-4.1'],
  gemini:  ['gemini-2.5-flash', 'gemini-2.5-pro', 'gemini-2.0-flash'],
  claude:  ['claude-opus-4-5', 'claude-sonnet-4-5', 'claude-haiku-4-5-20251001'],
  ollama:  ['llava', 'llava-llama3', 'llava-phi3', 'minicpm-v', 'moondream'],
};

// 翻译 providers（复用 LLM）
export const TRANSLATE_PROVIDERS = ['gemini', 'openai', 'claude', 'deepseek', 'groq', 'mistral', 'xai', 'ollama', 'github',
  'qwen', 'doubao', 'hunyuan', 'glm', 'moonshot', 'spark', 'minimax', 'baichuan'];
export const TRANSLATE_LANGUAGES = ['中文', '英文', '日文', '韩文', '法文', '德文', '西班牙文', '俄文', '阿拉伯文', '葡萄牙文'];

export const LOCAL_PROVIDERS = new Set(['faster_whisper', 'whisper', 'local_rvc', 'seed_vc', 'fish_speech', 'comfyui', 'flux', 'sd_local', 'facefusion', 'wan_local', 'got_ocr', 'liveportrait', 'sadtalker']);
// 前端 provider 名 → manifest engine key
export const PROVIDER_TO_ENGINE: Record<string, string> = {
  fish_speech: 'fish_speech',
  seed_vc: 'seed_vc',
  local_rvc: 'rvc',
  faster_whisper: 'faster_whisper',
  whisper: 'whisper',
  flux: 'flux',
  got_ocr: 'got_ocr',
  liveportrait: 'liveportrait',
  wan_local: 'wan',
  facefusion: 'facefusion',
};

// 尚未实现的服务商（后端无对应端点），选中后前端禁用提交按钮并提示
export const UNSUPPORTED_PROVIDERS = new Set([
  'replicate',   // image_i2i：暂未实现
  'wan_video',   // video_gen：万象视频 API 暂未实现
  'runway',      // video_gen：RunwayML API 暂未实现
  'pika',        // video_gen：Pika API 暂未实现
  'sora',        // video_gen：Sora API 暂未实现
  'azure_doc',   // ocr：Azure Document Intelligence 暂未实现
  'sadtalker',   // lipsync：SadTalker 本地引擎暂未实现
  'heygen',      // lipsync：HeyGen API 暂未实现
  'did',         // lipsync：D-ID API 暂未实现
]);
export const URL_ONLY_PROVIDERS = new Set(['ollama']);

export const LS = {
  apiKey: 'ai_tool_api_key', endpoint: 'ai_tool_cloud_endpoint',
  task: 'ai_tool_task_type', provider: 'ai_tool_provider_', outputDir: 'ai_tool_output_dir',
};

export const TASK_ICON_CFG: Record<TaskType, { abbr: string; bg: string; text: string }> = {
  tts:        { abbr: 'TTS', bg: '#4f46e5', text: '#fff' },
  vc:         { abbr: 'VC',  bg: '#7c3aed', text: '#fff' },
  asr:        { abbr: 'STT', bg: '#0284c7', text: '#fff' },
  llm:        { abbr: 'LLM', bg: '#059669', text: '#fff' },
  voice_chat: { abbr: 'V+',  bg: '#d97706', text: '#fff' },
  media:      { abbr: 'FMT', bg: '#0f766e', text: '#fff' },
  doc:        { abbr: 'DOC', bg: '#b45309', text: '#fff' },
  misc: { abbr: 'EXT', bg: '#6d28d9', text: '#fff' },
};

// ─── 图像生成（独立）提供商 ──────────────────────────────────────────────────
// 推荐顺序：SD-Turbo 本地 > ComfyUI 本地 > 主流云端（Flux 已禁用）
export const IMG_GEN_PROVIDERS = ['sd_local', 'flux', 'comfyui', 'openai', 'gemini', 'stability', 'dashscope'];
export const IMG_GEN_PROVIDER_LABELS: Record<string, string> = {
  sd_local:  'Stable Diffusion（本地）',
  flux:      'Flux.1 GGUF（本地 · 无需 API Key）',
  comfyui:   'ComfyUI（本地 · 需本地服务）',
  openai:    'DALL-E · OpenAI',
  gemini:    'Imagen · Google（有免费额度）',
  stability: 'SD3 · Stability AI（云端）',
  dashscope: '万象 · 阿里云（DashScope）',
};
export const IMG_GEN_MODELS: Record<string, string[]> = {
  sd_local:  ['sd-turbo'],
  flux:      ['flux1-schnell-Q4_K_S'],
  comfyui:   [],
  openai:    ['dall-e-3', 'dall-e-2'],
  gemini:    ['imagen-3.0-generate-002', 'imagen-3.0-fast-generate-001'],
  stability: ['sd3-large-turbo', 'sd3-large', 'core', 'ultra'],
  dashscope: ['wanx2.1-t2i-turbo', 'wanx2.1-t2i-plus', 'wanx-v1'],
};
export const IMG_GEN_SIZES: Record<string, string[]> = {
  sd_local:  ['512x512', '768x512', '512x768', '640x640'],
  flux:      ['1024x1024', '1360x768', '768x1360', '1152x896', '896x1152', '512x512'],
  comfyui:   ['1024x1024', '768x768', '512x512', '1152x896', '896x1152'],
  openai:    ['1024x1024', '1024x1792', '1792x1024'],
  gemini:    ['1:1', '16:9', '9:16', '4:3', '3:4'],
  stability: ['1:1', '16:9', '9:16', '4:3', '3:4'],
  dashscope: ['1024*1024', '720*1280', '1280*720'],
};

// ─── 换脸换图（i2i）提供商 ──────────────────────────────────────────────────
// 推荐顺序：FaceFusion 专用换脸引擎 > ComfyUI 风格迁移 > 云端
export const IMG_I2I_PROVIDERS = ['facefusion', 'comfyui', 'replicate', 'dashscope'];
export const IMG_I2I_PROVIDER_LABELS: Record<string, string> = {
  facefusion: 'FaceFusion 3.x（本地 · 换脸专用）',
  comfyui:    'ComfyUI（本地 · 风格迁移）',
  replicate:  'Replicate【暂不支持】',
  dashscope:  '万象 · 阿里云【暂不支持】',
};
export const IMG_I2I_MODELS: Record<string, string[]> = {
  facefusion: [],
  comfyui:    [],
  replicate:  ['lucataco/faceswap', 'cdingram/face-swap', 'tencentarc/photomaker-style'],
  dashscope:  ['wanx2.1-i2i-turbo', 'wanx-style-repaint-v1'],
};

// ─── 视频生成提供商（本地优先 + 云端）──────────────────────────────────────
// 推荐：Wan 2.1 本地 1.3B > 可灵 > RunwayML
export const VIDEO_GEN_PROVIDERS = ['kling', 'wan_local', 'wan_video', 'runway', 'pika', 'sora'];
export const VIDEO_GEN_PROVIDER_LABELS: Record<string, string> = {
  wan_local: 'Wan 2.1（本地 · 无需 API Key）',
  kling:     '可灵 · 快手',
  wan_video: '万象视频 · 阿里云【暂不支持】',
  runway:    'RunwayML（Gen-3）【暂不支持】',
  pika:      'Pika【暂不支持】',
  sora:      'Sora · OpenAI【暂不支持】',
};
export const VIDEO_GEN_MODELS: Record<string, string[]> = {
  wan_local: ['Wan2.1-T2V-1.3B', 'Wan2.1-I2V-1.3B'],
  kling:     ['kling-v1', 'kling-v1-5', 'kling-v2'],
  wan_video: ['wan2.1-t2v-plus', 'wan2.1-t2v-turbo', 'wan2.1-i2v-plus', 'wan2.1-i2v-turbo'],
  runway:    ['gen3a_turbo', 'gen-3-alpha'],
  pika:      ['pika-2.2', 'pika-2.0'],
  sora:      ['sora-1.5', 'sora-preview'],
};
export const VIDEO_GEN_DURATIONS: Record<string, number[]> = {
  wan_local: [3, 5, 10],
  kling:     [5, 10],
  wan_video: [4, 8],
  runway:    [5, 10],
  pika:      [3, 5, 10],
  sora:      [5, 10, 20],
};

// ─── OCR / 文档识别提供商 ───────────────────────────────────────────────────
// 推荐：GOT-OCR2.0 本地（复杂图表/公式）> Azure（生产）> GPT-4o/Gemini Vision
export const OCR_PROVIDERS = ['got_ocr', 'azure_doc', 'openai', 'gemini'];
export const OCR_PROVIDER_LABELS: Record<string, string> = {
  got_ocr:   'GOT-OCR 2.0（本地 · 公式 / 表格强）',
  azure_doc: 'Document Intelligence · Azure【暂不支持】',
  openai:    'GPT-4o Vision · OpenAI',
  gemini:    'Gemini Vision · Google（有免费额度）',
};
export const OCR_MODELS: Record<string, string[]> = {
  got_ocr:   ['GOT-OCR2.0'],
  azure_doc: ['prebuilt-layout', 'prebuilt-document', 'prebuilt-read'],
  openai:    ['gpt-4o', 'gpt-4o-mini', 'gpt-4.1'],
  gemini:    ['gemini-2.5-flash', 'gemini-2.5-pro', 'gemini-2.0-flash'],
};

// ─── 口型同步提供商 ─────────────────────────────────────────────────────────
// 推荐：LivePortrait 本地（物理拟真最高）> SadTalker > HeyGen 云端
export const LIPSYNC_PROVIDERS = ['liveportrait', 'sadtalker', 'heygen', 'did'];
export const LIPSYNC_PROVIDER_LABELS: Record<string, string> = {
  liveportrait: 'LivePortrait（本地 · 人物图片 + 驱动视频 → 动画）',
  sadtalker:    'SadTalker（本地 · 图片 + 音频驱动口型）【暂不支持】',
  heygen:       'HeyGen（云端）【暂不支持】',
  did:          'D-ID（云端）【暂不支持】',
};
export const LIPSYNC_MODELS: Record<string, string[]> = {
  liveportrait: [],
  sadtalker:    [],
  heygen:       ['video_translate_v2', 'video_v2.2'],
  did:          ['microsoft/kognitiv-arc/arc2face'],
};
