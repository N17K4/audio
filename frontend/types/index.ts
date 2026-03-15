// ─── 类型 ──────────────────────────────────────────────────────────────────
export type Status = 'idle' | 'recording' | 'processing';
export type TaskType = 'tts' | 'vc' | 'asr' | 'llm' | 'voice_chat' | 'media' | 'doc';
export type DocSubPage = 'pdf_to_word' | 'doc_convert' | 'pdf_extract' | 'image' | 'qr' | 'text_encoding';
export type ToolboxSubPage = 'image' | 'qr' | 'text_encoding'; // 保留兼容 useToolbox hook
export type MediaAction = 'convert' | 'extract_audio' | 'clip' | 'subtitle_convert' | 'subtitle_extract';
export type VcInputMode = 'record' | 'upload';
export type DesktopSource = { id: string; name: string };
export type VoiceInfo = { voice_id: string; name: string; is_ready: boolean; engine: string; sample_rate: number };
export type CapabilityMap = Record<string, string[]>;
export type ChatMessage = { role: 'user' | 'assistant'; content: string; ts: number };
export type VoiceChatStatus = 'idle' | 'recording' | 'transcribing' | 'thinking' | 'speaking';
export type VoiceChatMsg = { role: 'user' | 'assistant'; text: string; audioUrl?: string; ts: number };

export type DiskRow = { key: string; label: string; sub?: string; size: number };
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
      clearUserData: () => Promise<{ ok: boolean; error?: string }>;
      clearAndOpenSetup: () => Promise<{ ok: boolean; error?: string }>;
    };
  }
}
