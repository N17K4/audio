import React, { useEffect, useRef, useState } from 'react';

// ─── 类型 ──────────────────────────────────────────────────────────────────
type Status = 'idle' | 'recording' | 'processing';
type TaskType = 'tts' | 'vc' | 'asr' | 'llm' | 'voice_chat' | 'media';
type MediaAction = 'convert' | 'extract_audio' | 'clip';
type VcInputMode = 'record' | 'upload';
type DesktopSource = { id: string; name: string };
type VoiceInfo = { voice_id: string; name: string; is_ready: boolean; engine: string; sample_rate: number };
type CapabilityMap = Record<string, string[]>;
type ChatMessage = { role: 'user' | 'assistant'; content: string; ts: number };
type VoiceChatStatus = 'idle' | 'recording' | 'transcribing' | 'thinking' | 'speaking';
type VoiceChatMsg = { role: 'user' | 'assistant'; text: string; audioUrl?: string; ts: number };

type DiskRow = { key: string; label: string; sub?: string; size: number };
type Job = {
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
    };
  }
}

// ─── 常量 ──────────────────────────────────────────────────────────────────
const TASK_LABELS: Record<TaskType, string> = {
  tts: '文本转语音',
  vc: '音色转换',
  asr: '语音转文字',
  llm: '聊天',
  voice_chat: '语音聊天',
  media: '格式转换',
};

const TASK_PHASES: Record<string, string[]> = {
  tts:        ['准备请求', '合成语音中', '写入输出文件'],
  vc:         ['上传音频', '推理转换中', '写入转换结果'],
  asr:        ['上传音频', '语音识别中', '整理转录文字'],
  llm:        ['发送消息', '等待模型回复'],
  voice_chat: ['处理中'],
  media:      ['上传文件', 'FFmpeg 转换中', '写入输出文件'],
};

const DEFAULT_CAPS: CapabilityMap = {
  tts: ['fish_speech', 'openai', 'gemini', 'elevenlabs'],
  vc: ['seed_vc', 'local_rvc', 'elevenlabs'],
  asr: ['whisper', 'openai', 'gemini'],
  llm: ['gemini', 'openai', 'ollama', 'github'],
  media: [],
};

const PROVIDER_LABELS: Record<string, string> = {
  fish_speech: 'Fish Speech（本地）', seed_vc: 'Seed-VC（本地）', local_rvc: 'RVC（本地）',
  whisper: 'Whisper（本地）', ollama: 'Ollama（本地服务）',
  openai: 'OpenAI', gemini: 'Gemini', elevenlabs: 'ElevenLabs', github: 'GitHub Models',
};

