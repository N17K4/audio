import type { TaskType, CapabilityMap } from '../types';

// ─── 常量 ──────────────────────────────────────────────────────────────────
export const TASK_LABELS: Record<TaskType, string> = {
  tts: '文本转语音',
  vc: '音色转换',
  asr: '语音转文字',
  llm: '聊天',
  voice_chat: '语音聊天',
  media: '音视频转换',
  doc:     '文档工具',
  misc:    '扩展功能',
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
  image_understand: ['上传图片', '分析中', '返回结果'],
  translate:        ['发送请求', '翻译中', '返回结果'],
};

export const DEFAULT_CAPS: CapabilityMap = {
  tts: ['fish_speech', 'openai', 'gemini', 'elevenlabs', 'cartesia', 'dashscope'],
  vc: ['seed_vc', 'local_rvc', 'elevenlabs'],
  asr: ['whisper', 'openai', 'gemini', 'groq', 'deepgram'],
  llm: ['gemini', 'openai', 'claude', 'groq', 'deepseek', 'mistral', 'xai', 'ollama', 'github'],
  media: [],
  doc:     [],
  misc:    [],
};

export const PROVIDER_LABELS: Record<string, string> = {
  fish_speech: 'Fish Speech（本地）', seed_vc: 'Seed-VC（本地）', local_rvc: 'RVC（本地）',
  whisper: 'Whisper（本地）', ollama: 'Ollama（本地服务）',
  openai: 'OpenAI', gemini: 'Gemini', elevenlabs: 'ElevenLabs', cartesia: 'Cartesia',
  dashscope: 'DashScope（阿里云）', deepgram: 'Deepgram', groq: 'Groq',
  claude: 'Claude（Anthropic）', deepseek: 'DeepSeek', mistral: 'Mistral', xai: 'xAI（Grok）',
  github: 'GitHub Models', stability: 'Stability AI',
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
  },
  asr: {
    openai:   'whisper-1',
    gemini:   'gemini-2.5-flash',
    whisper:  'base',
    groq:     'whisper-large-v3-turbo',
    deepgram: 'nova-3',
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
  },
  asr: {
    openai:   ['gpt-4o-mini-transcribe', 'gpt-4o-transcribe', 'whisper-1'],
    gemini:   ['gemini-2.5-flash', 'gemini-2.0-flash'],
    whisper:  ['base', 'small', 'medium', 'large', 'large-v3', 'turbo'],
    groq:     ['whisper-large-v3-turbo', 'whisper-large-v3', 'distil-whisper-large-v3-en'],
    deepgram: ['nova-3', 'nova-2', 'enhanced', 'base'],
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
  },
};

// 图像生成 providers
export const IMAGE_GEN_PROVIDERS = ['openai', 'gemini', 'stability', 'dashscope'];
export const IMAGE_GEN_PROVIDER_LABELS: Record<string, string> = {
  openai: 'OpenAI（DALL-E 3）',
  gemini: 'Gemini（Imagen 3）',
  stability: 'Stability AI（SD3）',
  dashscope: 'DashScope（通义万象）',
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
export const IMAGE_UNDERSTAND_PROVIDERS = ['openai', 'gemini', 'claude', 'ollama'];
export const IMAGE_UNDERSTAND_PROVIDER_LABELS: Record<string, string> = {
  openai:  'OpenAI（GPT-4o）',
  gemini:  'Gemini Vision',
  claude:  'Claude Vision',
  ollama:  'Ollama（LLaVA 等）',
};
export const IMAGE_UNDERSTAND_MODELS: Record<string, string[]> = {
  openai:  ['gpt-4o-mini', 'gpt-4o', 'gpt-4.1-mini', 'gpt-4.1'],
  gemini:  ['gemini-2.5-flash', 'gemini-2.5-pro', 'gemini-2.0-flash'],
  claude:  ['claude-opus-4-5', 'claude-sonnet-4-5', 'claude-haiku-4-5-20251001'],
  ollama:  ['llava', 'llava-llama3', 'llava-phi3', 'minicpm-v', 'moondream'],
};

// 翻译 providers（复用 LLM）
export const TRANSLATE_PROVIDERS = ['gemini', 'openai', 'claude', 'deepseek', 'groq', 'mistral', 'xai', 'ollama', 'github'];
export const TRANSLATE_LANGUAGES = ['中文', '英文', '日文', '韩文', '法文', '德文', '西班牙文', '俄文', '阿拉伯文', '葡萄牙文'];

export const LOCAL_PROVIDERS = new Set(['whisper', 'local_rvc', 'seed_vc', 'fish_speech']);
// 前端 provider 名 → manifest engine key
export const PROVIDER_TO_ENGINE: Record<string, string> = {
  fish_speech: 'fish_speech',
  seed_vc: 'seed_vc',
  local_rvc: 'rvc',
  whisper: 'whisper',
};
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
  misc:       { abbr: 'EXT', bg: '#6d28d9', text: '#fff' },
};
