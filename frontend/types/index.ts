// ─── 类型 ──────────────────────────────────────────────────────────────────
export type Status = 'idle' | 'recording' | 'processing';
export type TaskType = 'tts' | 'vc' | 'asr' | 'voice_chat' | 'media' | 'misc';
export type MiscSubPage = 'image_understand' | 'translate' | 'code_assist' | 'img_gen' | 'img_i2i' | 'video_gen' | 'ocr' | 'lipsync';
export type MediaAction = 'convert' | 'clip';
export type VcInputMode = 'record' | 'upload';
export type VoiceChatStatus = 'idle' | 'recording' | 'transcribing' | 'thinking' | 'speaking';
export type VoiceChatMsg = { role: 'user' | 'assistant'; text: string; audioUrl?: string; ts: number };
export type DesktopSource = { id: string; name: string };
export type VoiceInfo = { voice_id: string; name: string; is_ready: boolean; engine: string; sample_rate: number; model_file?: string | null; is_builtin?: boolean; gpt_model?: string | null; sovits_model?: string | null };
export type CapabilityMap = Record<string, string[]>;
export type ChatMessage = { role: 'user' | 'assistant'; content: string; ts: number };

export type DiskRow = {
  key: string;
  label: string;
  version?: string;          // 版本号（如 "v1.5"），由前端 badge 展示
  sub?: string;              // 安装目录路径
  size: number;
  engineKey?: string;        // 对应引擎下载 --engine 参数，有值才显示安装/卸载按钮
  ready?: boolean;           // 模型是否已就绪（size > 0 作为代理）
  clearable?: boolean;       // 可直接清空目录，显示「清空」按钮
  stage?: string;            // 安装阶段分组（setup / ml_base 等），同阶段共享一个重新安装按钮
  estimatedSizeMb?: number;  // 预估体积，始终显示在标签旁
  default_install?: boolean; // true=pnpm run checkpoints 默认安装；false=需手动 --engine 指定
  desc?: string;             // 详细说明（来源、内容、备注等）
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
  params?: Record<string, any>;  // 任务输入参数
};


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
      reinstallStage: (stage: string) => Promise<{ ok: boolean; exitCode?: number; error?: string }>;
      clearStage: (stage: string) => Promise<{ ok: boolean; error?: string }>;
      clearStageAndOpenSetup: (stage: string) => Promise<{ ok: boolean; error?: string }>;
      supplementInstall: (stage: string) => Promise<{ ok: boolean; error?: string }>;
    };
  }
}