// 各服务商常用模型列表（用于 datalist 下拉提示）
// 留空时后端实际使用的默认模型，用于 placeholder 提示
const DEFAULT_MODELS: Record<string, Record<string, string>> = {
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

const PROVIDER_MODELS: Record<string, Record<string, string[]>> = {
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

const LOCAL_PROVIDERS = new Set(['whisper', 'local_rvc', 'seed_vc', 'fish_speech']);
// 前端 provider 名 → manifest engine key
const PROVIDER_TO_ENGINE: Record<string, string> = {
  fish_speech: 'fish_speech',
  seed_vc: 'seed_vc',
  local_rvc: 'rvc',
  whisper: 'whisper',
};
const URL_ONLY_PROVIDERS = new Set(['ollama']);

const LS = {
  apiKey: 'ai_tool_api_key', endpoint: 'ai_tool_cloud_endpoint',
  task: 'ai_tool_task_type', provider: 'ai_tool_provider_', outputDir: 'ai_tool_output_dir',
};

// ─── ModelInput：自由输入 + datalist 常用模型 ─────────────────────────────────
function ModelInput({
  value, onChange, task, provider, placeholder,
}: {
  value: string; onChange: (v: string) => void;
  task: string; provider: string; placeholder?: string;
}) {
  const listId = `model-list-${task}-${provider}`;
  const options = PROVIDER_MODELS[task]?.[provider] ?? [];
  const defaultModel = DEFAULT_MODELS[task]?.[provider];
  const ph = placeholder ?? (defaultModel ? `默认：${defaultModel}` : '留空用默认');
  return (
    <>
      <input
        className="w-full rounded-xl border border-slate-200 bg-slate-50/50 px-3.5 py-2.5 text-sm text-slate-800 placeholder:text-slate-400 focus:border-indigo-400 focus:bg-white focus:ring-2 focus:ring-indigo-500/15 transition-all dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200 dark:placeholder:text-slate-500 dark:focus:bg-slate-700 dark:focus:border-indigo-400"
        list={listId}
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={ph}
        autoComplete="off"
      />
      <datalist id={listId}>
        {options.map(m => <option key={m} value={m} />)}
      </datalist>
    </>
  );
}

// ─── 工具函数 ───────────────────────────────────────────────────────────────
async function safeJson(res: Response): Promise<any> {
  try { return await res.json(); } catch { return null; }
}
async function waitForBackend(baseUrl: string): Promise<boolean> {
  for (let i = 0; i < 20; i++) {
    try { const r = await fetch(`${baseUrl}/health`); if (r.ok) return true; } catch { /**/ }
    await new Promise(r => setTimeout(r, 500));
  }
  return false;
}

// ─── 组件 ──────────────────────────────────────────────────────────────────
// ─── 前端日志（写入 logs/frontend.log，仅 production）───────────────────────
function rlog(level: 'INFO' | 'WARN' | 'ERROR', ...args: unknown[]) {
  const msg = args.map(a => (typeof a === 'object' ? JSON.stringify(a) : String(a))).join(' ');
  try { (window as any).electronAPI?.logRenderer?.(level, msg); } catch {}
}

export default function Home() {
  // 全局状态
  const [backendBaseUrl, setBackendBaseUrl] = useState('');
  const [backendReady, setBackendReady] = useState(false);
  const [taskType, setTaskType] = useState<TaskType>('tts');
  const [capabilities, setCapabilities] = useState<CapabilityMap>(DEFAULT_CAPS);
  const [providerMap, setProviderMap] = useState<Record<string, string>>({
    tts: 'fish_speech', vc: 'seed_vc', asr: 'whisper', llm: 'gemini',
  });
  const [apiKey, setApiKey] = useState('');
  const [cloudEndpoint, setCloudEndpoint] = useState('');
  const [outputDir, setOutputDir] = useState('');
  const [voices, setVoices] = useState<VoiceInfo[]>([]);
  const [selectedVoiceId, setSelectedVoiceId] = useState('');
  const [engineVersions, setEngineVersions] = useState<Record<string, { version: string; ready: boolean }>>({});

  // 通用结果
  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');
  const [resultUrl, setResultUrl] = useState('');
  const [resultText, setResultText] = useState('');
  const [lastResponse, setLastResponse] = useState('');
  const [status, setStatus] = useState<Status>('idle');

  // ─── 处理计时 & 弹窗 ────────────────────────────────────────────────────────
  const [processingStartTime, setProcessingStartTime] = useState<number | null>(null);
  const [elapsedSec, setElapsedSec] = useState(0);
  const [processingPhaseStr, setProcessingPhaseStr] = useState('');
  const [successModal, setSuccessModal] = useState<{
    feature: string; sec: number; resultPath: string; outDir: string; resultText: string;
  } | null>(null);

  // ─── 运行环境检测（避免 SSR hydration mismatch） ──────────────────────────
  const [isElectron, setIsElectron] = useState(false);
  useEffect(() => { setIsElectron(!!window.electronAPI); }, []);

  // ─── 深色模式 ─────────────────────────────────────────────────────────────
  const [isDark, setIsDark] = useState(false);
  useEffect(() => { if (localStorage.getItem('theme') === 'dark') setIsDark(true); }, []);
  useEffect(() => { localStorage.setItem('theme', isDark ? 'dark' : 'light'); }, [isDark]);

  // ─── 侧边栏 ───────────────────────────────────────────────────────────────
  const [showHome, setShowHome] = useState(true);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState(180);
  const isResizingRef = useRef(false);
  const resizeStartXRef = useRef(0);
  const resizeStartWidthRef = useRef(0);

  // ─── 系统工具面板 ──────────────────────────────────────────────────────────
  const [sysOpen, setSysOpen] = useState(false);
  const [healthResult, setHealthResult] = useState<string | null>(null);
  const [healthLoading, setHealthLoading] = useState(false);
  const [healthCollapsed, setHealthCollapsed] = useState(false);
  const [diskRows, setDiskRows] = useState<DiskRow[] | null>(null);
  const [diskLoading, setDiskLoading] = useState(false);
  const [diskCollapsed, setDiskCollapsed] = useState(false);
  const [logContent, setLogContent] = useState<{ name: string; content: string } | null>(null);
  const [logLoading, setLogLoading] = useState(false);
  const [logCollapsed, setLogCollapsed] = useState(false);

  // TTS
  const [ttsText, setTtsText] = useState('你好，这是一段测试语音。');
  const [ttsModel, setTtsModel] = useState('');
  const [ttsVoice, setTtsVoice] = useState('');

  // VC
  const [vcInputMode, setVcInputMode] = useState<VcInputMode>('upload');
  const [vcFile, setVcFile] = useState<File | null>(null);
  const [vcRefAudio, setVcRefAudio] = useState<File | null>(null);

  // VC 高级设置
  const [seedVcDiffusionSteps, setSeedVcDiffusionSteps] = useState(10);
  const [seedVcPitchShift, setSeedVcPitchShift] = useState(0);
  const [seedVcF0Condition, setSeedVcF0Condition] = useState(false);
  const [seedVcEnablePostprocess, setSeedVcEnablePostprocess] = useState(true);
  const [rvcF0Method, setRvcF0Method] = useState('rmvpe');
  const [rvcFilterRadius, setRvcFilterRadius] = useState(3);
  const [rvcIndexRate, setRvcIndexRate] = useState(0.75);
  const [rvcPitchShift, setRvcPitchShift] = useState(0);

  // TTS 参考音频（Fish Speech）
  const [ttsRefAudio, setTtsRefAudio] = useState<File | null>(null);

  // ASR
  const [asrFile, setAsrFile] = useState<File | null>(null);
  const [asrModel, setAsrModel] = useState('');

  // LLM 聊天
  const [llmMessages, setLlmMessages] = useState<ChatMessage[]>([]);
  const [llmInput, setLlmInput] = useState('');
  const [llmModel, setLlmModel] = useState('');
  const [llmLoading, setLlmLoading] = useState(false);
  const llmScrollRef = useRef<HTMLDivElement>(null);

  // 新建音色
  const [showCreateVoice, setShowCreateVoice] = useState(false);
  const [newVoiceName, setNewVoiceName] = useState('');
  const [newVoiceEngine, setNewVoiceEngine] = useState('rvc');
  const [newVoiceModel, setNewVoiceModel] = useState<File | null>(null);
  const [newVoiceIndex, setNewVoiceIndex] = useState<File | null>(null);
  const [newVoiceRef, setNewVoiceRef] = useState<File | null>(null);
  const [creatingVoice, setCreatingVoice] = useState(false);

  // 语音对话
  const [vchatMsgs, setVchatMsgs] = useState<VoiceChatMsg[]>([]);
  const [vchatStatus, setVchatStatus] = useState<VoiceChatStatus>('idle');
  const [vchatSttProvider, setVchatSttProvider] = useState('whisper');
  const [vchatSttModel, setVchatSttModel] = useState('');
  const [vchatLlmProvider, setVchatLlmProvider] = useState('gemini');
  const [vchatLlmModel, setVchatLlmModel] = useState('');
  const [vchatTtsProvider, setVchatTtsProvider] = useState('fish_speech');
  const [vchatTtsModel, setVchatTtsModel] = useState('');
  const [vchatVoiceId, setVchatVoiceId] = useState('');
  const [vchatApiKey, setVchatApiKey] = useState('');
  const [vchatEndpoint, setVchatEndpoint] = useState('');
  const vchatScrollRef = useRef<HTMLDivElement>(null);
  const vchatRecorderRef = useRef<MediaRecorder | null>(null);
  const vchatChunksRef = useRef<Blob[]>([]);

  // 格式转换
  const [mediaFile, setMediaFile] = useState<File | null>(null);
  const [mediaAction, setMediaAction] = useState<MediaAction>('convert');
  const [mediaOutputFormat, setMediaOutputFormat] = useState('mp3');
  const [mediaStartTime, setMediaStartTime] = useState('');
  const [mediaDuration, setMediaDuration] = useState('');
  const [mediaResultUrl, setMediaResultUrl] = useState('');

  // 录音（VC 用）
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  // 取消请求
  const abortCtrlRef = useRef<AbortController | null>(null);

  // 训练（保留）
  const [trainVoiceName, setTrainVoiceName] = useState('我的音色');
  const [trainFile, setTrainFile] = useState<File | null>(null);
  const [trainJobId, setTrainJobId] = useState('');
  const [trainJobStatus, setTrainJobStatus] = useState('');

  // ─── 任务队列 ──────────────────────────────────────────────────────────────
  const [jobs, setJobs] = useState<Job[]>([]);

  // ─── 衍生值 ──────────────────────────────────────────────────────────────
  const selectedProvider = providerMap[taskType] || (capabilities[taskType]?.[0] ?? 'gemini');
  const isLocal = LOCAL_PROVIDERS.has(selectedProvider);
  const isUrlOnly = URL_ONLY_PROVIDERS.has(selectedProvider);
  const needsAuth = !isLocal && !isUrlOnly;

  // ─── 共享样式常量（dark 模式感知）────────────────────────────────────────
  const fieldCls = 'w-full rounded-xl border border-slate-200 bg-slate-50/50 px-3.5 py-2.5 text-sm text-slate-800 placeholder:text-slate-400 focus:border-indigo-400 focus:bg-white focus:ring-2 focus:ring-indigo-500/15 transition-all dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200 dark:placeholder:text-slate-500 dark:focus:bg-slate-700 dark:focus:border-indigo-400';
  const fileCls  = 'w-full rounded-xl border border-slate-200 bg-slate-50/50 px-3.5 py-2.5 text-sm text-slate-700 file:mr-3 file:rounded-lg file:border-0 file:bg-indigo-50 file:px-3 file:py-1 file:text-xs file:font-medium file:text-indigo-700 hover:file:bg-indigo-100 transition-all dark:border-slate-600 dark:bg-slate-800 dark:text-slate-300 dark:file:bg-indigo-900/50 dark:file:text-indigo-300 dark:hover:file:bg-indigo-900';
  const labelCls = 'block text-xs font-medium text-slate-400 mb-1.5 uppercase tracking-wide dark:text-slate-500';
  const cardCls  = 'rounded-2xl border border-slate-200/80 bg-white shadow-panel dark:bg-slate-900 dark:border-slate-700/80';
  const divCls   = 'border-t border-slate-100 dark:border-slate-800';
  const btnSec   = 'rounded-xl border border-slate-200 bg-slate-100 hover:bg-slate-200 px-4 py-2.5 text-sm font-medium text-slate-600 transition-colors dark:border-slate-600 dark:bg-slate-800 dark:hover:bg-slate-700 dark:text-slate-300';
  const btnPri   = 'w-full rounded-xl bg-indigo-600 hover:bg-indigo-700 active:bg-indigo-800 py-2.5 text-sm font-semibold text-white shadow-sm hover:shadow-button-primary transition-all duration-150 active:scale-[0.99]';

  // ─── 持久化 ──────────────────────────────────────────────────────────────
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const savedTask = (localStorage.getItem(LS.task) as TaskType) || 'tts';
    setTaskType(savedTask in TASK_LABELS ? savedTask : 'tts');
    setApiKey(localStorage.getItem(LS.apiKey) || '');
    setCloudEndpoint(localStorage.getItem(LS.endpoint) || '');
    setOutputDir(localStorage.getItem(LS.outputDir) || '');
    setProviderMap(prev => {
      const next = { ...prev };
      Object.keys(TASK_LABELS).forEach(t => {
        const s = localStorage.getItem(`${LS.provider}${t}`);
        if (s) next[t] = s;
      });
      return next;
    });
  }, []);
  useEffect(() => { if (typeof window !== 'undefined') localStorage.setItem(LS.task, taskType); }, [taskType]);
  useEffect(() => { if (typeof window !== 'undefined') localStorage.setItem(LS.apiKey, apiKey); }, [apiKey]);
  useEffect(() => { if (typeof window !== 'undefined') localStorage.setItem(LS.endpoint, cloudEndpoint); }, [cloudEndpoint]);
  useEffect(() => { if (typeof window !== 'undefined') localStorage.setItem(LS.outputDir, outputDir); }, [outputDir]);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    for (const [t, p] of Object.entries(providerMap)) localStorage.setItem(`${LS.provider}${t}`, p);
  }, [providerMap]);

  // ─── 全局错误捕获 → frontend.log ─────────────────────────────────────────
  useEffect(() => {
    const onError = (e: ErrorEvent) => rlog('ERROR', `未捕获异常: ${e.message}`, e.filename, `L${e.lineno}`);
    const onUnhandled = (e: PromiseRejectionEvent) => rlog('ERROR', '未处理的 Promise rejection:', String(e.reason));
    window.addEventListener('error', onError);
    window.addEventListener('unhandledrejection', onUnhandled);
    rlog('INFO', '渲染进程启动');
    return () => { window.removeEventListener('error', onError); window.removeEventListener('unhandledrejection', onUnhandled); };
  }, []);

  // ─── 侧边栏拖拽 resize ────────────────────────────────────────────────────
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!isResizingRef.current) return;
      const w = Math.max(120, Math.min(320, resizeStartWidthRef.current + e.clientX - resizeStartXRef.current));
      setSidebarWidth(w);
    };
    const onUp = () => {
      if (!isResizingRef.current) return;
      isResizingRef.current = false;
      document.body.style.userSelect = '';
      document.body.style.cursor = '';
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    return () => { document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp); };
  }, []);

  // ─── 处理计时器 ───────────────────────────────────────────────────────────
  useEffect(() => {
    if (status !== 'processing' || processingStartTime === null) {
      setElapsedSec(0);
      setProcessingPhaseStr('');
      return;
    }
    const phases = TASK_PHASES[taskType] || ['处理中'];
    setProcessingPhaseStr(phases[0]);
    const interval = setInterval(() => {
      const sec = Math.floor((Date.now() - processingStartTime) / 1000);
      setElapsedSec(sec);
      const idx = Math.min(Math.floor(sec / 8), phases.length - 1);
      setProcessingPhaseStr(phases[idx]);
    }, 1000);
    return () => clearInterval(interval);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, processingStartTime, taskType]);

  // ─── 后端初始化 ───────────────────────────────────────────────────────────
  useEffect(() => {
    const api = window.electronAPI;
    if (api?.getBackendBaseUrl) {
      api.getBackendBaseUrl().then(url => { if (url) { setBackendBaseUrl(url); rlog('INFO', '后端地址:', url); } }).catch(() => setBackendBaseUrl('http://127.0.0.1:8000'));
    } else {
      setBackendBaseUrl('http://127.0.0.1:8000');
    }
  }, []);

  useEffect(() => {
    if (!backendBaseUrl) return;
    let cancelled = false;
    (async () => {
      const ok = await waitForBackend(backendBaseUrl);
      if (cancelled) return;
      setBackendReady(ok);
      if (!ok) { setError(`后端无法访问：${backendBaseUrl}`); return; }
      setError('');
      await Promise.all([fetchCapabilities(), fetchVoices(), fetchEngineVersions()]);
    })();
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [backendBaseUrl]);

  // ─── 数据获取 ─────────────────────────────────────────────────────────────
  async function fetchEngineVersions() {
    try {
      const r = await fetch(`${backendBaseUrl}/runtime/info`);
      if (!r.ok) return;
      const d = await r.json();
      const versions: Record<string, { version: string; ready: boolean }> = {};
      for (const [k, v] of Object.entries(d.engines || {})) {
        const e = v as any;
        versions[k] = { version: e.version || 'unknown', ready: e.ready ?? false };
      }
      setEngineVersions(versions);
    } catch { /**/ }
  }

  async function fetchCapabilities() {
    try {
      const r = await fetch(`${backendBaseUrl}/capabilities`);
      if (!r.ok) return;
      const d = await r.json();
      if (d?.tasks) setCapabilities(d.tasks);
    } catch { /**/ }
  }

  async function fetchVoices() {
    try {
      const r = await fetch(`${backendBaseUrl}/voices`);
      if (!r.ok) throw new Error(`加载音色失败（${r.status}）`);
      const d = await r.json();
      const list: VoiceInfo[] = d.voices || [];
      setVoices(list);
      if (list.length > 0) {
        setSelectedVoiceId(v => v || list[0].voice_id);
        setVchatVoiceId(v => v || list[0].voice_id);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : '获取音色列表失败');
    }
  }

  // ─── 任务列表轮询 ─────────────────────────────────────────────────────────
  useEffect(() => {
    if (!backendReady || !backendBaseUrl) return;
    const hasActive = jobs.some(j => j.status === 'queued' || j.status === 'running');
    if (!hasActive) return;
    const timer = setTimeout(async () => {
      try {
        const r = await fetch(`${backendBaseUrl}/jobs`);
        if (!r.ok) return;
        const d = await r.json();
        setJobs(d.jobs || []);
      } catch { /**/ }
    }, 2000);
    return () => clearTimeout(timer);
  }, [jobs, backendReady, backendBaseUrl]);

  async function fetchJobs() {
    if (!backendBaseUrl) return;
    try {
      const r = await fetch(`${backendBaseUrl}/jobs`);
      if (!r.ok) return;
      const d = await r.json();
      setJobs(d.jobs || []);
    } catch { /**/ }
  }

  async function pollJobResult(jobId: string, timeoutMs = 180000): Promise<Job> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      await new Promise(r => setTimeout(r, 1500));
      try {
        const r = await fetch(`${backendBaseUrl}/jobs/${jobId}`);
        if (!r.ok) continue;
        const d: Job = await r.json();
        setJobs(prev => {
          const idx = prev.findIndex(j => j.id === jobId);
          if (idx >= 0) { const next = [...prev]; next[idx] = d; return next; }
          return [d, ...prev];
        });
        if (d.status === 'completed') return d;
        if (d.status === 'failed') throw new Error(d.error || '任务失败');
      } catch (e) {
        if (e instanceof Error && e.message !== 'NetworkError') throw e;
      }
    }
    throw new Error('等待任务超时（3 分钟）');
  }

  // ─── 通用 postTask ────────────────────────────────────────────────────────
  async function postTask(path: string, fill: (fd: FormData) => void) {
    setError(''); setSuccessMsg(''); setResultText(''); setResultUrl(''); setLastResponse(''); setSuccessModal(null);
    const t0 = Date.now();
    setProcessingStartTime(t0);
    setStatus('processing');
    const ctrl = new AbortController();
    abortCtrlRef.current = ctrl;
    try {
      const fd = new FormData();
      fill(fd);
      const res = await fetch(`${backendBaseUrl}${path}`, { method: 'POST', body: fd, signal: ctrl.signal });
      const data = await safeJson(res);
      setLastResponse(JSON.stringify(data, null, 2));
      if (!res.ok) throw new Error(`任务失败（${res.status}）${data?.detail ? `：${data.detail}` : ''}`);
      if (data?.result_url) {
        setResultUrl(data.result_url);
      }
      const textOut = data?.text || data?.message || data?.summary || data?.result_text || '';
      if (textOut) setResultText(String(textOut));
      const elapsed = Math.round((Date.now() - t0) / 1000);
      setSuccessModal({ feature: TASK_LABELS[taskType], sec: elapsed, resultPath: data?.result_url || '', outDir: outputDir || '', resultText: String(textOut) });
      setSuccessMsg(`${TASK_LABELS[taskType]} 请求已发送`);
    } catch (e: any) {
      if (e?.name === 'AbortError') { setError('已取消'); }
      else { setError(e instanceof Error ? e.message : '任务失败'); }
    } finally {
      setStatus('idle');
      setProcessingStartTime(null);
      abortCtrlRef.current = null;
    }
  }

  // ─── TTS ─────────────────────────────────────────────────────────────────
  async function runTts() {
    if (!ttsText.trim()) { setError('请输入合成文本'); return; }
    if (!outputDir.trim()) { setError('请填写输出目录'); return; }
    if (needsAuth && !apiKey.trim()) { setError('该服务商需要 API 密钥'); return; }
    setError(''); setSuccessMsg(''); setResultUrl(''); setResultText(''); setLastResponse(''); setSuccessModal(null);
    const t0 = Date.now();
    setProcessingStartTime(t0);
    setStatus('processing');
    try {
      const fd = new FormData();
      fd.append('provider', selectedProvider);
      fd.append('text', ttsText);
      fd.append('model', ttsModel);
      fd.append('voice', ttsVoice);
      fd.append('api_key', apiKey);
      fd.append('cloud_endpoint', cloudEndpoint);
      fd.append('output_dir', outputDir);
      if (selectedProvider === 'fish_speech' && ttsRefAudio) fd.append('reference_audio', ttsRefAudio);
      const res = await fetch(`${backendBaseUrl}/tasks/tts`, { method: 'POST', body: fd });
      const data = await safeJson(res);
      if (!res.ok) throw new Error(`任务失败（${res.status}）${data?.detail ? `：${data.detail}` : ''}`);
      if (data?.job_id) {
        // 本地推理：加入队列，跳转到任务列表
        const pending: Job = { id: data.job_id, type: 'tts', label: `TTS · ${(ttsText.slice(0, 30) + (ttsText.length > 30 ? '…' : ''))}`, provider: selectedProvider, is_local: true, status: 'queued', created_at: Date.now() / 1000, started_at: null, completed_at: null, result_url: null, result_text: null, error: null };
        setJobs(prev => [pending, ...prev]);
        setSuccessMsg('任务已加入队列，可在「任务列表」中查看进度');
        navigate('tasks');
      } else {
        setLastResponse(JSON.stringify(data, null, 2));
        if (data?.result_url) setResultUrl(data.result_url);
        const elapsed = Math.round((Date.now() - t0) / 1000);
        setSuccessModal({ feature: 'TTS 文本转语音', sec: elapsed, resultPath: data?.result_url || '', outDir: outputDir || '', resultText: '' });
        setSuccessMsg('TTS 完成');
      }
    } catch (e: any) {
      setError(e instanceof Error ? e.message : '任务失败');
    } finally {
      setStatus('idle');
      setProcessingStartTime(null);
    }
  }

  // ─── VC ──────────────────────────────────────────────────────────────────
  async function startVcRecording() {
    setError(''); setSuccessMsg('');
    try {
      const api = window.electronAPI;
      if (!api?.getDesktopSources) throw new Error('Electron API 不可用');
      const sources = await api.getDesktopSources();
      if (!sources[0]) throw new Error('未找到音频源');
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { mandatory: { chromeMediaSource: 'desktop', chromeMediaSourceId: sources[0].id } } as any,
        video: { mandatory: { chromeMediaSource: 'desktop', chromeMediaSourceId: sources[0].id } } as any,
      });
      const audioStream = new MediaStream(stream.getAudioTracks());
      stream.getVideoTracks().forEach(t => t.stop());
      chunksRef.current = [];
      const recorder = new MediaRecorder(audioStream);
      recorder.ondataavailable = e => { if (e.data.size > 0) chunksRef.current.push(e.data); };
      recorder.onstop = async () => {
        const blob = new Blob(chunksRef.current, { type: 'audio/webm' });
        await handleVoiceConvert(blob);
      };
      recorder.start();
      recorderRef.current = recorder;
      setStatus('recording');
    } catch (e) {
      setError(e instanceof Error ? e.message : '启动录音失败');
      setStatus('idle');
    }
  }

  function stopVcRecording() { recorderRef.current?.stop(); setStatus('processing'); }

  async function handleVoiceConvert(audio: Blob | File) {
    const isSeedVc = selectedProvider === 'seed_vc';
    if (!isSeedVc && !selectedVoiceId) { setStatus('idle'); setError('请选择目标音色'); return; }
    if (isSeedVc && !vcRefAudio) { setStatus('idle'); setError('请上传 Seed-VC 参考音频'); return; }
    if (!outputDir.trim()) { setStatus('idle'); setError('请填写输出目录'); return; }
    if (needsAuth && !apiKey.trim()) { setStatus('idle'); setError('该服务商需要 API 密钥'); return; }
    setError(''); setSuccessMsg(''); setResultUrl(''); setResultText(''); setLastResponse(''); setSuccessModal(null);
    setStatus('processing');
    const t0 = Date.now();
    setProcessingStartTime(t0);
    const ctrl = new AbortController();
    abortCtrlRef.current = ctrl;
    const fd = new FormData();
    fd.append('file', audio, 'audio.webm');
    // Seed-VC 不依赖预建音色包，用临时 voice_id 占位，参考音频直接上传
    fd.append('voice_id', isSeedVc ? '_seed_vc_direct_' : selectedVoiceId);
    fd.append('mode', isLocal ? 'local' : 'cloud');
    fd.append('provider', selectedProvider);
    fd.append('api_key', apiKey);
    fd.append('cloud_endpoint', cloudEndpoint);
    fd.append('output_dir', outputDir);
    if (isSeedVc && vcRefAudio) fd.append('reference_audio', vcRefAudio);
    // 高级参数
    if (isSeedVc) {
      fd.append('diffusion_steps', String(seedVcDiffusionSteps));
      fd.append('pitch_shift', String(seedVcPitchShift));
      fd.append('f0_condition', String(seedVcF0Condition));
      fd.append('cfg_rate', String(0.7));
      fd.append('enable_postprocess', String(seedVcEnablePostprocess));
    } else if (selectedProvider === 'local_rvc') {
      fd.append('pitch_shift', String(rvcPitchShift));
      fd.append('f0_method', rvcF0Method);
      fd.append('filter_radius', String(rvcFilterRadius));
      fd.append('index_rate', String(rvcIndexRate));
    }
    try {
      const res = await fetch(`${backendBaseUrl}/convert`, { method: 'POST', body: fd, signal: ctrl.signal });
      const data = await safeJson(res);
      if (!res.ok) throw new Error(`转换失败（${res.status}）${data?.detail ? `：${data.detail}` : ''}`);
      if (data?.job_id) {
        const pending: Job = { id: data.job_id, type: 'vc', label: `VC · ${selectedProvider}`, provider: selectedProvider, is_local: true, status: 'queued', created_at: Date.now() / 1000, started_at: null, completed_at: null, result_url: null, result_text: null, error: null };
        setJobs(prev => [pending, ...prev]);
        setSuccessMsg('转换任务已加入队列，可在「任务列表」中查看进度');
        navigate('tasks');
      } else {
        setLastResponse(JSON.stringify(data, null, 2));
        const url = data?.result_url;
        if (!url) throw new Error('响应中无结果链接');
        setResultUrl(url);
        const elapsed = Math.round((Date.now() - t0) / 1000);
        setSuccessMsg(`已用 ${selectedProvider} / ${selectedVoiceId} 完成转换`);
        setSuccessModal({ feature: 'VC 音色转换', sec: elapsed, resultPath: url, outDir: outputDir || '', resultText: '' });
      }
    } catch (e: any) {
      if (e?.name === 'AbortError') { setError('已取消'); }
      else { setError(e instanceof Error ? e.message : '转换失败'); }
    } finally {
      setStatus('idle');
      setProcessingStartTime(null);
      abortCtrlRef.current = null;
    }
  }

  // ─── 新建音色 ─────────────────────────────────────────────────────────────
  async function createVoice() {
    if (!newVoiceName.trim()) { setError('请填写音色名称'); return; }
    setCreatingVoice(true); setError(''); setSuccessMsg('');
    try {
      const fd = new FormData();
      fd.append('voice_name', newVoiceName.trim());
      fd.append('engine', newVoiceEngine);
      if (newVoiceModel) fd.append('model_file', newVoiceModel);
      if (newVoiceIndex) fd.append('index_file', newVoiceIndex);
      if (newVoiceRef) fd.append('reference_audio', newVoiceRef);
      const res = await fetch(`${backendBaseUrl}/voices/create`, { method: 'POST', body: fd });
      const data = await safeJson(res);
      if (!res.ok) throw new Error(`创建失败（${res.status}）${data?.detail ? `：${data.detail}` : ''}`);
      setSuccessMsg(`音色已创建：${data.voice_name}（ID: ${data.voice_id}）`);
      setShowCreateVoice(false);
      setNewVoiceName(''); setNewVoiceModel(null); setNewVoiceIndex(null); setNewVoiceRef(null);
      await fetchVoices();
      setSelectedVoiceId(data.voice_id);
    } catch (e) {
      setError(e instanceof Error ? e.message : '创建音色失败');
    } finally {
      setCreatingVoice(false);
    }
  }

  // ─── 训练（保留） ─────────────────────────────────────────────────────────
  async function startTraining() {
    if (!trainFile) { setError('请先选择训练数据集'); return; }
    if (!trainVoiceName.trim()) { setError('请输入音色名称'); return; }
    setError(''); setSuccessMsg(''); setTrainJobStatus('提交中');
    const normalized = trainVoiceName.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '_').replace(/^_+|_+$/g, '');
    const autoVoiceId = `${normalized || 'voice'}_${Date.now().toString().slice(-6)}`;
    const fd = new FormData();
    fd.append('dataset', trainFile);
    fd.append('voice_id', autoVoiceId);
    fd.append('voice_name', trainVoiceName.trim());
    try {
      const res = await fetch(`${backendBaseUrl}/train`, { method: 'POST', body: fd });
      const data = await safeJson(res);
      if (!res.ok) throw new Error(`训练失败（${res.status}）${data?.detail ? `：${data.detail}` : ''}`);
      setTrainJobId(data.job_id || '');
      setTrainJobStatus('排队中');
      setSuccessMsg(`训练已提交：${data.job_id}`);
      await pollTrainJob(data.job_id);
      await fetchVoices();
    } catch (e) {
      setTrainJobStatus('失败');
      setError(e instanceof Error ? e.message : '训练失败');
    }
  }

  async function pollTrainJob(jobId: string) {
    if (!jobId) return;
    for (let i = 0; i < 20; i++) {
      await new Promise(r => setTimeout(r, 1000));
      try {
        const res = await fetch(`${backendBaseUrl}/train/${jobId}`);
        if (!res.ok) continue;
        const d = await res.json();
        const s = d?.status || '未知';
        setTrainJobStatus(s);
        if (s === 'completed') { setSuccessMsg(`训练完成：${d.voice_id}`); return; }
        if (s === 'failed') { setError(d?.error || '训练失败'); return; }
      } catch { /**/ }
    }
  }

  // ─── ASR ─────────────────────────────────────────────────────────────────
  async function runAsr() {
    if (!asrFile) { setError('请选择音频文件'); return; }
    if (needsAuth && !apiKey.trim()) { setError('该服务商需要 API 密钥'); return; }
    await postTask('/tasks/stt', fd => {
      fd.append('provider', selectedProvider);
      fd.append('file', asrFile);
      fd.append('model', asrModel);
      fd.append('api_key', apiKey);
      fd.append('cloud_endpoint', cloudEndpoint);
    });
  }

  // ─── 格式转换 ──────────────────────────────────────────────────────────────
  async function runMediaConvert() {
    if (!mediaFile) { setError('请选择要转换的文件'); return; }
    setError(''); setSuccessMsg(''); setMediaResultUrl(''); setLastResponse(''); setSuccessModal(null);
    const t0 = Date.now();
    setProcessingStartTime(t0);
    setStatus('processing');
    const ctrl = new AbortController();
    abortCtrlRef.current = ctrl;
    try {
      const fd = new FormData();
      fd.append('file', mediaFile);
      fd.append('action', mediaAction);
      fd.append('output_format', mediaOutputFormat);
      fd.append('start_time', mediaStartTime);
      fd.append('duration', mediaDuration);
      fd.append('output_dir', outputDir);
      const res = await fetch(`${backendBaseUrl}/tasks/media-convert`, { method: 'POST', body: fd, signal: ctrl.signal });
      const data = await safeJson(res);
      setLastResponse(JSON.stringify(data, null, 2));
      if (!res.ok) throw new Error(`转换失败（${res.status}）${data?.detail ? `：${data.detail}` : ''}`);
      const url = data?.result_url || '';
      if (!url) throw new Error('响应中无结果链接');
      setMediaResultUrl(url);
      const elapsed = Math.round((Date.now() - t0) / 1000);
      setSuccessMsg('格式转换完成');
      setSuccessModal({ feature: '格式转换', sec: elapsed, resultPath: url, outDir: outputDir || '', resultText: '' });
    } catch (e: any) {
      if (e?.name === 'AbortError') { setError('已取消'); }
      else { setError(e instanceof Error ? e.message : '转换失败'); }
    } finally {
      setStatus('idle');
      setProcessingStartTime(null);
      abortCtrlRef.current = null;
    }
  }

  // ─── LLM 聊天 ─────────────────────────────────────────────────────────────
  useEffect(() => {
    if (llmScrollRef.current) llmScrollRef.current.scrollTop = llmScrollRef.current.scrollHeight;
  }, [llmMessages]);

  async function sendLlmMessage() {
    const text = llmInput.trim();
    if (!text || llmLoading) return;
    if (needsAuth && !apiKey.trim()) { setError('该服务商需要 API 密钥'); return; }
    const userMsg: ChatMessage = { role: 'user', content: text, ts: Date.now() };
    const nextMsgs = [...llmMessages, userMsg];
    setLlmMessages(nextMsgs);
    setLlmInput('');
    setLlmLoading(true);
    setError('');
    try {
      const fd = new FormData();
      fd.append('provider', selectedProvider);
      fd.append('model', llmModel);
      fd.append('api_key', apiKey);
      fd.append('cloud_endpoint', cloudEndpoint);
      // 发送完整多轮历史
      fd.append('messages', JSON.stringify(nextMsgs.map(m => ({ role: m.role, content: m.content }))));
      const res = await fetch(`${backendBaseUrl}/tasks/llm`, { method: 'POST', body: fd });
      const data = await safeJson(res);
      if (!res.ok) throw new Error(`LLM 失败（${res.status}）${data?.detail ? `：${data.detail}` : ''}`);
      const reply = data?.text || '';
      setLlmMessages(prev => [...prev, { role: 'assistant', content: reply, ts: Date.now() }]);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'LLM 请求失败');
    } finally {
      setLlmLoading(false);
    }
  }

  // ─── 语音对话 ─────────────────────────────────────────────────────────────
  useEffect(() => {
    if (vchatScrollRef.current) vchatScrollRef.current.scrollTop = vchatScrollRef.current.scrollHeight;
  }, [vchatMsgs]);

  function vchatIsLocalStt() { return LOCAL_PROVIDERS.has(vchatSttProvider); }
  function vchatIsLocalLlm() { return LOCAL_PROVIDERS.has(vchatLlmProvider) || URL_ONLY_PROVIDERS.has(vchatLlmProvider); }
  function vchatIsLocalTts() { return LOCAL_PROVIDERS.has(vchatTtsProvider); }

  async function startVchatRecording() {
    if (vchatStatus !== 'idle') return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      vchatChunksRef.current = [];
      const recorder = new MediaRecorder(stream);
      recorder.ondataavailable = e => { if (e.data.size > 0) vchatChunksRef.current.push(e.data); };
      recorder.onstop = async () => {
        stream.getTracks().forEach(t => t.stop());
        const blob = new Blob(vchatChunksRef.current, { type: 'audio/webm' });
        await runVchatPipeline(blob);
      };
      recorder.start();
      vchatRecorderRef.current = recorder;
      setVchatStatus('recording');
    } catch (e) {
      setError(e instanceof Error ? e.message : '无法访问麦克风');
    }
  }

  function stopVchatRecording() {
    vchatRecorderRef.current?.stop();
    setVchatStatus('transcribing');
  }

  async function runVchatPipeline(audioBlob: Blob) {
    try {
      // 1. STT
      setVchatStatus('transcribing');
      const sttFd = new FormData();
      sttFd.append('provider', vchatSttProvider);
      sttFd.append('file', audioBlob, 'audio.webm');
      sttFd.append('model', vchatSttModel);
      sttFd.append('api_key', vchatIsLocalStt() ? '' : vchatApiKey);
      sttFd.append('cloud_endpoint', vchatEndpoint);
      const sttRes = await fetch(`${backendBaseUrl}/tasks/stt`, { method: 'POST', body: sttFd });
      const sttData = await safeJson(sttRes);
      if (!sttRes.ok) throw new Error(`STT 失败：${sttData?.detail || sttRes.status}`);
      const userText = (sttData?.text || '').trim();
      if (!userText) { setVchatStatus('idle'); return; }

      const userMsg: VoiceChatMsg = { role: 'user', text: userText, ts: Date.now() };
      setVchatMsgs(prev => [...prev, userMsg]);

      // 2. LLM
      setVchatStatus('thinking');
      const history = [...vchatMsgs, userMsg].map(m => ({ role: m.role, content: m.text }));
      const llmFd = new FormData();
      llmFd.append('provider', vchatLlmProvider);
      llmFd.append('model', vchatLlmModel);
      llmFd.append('api_key', vchatIsLocalLlm() ? '' : vchatApiKey);
      llmFd.append('cloud_endpoint', vchatEndpoint);
      llmFd.append('messages', JSON.stringify(history));
      const llmRes = await fetch(`${backendBaseUrl}/tasks/llm`, { method: 'POST', body: llmFd });
      const llmData = await safeJson(llmRes);
      if (!llmRes.ok) throw new Error(`LLM 失败：${llmData?.detail || llmRes.status}`);
      const replyText = (llmData?.text || '').trim();

      // 3. TTS
      setVchatStatus('speaking');
      const ttsFd = new FormData();
      ttsFd.append('provider', vchatTtsProvider);
      ttsFd.append('text', replyText);
      ttsFd.append('model', vchatTtsModel);
      ttsFd.append('api_key', vchatIsLocalTts() ? '' : vchatApiKey);
      ttsFd.append('cloud_endpoint', vchatEndpoint);
      ttsFd.append('voice_id', vchatVoiceId);
      ttsFd.append('output_dir', '');
      const ttsRes = await fetch(`${backendBaseUrl}/tasks/tts`, { method: 'POST', body: ttsFd });
      const ttsData = await safeJson(ttsRes);
      let audioUrl = '';
      if (ttsRes.ok) {
        if (ttsData?.result_url) {
          audioUrl = ttsData.result_url;
        } else if (ttsData?.job_id) {
          try {
            const done = await pollJobResult(ttsData.job_id, 120000);
            audioUrl = done.result_url || '';
          } catch { /**/ }
        }
      }

      setVchatMsgs(prev => [...prev, { role: 'assistant', text: replyText, audioUrl, ts: Date.now() }]);
    } catch (e) {
      setError(e instanceof Error ? e.message : '语音对话失败');
    } finally {
      setVchatStatus('idle');
    }
  }

  // ─── 共用 UI 片段（作为普通函数调用，避免内部定义导致每次渲染产生新组件类型使输入框失焦）─────
  function ProviderRow() {
    const caps = capabilities[taskType] || DEFAULT_CAPS[taskType] || [];
    const engineKey = PROVIDER_TO_ENGINE[selectedProvider];
    const engineInfo = engineKey ? engineVersions[engineKey] : undefined;
    return (
      <div className="space-y-3">
        <div className="flex gap-3 flex-wrap">
          <label className="flex-1 min-w-[140px]">
            <span className={labelCls}>服务商</span>
            <select className={fieldCls}
              value={selectedProvider} onChange={e => setProviderMap(p => ({ ...p, [taskType]: e.target.value }))}>
              {caps.map(p => <option key={p} value={p}>{PROVIDER_LABELS[p] || p}</option>)}
            </select>
          </label>
          {needsAuth && (
            <label className="flex-1 min-w-[160px]">
              <span className={labelCls}>API 密钥</span>
              <input className={fieldCls} type="password"
                value={apiKey} onChange={e => setApiKey(e.target.value)} placeholder="服务商 API 密钥" />
            </label>
          )}
          {isUrlOnly && (
            <label className="flex-1 min-w-[160px]">
              <span className={labelCls}>服务地址</span>
              <input className={fieldCls}
                value={cloudEndpoint} onChange={e => setCloudEndpoint(e.target.value)} placeholder="http://localhost:11434" />
            </label>
          )}
        </div>
        {engineInfo && (
          <div className="flex items-center gap-2 text-xs">
            <span className={`rounded-full px-2.5 py-0.5 font-mono text-[11px] font-semibold ${engineInfo.ready ? 'bg-emerald-50 text-emerald-600 border border-emerald-200/80' : 'bg-amber-50 text-amber-600 border border-amber-200/80'}`}>
              v{engineInfo.version}
            </span>
            {engineInfo.ready
              ? <span className="text-slate-400">模型已就绪</span>
              : <span className="text-amber-500">缺少模型权重，请先下载 checkpoints</span>
            }
          </div>
        )}
      </div>
    );
  }

  function OutputDirRow({ required }: { required?: boolean }) {
    return (
      <label className="block">
        <span className={labelCls}>输出目录{required ? '' : '（可选）'}</span>
        <div className="flex gap-2">
          <input className={`flex-1 ${fieldCls}`}
            value={outputDir} onChange={e => setOutputDir(e.target.value)} placeholder="/保存/输出/路径" />
          <button className={btnSec}
            onClick={async () => { const d = await window.electronAPI?.selectOutputDir?.(); if (d) setOutputDir(d); }}>
            浏览
          </button>
        </div>
      </label>
    );
  }

  function VoiceSelector({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
    return (
      <label className="block">
        <span className={labelCls}>{label}</span>
        <div className="flex gap-2">
          <select className={`flex-1 ${fieldCls}`}
            value={value} onChange={e => onChange(e.target.value)}>
            {voices.length === 0 && <option value="">（暂无音色）</option>}
            {voices.map(v => (
              <option key={v.voice_id} value={v.voice_id}>
                {v.name}【{v.engine}】{v.is_ready ? '' : ' ⚠️'}
              </option>
            ))}
          </select>
          <button className={btnSec} onClick={fetchVoices}>刷新</button>
        </div>
      </label>
    );
  }

  // 新建音色表单
  function CreateVoicePanel({ engine }: { engine?: string }) {
    const eng = engine || newVoiceEngine;
    const isRvc = eng === 'rvc';
    return (
      <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50/60 p-5 space-y-4 dark:border-slate-600 dark:bg-slate-800/40">
        <div className="flex items-center justify-between">
          <span className="text-sm font-semibold text-slate-700 dark:text-slate-200">新建音色包</span>
          <button className="text-xs text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition-colors" onClick={() => setShowCreateVoice(false)}>收起</button>
        </div>
        <div className="flex gap-3 flex-wrap">
          <label className="flex-1 min-w-[120px]">
            <span className={labelCls}>音色名称</span>
            <input className={fieldCls}
              value={newVoiceName} onChange={e => setNewVoiceName(e.target.value)} placeholder="我的音色" />
          </label>
          {!engine && (
            <label className="flex-1 min-w-[120px]">
              <span className={labelCls}>引擎</span>
              <select className={fieldCls}
                value={newVoiceEngine} onChange={e => setNewVoiceEngine(e.target.value)}>
                <option value="rvc">RVC</option>
                <option value="fish_speech">Fish Speech</option>
                <option value="seed_vc">Seed-VC</option>
              </select>
            </label>
          )}
        </div>
        {isRvc && (
          <>
            <label className="block">
              <span className={labelCls}>模型文件 .pth（必填）</span>
              <input className={fieldCls} type="file" accept=".pth,.onnx,.pt,.safetensors"
                onChange={e => setNewVoiceModel(e.target.files?.[0] || null)} />
            </label>
            <label className="block">
              <span className={labelCls}>索引文件 .index（可选）</span>
              <input className={fieldCls} type="file" accept=".index"
                onChange={e => setNewVoiceIndex(e.target.files?.[0] || null)} />
            </label>
          </>
        )}
        <label className="block">
          <span className={labelCls}>
            {isRvc ? '参考音频（可选，用于音色预览）' : '参考音频（必填，用于声音克隆）'}
          </span>
          <input className={fieldCls} type="file" accept="audio/*"
            onChange={e => setNewVoiceRef(e.target.files?.[0] || null)} />
        </label>
        <button className="w-full rounded-xl bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800 py-2.5 text-sm font-semibold text-white shadow-sm hover:shadow transition-all duration-150 disabled:opacity-50 disabled:cursor-not-allowed"
          onClick={createVoice} disabled={creatingVoice}>
          {creatingVoice ? '创建中...' : '确认创建'}
        </button>
      </div>
    );
  }

  // ─── 侧边栏图标 ───────────────────────────────────────────────────────────
  const TASK_ICON_CFG: Record<TaskType, { abbr: string; bg: string; text: string }> = {
    tts:        { abbr: 'TTS', bg: '#4f46e5', text: '#fff' },
    vc:         { abbr: 'VC',  bg: '#7c3aed', text: '#fff' },
    asr:        { abbr: 'STT', bg: '#0284c7', text: '#fff' },
    llm:        { abbr: 'LLM', bg: '#059669', text: '#fff' },
    voice_chat: { abbr: 'V+',  bg: '#d97706', text: '#fff' },
    media:      { abbr: 'FMT', bg: '#0f766e', text: '#fff' },
  };

  function TaskIcon({ task, size = 28 }: { task: TaskType; size?: number }) {
    const cfg = TASK_ICON_CFG[task];
    const fs = cfg.abbr.length >= 3 ? size * 0.34 : size * 0.4;
    return (
      <svg width={size} height={size} viewBox="0 0 28 28" style={{ flexShrink: 0 }}>
        <rect width="28" height="28" rx="7" fill={cfg.bg} />
        <text x="14" y="14" dominantBaseline="central" textAnchor="middle"
          fontSize={fs} fontWeight="700" fill={cfg.text} fontFamily="-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">
          {cfg.abbr}
        </text>
      </svg>
    );
  }

  function HomeIcon({ size = 28 }: { size?: number }) {
    return (
      <svg width={size} height={size} viewBox="0 0 28 28" style={{ flexShrink: 0 }}>
        <rect width="28" height="28" rx="7" fill="#bae6fd" />
        <path d="M14 7L22 14H19V21H16V17H12V21H9V14H6L14 7Z" fill="#0369a1" />
      </svg>
    );
  }

  function TasksIcon({ size = 28, badge = 0 }: { size?: number; badge?: number }) {
    return (
      <svg width={size} height={size} viewBox="0 0 28 28" style={{ flexShrink: 0 }}>
        <rect width="28" height="28" rx="7" fill="#f0fdf4" />
        <rect x="7" y="8" width="14" height="2.5" rx="1.25" fill="#16a34a" />
        <rect x="7" y="12.75" width="10" height="2.5" rx="1.25" fill="#16a34a" />
        <rect x="7" y="17.5" width="7" height="2.5" rx="1.25" fill="#16a34a" />
        {badge > 0 && <>
          <circle cx="22" cy="7" r="5" fill="#f97316" />
          <text x="22" y="7" dominantBaseline="central" textAnchor="middle" fontSize="6" fontWeight="700" fill="#fff" fontFamily="-apple-system,sans-serif">{badge > 9 ? '9+' : badge}</text>
        </>}
      </svg>
    );
  }

  type Page = 'home' | 'tasks' | 'system' | TaskType;
  const [showTasks, setShowTasks] = useState(false);
  const [showSystem, setShowSystem] = useState(false);
  const currentPage: Page = showHome ? 'home' : showTasks ? 'tasks' : showSystem ? 'system' : taskType;

  function navigate(page: Page) {
    if (page === 'home') { setShowHome(true); setShowTasks(false); setShowSystem(false); }
    else if (page === 'tasks') { setShowHome(false); setShowTasks(true); setShowSystem(false); fetchJobs(); }
    else if (page === 'system') { setShowHome(false); setShowTasks(false); setShowSystem(true); }
    else { setShowHome(false); setShowTasks(false); setShowSystem(false); setTaskType(page as TaskType); }
  }

  function NavItem({ page, label, icon }: { page: Page; label: string; icon: React.ReactNode }) {
    const active = currentPage === page;
    return (
      <button
        onClick={() => navigate(page)}
        title={sidebarCollapsed ? label : undefined}
        className={`w-full flex items-center gap-3 px-2.5 py-2 rounded-xl text-sm font-medium transition-all duration-150 ${
          active
            ? 'bg-sky-100 text-sky-700 dark:bg-slate-700 dark:text-sky-400'
            : 'text-sky-600 hover:bg-sky-100/70 hover:text-sky-800 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-200'
        }`}
        style={{ justifyContent: sidebarCollapsed ? 'center' : 'flex-start' }}>
        {icon}
        {!sidebarCollapsed && <span className="truncate">{label}</span>}
      </button>
    );
  }

  // ─── 首页卡片 ──────────────────────────────────────────────────────────────
  const HOME_CARDS: { task: TaskType; title: string; desc: string }[] = [
    { task: 'tts',        title: 'TTS 文本转语音', desc: '输入文字，选择音色，生成语音文件' },
    { task: 'vc',         title: 'VC 音色转换',   desc: '将音频转换为目标音色，支持本地和云端' },
    { task: 'asr',        title: 'STT 语音转文字', desc: '上传音频，识别为文字，支持多语言' },
    { task: 'llm',        title: 'LLM 聊天',      desc: '与大语言模型对话，支持多种服务商' },
    { task: 'media',      title: '格式转换',       desc: '音频互转、视频提取音频、按时间截取片段' },
    { task: 'voice_chat', title: 'LLM 语音聊天',  desc: '语音输入 → AI 回复 → 语音播报' },
  ];

  function HomePanel() {
    return (
      <div className="space-y-8">
        <div className="pt-2">
          <h1 className="text-3xl font-bold tracking-tight text-slate-900 dark:text-slate-50">AI 音频工作台</h1>
          <p className="text-sm text-slate-400 mt-2 font-medium dark:text-slate-500">选择一项功能开始使用</p>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {HOME_CARDS.map(({ task, title, desc }) => (
            <button key={task} onClick={() => navigate(task)}
              className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-card text-left hover:border-indigo-300/80 hover:shadow-panel transition-all duration-200 group active:scale-[0.99] dark:bg-slate-900 dark:border-slate-700/80 dark:hover:border-indigo-500/50">
              <div className="flex items-start gap-4">
                <TaskIcon task={task} size={40} />
                <div className="flex-1 min-w-0">
                  <div className="font-semibold text-slate-800 group-hover:text-indigo-700 dark:text-slate-200 dark:group-hover:text-indigo-400 transition-colors text-[15px]">{title}</div>
                  <div className="text-xs text-slate-400 dark:text-slate-500 mt-1 leading-relaxed">{desc}</div>
                </div>
                <svg className="w-4 h-4 text-slate-300 group-hover:text-indigo-400 dark:text-slate-600 mt-0.5 shrink-0 transition-colors" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </div>
            </button>
          ))}
        </div>
      </div>
    );
  }

  // ─── 渲染 ─────────────────────────────────────────────────────────────────
  return (
    <div className={`flex h-screen overflow-hidden bg-slate-50 text-slate-900 dark:bg-slate-950 dark:text-slate-100 ${isDark ? 'dark' : ''}`}>

      {/* ── 侧边栏 ── */}
      <aside
        className="flex flex-col shrink-0 bg-sky-50 border-r border-sky-100 overflow-hidden dark:bg-slate-900 dark:border-slate-800"
        style={{ width: sidebarCollapsed ? 60 : sidebarWidth, transition: isResizingRef.current ? 'none' : 'width 0.2s ease' }}>

        {/* 品牌区 */}
        <div className={`flex items-center py-5 border-b border-sky-100 dark:border-slate-800 ${sidebarCollapsed ? 'justify-center px-0' : 'px-4 gap-2.5'}`}>
          <svg width="28" height="28" viewBox="0 0 28 28" style={{ flexShrink: 0 }}>
            <rect width="28" height="28" rx="7" fill="#0ea5e9" />
            <path d="M7 18 Q14 8 21 18" stroke="#e0f2fe" strokeWidth="2.2" fill="none" strokeLinecap="round"/>
            <path d="M9 18 Q14 11 19 18" stroke="#bae6fd" strokeWidth="2" fill="none" strokeLinecap="round"/>
          </svg>
          {!sidebarCollapsed && <span className="font-semibold text-sky-900 dark:text-slate-100 text-sm truncate tracking-tight">AI 音频工作台</span>}
        </div>

        {/* 导航 */}
        <nav className="flex-1 py-3 px-2 space-y-0.5 overflow-y-auto overflow-x-hidden">
          <NavItem page="home" label="首页" icon={<HomeIcon />} />
          <div className="my-2 border-t border-sky-100 dark:border-slate-800" />
          {(Object.keys(TASK_LABELS) as TaskType[]).map(t => (
            <NavItem key={t} page={t} label={TASK_LABELS[t]} icon={<TaskIcon task={t} />} />
          ))}
        </nav>

        {/* 底部导航 - 任务列表 & 系统工具 */}
        <div className="border-t border-sky-100 dark:border-slate-800 px-2 py-2 space-y-0.5">
          <NavItem page="tasks" label="任务列表" icon={<TasksIcon badge={jobs.filter(j => j.status === 'queued' || j.status === 'running').length} />} />
          <NavItem page="system" label="系统工具" icon={<svg width="18" height="18" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"/><path d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/></svg>} />
        </div>

        {/* 折叠按钮 */}
        <div className="border-t border-sky-100 dark:border-slate-800 p-2">
          <button
            onClick={() => setSidebarCollapsed(v => !v)}
            className="w-full flex items-center justify-center rounded-xl py-2 text-sky-400 hover:bg-sky-100 hover:text-sky-600 dark:text-slate-500 dark:hover:bg-slate-800 dark:hover:text-slate-300 transition-colors"
            title={sidebarCollapsed ? '展开' : '收起'}>
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              {sidebarCollapsed
                ? <path d="M6 3l5 5-5 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                : <path d="M10 3L5 8l5 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>}
            </svg>
          </button>
        </div>
      </aside>

      {/* ── 拖拽调宽手柄 ── */}
      {!sidebarCollapsed && (
        <div
          className="w-px shrink-0 cursor-col-resize bg-sky-100 hover:bg-sky-300 dark:bg-slate-800 dark:hover:bg-slate-600 transition-colors"
          onMouseDown={e => {
            isResizingRef.current = true;
            resizeStartXRef.current = e.clientX;
            resizeStartWidthRef.current = sidebarWidth;
            document.body.style.userSelect = 'none';
            document.body.style.cursor = 'col-resize';
          }}
        />
      )}

      {/* ── 深色模式切换按钮（固定右上角）── */}
      <button
        onClick={() => setIsDark(v => !v)}
        title={isDark ? '切换到亮色模式' : '切换到暗色模式'}
        className={`fixed top-4 right-4 z-50 flex items-center w-[52px] h-[28px] rounded-full transition-all duration-300 shadow-md ${isDark ? 'bg-slate-700' : 'bg-sky-200'}`}
      >
        <span className={`absolute w-[22px] h-[22px] rounded-full shadow-sm flex items-center justify-center text-[13px] transition-all duration-300 ${isDark ? 'translate-x-[26px] bg-slate-200' : 'translate-x-[3px] bg-white'}`}>
          {isDark ? '🌙' : '☀️'}
        </span>
      </button>

      {/* ── 主内容区 ── */}
      <div className="flex-1 overflow-y-auto min-w-0 bg-slate-50 dark:bg-slate-950">
        <div className="p-6 md:p-8">
          <div className="mx-auto w-full max-w-3xl space-y-5">

        {/* 首页 */}
        {showHome && <HomePanel />}

        {/* ══ 任务列表面板 ══ */}
        {showTasks && (() => {
          const activeJobs = jobs.filter(j => j.status === 'queued' || j.status === 'running');
          const doneJobs = jobs.filter(j => j.status === 'completed' || j.status === 'failed');
          const now = Date.now() / 1000;
          function fmtElapsed(j: Job) {
            const base = j.status === 'completed' || j.status === 'failed'
              ? (j.completed_at || now) - (j.started_at || j.created_at)
              : now - (j.started_at || j.created_at);
            const s = Math.max(0, Math.round(base));
            return s < 60 ? `${s}s` : `${Math.floor(s/60)}m${s%60}s`;
          }
          function StatusBadge({ job }: { job: Job }) {
            if (job.status === 'queued') return <span className="rounded-full bg-slate-100 dark:bg-slate-700 px-2.5 py-0.5 text-[11px] font-semibold text-slate-500 dark:text-slate-400">排队中</span>;
            if (job.status === 'running') return <span className="rounded-full bg-indigo-100 dark:bg-indigo-900/50 px-2.5 py-0.5 text-[11px] font-semibold text-indigo-600 dark:text-indigo-400 animate-pulse">处理中</span>;
            if (job.status === 'completed') return <span className="rounded-full bg-emerald-100 dark:bg-emerald-900/50 px-2.5 py-0.5 text-[11px] font-semibold text-emerald-600 dark:text-emerald-400">完成</span>;
            return <span className="rounded-full bg-rose-100 dark:bg-rose-900/50 px-2.5 py-0.5 text-[11px] font-semibold text-rose-600 dark:text-rose-400">失败</span>;
          }
          function TypeBadge({ job }: { job: Job }) {
            const color = job.type === 'tts' ? 'bg-indigo-600' : job.type === 'vc' ? 'bg-violet-600' : 'bg-slate-600';
            const abbr = job.type === 'tts' ? 'TTS' : job.type === 'vc' ? 'VC' : job.type.toUpperCase().slice(0, 3);
            return <span className={`rounded-lg ${color} px-2 py-0.5 text-[10px] font-bold text-white uppercase tracking-wide`}>{abbr}</span>;
          }
          function JobRow({ job }: { job: Job }) {
            return (
              <div className="flex items-start gap-3 px-5 py-3.5 border-b border-slate-100 dark:border-slate-800 last:border-0 hover:bg-slate-50 dark:hover:bg-slate-800/40 transition-colors">
                <div className="mt-0.5"><TypeBadge job={job} /></div>
                <div className="flex-1 min-w-0 space-y-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-medium text-slate-800 dark:text-slate-200 truncate max-w-[280px]">{job.label}</span>
                    <StatusBadge job={job} />
                  </div>
                  <div className="flex items-center gap-3 text-xs text-slate-400">
                    <span>{PROVIDER_LABELS[job.provider] || job.provider}</span>
                    {(job.status === 'running' || job.status === 'completed' || job.status === 'failed') && (
                      <span className="tabular-nums font-mono">{fmtElapsed(job)}</span>
                    )}
                  </div>
                  {job.status === 'completed' && job.result_url && (
                    <div className="pt-1 space-y-1.5">
                      <audio controls src={job.result_url} className="w-full h-8" />
                      <a href={job.result_url} target="_blank" rel="noreferrer" className="text-[11px] text-indigo-500 hover:text-indigo-700 underline break-all">{job.result_url}</a>
                    </div>
                  )}
                  {job.status === 'failed' && job.error && (
                    <p className="text-xs text-rose-500 break-all pt-0.5">{job.error}</p>
                  )}
                </div>
                <button
                  className="shrink-0 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 px-2.5 py-1 text-xs text-slate-400 hover:text-rose-500 transition-colors"
                  onClick={async () => {
                    await fetch(`${backendBaseUrl}/jobs/${job.id}`, { method: 'DELETE' }).catch(() => {});
                    setJobs(prev => prev.filter(j => j.id !== job.id));
                  }}>
                  删除
                </button>
              </div>
            );
          }
          return (
            <div className="space-y-5">
              <header className="flex items-center gap-3.5 pb-1">
                <TasksIcon size={36} badge={activeJobs.length} />
                <div className="flex-1">
                  <h1 className="text-xl font-bold tracking-tight text-slate-900 dark:text-slate-100">任务列表</h1>
                  <p className="text-xs text-slate-400 font-medium mt-0.5">TTS / VC 异步任务队列</p>
                </div>
                <button className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 hover:bg-slate-50 px-3 py-1.5 text-xs font-medium text-slate-500 transition-colors" onClick={fetchJobs}>刷新</button>
                {doneJobs.length > 0 && (
                  <button className="rounded-xl border border-rose-200 dark:border-rose-900 bg-white dark:bg-slate-900 hover:bg-rose-50 px-3 py-1.5 text-xs font-medium text-rose-500 transition-colors"
                    onClick={async () => {
                      await fetch(`${backendBaseUrl}/jobs?status=done`, { method: 'DELETE' }).catch(() => {});
                      setJobs(prev => prev.filter(j => j.status === 'queued' || j.status === 'running'));
                    }}>清空已完成</button>
                )}
              </header>

              {jobs.length === 0 ? (
                <div className="rounded-2xl border border-slate-200/80 bg-white dark:bg-slate-900 dark:border-slate-700/80 p-12 text-center text-sm text-slate-400">
                  暂无任务，提交 TTS 或音色转换后在此查看进度
                </div>
              ) : (
                <>
                  {activeJobs.length > 0 && (
                    <section className="rounded-2xl border border-indigo-200/80 dark:border-indigo-800/60 bg-white dark:bg-slate-900 shadow-panel overflow-hidden">
                      <div className="px-5 py-3 border-b border-indigo-100 dark:border-indigo-900/60 flex items-center gap-2">
                        <svg className="w-3.5 h-3.5 text-indigo-500 animate-spin" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
                        </svg>
                        <span className="text-xs font-semibold text-indigo-600 dark:text-indigo-400">进行中（{activeJobs.length}）</span>
                      </div>
                      {activeJobs.map(j => <JobRow key={j.id} job={j} />)}
                    </section>
                  )}
                  {doneJobs.length > 0 && (
                    <section className="rounded-2xl border border-slate-200/80 bg-white dark:bg-slate-900 dark:border-slate-700/80 shadow-panel overflow-hidden">
                      <div className="px-5 py-3 border-b border-slate-100 dark:border-slate-800">
                        <span className="text-xs font-semibold text-slate-400">历史记录（{doneJobs.length}）</span>
                      </div>
                      {doneJobs.map(j => <JobRow key={j.id} job={j} />)}
                    </section>
                  )}
                </>
              )}
            </div>
          );
        })()}

        {/* 任务页标题栏 */}
        {!showHome && !showTasks && !showSystem && (
          <header className="flex items-center gap-3.5 pb-1">
            <TaskIcon task={taskType} size={36} />
            <div>
              <h1 className="text-xl font-bold tracking-tight text-slate-900 dark:text-slate-100">{TASK_LABELS[taskType]}</h1>
              <p className="text-xs text-slate-400 font-medium mt-0.5">{TASK_ICON_CFG[taskType].abbr}</p>
            </div>
          </header>
        )}

        {/* ══ TTS 面板 ══ */}
        {!showHome && !showTasks && !showSystem && taskType === 'tts' && (
          <section className="rounded-2xl border border-slate-200/80 bg-white p-6 shadow-panel space-y-5 dark:bg-slate-900 dark:border-slate-700/80">
            {ProviderRow()}
            <div className="border-t border-slate-100 dark:border-slate-800" />

            {selectedProvider === 'fish_speech' ? (
              <label className="block">
                <span className="block text-xs font-medium text-slate-400 mb-1.5 uppercase tracking-wide">目标音色（音频样本）</span>
                <input className="w-full rounded-xl border border-slate-200 bg-slate-50/50 px-3.5 py-2.5 text-sm text-slate-800 file:mr-3 file:rounded-lg file:border-0 file:bg-indigo-50 file:px-3 file:py-1 file:text-xs file:font-medium file:text-indigo-700 hover:file:bg-indigo-100 transition-all" type="file" accept="audio/*"
                  onChange={e => setTtsRefAudio(e.target.files?.[0] || null)} />
                {ttsRefAudio && <p className="text-xs text-slate-400 mt-1.5">{ttsRefAudio.name}（{Math.round(ttsRefAudio.size / 1024)} KB）</p>}
              </label>
            ) : selectedProvider === 'elevenlabs' ? (
              <label className="block">
                <span className="block text-xs font-medium text-slate-400 mb-1.5 uppercase tracking-wide">音色 ID</span>
                <input className="w-full rounded-xl border border-slate-200 bg-slate-50/50 px-3.5 py-2.5 text-sm text-slate-800 placeholder:text-slate-400 focus:border-indigo-400 focus:bg-white focus:ring-2 focus:ring-indigo-500/15 transition-all"
                  value={ttsVoice} onChange={e => setTtsVoice(e.target.value)} placeholder="ElevenLabs Voice ID" />
              </label>
            ) : (
              <label className="block">
                <span className="block text-xs font-medium text-slate-400 mb-1.5 uppercase tracking-wide">音色（可选）</span>
                <input className="w-full rounded-xl border border-slate-200 bg-slate-50/50 px-3.5 py-2.5 text-sm text-slate-800 placeholder:text-slate-400 focus:border-indigo-400 focus:bg-white focus:ring-2 focus:ring-indigo-500/15 transition-all"
                  value={ttsVoice} onChange={e => setTtsVoice(e.target.value)}
                  placeholder={selectedProvider === 'gemini' ? 'Kore' : 'alloy'} />
              </label>
            )}

            {!LOCAL_PROVIDERS.has(selectedProvider) && (
              <label className="block">
                <span className="block text-xs font-medium text-slate-400 mb-1.5 uppercase tracking-wide">模型（可选）</span>
                <ModelInput value={ttsModel} onChange={setTtsModel} task="tts" provider={selectedProvider} />
              </label>
            )}

            <label className="block">
              <span className="block text-xs font-medium text-slate-400 mb-1.5 uppercase tracking-wide">输入文本</span>
              <textarea className="w-full rounded-xl border border-slate-200 bg-slate-50/50 px-3.5 py-3 text-sm text-slate-800 placeholder:text-slate-400 focus:border-indigo-400 focus:bg-white focus:ring-2 focus:ring-indigo-500/15 transition-all resize-none"
                value={ttsText} onChange={e => setTtsText(e.target.value)} rows={5} />
              <span className="text-xs text-slate-400 mt-1 block">{ttsText.length} 字</span>
            </label>

            {OutputDirRow({ required: true })}
            <button className="w-full rounded-xl bg-indigo-600 hover:bg-indigo-700 active:bg-indigo-800 py-2.5 text-sm font-semibold text-white shadow-sm hover:shadow-button-primary transition-all duration-150 active:scale-[0.99] disabled:opacity-60 disabled:cursor-not-allowed" onClick={runTts} disabled={status === 'processing'}>
              {status === 'processing' ? '处理中...' : '开始合成'}
            </button>
          </section>
        )}

        {/* ══ VC 面板 ══ */}
        {!showHome && !showTasks && !showSystem && taskType === 'vc' && (
          <section className="rounded-2xl border border-slate-200/80 bg-white p-6 shadow-panel space-y-5 dark:bg-slate-900 dark:border-slate-700/80">
            {ProviderRow()}
            <div className="border-t border-slate-100 dark:border-slate-800" />

            {selectedProvider === 'seed_vc' ? (
              <label className="block">
                <span className="block text-xs font-medium text-slate-400 mb-1.5 uppercase tracking-wide">目标音色（音频样本）</span>
                <input className="w-full rounded-xl border border-slate-200 bg-slate-50/50 px-3.5 py-2.5 text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-indigo-50 file:px-3 file:py-1 file:text-xs file:font-medium file:text-indigo-700 hover:file:bg-indigo-100 transition-all" type="file" accept="audio/*"
                  onChange={e => setVcRefAudio(e.target.files?.[0] || null)} />
                {vcRefAudio && <p className="text-xs text-slate-400 mt-1.5">{vcRefAudio.name}（{Math.round(vcRefAudio.size / 1024)} KB）</p>}
              </label>
            ) : isLocal ? (
              <>
                {VoiceSelector({ label: '目标音色（RVC 模型）', value: selectedVoiceId, onChange: setSelectedVoiceId })}
                <div className="flex justify-end">
                  <button className="text-xs font-medium text-indigo-600 hover:text-indigo-700 transition-colors"
                    onClick={() => { setNewVoiceEngine('rvc'); setShowCreateVoice(v => !v); }}>
                    + 新建音色
                  </button>
                </div>
                {showCreateVoice && CreateVoicePanel({ engine: 'rvc' })}
              </>
            ) : (
              <label className="block">
                <span className="block text-xs font-medium text-slate-400 mb-1.5 uppercase tracking-wide">音色 ID</span>
                <input className="w-full rounded-xl border border-slate-200 bg-slate-50/50 px-3.5 py-2.5 text-sm text-slate-800 placeholder:text-slate-400 focus:border-indigo-400 focus:bg-white focus:ring-2 focus:ring-indigo-500/15 transition-all"
                  value={selectedVoiceId} onChange={e => setSelectedVoiceId(e.target.value)} placeholder="ElevenLabs Voice ID" />
              </label>
            )}

            {/* 输入音频 */}
            <div className="space-y-3">
              <span className="block text-xs font-medium text-slate-400 uppercase tracking-wide">输入音频</span>
              <div className="flex rounded-xl border border-slate-200 dark:border-slate-700 overflow-hidden text-sm bg-slate-50/50 dark:bg-slate-800/50">
                {(['upload', 'record'] as VcInputMode[]).map(m => (
                  <button key={m}
                    className={`flex-1 py-2 text-sm font-medium transition-all ${vcInputMode === m ? 'bg-slate-800 dark:bg-slate-600 text-white shadow-sm' : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 hover:bg-slate-100 dark:hover:bg-slate-700 dark:hover:text-slate-200'}`}
                    onClick={() => setVcInputMode(m)}>
                    {m === 'record' ? '实时录音' : '上传文件'}
                  </button>
                ))}
              </div>
              {vcInputMode === 'upload' ? (
                <div className="space-y-3">
                  <input className="w-full rounded-xl border border-slate-200 bg-slate-50/50 px-3.5 py-2.5 text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-indigo-50 file:px-3 file:py-1 file:text-xs file:font-medium file:text-indigo-700 hover:file:bg-indigo-100 transition-all" type="file" accept="audio/*"
                    onChange={e => setVcFile(e.target.files?.[0] || null)} />
                  {vcFile && <p className="text-xs text-slate-400">{vcFile.name}（{Math.round(vcFile.size / 1024)} KB）</p>}
                  <button className="w-full rounded-xl bg-indigo-600 hover:bg-indigo-700 active:bg-indigo-800 py-2.5 text-sm font-semibold text-white shadow-sm hover:shadow-button-primary transition-all duration-150 active:scale-[0.99] disabled:opacity-50 disabled:cursor-not-allowed"
                    onClick={() => vcFile && handleVoiceConvert(vcFile)} disabled={status === 'processing' || !vcFile}>
                    {status === 'processing' ? '处理中...' : '开始转换'}
                  </button>
                </div>
              ) : (
                <div className="flex gap-2">
                  {status === 'idle' && (
                    <button className="flex-1 rounded-xl bg-indigo-600 hover:bg-indigo-700 py-2.5 text-sm font-semibold text-white shadow-sm transition-all active:scale-[0.99]" onClick={startVcRecording}>开始录音</button>
                  )}
                  {status === 'recording' && (
                    <button className="flex-1 rounded-xl bg-rose-600 hover:bg-rose-700 py-2.5 text-sm font-semibold text-white shadow-sm animate-pulse transition-all" onClick={stopVcRecording}>停止录音</button>
                  )}
                  {status === 'processing' && <span className="text-sm text-slate-400 py-2 opacity-0 pointer-events-none">处理中...</span>}
                </div>
              )}
            </div>

            {OutputDirRow({ required: true })}

            {/* 高级设置（折叠） */}
            <details className="border border-slate-200/80 dark:border-slate-700/80 rounded-2xl overflow-hidden dark:bg-slate-900">
              <summary className="text-sm font-medium text-slate-500 dark:text-slate-400 cursor-pointer px-5 py-3.5 hover:bg-slate-50 dark:hover:bg-slate-800 hover:text-slate-700 dark:hover:text-slate-200 transition-colors list-none flex items-center justify-between">
                <span>高级设置</span>
                <svg className="w-4 h-4 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </summary>
              <div className="px-5 pb-5 pt-3 space-y-4 border-t border-slate-100 dark:border-slate-800">
                {selectedProvider === 'seed_vc' && (
                  <>
                    <label className="block">
                      <span className={labelCls}>扩散步数（{seedVcDiffusionSteps}）</span>
                      <input type="range" min={1} max={30} step={1} className="w-full accent-indigo-600"
                        value={seedVcDiffusionSteps} onChange={e => setSeedVcDiffusionSteps(Number(e.target.value))} />
                      <span className="text-xs text-slate-400 mt-1 block">降噪迭代次数，步数越多细节越丰富但越慢。快速预览用 5 步，正式输出用 15～20 步，默认 10</span>
                    </label>
                    <label className="block">
                      <span className={labelCls}>音调偏移（{seedVcPitchShift} 半音）</span>
                      <input type="range" min={-12} max={12} step={1} className="w-full accent-indigo-600"
                        value={seedVcPitchShift} onChange={e => setSeedVcPitchShift(Number(e.target.value))} />
                      <span className="text-xs text-slate-400 mt-1 block">转换后整体升高或降低音调，1 个八度 = 12 半音。例：男声参考转女声输出时调 +5，女声参考转男声时调 -5</span>
                    </label>
                    <div className="space-y-1">
                      <div className="flex items-center justify-between">
                        <span className={labelCls + ' mb-0'}>F0 条件化</span>
                        <button
                          className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${seedVcF0Condition ? 'bg-indigo-600' : 'bg-slate-300 dark:bg-slate-600'}`}
                          onClick={() => setSeedVcF0Condition(v => !v)}>
                          <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${seedVcF0Condition ? 'translate-x-6' : 'translate-x-1'}`} />
                        </button>
                      </div>
                      <p className="text-xs text-slate-400">开启后模型会保留原始音频的音调走势（语调起伏）。适合说话/朗读场景；转换歌声时建议关闭，避免音调被锁死</p>
                    </div>
                    <div className="space-y-1">
                      <div className="flex items-center justify-between">
                        <span className={labelCls + ' mb-0'}>音频美化</span>
                        <button
                          className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${seedVcEnablePostprocess ? 'bg-indigo-600' : 'bg-slate-300 dark:bg-slate-600'}`}
                          onClick={() => setSeedVcEnablePostprocess(v => !v)}>
                          <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${seedVcEnablePostprocess ? 'translate-x-6' : 'translate-x-1'}`} />
                        </button>
                      </div>
                      <p className="text-xs text-slate-400">对输出做峰值归一化（统一响度）和高通滤波（消除低频底噪）。一般保持开启；需要原始输出用于后期处理时可关闭</p>
                    </div>
                  </>
                )}
                {selectedProvider === 'local_rvc' && (
                  <>
                    <label className="block">
                      <span className={labelCls}>F0 提取方法</span>
                      <select className={fieldCls} value={rvcF0Method} onChange={e => setRvcF0Method(e.target.value)}>
                        <option value="rmvpe">rmvpe（推荐）</option>
                        <option value="harvest">harvest</option>
                        <option value="pm">pm（最快）</option>
                      </select>
                      <span className="text-xs text-slate-400 mt-1 block">分析原始音频音调的算法。rmvpe 精度最高适合大多数场景；harvest 更稳定适合低质量录音；pm 最快但精度低，仅用于测试</span>
                    </label>
                    <label className="block">
                      <span className={labelCls}>F0 平滑度（{rvcFilterRadius}）</span>
                      <input type="range" min={1} max={7} step={1} className="w-full accent-indigo-600"
                        value={rvcFilterRadius} onChange={e => setRvcFilterRadius(Number(e.target.value))} />
                      <span className="text-xs text-slate-400 mt-1 block">对音调曲线做中值滤波，消除突变噪声。值越大越平滑，但会损失语调细节。说话/朗读用 3（默认），有颤音的歌声用 1～2</span>
                    </label>
                    <label className="block">
                      <span className={labelCls}>索引混合率（{rvcIndexRate.toFixed(2)}）</span>
                      <input type="range" min={0} max={1} step={0.05} className="w-full accent-indigo-600"
                        value={rvcIndexRate} onChange={e => setRvcIndexRate(Number(e.target.value))} />
                      <span className="text-xs text-slate-400 mt-1 block">控制目标音色特征文件（.index）的混合比例，越高越贴近目标音色但可能出现电音。音色不像时调高到 0.9，出现电音/伪音时调低到 0.5</span>
                    </label>
                    <label className="block">
                      <span className={labelCls}>音调偏移（{rvcPitchShift} 半音）</span>
                      <input type="range" min={-12} max={12} step={1} className="w-full accent-indigo-600"
                        value={rvcPitchShift} onChange={e => setRvcPitchShift(Number(e.target.value))} />
                      <span className="text-xs text-slate-400 mt-1 block">转换后整体升降音调，1 个八度 = 12 半音。用女声模型转男声时调 -12（降一个八度），男声模型转女声时调 +12</span>
                    </label>
                  </>
                )}
                {selectedProvider !== 'seed_vc' && selectedProvider !== 'local_rvc' && (
                  <p className="text-xs text-slate-400">当前服务商暂无高级参数</p>
                )}
              </div>
            </details>

            {/* 训练（折叠） */}
            <details className="border border-slate-200/80 dark:border-slate-700/80 rounded-2xl overflow-hidden dark:bg-slate-900">
              <summary className="text-sm font-medium text-slate-500 dark:text-slate-400 cursor-pointer px-5 py-3.5 hover:bg-slate-50 dark:hover:bg-slate-800 hover:text-slate-700 dark:hover:text-slate-200 transition-colors list-none flex items-center justify-between">
                <span>RVC 模型训练（占位）</span>
                <svg className="w-4 h-4 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </summary>
              <div className="px-5 pb-5 pt-3 space-y-4 border-t border-slate-100 dark:border-slate-800">
                <label className="block">
                  <span className="block text-xs font-medium text-slate-400 mb-1.5 uppercase tracking-wide">音色名称</span>
                  <input className="w-full rounded-xl border border-slate-200 bg-slate-50/50 px-3.5 py-2.5 text-sm text-slate-800 focus:border-indigo-400 focus:bg-white focus:ring-2 focus:ring-indigo-500/15 transition-all"
                    value={trainVoiceName} onChange={e => setTrainVoiceName(e.target.value)} />
                </label>
                <label className="block">
                  <span className="block text-xs font-medium text-slate-400 mb-1.5 uppercase tracking-wide">训练数据集</span>
                  <input className="w-full rounded-xl border border-slate-200 bg-slate-50/50 px-3.5 py-2.5 text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-slate-100 file:px-3 file:py-1 file:text-xs file:font-medium file:text-slate-600 transition-all" type="file"
                    onChange={e => setTrainFile(e.target.files?.[0] || null)} />
                </label>
                {trainJobStatus && <p className="text-xs text-slate-500">状态：{trainJobStatus}（Job: {trainJobId}）</p>}
                <button className="w-full rounded-xl bg-slate-700 hover:bg-slate-800 py-2.5 text-sm font-semibold text-white shadow-sm transition-all active:scale-[0.99]" onClick={startTraining}>
                  提交训练
                </button>
              </div>
            </details>
          </section>
        )}

        {/* ══ ASR 面板 ══ */}
        {!showHome && !showTasks && !showSystem && taskType === 'asr' && (
          <section className="rounded-2xl border border-slate-200/80 bg-white p-6 shadow-panel space-y-5 dark:bg-slate-900 dark:border-slate-700/80">
            {ProviderRow()}
            <div className="border-t border-slate-100 dark:border-slate-800" />

            {!LOCAL_PROVIDERS.has(selectedProvider) && (
              <label className="block">
                <span className="block text-xs font-medium text-slate-400 mb-1.5 uppercase tracking-wide">模型（可选）</span>
                <ModelInput value={asrModel} onChange={setAsrModel} task="asr" provider={selectedProvider} />
              </label>
            )}

            <label className="block">
              <span className="block text-xs font-medium text-slate-400 mb-1.5 uppercase tracking-wide">输入音频</span>
              <input className="w-full rounded-xl border border-slate-200 bg-slate-50/50 px-3.5 py-2.5 text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-indigo-50 file:px-3 file:py-1 file:text-xs file:font-medium file:text-indigo-700 hover:file:bg-indigo-100 transition-all" type="file" accept="audio/*"
                onChange={e => setAsrFile(e.target.files?.[0] || null)} />
              {asrFile && <span className="text-xs text-slate-400 mt-1.5 block">{asrFile.name}（{Math.round(asrFile.size / 1024)} KB）</span>}
            </label>

            <button className="w-full rounded-xl bg-indigo-600 hover:bg-indigo-700 active:bg-indigo-800 py-2.5 text-sm font-semibold text-white shadow-sm hover:shadow-button-primary transition-all duration-150 active:scale-[0.99] disabled:opacity-60 disabled:cursor-not-allowed" onClick={runAsr} disabled={status === 'processing'}>
              {status === 'processing' ? '处理中...' : '开始识别'}
            </button>

            {resultText && (
              <div className="space-y-2">
                <span className="block text-xs font-medium text-slate-400 uppercase tracking-wide">识别结果</span>
                <pre className="whitespace-pre-wrap rounded-xl border border-slate-200/80 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 p-4 text-sm text-slate-700 dark:text-slate-300 leading-relaxed">{resultText}</pre>
              </div>
            )}
          </section>
        )}

        {/* ══ LLM 聊天面板 ══ */}
        {!showHome && !showTasks && !showSystem && taskType === 'llm' && (
          <section className="rounded-2xl border border-slate-200/80 bg-white shadow-panel flex flex-col dark:bg-slate-900 dark:border-slate-700/80" style={{ height: '540px' }}>
            {/* 顶部配置栏 */}
            <div className="p-5 border-b border-slate-100 dark:border-slate-800 space-y-4">
              {ProviderRow()}
              <label className="block">
                <span className="block text-xs font-medium text-slate-400 mb-1.5 uppercase tracking-wide">模型（可选）</span>
                <ModelInput value={llmModel} onChange={setLlmModel} task="llm" provider={selectedProvider} />
              </label>
            </div>

            {/* 消息列表 */}
            <div ref={llmScrollRef} className="flex-1 overflow-y-auto p-5 space-y-4">
              {llmMessages.length === 0 && (
                <p className="text-center text-sm text-slate-400 dark:text-slate-600 mt-10">在下方输入消息开始对话</p>
              )}
              {llmMessages.map((msg, i) => (
                <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                  <div className={`max-w-[80%] rounded-2xl px-4 py-2.5 text-sm whitespace-pre-wrap leading-relaxed ${
                    msg.role === 'user'
                      ? 'bg-indigo-600 text-white rounded-br-md shadow-sm'
                      : 'bg-slate-100 text-slate-800 rounded-bl-md dark:bg-slate-700 dark:text-slate-200'
                  }`}>
                    {msg.content}
                  </div>
                </div>
              ))}
              {llmLoading && (
                <div className="flex justify-start">
                  <div className="bg-slate-100 dark:bg-slate-700 rounded-2xl rounded-bl-md px-4 py-2.5 text-sm text-slate-400 dark:text-slate-500 flex items-center gap-2">
                    <span className="inline-flex gap-1">
                      <span className="w-1.5 h-1.5 rounded-full bg-slate-400 animate-bounce [animation-delay:0ms]" />
                      <span className="w-1.5 h-1.5 rounded-full bg-slate-400 animate-bounce [animation-delay:150ms]" />
                      <span className="w-1.5 h-1.5 rounded-full bg-slate-400 animate-bounce [animation-delay:300ms]" />
                    </span>
                  </div>
                </div>
              )}
            </div>

            {/* 输入区 */}
            <div className="p-4 border-t border-slate-100 dark:border-slate-800 flex gap-3 items-end">
              <textarea
                className="flex-1 rounded-xl border border-slate-200 bg-slate-50/50 px-3.5 py-2.5 text-sm resize-none focus:border-indigo-400 focus:bg-white focus:ring-2 focus:ring-indigo-500/15 transition-all placeholder:text-slate-400 text-slate-800"
                rows={2}
                placeholder="输入消息，Enter 发送，Shift+Enter 换行"
                value={llmInput}
                onChange={e => setLlmInput(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendLlmMessage(); } }}
              />
              <div className="flex flex-col gap-1.5">
                <button
                  className="rounded-xl bg-indigo-600 hover:bg-indigo-700 px-4 py-2 text-sm font-semibold text-white shadow-sm transition-all disabled:opacity-50 disabled:cursor-not-allowed active:scale-[0.98]"
                  onClick={sendLlmMessage} disabled={llmLoading || !llmInput.trim()}>
                  发送
                </button>
                <button
                  className="rounded-xl border border-slate-200 bg-slate-50 hover:bg-slate-100 px-4 py-2 text-xs text-slate-500 transition-colors"
                  onClick={() => setLlmMessages([])}>
                  清空
                </button>
              </div>
            </div>
          </section>
        )}

        {/* ══ 语音对话面板 ══ */}
        {!showHome && !showTasks && !showSystem && taskType === 'voice_chat' && (
          <section className="rounded-2xl border border-slate-200/80 bg-white shadow-panel flex flex-col dark:bg-slate-900 dark:border-slate-700/80" style={{ height: '660px' }}>
            {/* 顶部配置区（常显） */}
            <div className="p-5 border-b border-slate-100 dark:border-slate-800 space-y-4">
              <p className="text-xs text-slate-400 leading-relaxed">
                语音对话流程：你说话 → <span className="font-semibold text-slate-600">STT</span> 转文字 → <span className="font-semibold text-slate-600">LLM</span> 生成回复 → <span className="font-semibold text-slate-600">TTS</span> 合成播放
              </p>
              {/* API 密钥（共用） */}
              <div className="flex gap-3 flex-wrap">
                <label className="flex-1 min-w-[160px]">
                  <span className="block text-xs font-medium text-slate-400 mb-1.5 uppercase tracking-wide">API 密钥（云服务共用）</span>
                  <input className="w-full rounded-xl border border-slate-200 bg-slate-50/50 px-3.5 py-2.5 text-sm text-slate-800 placeholder:text-slate-400 focus:border-indigo-400 focus:bg-white focus:ring-2 focus:ring-indigo-500/15 transition-all" type="password"
                    value={vchatApiKey} onChange={e => setVchatApiKey(e.target.value)} placeholder="云服务 API 密钥" />
                </label>
                <label className="flex-1 min-w-[160px]">
                  <span className="block text-xs font-medium text-slate-400 mb-1.5 uppercase tracking-wide">服务地址（Ollama 等）</span>
                  <input className="w-full rounded-xl border border-slate-200 bg-slate-50/50 px-3.5 py-2.5 text-sm text-slate-800 placeholder:text-slate-400 focus:border-indigo-400 focus:bg-white focus:ring-2 focus:ring-indigo-500/15 transition-all"
                    value={vchatEndpoint} onChange={e => setVchatEndpoint(e.target.value)} placeholder="http://localhost:11434" />
                </label>
              </div>

              <div className="grid grid-cols-3 gap-3">
                {/* STT */}
                <div className="space-y-2">
                  <span className="block text-xs font-semibold text-indigo-600 uppercase tracking-wide">① STT</span>
                  <select className="w-full rounded-xl border border-slate-200 bg-slate-50/50 px-2.5 py-2 text-xs text-slate-800 focus:border-indigo-400 focus:ring-2 focus:ring-indigo-500/15 transition-all"
                    value={vchatSttProvider} onChange={e => setVchatSttProvider(e.target.value)}>
                    {['whisper', 'openai', 'gemini'].map(p => <option key={p} value={p}>{PROVIDER_LABELS[p] || p}</option>)}
                  </select>
                  {!LOCAL_PROVIDERS.has(vchatSttProvider) && (
                    <ModelInput value={vchatSttModel} onChange={setVchatSttModel} task="asr" provider={vchatSttProvider} placeholder="模型（可选）" />
                  )}
                  {LOCAL_PROVIDERS.has(vchatSttProvider) && engineVersions[PROVIDER_TO_ENGINE[vchatSttProvider]] && (
                    <span className="text-[11px] font-mono text-slate-400">v{engineVersions[PROVIDER_TO_ENGINE[vchatSttProvider]].version}</span>
                  )}
                </div>
                {/* LLM */}
                <div className="space-y-2">
                  <span className="block text-xs font-semibold text-indigo-600 uppercase tracking-wide">② LLM</span>
                  <select className="w-full rounded-xl border border-slate-200 bg-slate-50/50 px-2.5 py-2 text-xs text-slate-800 focus:border-indigo-400 focus:ring-2 focus:ring-indigo-500/15 transition-all"
                    value={vchatLlmProvider} onChange={e => setVchatLlmProvider(e.target.value)}>
                    {['gemini', 'openai', 'ollama', 'github'].map(p => <option key={p} value={p}>{PROVIDER_LABELS[p] || p}</option>)}
                  </select>
                  <ModelInput value={vchatLlmModel} onChange={setVchatLlmModel} task="llm" provider={vchatLlmProvider} />
                </div>
                {/* TTS */}
                <div className="space-y-2">
                  <span className="block text-xs font-semibold text-indigo-600 uppercase tracking-wide">③ TTS</span>
                  <select className="w-full rounded-xl border border-slate-200 bg-slate-50/50 px-2.5 py-2 text-xs text-slate-800 focus:border-indigo-400 focus:ring-2 focus:ring-indigo-500/15 transition-all"
                    value={vchatTtsProvider} onChange={e => setVchatTtsProvider(e.target.value)}>
                    {['fish_speech', 'openai', 'gemini', 'elevenlabs'].map(p => <option key={p} value={p}>{PROVIDER_LABELS[p] || p}</option>)}
                  </select>
                  {!LOCAL_PROVIDERS.has(vchatTtsProvider) && (
                    <ModelInput value={vchatTtsModel} onChange={setVchatTtsModel} task="tts" provider={vchatTtsProvider} placeholder="模型（可选）" />
                  )}
                  {LOCAL_PROVIDERS.has(vchatTtsProvider) && engineVersions[PROVIDER_TO_ENGINE[vchatTtsProvider]] && (
                    <span className="text-[11px] font-mono text-slate-400">v{engineVersions[PROVIDER_TO_ENGINE[vchatTtsProvider]].version}</span>
                  )}
                </div>
              </div>

              {/* TTS 音色 */}
              {VoiceSelector({ label: 'TTS 音色（语音合成用）', value: vchatVoiceId, onChange: setVchatVoiceId })}
            </div>

            {/* 对话记录 */}
            <div ref={vchatScrollRef} className="flex-1 overflow-y-auto p-5 space-y-4">
              {vchatMsgs.length === 0 && (
                <p className="text-center text-sm text-slate-400 dark:text-slate-600 mt-10">点击下方麦克风开始语音对话</p>
              )}
              {vchatMsgs.map((msg, i) => (
                <div key={i} className={`flex items-end gap-2 ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                  {msg.role === 'assistant' && (
                    <div className="w-7 h-7 rounded-full bg-indigo-100 dark:bg-indigo-900/60 flex items-center justify-center text-[10px] font-semibold text-indigo-600 dark:text-indigo-300 shrink-0">AI</div>
                  )}
                  <div className="max-w-[78%] space-y-1.5">
                    <div className={`rounded-2xl px-4 py-2.5 text-sm whitespace-pre-wrap leading-relaxed ${
                      msg.role === 'user'
                        ? 'bg-indigo-600 text-white rounded-br-md shadow-sm'
                        : 'bg-slate-100 text-slate-800 rounded-bl-md dark:bg-slate-700 dark:text-slate-200'
                    }`}>
                      {msg.text}
                    </div>
                    {msg.audioUrl && (
                      <audio controls src={msg.audioUrl} className="w-full h-8" />
                    )}
                  </div>
                  {msg.role === 'user' && (
                    <div className="w-7 h-7 rounded-full bg-slate-200 dark:bg-slate-700 flex items-center justify-center text-[10px] font-semibold text-slate-500 dark:text-slate-300 shrink-0">我</div>
                  )}
                </div>
              ))}
            </div>

            {/* 状态栏 */}
            <div className="px-5 py-2 border-t border-slate-100 dark:border-slate-800 text-center">
              {vchatStatus === 'idle' && <span className="text-xs text-slate-400">就绪</span>}
              {vchatStatus === 'recording' && <span className="text-xs text-rose-500 font-semibold animate-pulse">● 正在录音</span>}
              {vchatStatus === 'transcribing' && <span className="text-xs text-amber-500 font-medium">语音识别中...</span>}
              {vchatStatus === 'thinking' && <span className="text-xs text-indigo-500 font-medium">AI 思考中...</span>}
              {vchatStatus === 'speaking' && <span className="text-xs text-emerald-500 font-medium">合成语音...</span>}
            </div>

            {/* 控制区 */}
            <div className="p-5 border-t border-slate-100 dark:border-slate-800 flex items-center justify-center gap-5">
              {vchatStatus === 'idle' && (
                <>
                  <button
                    className="w-14 h-14 rounded-full bg-indigo-600 hover:bg-indigo-700 text-white text-xl shadow-md hover:shadow-lg active:scale-95 transition-all duration-150"
                    onClick={startVchatRecording}>
                    🎤
                  </button>
                  {vchatMsgs.length > 0 && (
                    <button className="rounded-xl border border-slate-200 bg-slate-50 hover:bg-slate-100 px-4 py-2 text-xs font-medium text-slate-500 transition-colors"
                      onClick={() => setVchatMsgs([])}>
                      清空
                    </button>
                  )}
                </>
              )}
              {vchatStatus === 'recording' && (
                <button
                  className="w-14 h-14 rounded-full bg-rose-600 hover:bg-rose-700 text-white text-xl shadow-md animate-pulse transition-all"
                  onClick={stopVchatRecording}>
                  ⏹
                </button>
              )}
              {(vchatStatus === 'transcribing' || vchatStatus === 'thinking' || vchatStatus === 'speaking') && (
                <div className="w-14 h-14 rounded-full bg-slate-100 flex items-center justify-center">
                  <span className="inline-flex gap-1">
                    <span className="w-2 h-2 rounded-full bg-slate-400 animate-bounce [animation-delay:0ms]" />
                    <span className="w-2 h-2 rounded-full bg-slate-400 animate-bounce [animation-delay:150ms]" />
                    <span className="w-2 h-2 rounded-full bg-slate-400 animate-bounce [animation-delay:300ms]" />
                  </span>
                </div>
              )}
            </div>
          </section>
        )}

        {/* ══ 格式转换面板 ══ */}
        {!showHome && !showTasks && !showSystem && taskType === 'media' && (
          <section className="rounded-2xl border border-slate-200/80 bg-white p-6 shadow-panel space-y-5 dark:bg-slate-900 dark:border-slate-700/80">

            {/* 操作选择 */}
            <div>
              <span className={labelCls}>操作类型</span>
              <div className="flex rounded-xl border border-slate-200 dark:border-slate-700 overflow-hidden text-sm bg-slate-50/50 dark:bg-slate-800/50">
                {([
                  { value: 'convert',       label: '格式转换' },
                  { value: 'extract_audio', label: '提取音频' },
                  { value: 'clip',          label: '截取片段' },
                ] as { value: MediaAction; label: string }[]).map(opt => (
                  <button key={opt.value}
                    className={`flex-1 py-2 text-sm font-medium transition-all ${mediaAction === opt.value ? 'bg-slate-800 dark:bg-slate-600 text-white shadow-sm' : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 hover:bg-slate-100 dark:hover:bg-slate-700 dark:hover:text-slate-200'}`}
                    onClick={() => setMediaAction(opt.value)}>
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            {/* 输入文件 */}
            <label className="block">
              <span className={labelCls}>
                {mediaAction === 'extract_audio' ? '视频文件' : '输入文件'}
              </span>
              <input className={fileCls} type="file"
                accept={mediaAction === 'extract_audio'
                  ? 'video/*,audio/*'
                  : 'audio/*,video/*,.mp3,.wav,.m4a,.mp4,.mov,.avi,.mkv,.flac,.ogg'}
                onChange={e => setMediaFile(e.target.files?.[0] || null)} />
              {mediaFile && <p className="text-xs text-slate-400 mt-1.5">{mediaFile.name}（{Math.round(mediaFile.size / 1024)} KB）</p>}
            </label>

            {/* 输出格式 */}
            <label className="block">
              <span className={labelCls}>输出格式</span>
              <select className={fieldCls} value={mediaOutputFormat} onChange={e => setMediaOutputFormat(e.target.value)}>
                <option value="mp3">MP3</option>
                <option value="wav">WAV</option>
                <option value="m4a">M4A</option>
              </select>
            </label>

            {/* 截取参数（仅 clip 模式） */}
            {mediaAction === 'clip' && (
              <div className="flex gap-3 flex-wrap">
                <label className="flex-1 min-w-[120px]">
                  <span className={labelCls}>开始时间</span>
                  <input className={fieldCls} value={mediaStartTime}
                    onChange={e => setMediaStartTime(e.target.value)}
                    placeholder="00:00:30" />
                  <span className="text-xs text-slate-400 mt-1 block">格式：HH:MM:SS 或秒数</span>
                </label>
                <label className="flex-1 min-w-[120px]">
                  <span className={labelCls}>持续时长（可选）</span>
                  <input className={fieldCls} value={mediaDuration}
                    onChange={e => setMediaDuration(e.target.value)}
                    placeholder="00:01:00" />
                  <span className="text-xs text-slate-400 mt-1 block">留空则截取到结尾</span>
                </label>
              </div>
            )}

            {OutputDirRow({})}

            <button className="w-full rounded-xl bg-teal-600 hover:bg-teal-700 active:bg-teal-800 py-2.5 text-sm font-semibold text-white shadow-sm transition-all duration-150 active:scale-[0.99] disabled:opacity-60 disabled:cursor-not-allowed"
              onClick={runMediaConvert} disabled={status === 'processing' || !mediaFile}>
              {status === 'processing' ? '处理中...' : '开始转换'}
            </button>
          </section>
        )}

        {/* 格式转换结果 */}
        {!showHome && !showTasks && !showSystem && taskType === 'media' && mediaResultUrl && (
          <section className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-panel space-y-3 dark:bg-slate-900 dark:border-slate-700/80">
            <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-wide">转换结果</h2>
            <audio controls src={mediaResultUrl} className="w-full" />
            <p className="text-xs text-slate-400 break-all">
              <a className="text-indigo-500 hover:text-indigo-700 underline transition-colors" href={mediaResultUrl} target="_blank" rel="noreferrer">{mediaResultUrl}</a>
            </p>
          </section>
        )}

        {/* ── 处理中进度条 ── */}
        {!showHome && !showTasks && !showSystem && status === 'processing' && (
          <div className="rounded-2xl border border-indigo-200/80 dark:border-indigo-800/60 bg-indigo-50 dark:bg-indigo-950/40 px-5 py-4 space-y-3">
            <div className="flex items-center gap-3">
              <svg className="w-5 h-5 text-indigo-500 animate-spin shrink-0" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
              </svg>
              <span className="text-sm font-semibold text-indigo-700 dark:text-indigo-300">处理中...</span>
              <span className="ml-auto text-sm font-mono text-indigo-500 dark:text-indigo-400 tabular-nums">已用时 {elapsedSec} 秒</span>
              <button
                className="rounded-lg border border-rose-200 dark:border-rose-800 bg-rose-50 dark:bg-rose-950/40 hover:bg-rose-100 dark:hover:bg-rose-900/40 px-3 py-1 text-xs font-medium text-rose-600 dark:text-rose-400 transition-colors"
                onClick={() => abortCtrlRef.current?.abort()}>
                取消
              </button>
            </div>
            {processingPhaseStr && (() => {
              const phases = TASK_PHASES[taskType] || ['处理中'];
              const currentIdx = phases.indexOf(processingPhaseStr);
              return (
                <div className="flex gap-2 flex-wrap">
                  {phases.map((phase, i) => {
                    const isDone = i < currentIdx;
                    const isCurrent = i === currentIdx;
                    return (
                      <span key={i} className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                        isDone ? 'bg-emerald-100 text-emerald-600 dark:bg-emerald-900/40 dark:text-emerald-400' :
                        isCurrent ? 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/60 dark:text-indigo-300' :
                        'bg-slate-100 text-slate-400 dark:bg-slate-800 dark:text-slate-600'
                      }`}>
                        {isDone && <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd"/></svg>}
                        {isCurrent && <span className="w-1.5 h-1.5 rounded-full bg-indigo-500 animate-pulse" />}
                        {phase}
                      </span>
                    );
                  })}
                </div>
              );
            })()}
          </div>
        )}

        {/* ── 全局结果区 ── */}
        {!showHome && !showTasks && !showSystem && error && (
          <div className="rounded-2xl border border-rose-200/80 dark:border-rose-900/60 bg-rose-50 dark:bg-rose-950/40 px-5 py-4 text-sm text-rose-700 dark:text-rose-300 flex gap-3">
            <svg className="w-4 h-4 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.072 16.5c-.77.833.192 2.5 1.732 2.5z"/></svg>
            <span className="font-semibold leading-relaxed break-all">{error}</span>
          </div>
        )}
        {!showHome && !showTasks && !showSystem && successMsg && !error && (
          <div className="rounded-2xl border border-emerald-200/80 dark:border-emerald-900/60 bg-emerald-50 dark:bg-emerald-950/40 px-5 py-3.5 text-sm text-emerald-700 dark:text-emerald-300 flex items-center gap-2">
            <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7"/></svg>
            <span className="font-medium">{successMsg}</span>
          </div>
        )}

        {!showHome && !showTasks && !showSystem && resultUrl && taskType !== 'voice_chat' && (
          <section className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-panel space-y-3 dark:bg-slate-900 dark:border-slate-700/80">
            <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-wide">音频结果</h2>
            <audio controls src={resultUrl} className="w-full" />
            <p className="text-xs text-slate-400 break-all">
              <a className="text-indigo-500 hover:text-indigo-700 underline transition-colors" href={resultUrl} target="_blank" rel="noreferrer">{resultUrl}</a>
            </p>
          </section>
        )}


        {/* ── 原始响应 ── */}
        {!showHome && !showTasks && !showSystem && lastResponse && (
          <details className="rounded-2xl border border-slate-200/80 bg-white shadow-card overflow-hidden dark:bg-slate-900 dark:border-slate-700/80">
            <summary className="cursor-pointer select-none px-5 py-3.5 text-sm font-medium text-slate-500 hover:bg-slate-50 dark:text-slate-400 dark:hover:bg-slate-800/50 list-none flex items-center justify-between transition-colors">
              <span>原始响应</span>
              <svg className="w-4 h-4 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7"/></svg>
            </summary>
            <pre className="px-5 pb-5 pt-3 border-t border-slate-100 dark:border-slate-800 text-xs text-slate-600 dark:text-slate-400 overflow-x-auto whitespace-pre-wrap font-mono leading-relaxed max-h-64">{lastResponse}</pre>
          </details>
        )}

        {!showHome && !showTasks && !showSystem && (
          <div className="flex justify-end">
            <button className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800 px-4 py-1.5 text-xs font-medium text-slate-500 dark:text-slate-400 transition-colors shadow-sm"
              onClick={() => { setError(''); setSuccessMsg(''); setResultUrl(''); setResultText(''); setLastResponse(''); setSuccessModal(null); }}>
              清空结果
            </button>
          </div>
        )}

        {/* ══ 系统工具 ══ */}
        {showSystem && <div className="rounded-2xl border border-slate-200/80 bg-white shadow-card overflow-hidden dark:bg-slate-900 dark:border-slate-700/80">
          <div className="px-5 pb-6 space-y-6 pt-5">

            {/* 健康检查 */}
            <div className="space-y-3">
              <div className="flex items-center gap-3">
                <button className="flex items-center gap-1.5 text-sm font-medium text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200 transition-colors" onClick={() => setHealthCollapsed(v => !v)}>
                  <svg className={`w-3.5 h-3.5 transition-transform ${healthCollapsed ? '-rotate-90' : ''}`} viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z" clipRule="evenodd"/></svg>
                  后端健康检查
                </button>
                {!healthCollapsed && <button
                  className="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 px-3 py-1 text-xs font-medium text-slate-600 dark:text-slate-300 transition-colors disabled:opacity-50"
                  disabled={healthLoading || !backendBaseUrl}
                  onClick={async () => {
                    setHealthLoading(true); setHealthResult(null);
                    try {
                      const r = await fetch(`${backendBaseUrl}/health`);
                      const j = await r.json().catch(() => null);
                      setHealthResult(JSON.stringify(j ?? await r.text(), null, 2));
                    } catch (e: any) {
                      setHealthResult(`请求失败：${e.message}`);
                    } finally { setHealthLoading(false); }
                  }}>
                  {healthLoading ? '请求中…' : '检查'}
                </button>}
              </div>
              {!healthCollapsed && healthResult && (
                <pre className="rounded-xl border border-slate-200/80 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 p-3 text-xs text-slate-700 dark:text-slate-300 overflow-x-auto whitespace-pre-wrap">{healthResult}</pre>
              )}
            </div>

            {/* 磁盘占用（仅 Electron） */}
            {isElectron && (
              <div className="space-y-3">
                <div className="flex items-center gap-3">
                  <button className="flex items-center gap-1.5 text-sm font-medium text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200 transition-colors" onClick={() => setDiskCollapsed(v => !v)}>
                    <svg className={`w-3.5 h-3.5 transition-transform ${diskCollapsed ? '-rotate-90' : ''}`} viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z" clipRule="evenodd"/></svg>
                    磁盘占用
                  </button>
                  {!diskCollapsed && <button
                    className="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 px-3 py-1 text-xs font-medium text-slate-600 dark:text-slate-300 transition-colors disabled:opacity-50"
                    disabled={diskLoading}
                    onClick={async () => {
                      setDiskLoading(true);
                      try { setDiskRows(await window.electronAPI?.getDiskUsage() ?? null); }
                      catch (e: any) { setDiskRows(null); }
                      finally { setDiskLoading(false); }
                    }}>
                    {diskLoading ? '计算中…' : '刷新'}
                  </button>}
                </div>
                {!diskCollapsed && diskRows && (() => {
                  const fmtSize = (b: number) => b <= 0 ? '0 B' : b < 1024 ? `${b} B` : b < 1048576 ? `${(b/1024).toFixed(1)} KB` : b < 1073741824 ? `${(b/1048576).toFixed(1)} MB` : `${(b/1073741824).toFixed(2)} GB`;
                  const max = Math.max(1, ...diskRows.map(r => r.size));
                  const total = diskRows.reduce((s, r) => s + Math.max(0, r.size), 0);
                  return (
                    <div className="rounded-xl border border-slate-200/80 dark:border-slate-700 overflow-hidden text-xs dark:bg-slate-800">
                      {diskRows.map(r => (
                        <div key={r.key} className="flex items-center gap-3 px-4 py-2.5 border-b border-slate-100 dark:border-slate-700 last:border-0 hover:bg-slate-50 dark:hover:bg-slate-800/60 transition-colors">
                          <div className="flex-1 min-w-0">
                            <div className="text-slate-700 dark:text-slate-300 font-medium truncate">{r.label}</div>
                            {r.sub && <div className="text-slate-400 mt-0.5">{r.sub}</div>}
                          </div>
                          <div className="w-24 shrink-0">
                            <div className="h-1.5 rounded-full bg-slate-100 overflow-hidden">
                              <div className="h-full rounded-full bg-indigo-400" style={{ width: `${r.size > 0 ? Math.max(2, Math.round(r.size/max*100)) : 0}%` }} />
                            </div>
                          </div>
                          <div className="w-16 text-right text-slate-600 tabular-nums shrink-0 font-medium">{fmtSize(r.size)}</div>
                        </div>
                      ))}
                      <div className="flex justify-between px-4 py-2.5 bg-slate-50/80 dark:bg-slate-800/60 font-semibold text-slate-700 dark:text-slate-300 border-t border-slate-100 dark:border-slate-700">
                        <span>合计</span><span className="tabular-nums">{fmtSize(total)}</span>
                      </div>
                    </div>
                  );
                })()}
              </div>
            )}

            {/* 日志（仅 Electron） */}
            {isElectron && (
              <div className="space-y-3">
                <div className="flex items-center gap-2 flex-wrap">
                  <button className="flex items-center gap-1.5 text-sm font-medium text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200 transition-colors" onClick={() => setLogCollapsed(v => !v)}>
                    <svg className={`w-3.5 h-3.5 transition-transform ${logCollapsed ? '-rotate-90' : ''}`} viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z" clipRule="evenodd"/></svg>
                    日志
                  </button>
                  {!logCollapsed && ['electron.log', 'backend.log', 'frontend.log'].map(name => (
                    <button key={name}
                      className={`rounded-lg border px-3 py-1 text-xs font-medium transition-colors disabled:opacity-50 ${logContent?.name === name ? 'border-indigo-300/80 bg-indigo-50 dark:bg-indigo-900/40 dark:border-indigo-700 text-indigo-700 dark:text-indigo-300' : 'border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-400'}`}
                      disabled={logLoading}
                      onClick={async () => {
                        if (logContent?.name === name) { setLogContent(null); return; }
                        setLogLoading(true);
                        const res = await window.electronAPI?.readLogFile(name) ?? { ok: false, content: '' };
                        setLogContent({ name, content: res.content });
                        setLogLoading(false);
                      }}>
                      {name}
                    </button>
                  ))}
                  {!logCollapsed && <button
                    className="rounded-lg border border-slate-200 bg-slate-50 hover:bg-slate-100 px-3 py-1 text-xs font-medium text-slate-600 transition-colors"
                    onClick={() => window.electronAPI?.openLogsDir?.()}>
                    打开目录
                  </button>}
                </div>
                {!logCollapsed && logContent && (
                  <pre className="rounded-xl border border-slate-800 bg-slate-950 text-slate-300 p-4 text-xs overflow-x-auto whitespace-pre-wrap max-h-64 font-mono leading-relaxed">{logContent.content || '（空）'}</pre>
                )}
              </div>
            )}

          </div>
        </div>}

          </div>{/* max-w-3xl */}
        </div>{/* p-4 */}
      </div>{/* flex-1 main scroll */}

      {/* ── 成功弹窗 ── */}
      {successModal && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/30 backdrop-blur-sm" onClick={() => setSuccessModal(null)} />
          <div className="relative rounded-2xl border border-slate-200/80 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-2xl p-6 w-full max-w-sm space-y-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-emerald-100 dark:bg-emerald-900/40 flex items-center justify-center shrink-0">
                <svg className="w-5 h-5 text-emerald-600 dark:text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7"/>
                </svg>
              </div>
              <div>
                <h3 className="font-semibold text-slate-900 dark:text-slate-100">{successModal.feature} 完成</h3>
                <p className="text-xs text-slate-400 mt-0.5">耗时 {successModal.sec} 秒</p>
              </div>
            </div>
            {(successModal.resultPath || successModal.outDir || successModal.resultText) && (
              <div className="rounded-xl border border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/60 p-4 space-y-2.5 text-xs">
                {successModal.resultPath && (
                  <div>
                    <span className="font-medium text-slate-500 dark:text-slate-400">输出文件</span>
                    <p className="text-slate-700 dark:text-slate-300 break-all mt-0.5">{successModal.resultPath}</p>
                  </div>
                )}
                {successModal.outDir && (
                  <div>
                    <span className="font-medium text-slate-500 dark:text-slate-400">输出目录</span>
                    <p className="text-slate-700 dark:text-slate-300 break-all mt-0.5">{successModal.outDir}</p>
                  </div>
                )}
                {successModal.resultText && (
                  <div>
                    <span className="font-medium text-slate-500 dark:text-slate-400">识别内容</span>
                    <p className="text-slate-700 dark:text-slate-300 mt-0.5 line-clamp-3">{successModal.resultText}</p>
                  </div>
                )}
              </div>
            )}
            <button
              className="w-full rounded-xl bg-indigo-600 hover:bg-indigo-700 py-2 text-sm font-medium text-white transition-colors"
              onClick={() => setSuccessModal(null)}>
              确认
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
