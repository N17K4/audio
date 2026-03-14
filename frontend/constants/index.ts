import type { TaskType, CapabilityMap } from '../types';

// ─── 常量 ──────────────────────────────────────────────────────────────────
export const TASK_LABELS: Record<TaskType, string> = {
  tts: '文本转语音',
  vc: '音色转换',
  asr: '语音转文字',
  llm: '聊天',
  voice_chat: '语音聊天',
  media: '格式转换',
};

export const TASK_PHASES: Record<string, string[]> = {
  tts:        ['准备请求', '合成语音中', '写入输出文件'],
  vc:         ['上传音频', '推理转换中', '写入转换结果'],
  asr:        ['上传音频', '语音识别中', '整理转录文字'],
  llm:        ['发送消息', '等待模型回复'],
  voice_chat: ['处理中'],
  media:      ['上传文件', 'FFmpeg 转换中', '写入输出文件'],
};

export const DEFAULT_CAPS: CapabilityMap = {
  tts: ['fish_speech', 'openai', 'gemini', 'elevenlabs'],
  vc: ['seed_vc', 'local_rvc', 'elevenlabs'],
  asr: ['whisper', 'openai', 'gemini'],
  llm: ['gemini', 'openai', 'ollama', 'github'],
  media: [],
};

export const PROVIDER_LABELS: Record<string, string> = {
  fish_speech: 'Fish Speech（本地）', seed_vc: 'Seed-VC（本地）', local_rvc: 'RVC（本地）',
  whisper: 'Whisper（本地）', ollama: 'Ollama（本地服务）',
  openai: 'OpenAI', gemini: 'Gemini', elevenlabs: 'ElevenLabs', github: 'GitHub Models',
};

// 各服务商常用模型列表（用于 datalist 下拉提示）
// 留空时后端实际使用的默认模型，用于 placeholder 提示
export const DEFAULT_MODELS: Record<string, Record<string, string>> = {
  tts: {
    openai:      'tts-1',
    gemini:      'gemini-2.5-flash-preview-tts',
    elevenlabs:  'eleven_multilingual_v2',
    fish_speech: '',
  },
  asr: {
    openai:  'whisper-1',
    gemini:  'gemini-2.5-flash',
    whisper: 'base',
  },
  llm: {
    openai:  'gpt-4o-mini',
    gemini:  'gemini-2.5-flash',
    ollama:  'qwen2.5:14b',
    github:  'gpt-4o-mini',
  },
};

export const PROVIDER_MODELS: Record<string, Record<string, string[]>> = {
  tts: {
    openai:      ['gpt-4o-mini-tts', 'tts-1', 'tts-1-hd'],
    gemini:      ['gemini-2.5-flash-preview-tts', 'gemini-2.0-flash-live-001'],
    elevenlabs:  ['eleven_multilingual_v2', 'eleven_flash_v2_5', 'eleven_turbo_v2_5'],
    fish_speech: [],
  },
  asr: {
    openai:  ['gpt-4o-mini-transcribe', 'gpt-4o-transcribe', 'whisper-1'],
    gemini:  ['gemini-2.5-flash', 'gemini-2.0-flash'],
    whisper: ['base', 'small', 'medium', 'large', 'large-v3', 'turbo'],
  },
  llm: {
    openai:  ['gpt-4o-mini', 'gpt-4o', 'gpt-4.1-mini', 'gpt-4.1'],
    gemini:  ['gemini-2.5-flash', 'gemini-2.5-pro', 'gemini-2.0-flash'],
    ollama:  ['qwen2.5-coder:14b', 'qwen2.5-coder:7b', 'qwen2.5:14b', 'qwen3:14b', 'llama3.3', 'mistral'],
    github:  ['gpt-4o-mini', 'gpt-4o', 'meta-llama-3.3-70b-instruct', 'deepseek-r1'],
  },
};

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
};
