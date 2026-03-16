// ─── 类型 ──────────────────────────────────────────────────────────────────
export type Status = 'idle' | 'recording' | 'processing';
export type TaskType = 'tts' | 'vc' | 'asr' | 'llm' | 'voice_chat' | 'media' | 'doc' | 'misc' | 'rag' | 'agent' | 'finetune';
export type MiscSubPage = 'image_understand' | 'translate' | 'code_assist' | 'img_gen' | 'img_i2i' | 'video_gen' | 'ocr' | 'lipsync';
export type DocSubPage = 'pdf_to_word' | 'doc_convert' | 'pdf_extract' | 'image' | 'qr' | 'text_encoding';
export type ToolboxSubPage = 'image' | 'qr' | 'text_encoding'; // 保留兼容 useToolbox hook
export type MediaAction = 'convert' | 'extract_audio' | 'clip' | 'subtitle_convert' | 'subtitle_extract';
export type VcInputMode = 'record' | 'upload';
export type DesktopSource = { id: string; name: string };
export type VoiceInfo = { voice_id: string; name: string; is_ready: boolean; engine: string; sample_rate: number; model_file?: string | null };
export type CapabilityMap = Record<string, string[]>;
export type ChatMessage = { role: 'user' | 'assistant'; content: string; ts: number };
export type VoiceChatStatus = 'idle' | 'recording' | 'transcribing' | 'thinking' | 'speaking';
export type VoiceChatMsg = { role: 'user' | 'assistant'; text: string; audioUrl?: string; ts: number };

export type DiskRow = {
  key: string;
  label: string;
  version?: string;          // 版本号（如 "v1.5"），由前端 badge 展示
  sub?: string;
  size: number;
  engineKey?: string;        // 对应 download_checkpoints.py --engine 参数，有值才显示安装/卸载按钮
  ready?: boolean;           // 模型是否已就绪（size > 0 作为代理）
  clearable?: boolean;       // 可直接清空目录，显示「清空」按钮
  estimatedSizeMb?: number;  // 预估体积，始终显示在标签旁
  default_install?: boolean; // true=pnpm run checkpoints 默认安装；false=需手动 --engine 指定
};
export type Job = {
  id: string;
  type: 'tts' | 'vc' | string;
  label: string;
  provider: string;
  is_local: boolean;
  status: 'queued' | 'running' | 'completed' | 'failed';
  created_at: number;
  started_at: number | null;
  completed_at: number | null;
  result_url: string | null;
  result_text: string | null;
  error: string | null;
  progress?: number;      // 0-100，训练任务进度
  step?: string;          // 当前阶段名称
  step_msg?: string;      // 当前阶段描述
};

export interface RagCollection {
  name: string;
  doc_count: number;
  size_mb: number;
  created_at: string;
}

export interface AgentStep {
  type: 'thought' | 'action' | 'observation' | 'final' | 'error';
  content?: string;
  tool?: string;
  args?: Record<string, unknown>;
}

export interface FinetuneJob {
  job_id: string;
  status: 'running' | 'done' | 'error' | 'cancelled';
  model: string;
  progress: number;
  loss_curve: number[];
  log_tail: string[];
  output_dir: string;
  export_format: string;
  created_at: string;
}

declare global {
  interface Window {
    electronAPI?: {
      getDesktopSources: () => Promise<DesktopSource[]>;
      getBackendBaseUrl: () => Promise<string>;
      selectOutputDir: () => Promise<string>;
      logRenderer?: (level: string, message: string) => void;
      getDiskUsage: () => Promise<DiskRow[]>;
      readLogFile: (filename: string) => Promise<{ ok: boolean; content: string }>;
      openLogsDir: () => Promise<void>;
      openDir: (dirPath: string) => Promise<void>;
      saveRecording: (filename: string, buffer: ArrayBuffer) => Promise<string>;
      clearUserData: () => Promise<{ ok: boolean; error?: string }>;
      clearAndOpenSetup: () => Promise<{ ok: boolean; error?: string }>;
      downloadEngine: (engine: string) => Promise<{ ok: boolean; exitCode?: number; error?: string }>;
      deleteEngine: (engine: string) => Promise<{ ok: boolean; note?: string; error?: string }>;
      onEngineDownloadProgress: (cb: (msg: Record<string, unknown>) => void) => void;
      offEngineDownloadProgress: (cb: (msg: Record<string, unknown>) => void) => void;
      clearDiskRow: (key: string) => Promise<{ ok: boolean; error?: string }>;
    };
  }
}
