import { useEffect, useState } from 'react';
import type { Status, TaskType, VcInputMode, ToolboxSubPage, MediaAction, DocSubPage, MiscSubPage } from '../types';
import { TASK_LABELS, TASK_PHASES, TASK_ICON_CFG, LS, LOCAL_PROVIDERS, URL_ONLY_PROVIDERS } from '../constants';
import { rlog } from '../utils';

// Hooks
import { useBackend } from '../hooks/useBackend';
import { useJobs } from '../hooks/useJobs';
import { useTTS } from '../hooks/useTTS';
import { useVC } from '../hooks/useVC';
import { useASR } from '../hooks/useASR';
import { useLLM } from '../hooks/useLLM';
import { useVoiceChat } from '../hooks/useVoiceChat';
import { useMediaConvert } from '../hooks/useMediaConvert';
import { useDocConvert } from '../hooks/useDocConvert';
import { useToolbox } from '../hooks/useToolbox';
import { useMisc } from '../hooks/useMisc';
import { useImageExt } from '../hooks/useImageExt';

// Components
import TopNav from '../components/layout/TopNav';
import type { Page } from '../components/layout/Sidebar';
import HomePanel from '../components/HomePanel';
import TaskList from '../components/TaskList';
import SystemPanel from '../components/SystemPanel';
import TaskIcon from '../components/icons/TaskIcon';
import TtsPanel from '../components/panels/TtsPanel';
import VcPanel from '../components/panels/VcPanel';
import AsrPanel from '../components/panels/AsrPanel';
import LlmPanel from '../components/panels/LlmPanel';
import VoiceChatPanel from '../components/panels/VoiceChatPanel';
import MediaPanel from '../components/panels/MediaPanel';
import DocPanel from '../components/panels/DocPanel';
import MiscPanel from '../components/panels/MiscPanel';
import RagPanel from '../components/panels/RagPanel';
import AgentPanel from '../components/panels/AgentPanel';
import FinetunePanel from '../components/panels/FinetunePanel';

export default function Home() {
  // ─── 导航状态 ─────────────────────────────────────────────────────────────
  const [taskType, setTaskType] = useState<TaskType>('tts');
  const [showHome, setShowHome] = useState(true);
  const [showTasks, setShowTasks] = useState(false);
  const [tasksTab, setTasksTab] = useState<'tasks' | 'about' | 'models'>('tasks');
  const [showAudioTools, setShowAudioTools] = useState(false);
  const [showFormatConvert, setShowFormatConvert] = useState(false);
  const [showImageTools, setShowImageTools] = useState(false);
  const [showVideoTools, setShowVideoTools] = useState(false);
  const [showTextTools, setShowTextTools] = useState(false);
  const [showAdvancedTools, setShowAdvancedTools] = useState(false);
  const [advancedSubPage, setAdvancedSubPage] = useState<'rag' | 'agent' | 'finetune'>('rag');
  const [textSubPage, setTextSubPage] = useState<'llm' | 'translate' | 'code_assist'>('llm');
  const [formatGroup, setFormatGroup] = useState<'media' | 'doc'>('media');
  const [hwAccelDetected, setHwAccelDetected] = useState('');

  const AUDIO_TASK_TYPES: TaskType[] = ['tts', 'vc', 'asr', 'voice_chat'];

  const currentPage: Page = showHome ? 'home' : showTasks ? (tasksTab === 'tasks' ? 'tasks' : 'system') :
    showAudioTools ? 'audio_tools' : showFormatConvert ? 'format_convert' :
    showAdvancedTools ? (advancedSubPage === 'rag' ? 'rag' : advancedSubPage === 'agent' ? 'agent' : 'advanced_tools') :
    showImageTools ? 'image_tools' : showVideoTools ? 'video_tools' :
    showTextTools ? 'text_tools' : taskType;

  function navigate(page: Page, subPage?: string) {
    const resetAll = () => {
      setShowHome(false); setShowTasks(false);
      setShowAudioTools(false); setShowFormatConvert(false);
      setShowImageTools(false); setShowVideoTools(false); setShowTextTools(false);
      setShowAdvancedTools(false);
    };
    if (page === 'home') { resetAll(); setShowHome(true); }
    else if (page === 'tasks') { resetAll(); setShowTasks(true); setTasksTab('tasks'); fetchJobs(); }
    else if (page === 'system') { resetAll(); setShowTasks(true); setTasksTab('models'); }
    else if (page === 'audio_tools') {
      resetAll(); setShowAudioTools(true);
      if (subPage && ['tts', 'vc', 'asr', 'voice_chat'].includes(subPage)) setTaskType(subPage as TaskType);
      else if (!AUDIO_TASK_TYPES.includes(taskType)) setTaskType('tts');
    }
    else if (page === 'format_convert') {
      resetAll(); setShowFormatConvert(true);
      if (!hwAccelDetected) {
        fetch(`${backend.backendBaseUrl}/hw-accel`)
          .then(r => r.json())
          .then(d => setHwAccelDetected(d.label || ''))
          .catch(() => {});
      }
    }
    else if (page === 'image_tools') {
      resetAll(); setShowImageTools(true);
      if (subPage) misc.setMiscSubPage(subPage as MiscSubPage);
      else misc.setMiscSubPage('img_gen');
    }
    else if (page === 'video_tools') {
      resetAll(); setShowVideoTools(true);
      if (subPage) misc.setMiscSubPage(subPage as MiscSubPage);
      else misc.setMiscSubPage('video_gen');
    }
    else if (page === 'text_tools') {
      resetAll(); setShowTextTools(true);
      if (subPage === 'llm' || subPage === 'translate' || subPage === 'code_assist') {
        setTextSubPage(subPage);
        if (subPage !== 'llm') misc.setMiscSubPage(subPage as MiscSubPage);
      }
    }
    else if (page === 'rag') {
      resetAll(); setShowAdvancedTools(true);
      setAdvancedSubPage('rag');
    }
    else if (page === 'agent') {
      resetAll(); setShowAdvancedTools(true);
      setAdvancedSubPage('agent');
    }
    else if (page === 'advanced_tools') {
      resetAll(); setShowAdvancedTools(true);
      if (subPage === 'rag' || subPage === 'agent' || subPage === 'finetune') {
        setAdvancedSubPage(subPage);
      } else {
        setAdvancedSubPage('finetune');
      }
    }
    else if (page === 'misc') {
      // backward compat: misc goes to image_tools
      resetAll(); setShowImageTools(true);
      if (subPage) misc.setMiscSubPage(subPage as MiscSubPage);
    }
    else { resetAll(); setTaskType(page as TaskType); }
  }

  function navigateTasks() {
    setShowHome(false); setShowTasks(true); setTasksTab('tasks');
  }

  // ─── 通用状态 ─────────────────────────────────────────────────────────────
  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');
  const [status, setStatus] = useState<Status>('idle');
  const [processingStartTime, setProcessingStartTime] = useState<number | null>(null);
  const [elapsedSec, setElapsedSec] = useState(0);
  const [processingPhaseStr, setProcessingPhaseStr] = useState('');

  // ─── 深色模式 ─────────────────────────────────────────────────────────────
  const [isDark, setIsDark] = useState(false);
  useEffect(() => { if (localStorage.getItem('theme') === 'dark') setIsDark(true); }, []);
  useEffect(() => { localStorage.setItem('theme', isDark ? 'dark' : 'light'); }, [isDark]);

  // ─── 运行环境检测 ──────────────────────────────────────────────────────────
  const [isElectron, setIsElectron] = useState(false);
  useEffect(() => { setIsElectron(!!window.electronAPI); }, []);

  // (侧边栏已移除，改为顶部导航栏)

  // ─── 共享设置 ─────────────────────────────────────────────────────────────
  const [providerMap, setProviderMap] = useState<Record<string, string>>({
    tts: 'fish_speech', vc: 'seed_vc', asr: 'faster_whisper', llm: 'gemini',
  });
  const [apiKey, setApiKey] = useState('');
  const [cloudEndpoint, setCloudEndpoint] = useState('');
  const [outputDir, setOutputDir] = useState('');

  const selectedProvider = providerMap[taskType] || 'gemini';
  const isLocal = LOCAL_PROVIDERS.has(selectedProvider);
  const isUrlOnly = URL_ONLY_PROVIDERS.has(selectedProvider);
  const needsAuth = !isLocal && !isUrlOnly;

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

  // ─── 全局错误捕获 ────────────────────────────────────────────────────────
  useEffect(() => {
    const onError = (e: ErrorEvent) => rlog('ERROR', `未捕获异常: ${e.message}`, e.filename, `L${e.lineno}`);
    const onUnhandled = (e: PromiseRejectionEvent) => rlog('ERROR', '未处理的 Promise rejection:', String(e.reason));
    window.addEventListener('error', onError);
    window.addEventListener('unhandledrejection', onUnhandled);
    rlog('INFO', '渲染进程启动');
    return () => { window.removeEventListener('error', onError); window.removeEventListener('unhandledrejection', onUnhandled); };
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

  // ─── VC 扩展状态 ──────────────────────────────────────────────────────────
  const [vcInputMode, setVcInputMode] = useState<VcInputMode>('upload');
  const [vcFile, setVcFile] = useState<File | null>(null);
  const [vcRefAudios, setVcRefAudios] = useState<File[]>([]);
  const [seedVcDiffusionSteps, setSeedVcDiffusionSteps] = useState(8);
  const [seedVcPitchShift, setSeedVcPitchShift] = useState(0);
  const [seedVcF0Condition, setSeedVcF0Condition] = useState(false);
  const [seedVcEnablePostprocess, setSeedVcEnablePostprocess] = useState(true);
  const [seedVcCfgRate, setSeedVcCfgRate] = useState(0.7);
  const [rvcF0Method, setRvcF0Method] = useState('rmvpe');
  const [rvcFilterRadius, setRvcFilterRadius] = useState(3);
  const [rvcIndexRate, setRvcIndexRate] = useState(0.75);
  const [rvcPitchShift, setRvcPitchShift] = useState(0);
  const [rvcRmsMixRate, setRvcRmsMixRate] = useState(0.25);
  const [rvcProtect, setRvcProtect] = useState(0.33);

  // ─── 新建音色扩展状态 ─────────────────────────────────────────────────────
  const [showCreateVoice, setShowCreateVoice] = useState(false);
  const [newVoiceName, setNewVoiceName] = useState('');
  const [newVoiceEngine, setNewVoiceEngine] = useState('rvc');
  const [newVoiceModel, setNewVoiceModel] = useState<File | null>(null);
  const [newVoiceIndex, setNewVoiceIndex] = useState<File | null>(null);
  const [newVoiceRef, setNewVoiceRef] = useState<File | null>(null);
  const [newVoiceGptModel, setNewVoiceGptModel] = useState<File | null>(null);
  const [newVoiceSovitsModel, setNewVoiceSovitsModel] = useState<File | null>(null);
  const [newVoiceRefText, setNewVoiceRefText] = useState('');
  const [creatingVoice, setCreatingVoice] = useState(false);

  // ─── 训练状态 ─────────────────────────────────────────────────────────────
  const [trainVoiceName, setTrainVoiceName] = useState('');
  const [trainFiles, setTrainFiles] = useState<File[]>([]);
  // 训练高级参数
  const [trainEpochs, setTrainEpochs] = useState(0);
  const [trainF0Method, setTrainF0Method] = useState('harvest');
  const [trainSampleRate, setTrainSampleRate] = useState(40000);

  // ─── 共享样式常量 ─────────────────────────────────────────────────────────
  const fieldCls = 'w-full rounded-xl border border-slate-200 bg-slate-50/50 px-3.5 py-2.5 text-sm text-slate-800 placeholder:text-slate-400 focus:border-[#1A8FE3] focus:bg-white focus:ring-2 focus:ring-[#1A8FE3]/15 transition-all dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200 dark:placeholder:text-slate-500 dark:focus:bg-slate-700 dark:focus:border-[#1A8FE3]';
  const fileCls  = 'w-full rounded-xl border border-slate-200 bg-slate-50/50 px-3.5 py-2.5 text-sm text-slate-700 file:mr-3 file:rounded-lg file:border-0 file:bg-indigo-50 file:px-3 file:py-1 file:text-xs file:font-medium file:text-indigo-700 hover:file:bg-indigo-100 transition-all dark:border-slate-600 dark:bg-slate-800 dark:text-slate-300 dark:file:bg-indigo-900/50 dark:file:text-indigo-300 dark:hover:file:bg-indigo-900';
  const labelCls = 'block text-xs font-medium text-slate-400 mb-1.5 uppercase tracking-wide dark:text-slate-500';
  const btnSec   = 'rounded-xl border border-slate-200 bg-slate-100 hover:bg-slate-200 px-4 py-2.5 text-sm font-medium text-slate-600 transition-colors dark:border-slate-600 dark:bg-slate-800 dark:hover:bg-slate-700 dark:text-slate-300';

  // ─── Hooks ────────────────────────────────────────────────────────────────
  const backend = useBackend();
  // 首次加载时：如果 outputDir 为空，用后端返回的系统下载目录作为默认值
  useEffect(() => {
    if (!outputDir && backend.downloadDir) setOutputDir(backend.downloadDir);
  }, [backend.downloadDir]);
  // Sync vchatVoiceId from backend hook into voice chat if backend hook manages it separately
  // Actually useBackend manages selectedVoiceId & vchatVoiceId, use them directly

  const { jobs, setJobs, fetchJobs, addInstantJobResult, addPendingJob, resolveJob, pollJobResult } = useJobs(
    backend.backendBaseUrl,
    backend.backendReady,
  );

  const tts = useTTS({
    backendBaseUrl: backend.backendBaseUrl,
    selectedProvider,
    apiKey,
    cloudEndpoint,
    outputDir,
    needsAuth,
    setStatus,
    setProcessingStartTime,
    setError,
    setJobs,
    addInstantJobResult,
  });

  const vc = useVC({
    backendBaseUrl: backend.backendBaseUrl,
    selectedProvider,
    isLocal,
    apiKey,
    cloudEndpoint,
    outputDir,
    needsAuth,
    selectedVoiceId: backend.selectedVoiceId,
    vcRefAudios,
    status,
    setStatus,
    setProcessingStartTime,
    setError,
    setSuccessMsg,
    setJobs,
    addInstantJobResult,
    seedVcDiffusionSteps,
    seedVcPitchShift,
    seedVcF0Condition,
    seedVcEnablePostprocess,
    seedVcCfgRate,
    rvcF0Method,
    rvcFilterRadius,
    rvcIndexRate,
    rvcPitchShift,
    rvcRmsMixRate,
    rvcProtect,
  });

  const asr = useASR({
    backendBaseUrl: backend.backendBaseUrl,
    selectedProvider,
    isLocal,
    apiKey,
    cloudEndpoint,
    needsAuth,
    setStatus,
    setProcessingStartTime,
    setError,
    addInstantJobResult,
  });

  const llm = useLLM({
    backendBaseUrl: backend.backendBaseUrl,
    selectedProvider,
    apiKey,
    cloudEndpoint,
    needsAuth,
    setError,
  });

  const voiceChat = useVoiceChat({
    backendBaseUrl: backend.backendBaseUrl,
    setError,
    pollJobResult,
  });

  const media = useMediaConvert({
    backendBaseUrl: backend.backendBaseUrl,
    outputDir,
    setStatus,
    setProcessingStartTime,
    setError,
    addPendingJob,
    resolveJob,
  });

  const toolbox = useToolbox({
    backendBaseUrl: backend.backendBaseUrl,
    outputDir,
    setStatus,
    setProcessingStartTime,
    setError,
    addInstantJobResult,
  });

  const doc = useDocConvert({
    backendBaseUrl: backend.backendBaseUrl,
    outputDir,
    setStatus,
    setProcessingStartTime,
    setError,
    addPendingJob,
    resolveJob,
  });

  const misc = useMisc({
    backendBaseUrl: backend.backendBaseUrl,
    apiKey,
    cloudEndpoint,
    setStatus,
    setProcessingStartTime,
    setError,
    addInstantJobResult,
    fetchJobs,
  });

  const imageExt = useImageExt({
    backendBaseUrl: backend.backendBaseUrl,
    apiKey,
    cloudEndpoint,
    setStatus,
    setProcessingStartTime,
    setError,
    addInstantJobResult,
    fetchJobs,
  });

  // ─── 新建音色 ─────────────────────────────────────────────────────────────
  async function createVoice() {
    const trimmedName = newVoiceName.trim();
    if (!trimmedName) { setError('请填写音色名称'); return; }
    const duplicate = backend.voices.some(v => v.name.toLowerCase() === trimmedName.toLowerCase());
    if (duplicate) { setError(`音色名称「${trimmedName}」已存在，请使用其他名称`); return; }
    setCreatingVoice(true); setError(''); setSuccessMsg('');
    try {
      const fd = new FormData();
      fd.append('voice_name', newVoiceName.trim());
      fd.append('engine', newVoiceEngine);
      if (newVoiceModel) fd.append('model_file', newVoiceModel);
      if (newVoiceIndex) fd.append('index_file', newVoiceIndex);
      if (newVoiceRef) fd.append('reference_audio', newVoiceRef);
      if (newVoiceGptModel) fd.append('gpt_model_file', newVoiceGptModel);
      if (newVoiceSovitsModel) fd.append('sovits_model_file', newVoiceSovitsModel);
      if (newVoiceRefText.trim()) fd.append('ref_text', newVoiceRefText.trim());
      const res = await fetch(`${backend.backendBaseUrl}/voices/create`, { method: 'POST', body: fd });
      let data: any = null;
      try { data = await res.json(); } catch { /**/ }
      if (!res.ok) throw new Error(`创建失败（${res.status}）${data?.detail ? `：${data.detail}` : ''}`);
      setSuccessMsg(`音色已创建：${data.voice_name}（ID: ${data.voice_id}）`);
      setShowCreateVoice(false);
      setNewVoiceName(''); setNewVoiceModel(null); setNewVoiceIndex(null); setNewVoiceRef(null);
      setNewVoiceGptModel(null); setNewVoiceSovitsModel(null); setNewVoiceRefText('');
      await backend.fetchVoices();
      backend.setSelectedVoiceId(data.voice_id);
    } catch (e) {
      setError(e instanceof Error ? e.message : '创建音色失败');
    } finally {
      setCreatingVoice(false);
    }
  }

  // ─── 重命名音色 ───────────────────────────────────────────────────────────
  async function renameVoice(voiceId: string, newName: string) {
    try {
      const fd = new FormData();
      fd.append('voice_name', newName);
      const res = await fetch(`${backend.backendBaseUrl}/voices/${voiceId}`, { method: 'PATCH', body: fd });
      if (!res.ok) {
        let data: any = null;
        try { data = await res.json(); } catch { /**/ }
        throw new Error(`重命名失败（${res.status}）${data?.detail ? `：${data.detail}` : ''}`);
      }
      await backend.fetchVoices();
    } catch (e) {
      setError(e instanceof Error ? e.message : '重命名音色失败');
    }
  }

  // ─── 删除音色 ─────────────────────────────────────────────────────────────
  async function deleteVoice(voiceId: string) {
    const voice = backend.voices.find(v => v.voice_id === voiceId);
    const name = voice?.name || voiceId;
    if (!window.confirm(`确定要删除音色「${name}」吗？此操作不可撤销。`)) return;
    try {
      const res = await fetch(`${backend.backendBaseUrl}/voices/${voiceId}`, { method: 'DELETE' });
      if (!res.ok) {
        let data: any = null;
        try { data = await res.json(); } catch { /**/ }
        throw new Error(`删除失败（${res.status}）${data?.detail ? `：${data.detail}` : ''}`);
      }
      await backend.fetchVoices();
    } catch (e) {
      setError(e instanceof Error ? e.message : '删除音色失败');
    }
  }

  // ─── 训练 ─────────────────────────────────────────────────────────────────
  async function startTraining() {
    const trimmedName = trainVoiceName.trim();
    if (!trainFiles || trainFiles.length === 0) { setError('请先选择训练数据集'); return; }
    if (!trimmedName) { setError('请输入音色名称'); return; }
    const duplicate = backend.voices.some(v => v.name.toLowerCase() === trimmedName.toLowerCase());
    if (duplicate) { setError(`音色名称「${trimmedName}」已存在，请使用其他名称`); return; }
    setError(''); setSuccessMsg('');
    const normalized = trimmedName.toLowerCase().replace(/[^a-z0-9_-]+/g, '_').replace(/^_+|_+$/g, '');
    const autoVoiceId = `${normalized || 'voice'}_${Date.now().toString().slice(-6)}`;
    const fd = new FormData();
    const isZipOnly = trainFiles.length === 1 && trainFiles[0].name.toLowerCase().endsWith('.zip');
    if (isZipOnly) {
      fd.append('dataset', trainFiles[0]);
    } else {
      const { packFilesToZip } = await import('../utils');
      const zipBlob = await packFilesToZip(trainFiles);
      fd.append('dataset', zipBlob, 'dataset.zip');
    }
    fd.append('voice_id', autoVoiceId);
    fd.append('voice_name', trimmedName);
    fd.append('epochs', String(trainEpochs));
    fd.append('f0_method', trainF0Method);
    fd.append('sample_rate', String(trainSampleRate));
    try {
      const res = await fetch(`${backend.backendBaseUrl}/train`, { method: 'POST', body: fd });
      let data: any = null;
      try { data = await res.json(); } catch { /**/ }
      if (!res.ok) throw new Error(`训练失败（${res.status}）${data?.detail ? `：${data.detail}` : ''}`);
      const pending: import('../types').Job = {
        id: data.job_id,
        type: 'train',
        label: `训练 · ${trimmedName}`,
        provider: 'local_rvc',
        is_local: true,
        status: 'queued',
        created_at: Date.now() / 1000,
        started_at: null,
        completed_at: null,
        result_url: null,
        result_text: null,
        error: null,
      };
      setJobs(prev => [pending, ...prev]);
    } catch (e) {
      setError(e instanceof Error ? e.message : '训练失败');
    }
  }

  // ─── 获取当前任务的 abortCtrl（用于取消按钮） ────────────────────────────
  // 各 hook 内部管理自己的 abortCtrl，通过各自暴露的 abort 函数调用
  function handleAbort() {
    vc.abortCurrentRequest();
    asr.abortCurrentRequest();
    media.abortCurrentRequest();
  }

  // ─── 渲染 ─────────────────────────────────────────────────────────────────
  return (
    <div className={`flex flex-col h-screen overflow-hidden bg-slate-50 text-slate-900 dark:bg-slate-950 dark:text-slate-100 ${isDark ? 'dark' : ''}`}>

      <TopNav
        currentPage={currentPage}
        jobs={jobs}
        isDark={isDark}
        setIsDark={setIsDark}
        onNavigate={navigate}
      />

      {/* ── 主内容区 ── */}
      <div className="flex-1 overflow-y-auto min-w-0 bg-slate-50 dark:bg-slate-950">
        <div className="p-6 md:p-8">
          <div className="mx-auto w-full space-y-5 max-w-5xl">

            {/* 首页 */}
            {showHome && <HomePanel onNavigate={(page, sub) => navigate(page as Page, sub)} jobs={jobs} backendBaseUrl={backend.backendBaseUrl} />}

            {/* 任务列表 + 设置 */}
            {showTasks && (() => {
              const TASKS_TABS = [
                { id: 'tasks',  label: '任务列表' },
                { id: 'about',  label: '功能说明' },
                ...(isElectron ? [{ id: 'models', label: '模型管理' }] : []),
              ] as const;
              return (
                <>
                  <div className="flex gap-1 rounded-2xl bg-slate-100 dark:bg-slate-800 p-1 mb-5">
                    {TASKS_TABS.map(t => (
                      <button key={t.id}
                        className={`flex-1 px-3 py-2 rounded-xl text-sm font-medium transition-all ${
                          tasksTab === t.id
                            ? 'bg-white dark:bg-slate-700 text-slate-800 dark:text-slate-100 shadow-sm'
                            : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300'
                        }`}
                        onClick={() => {
                          setTasksTab(t.id as typeof tasksTab);
                          if (t.id === 'tasks') fetchJobs();
                        }}>
                        {t.label}
                      </button>
                    ))}
                  </div>
                  {tasksTab === 'tasks' && (
                    <>
                      <TaskList
                        jobs={jobs}
                        backendBaseUrl={backend.backendBaseUrl}
                        setJobs={setJobs}
                        onFetchJobs={fetchJobs}
                        outputDir={outputDir}
                        downloadDir={backend.downloadDir}
                        addInstantJobResult={addInstantJobResult}
                      />
                      <div className="mt-6">
                        <SystemPanel
                          backendBaseUrl={backend.backendBaseUrl}
                          isElectron={isElectron}
                          externalSection="perf"
                        />
                      </div>
                    </>
                  )}
                  {tasksTab !== 'tasks' && (
                    <SystemPanel
                      backendBaseUrl={backend.backendBaseUrl}
                      isElectron={isElectron}
                      externalSection={tasksTab}
                    />
                  )}
                </>
              );
            })()}

            {/* 音频工具标题栏 + 子 Tab */}
            {showAudioTools && (
              <div className="pb-1">
                <header className="flex items-center gap-3.5 pb-3">
                  <svg width="36" height="36" viewBox="0 0 28 28" style={{ flexShrink: 0 }}>
                    <rect width="28" height="28" rx="7" fill="#4f46e5"/>
                    <rect x="5" y="13" width="2.5" height="6" rx="1.2" fill="#c7d2fe"/>
                    <rect x="9" y="9" width="2.5" height="10" rx="1.2" fill="#a5b4fc"/>
                    <rect x="13" y="6" width="2.5" height="16" rx="1.2" fill="#818cf8"/>
                    <rect x="17" y="10" width="2.5" height="8" rx="1.2" fill="#a5b4fc"/>
                    <rect x="21" y="14" width="2.5" height="4" rx="1.2" fill="#c7d2fe"/>
                  </svg>
                  <div>
                    <h1 className="text-xl font-bold tracking-tight text-slate-900 dark:text-slate-100">AI音频</h1>
                    <p className="text-xs text-slate-400 font-medium mt-0.5">TTS · VC · STT · LLM · 语音</p>
                  </div>
                </header>
                <div className="flex gap-1 rounded-2xl bg-slate-100 dark:bg-slate-800 p-1">
                  {([
                    ['tts',        '文本转语音', 'TTS'  ],
                    ['vc',         '音色转换',   'VC'   ],
                    ['asr',        '语音转文本', 'STT'  ],
                    ['voice_chat', '语音聊天',   'Voice'],
                  ] as [TaskType, string, string][]).map(([key, label, abbr]) => (
                    <button key={key} onClick={() => setTaskType(key)}
                      className={`flex-1 rounded-xl py-2 flex flex-col items-center gap-0.5 transition-all ${taskType === key ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100 shadow-sm' : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'}`}>
                      <span className="text-sm font-medium leading-tight">{label}</span>
                      <span className={`text-[10px] font-mono leading-tight ${taskType === key ? 'text-indigo-500 dark:text-indigo-400' : 'text-slate-400 dark:text-slate-600'}`}>{abbr}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* 格式转换标题栏 */}
            {showFormatConvert && (
              <header className="flex items-center gap-3.5 pb-1">
                <svg width="36" height="36" viewBox="0 0 28 28" style={{ flexShrink: 0 }}>
                  <rect width="28" height="28" rx="7" fill="#0f766e"/>
                  <path d="M7 10h10M7 10l3-3M7 10l3 3" stroke="#99f6e4" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                  <path d="M21 18H11M21 18l-3-3M21 18l-3 3" stroke="#5eead4" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
                <div>
                  <h1 className="text-xl font-bold tracking-tight text-slate-900 dark:text-slate-100">格式转换</h1>
                  <p className="text-xs text-slate-400 font-medium mt-0.5">音视频 · 文档</p>
                </div>
              </header>
            )}

            {/* 扩展功能标题栏 */}
            {!showHome && !showTasks && !showAudioTools && !showFormatConvert && taskType === 'misc' && (
              <header className="flex items-center gap-3.5 pb-1">
                <TaskIcon task="misc" size={36} />
                <div>
                  <h1 className="text-xl font-bold tracking-tight text-slate-900 dark:text-slate-100">{TASK_LABELS['misc']}</h1>
                  <p className="text-xs text-slate-400 font-medium mt-0.5">{TASK_ICON_CFG['misc'].abbr}</p>
                </div>
              </header>
            )}

            {/* TTS 面板 */}
            {showAudioTools && taskType === 'tts' && (
              <TtsPanel
                taskType="tts"
                capabilities={backend.capabilities}
                selectedProvider={selectedProvider}
                needsAuth={needsAuth}
                isUrlOnly={isUrlOnly}
                apiKey={apiKey}
                cloudEndpoint={cloudEndpoint}
                engineVersions={backend.engineVersions}
                setProviderMap={setProviderMap}
                setApiKey={setApiKey}
                setCloudEndpoint={setCloudEndpoint}
                ttsText={tts.ttsText}
                setTtsText={tts.setTtsText}
                ttsModel={tts.ttsModel}
                setTtsModel={tts.setTtsModel}
                ttsVoice={tts.ttsVoice}
                setTtsVoice={tts.setTtsVoice}
                ttsRefAudios={tts.ttsRefAudios}
                setTtsRefAudios={tts.setTtsRefAudios}
                ttsRefInputMode={tts.ttsRefInputMode}
                setTtsRefInputMode={tts.setTtsRefInputMode}
                ttsRefRecordedObjectUrl={tts.ttsRefRecordedObjectUrl}
                ttsRecordingDir={tts.ttsRecordingDir}
                onStartTtsRefRecording={tts.startTtsRefRecording}
                onStopTtsRefRecording={tts.stopTtsRefRecording}
                onClearTtsRefRecording={tts.clearTtsRefRecording}
                voices={backend.voices}
                ttsVoiceId={tts.ttsVoiceId}
                setTtsVoiceId={tts.setTtsVoiceId}
                onRefreshVoices={backend.fetchVoices}
                onRenameVoice={renameVoice}
                onDeleteVoice={deleteVoice}
                gptSovitsTextLang={tts.gptSovitsTextLang}
                setGptSovitsTextLang={tts.setGptSovitsTextLang}
                gptSovitsPromptLang={tts.gptSovitsPromptLang}
                setGptSovitsPromptLang={tts.setGptSovitsPromptLang}
                gptSovitsRefText={tts.gptSovitsRefText}
                setGptSovitsRefText={tts.setGptSovitsRefText}
                gptSovitsTopK={tts.gptSovitsTopK}
                setGptSovitsTopK={tts.setGptSovitsTopK}
                gptSovitsTopP={tts.gptSovitsTopP}
                setGptSovitsTopP={tts.setGptSovitsTopP}
                gptSovitsTemperature={tts.gptSovitsTemperature}
                setGptSovitsTemperature={tts.setGptSovitsTemperature}
                gptSovitsSpeed={tts.gptSovitsSpeed}
                setGptSovitsSpeed={tts.setGptSovitsSpeed}
                gptSovitsRepetitionPenalty={tts.gptSovitsRepetitionPenalty}
                setGptSovitsRepetitionPenalty={tts.setGptSovitsRepetitionPenalty}
                gptSovitsSeed={tts.gptSovitsSeed}
                setGptSovitsSeed={tts.setGptSovitsSeed}
                gptSovitsTextSplitMethod={tts.gptSovitsTextSplitMethod}
                setGptSovitsTextSplitMethod={tts.setGptSovitsTextSplitMethod}
                gptSovitsBatchSize={tts.gptSovitsBatchSize}
                setGptSovitsBatchSize={tts.setGptSovitsBatchSize}
                gptSovitsParallelInfer={tts.gptSovitsParallelInfer}
                setGptSovitsParallelInfer={tts.setGptSovitsParallelInfer}
                gptSovitsFragmentInterval={tts.gptSovitsFragmentInterval}
                setGptSovitsFragmentInterval={tts.setGptSovitsFragmentInterval}
                gptSovitsSampleSteps={tts.gptSovitsSampleSteps}
                setGptSovitsSampleSteps={tts.setGptSovitsSampleSteps}
                showCreateVoice={showCreateVoice}
                setShowCreateVoice={setShowCreateVoice}
                newVoiceEngine={newVoiceEngine}
                setNewVoiceEngine={setNewVoiceEngine}
                newVoiceName={newVoiceName}
                setNewVoiceName={setNewVoiceName}
                creatingVoice={creatingVoice}
                setNewVoiceModel={setNewVoiceModel}
                setNewVoiceIndex={setNewVoiceIndex}
                setNewVoiceRef={setNewVoiceRef}
                setNewVoiceGptModel={setNewVoiceGptModel}
                setNewVoiceSovitsModel={setNewVoiceSovitsModel}
                newVoiceRefText={newVoiceRefText}
                setNewVoiceRefText={setNewVoiceRefText}
                onCreateVoice={createVoice}
                trainVoiceName={trainVoiceName}
                setTrainVoiceName={setTrainVoiceName}
                trainFiles={trainFiles}
                setTrainFiles={setTrainFiles}
                onStartTraining={startTraining}
                outputDir={outputDir}
                setOutputDir={setOutputDir}
                status={status}
                onRunTts={tts.runTts}
                fieldCls={fieldCls}
                fileCls={fileCls}
                labelCls={labelCls}
                btnSec={btnSec}
              />
            )}

            {/* VC 面板 */}
            {showAudioTools && taskType === 'vc' && (
              <VcPanel
                taskType="vc"
                capabilities={backend.capabilities}
                selectedProvider={selectedProvider}
                isLocal={isLocal}
                needsAuth={needsAuth}
                isUrlOnly={isUrlOnly}
                apiKey={apiKey}
                cloudEndpoint={cloudEndpoint}
                engineVersions={backend.engineVersions}
                setProviderMap={setProviderMap}
                setApiKey={setApiKey}
                setCloudEndpoint={setCloudEndpoint}
                selectedVoiceId={backend.selectedVoiceId}
                setSelectedVoiceId={backend.setSelectedVoiceId}
                voices={backend.voices}
                onRefreshVoices={backend.fetchVoices}
                vcInputMode={vcInputMode}
                setVcInputMode={setVcInputMode}
                vcFile={vcFile}
                setVcFile={setVcFile}
                vcRefAudios={vcRefAudios}
                setVcRefAudios={setVcRefAudios}
                showCreateVoice={showCreateVoice}
                setShowCreateVoice={setShowCreateVoice}
                newVoiceEngine={newVoiceEngine}
                setNewVoiceEngine={setNewVoiceEngine}
                newVoiceName={newVoiceName}
                setNewVoiceName={setNewVoiceName}
                creatingVoice={creatingVoice}
                setNewVoiceModel={setNewVoiceModel}
                setNewVoiceIndex={setNewVoiceIndex}
                setNewVoiceRef={setNewVoiceRef}
                onCreateVoice={createVoice}
                onDeleteVoice={deleteVoice}
                onRenameVoice={renameVoice}
                outputDir={outputDir}
                setOutputDir={setOutputDir}
                status={status}
                vcRecordedFile={vc.vcRecordedFile}
                vcRecordedObjectUrl={vc.vcRecordedObjectUrl}
                vcRecordingDir={vc.vcRecordingDir}
                onClearVcRecording={vc.clearVcRecording}
                onHandleVoiceConvert={vc.handleVoiceConvert}
                onStartVcRecording={vc.startVcRecording}
                onStopVcRecording={vc.stopVcRecording}
                seedVcDiffusionSteps={seedVcDiffusionSteps}
                setSeedVcDiffusionSteps={setSeedVcDiffusionSteps}
                seedVcPitchShift={seedVcPitchShift}
                setSeedVcPitchShift={setSeedVcPitchShift}
                seedVcF0Condition={seedVcF0Condition}
                setSeedVcF0Condition={setSeedVcF0Condition}
                seedVcEnablePostprocess={seedVcEnablePostprocess}
                setSeedVcEnablePostprocess={setSeedVcEnablePostprocess}
                seedVcCfgRate={seedVcCfgRate}
                setSeedVcCfgRate={setSeedVcCfgRate}
                rvcF0Method={rvcF0Method}
                setRvcF0Method={setRvcF0Method}
                rvcFilterRadius={rvcFilterRadius}
                setRvcFilterRadius={setRvcFilterRadius}
                rvcIndexRate={rvcIndexRate}
                setRvcIndexRate={setRvcIndexRate}
                rvcPitchShift={rvcPitchShift}
                setRvcPitchShift={setRvcPitchShift}
                rvcRmsMixRate={rvcRmsMixRate}
                setRvcRmsMixRate={setRvcRmsMixRate}
                rvcProtect={rvcProtect}
                setRvcProtect={setRvcProtect}
                trainVoiceName={trainVoiceName}
                setTrainVoiceName={setTrainVoiceName}
                trainFiles={trainFiles}
                setTrainFiles={setTrainFiles}
                trainEpochs={trainEpochs}
                setTrainEpochs={setTrainEpochs}
                trainF0Method={trainF0Method}
                setTrainF0Method={setTrainF0Method}
                trainSampleRate={trainSampleRate}
                setTrainSampleRate={setTrainSampleRate}
                onStartTraining={startTraining}
                fieldCls={fieldCls}
                fileCls={fileCls}
                labelCls={labelCls}
                btnSec={btnSec}
              />
            )}

            {/* ASR 面板 */}
            {showAudioTools && taskType === 'asr' && (
              <AsrPanel
                taskType="asr"
                capabilities={backend.capabilities}
                selectedProvider={selectedProvider}
                needsAuth={needsAuth}
                isUrlOnly={isUrlOnly}
                apiKey={apiKey}
                cloudEndpoint={cloudEndpoint}
                engineVersions={backend.engineVersions}
                setProviderMap={setProviderMap}
                setApiKey={setApiKey}
                setCloudEndpoint={setCloudEndpoint}
                asrFile={asr.asrFile}
                setAsrFile={asr.setAsrFile}
                asrModel={asr.asrModel}
                setAsrModel={asr.setAsrModel}
                asrInputMode={asr.asrInputMode}
                setAsrInputMode={asr.setAsrInputMode}
                asrRecordedObjectUrl={asr.asrRecordedObjectUrl}
                asrRecordingDir={asr.asrRecordingDir}
                onStartAsrRecording={asr.startAsrRecording}
                onStopAsrRecording={asr.stopAsrRecording}
                onClearAsrRecording={asr.clearAsrRecording}
                outputDir={outputDir}
                status={status}
                onRunAsr={asr.runAsr}
                fieldCls={fieldCls}
                labelCls={labelCls}
              />
            )}

            {/* LLM 聊天面板 */}
            {showAudioTools && taskType === 'llm' && (
              <LlmPanel
                taskType="llm"
                capabilities={backend.capabilities}
                selectedProvider={selectedProvider}
                needsAuth={needsAuth}
                isUrlOnly={isUrlOnly}
                apiKey={apiKey}
                cloudEndpoint={cloudEndpoint}
                engineVersions={backend.engineVersions}
                setProviderMap={setProviderMap}
                setApiKey={setApiKey}
                setCloudEndpoint={setCloudEndpoint}
                llmMessages={llm.llmMessages}
                setLlmMessages={llm.setLlmMessages}
                llmInput={llm.llmInput}
                setLlmInput={llm.setLlmInput}
                llmModel={llm.llmModel}
                setLlmModel={llm.setLlmModel}
                llmLoading={llm.llmLoading}
                llmScrollRef={llm.llmScrollRef}
                onSendLlmMessage={llm.sendLlmMessage}
                fieldCls={fieldCls}
                labelCls={labelCls}
              />
            )}

            {/* 语音聊天面板 */}
            {showAudioTools && taskType === 'voice_chat' && (
              <VoiceChatPanel
                vchatMsgs={voiceChat.vchatMsgs}
                setVchatMsgs={voiceChat.setVchatMsgs}
                vchatStatus={voiceChat.vchatStatus}
                vchatSttProvider={voiceChat.vchatSttProvider}
                setVchatSttProvider={voiceChat.setVchatSttProvider}
                vchatSttModel={voiceChat.vchatSttModel}
                setVchatSttModel={voiceChat.setVchatSttModel}
                vchatLlmProvider={voiceChat.vchatLlmProvider}
                setVchatLlmProvider={voiceChat.setVchatLlmProvider}
                vchatLlmModel={voiceChat.vchatLlmModel}
                setVchatLlmModel={voiceChat.setVchatLlmModel}
                vchatTtsProvider={voiceChat.vchatTtsProvider}
                setVchatTtsProvider={voiceChat.setVchatTtsProvider}
                vchatTtsModel={voiceChat.vchatTtsModel}
                setVchatTtsModel={voiceChat.setVchatTtsModel}
                vchatTtsRefAudios={voiceChat.vchatTtsRefAudios}
                setVchatTtsRefAudios={voiceChat.setVchatTtsRefAudios}
                vchatApiKey={voiceChat.vchatApiKey}
                setVchatApiKey={voiceChat.setVchatApiKey}
                vchatEndpoint={voiceChat.vchatEndpoint}
                setVchatEndpoint={voiceChat.setVchatEndpoint}
                capabilities={backend.capabilities}
                engineVersions={backend.engineVersions}
                vchatScrollRef={voiceChat.vchatScrollRef}
                onStartRecording={voiceChat.startVchatRecording}
                onStopRecording={voiceChat.stopVchatRecording}
                downloadDir={backend.downloadDir}
                fieldCls={fieldCls}
                labelCls={labelCls}
                btnSec={btnSec}
              />
            )}

            {/* 格式转换：外部两行标签 + 内容 */}
            {showFormatConvert && (
              <>
                <div className="space-y-1">
                  {/* 音视频工具 */}
                  <div className="flex gap-1 rounded-2xl bg-slate-100 dark:bg-slate-800 p-1">
                    {([
                      { value: 'convert' as MediaAction,          label: '音视频转换', pkg: 'ffmpeg' },
                      { value: 'clip' as MediaAction,             label: '截取片段',   pkg: 'ffmpeg' },
                      { value: 'subtitle_extract' as MediaAction, label: '提取字幕',   pkg: 'ffmpeg' },
                      { value: 'subtitle_convert' as MediaAction, label: '字幕互转',   pkg: 'ffmpeg' },
                    ]).map(opt => {
                      const active = formatGroup === 'media' && media.mediaAction === opt.value;
                      return (
                        <button key={opt.value}
                          className={`flex-1 rounded-xl py-2 flex flex-col items-center gap-0.5 transition-all ${active ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100 shadow-sm' : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'}`}
                          onClick={() => { setFormatGroup('media'); media.setMediaAction(opt.value); }}>
                          <span className="text-sm font-medium leading-tight">{opt.label}</span>
                          <span className={`text-[10px] font-mono leading-tight ${active ? 'text-teal-500 dark:text-teal-400' : 'text-slate-400 dark:text-slate-600'}`}>{opt.pkg}</span>
                        </button>
                      );
                    })}
                  </div>
                  {/* 文档工具 */}
                  <div className="flex gap-1 rounded-2xl bg-slate-100 dark:bg-slate-800 p-1">
                    {([
                      { value: 'pdf_to_word' as DocSubPage,   label: 'PDF 转 Word', pkg: 'pdf2docx' },
                      { value: 'doc_convert' as DocSubPage,   label: '文档互转',    pkg: 'pandoc'   },
                      { value: 'pdf_extract' as DocSubPage,   label: 'PDF 提取',    pkg: 'PyMuPDF'  },
                      { value: 'image' as DocSubPage,         label: '图片处理',    pkg: 'Pillow'   },
                      { value: 'qr' as DocSubPage,            label: '二维码',      pkg: 'qrcode'   },
                      { value: 'text_encoding' as DocSubPage, label: '编码转换',    pkg: 'chardet'  },
                    ]).map(opt => {
                      const active = formatGroup === 'doc' && doc.docSubPage === opt.value;
                      return (
                        <button key={opt.value}
                          className={`flex-1 rounded-xl py-2 flex flex-col items-center gap-0.5 transition-all ${active ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100 shadow-sm' : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'}`}
                          onClick={() => { setFormatGroup('doc'); doc.setDocSubPage(opt.value); doc.setDocFile(null); }}>
                          <span className="text-sm font-medium leading-tight">{opt.label}</span>
                          <span className={`text-[10px] font-mono leading-tight ${active ? 'text-amber-500 dark:text-amber-400' : 'text-slate-400 dark:text-slate-600'}`}>{opt.pkg}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {formatGroup === 'media' && (
                  <MediaPanel
                    mediaFile={media.mediaFile}
                    setMediaFile={media.setMediaFile}
                    mediaAction={media.mediaAction}
                    setMediaAction={media.setMediaAction}
                    mediaOutputFormat={media.mediaOutputFormat}
                    setMediaOutputFormat={media.setMediaOutputFormat}
                    startMin={media.startMin}
                    setStartMin={media.setStartMin}
                    startSec={media.startSec}
                    setStartSec={media.setStartSec}
                    clipEndMode={media.clipEndMode}
                    setClipEndMode={media.setClipEndMode}
                    durationMin={media.durationMin}
                    setDurationMin={media.setDurationMin}
                    durationSec={media.durationSec}
                    setDurationSec={media.setDurationSec}
                    endMin={media.endMin}
                    setEndMin={media.setEndMin}
                    endSec={media.endSec}
                    setEndSec={media.setEndSec}
                    subtitleOutputFmt={media.subtitleOutputFmt}
                    setSubtitleOutputFmt={media.setSubtitleOutputFmt}
                    hwAccel={media.hwAccel}
                    setHwAccel={media.setHwAccel}
                    hwAccelDetected={hwAccelDetected}
                    outputDir={outputDir}
                    setOutputDir={setOutputDir}
                    status={status}
                    onRunMediaConvert={() => { media.runMediaConvert(); }}
                    onRunSubtitleConvert={() => { media.runSubtitleConvert(); }}
                    fieldCls={fieldCls}
                    fileCls={fileCls}
                    labelCls={labelCls}
                    btnSec={btnSec}
                  />
                )}

                {formatGroup === 'doc' && (
                  <DocPanel
                    docSubPage={doc.docSubPage}
                    setDocSubPage={doc.setDocSubPage}
                    docFile={doc.docFile}
                    setDocFile={doc.setDocFile}
                    docOutputFormat={doc.docOutputFormat}
                    setDocOutputFormat={doc.setDocOutputFormat}
                    docExtractMode={doc.docExtractMode}
                    setDocExtractMode={doc.setDocExtractMode}
                    onRunDocConvert={doc.runDocConvert}
                    imgFile={toolbox.imgFile} setImgFile={toolbox.setImgFile}
                    imgOutputFmt={toolbox.imgOutputFmt} setImgOutputFmt={toolbox.setImgOutputFmt}
                    imgResizeW={toolbox.imgResizeW} setImgResizeW={toolbox.setImgResizeW}
                    imgResizeH={toolbox.imgResizeH} setImgResizeH={toolbox.setImgResizeH}
                    imgQuality={toolbox.imgQuality} setImgQuality={toolbox.setImgQuality}
                    qrMode={toolbox.qrMode} setQrMode={toolbox.setQrMode}
                    qrText={toolbox.qrText} setQrText={toolbox.setQrText}
                    qrFile={toolbox.qrFile} setQrFile={toolbox.setQrFile}
                    encFile={toolbox.encFile} setEncFile={toolbox.setEncFile}
                    encTarget={toolbox.encTarget} setEncTarget={toolbox.setEncTarget}
                    onRunToolbox={() => toolbox.runToolbox(doc.docSubPage as ToolboxSubPage)}
                    outputDir={outputDir}
                    setOutputDir={setOutputDir}
                    status={status}
                    fieldCls={fieldCls}
                    fileCls={fileCls}
                    labelCls={labelCls}
                    btnSec={btnSec}
                  />
                )}
              </>
            )}

            {/* 扩展功能面板 */}
            {!showHome && !showTasks && !showAudioTools && !showFormatConvert && taskType === 'misc' && (
              <MiscPanel
                miscSubPage={misc.miscSubPage}
                setMiscSubPage={misc.setMiscSubPage}
                apiKey={apiKey}
                setApiKey={setApiKey}
                cloudEndpoint={cloudEndpoint}
                setCloudEndpoint={setCloudEndpoint}
                status={status}
                outputDir={outputDir}
                setOutputDir={setOutputDir}
                imageGenProvider={misc.imageGenProvider}
                onImageGenProviderChange={misc.handleImageGenProviderChange}
                imageGenPrompt={misc.imageGenPrompt}
                setImageGenPrompt={misc.setImageGenPrompt}
                imageGenModel={misc.imageGenModel}
                setImageGenModel={misc.setImageGenModel}
                imageGenSize={misc.imageGenSize}
                setImageGenSize={misc.setImageGenSize}
                onRunImageGen={misc.runImageGen}
                imageUnderstandProvider={misc.imageUnderstandProvider}
                onImageUnderstandProviderChange={misc.handleImageUnderstandProviderChange}
                imageUnderstandFile={misc.imageUnderstandFile}
                setImageUnderstandFile={misc.setImageUnderstandFile}
                imageUnderstandPrompt={misc.imageUnderstandPrompt}
                setImageUnderstandPrompt={misc.setImageUnderstandPrompt}
                imageUnderstandModel={misc.imageUnderstandModel}
                setImageUnderstandModel={misc.setImageUnderstandModel}
                onRunImageUnderstand={misc.runImageUnderstand}
                translateProvider={misc.translateProvider}
                setTranslateProvider={misc.setTranslateProvider}
                translateText={misc.translateText}
                setTranslateText={misc.setTranslateText}
                translateTarget={misc.translateTarget}
                setTranslateTarget={misc.setTranslateTarget}
                translateSource={misc.translateSource}
                setTranslateSource={misc.setTranslateSource}
                translateModel={misc.translateModel}
                setTranslateModel={misc.setTranslateModel}
                onRunTranslate={misc.runTranslate}
                codeProvider={misc.codeProvider}
                setCodeProvider={misc.setCodeProvider}
                codeModel={misc.codeModel}
                setCodeModel={misc.setCodeModel}
                codeMessages={misc.codeMessages}
                setCodeMessages={misc.setCodeMessages}
                codeInput={misc.codeInput}
                setCodeInput={misc.setCodeInput}
                codeLoading={misc.codeLoading}
                codeLang={misc.codeLang}
                setCodeLang={misc.setCodeLang}
                onSendCodeMessage={misc.sendCodeMessage}
                imgGenProvider={imageExt.imgGenProvider}
                onImgGenProviderChange={imageExt.handleImgGenProviderChange}
                imgGenPrompt={imageExt.imgGenPrompt}
                setImgGenPrompt={imageExt.setImgGenPrompt}
                imgGenModel={imageExt.imgGenModel}
                setImgGenModel={imageExt.setImgGenModel}
                imgGenSize={imageExt.imgGenSize}
                setImgGenSize={imageExt.setImgGenSize}
                imgGenComfyUrl={imageExt.imgGenComfyUrl}
                setImgGenComfyUrl={imageExt.setImgGenComfyUrl}
                onRunImgGen={imageExt.runImgGen}
                imgI2iProvider={imageExt.imgI2iProvider}
                onImgI2iProviderChange={imageExt.handleImgI2iProviderChange}
                imgI2iSourceFile={imageExt.imgI2iSourceFile}
                setImgI2iSourceFile={imageExt.setImgI2iSourceFile}
                imgI2iRefFile={imageExt.imgI2iRefFile}
                setImgI2iRefFile={imageExt.setImgI2iRefFile}
                imgI2iPrompt={imageExt.imgI2iPrompt}
                setImgI2iPrompt={imageExt.setImgI2iPrompt}
                imgI2iModel={imageExt.imgI2iModel}
                setImgI2iModel={imageExt.setImgI2iModel}
                imgI2iStrength={imageExt.imgI2iStrength}
                setImgI2iStrength={imageExt.setImgI2iStrength}
                imgI2iComfyUrl={imageExt.imgI2iComfyUrl}
                setImgI2iComfyUrl={imageExt.setImgI2iComfyUrl}
                onRunImgI2i={imageExt.runImgI2i}
                videoGenProvider={imageExt.videoGenProvider}
                onVideoGenProviderChange={imageExt.handleVideoGenProviderChange}
                videoGenPrompt={imageExt.videoGenPrompt}
                setVideoGenPrompt={imageExt.setVideoGenPrompt}
                videoGenModel={imageExt.videoGenModel}
                setVideoGenModel={imageExt.setVideoGenModel}
                videoGenDuration={imageExt.videoGenDuration}
                setVideoGenDuration={imageExt.setVideoGenDuration}
                videoGenMode={imageExt.videoGenMode}
                setVideoGenMode={imageExt.setVideoGenMode}
                videoGenImageFile={imageExt.videoGenImageFile}
                setVideoGenImageFile={imageExt.setVideoGenImageFile}
                onRunVideoGen={imageExt.runVideoGen}
                ocrProvider={imageExt.ocrProvider}
                onOcrProviderChange={imageExt.handleOcrProviderChange}
                ocrFile={imageExt.ocrFile}
                setOcrFile={imageExt.setOcrFile}
                ocrModel={imageExt.ocrModel}
                setOcrModel={imageExt.setOcrModel}
                ocrLocalUrl={imageExt.ocrLocalUrl}
                setOcrLocalUrl={imageExt.setOcrLocalUrl}
                onRunOcr={imageExt.runOcr}
                lipsyncProvider={imageExt.lipsyncProvider}
                onLipsyncProviderChange={imageExt.handleLipsyncProviderChange}
                lipsyncVideoFile={imageExt.lipsyncVideoFile}
                setLipsyncVideoFile={imageExt.setLipsyncVideoFile}
                lipsyncAudioFile={imageExt.lipsyncAudioFile}
                setLipsyncAudioFile={imageExt.setLipsyncAudioFile}
                lipsyncModel={imageExt.lipsyncModel}
                setLipsyncModel={imageExt.setLipsyncModel}
                lipsyncLocalUrl={imageExt.lipsyncLocalUrl}
                setLipsyncLocalUrl={imageExt.setLipsyncLocalUrl}
                onRunLipsync={imageExt.runLipsync}
                fieldCls={fieldCls}
                fileCls={fileCls}
                labelCls={labelCls}
                btnSec={btnSec}
              />
            )}

            {/* 图像工具 */}
            {showImageTools && (
              <>
                <header className="flex items-center gap-3.5 pb-1">
                  <svg width="36" height="36" viewBox="0 0 28 28" style={{ flexShrink: 0 }}>
                    <rect width="28" height="28" rx="7" fill="#db2777"/>
                    <rect x="5" y="7" width="18" height="14" rx="3" fill="none" stroke="#fce7f3" strokeWidth="1.5"/>
                    <circle cx="10" cy="12" r="2" fill="#fbcfe8"/>
                    <path d="M5 18l5-5 4 4 3-3 6 4" stroke="#f9a8d4" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                  <div>
                    <h1 className="text-xl font-bold tracking-tight text-slate-900 dark:text-slate-100">图像工具</h1>
                    <p className="text-xs text-slate-400 font-medium mt-0.5">图像生成 · 换脸换图 · OCR · 图像理解</p>
                  </div>
                </header>
                <MiscPanel
                  miscSubPage={misc.miscSubPage}
                  setMiscSubPage={misc.setMiscSubPage}
                  apiKey={apiKey}
                  setApiKey={setApiKey}
                  cloudEndpoint={cloudEndpoint}
                  setCloudEndpoint={setCloudEndpoint}
                  outputDir={outputDir}
                  setOutputDir={setOutputDir}
                  status={status}
                  imageGenProvider={misc.imageGenProvider}
                  onImageGenProviderChange={misc.handleImageGenProviderChange}
                  imageGenPrompt={misc.imageGenPrompt}
                  setImageGenPrompt={misc.setImageGenPrompt}
                  imageGenModel={misc.imageGenModel}
                  setImageGenModel={misc.setImageGenModel}
                  imageGenSize={misc.imageGenSize}
                  setImageGenSize={misc.setImageGenSize}
                  onRunImageGen={misc.runImageGen}
                  imageUnderstandProvider={misc.imageUnderstandProvider}
                  onImageUnderstandProviderChange={misc.handleImageUnderstandProviderChange}
                  imageUnderstandFile={misc.imageUnderstandFile}
                  setImageUnderstandFile={misc.setImageUnderstandFile}
                  imageUnderstandPrompt={misc.imageUnderstandPrompt}
                  setImageUnderstandPrompt={misc.setImageUnderstandPrompt}
                  imageUnderstandModel={misc.imageUnderstandModel}
                  setImageUnderstandModel={misc.setImageUnderstandModel}
                  onRunImageUnderstand={misc.runImageUnderstand}
                  translateProvider={misc.translateProvider}
                  setTranslateProvider={misc.setTranslateProvider}
                  translateText={misc.translateText}
                  setTranslateText={misc.setTranslateText}
                  translateTarget={misc.translateTarget}
                  setTranslateTarget={misc.setTranslateTarget}
                  translateSource={misc.translateSource}
                  setTranslateSource={misc.setTranslateSource}
                  translateModel={misc.translateModel}
                  setTranslateModel={misc.setTranslateModel}
                  onRunTranslate={misc.runTranslate}
                  codeProvider={misc.codeProvider}
                  setCodeProvider={misc.setCodeProvider}
                  codeModel={misc.codeModel}
                  setCodeModel={misc.setCodeModel}
                  codeMessages={misc.codeMessages}
                  setCodeMessages={misc.setCodeMessages}
                  codeInput={misc.codeInput}
                  setCodeInput={misc.setCodeInput}
                  codeLoading={misc.codeLoading}
                  codeLang={misc.codeLang}
                  setCodeLang={misc.setCodeLang}
                  onSendCodeMessage={misc.sendCodeMessage}
                  imgGenProvider={imageExt.imgGenProvider}
                  onImgGenProviderChange={imageExt.handleImgGenProviderChange}
                  imgGenPrompt={imageExt.imgGenPrompt}
                  setImgGenPrompt={imageExt.setImgGenPrompt}
                  imgGenModel={imageExt.imgGenModel}
                  setImgGenModel={imageExt.setImgGenModel}
                  imgGenSize={imageExt.imgGenSize}
                  setImgGenSize={imageExt.setImgGenSize}
                  imgGenComfyUrl={imageExt.imgGenComfyUrl}
                  setImgGenComfyUrl={imageExt.setImgGenComfyUrl}
                  onRunImgGen={imageExt.runImgGen}
                  imgI2iProvider={imageExt.imgI2iProvider}
                  onImgI2iProviderChange={imageExt.handleImgI2iProviderChange}
                  imgI2iSourceFile={imageExt.imgI2iSourceFile}
                  setImgI2iSourceFile={imageExt.setImgI2iSourceFile}
                  imgI2iRefFile={imageExt.imgI2iRefFile}
                  setImgI2iRefFile={imageExt.setImgI2iRefFile}
                  imgI2iPrompt={imageExt.imgI2iPrompt}
                  setImgI2iPrompt={imageExt.setImgI2iPrompt}
                  imgI2iModel={imageExt.imgI2iModel}
                  setImgI2iModel={imageExt.setImgI2iModel}
                  imgI2iStrength={imageExt.imgI2iStrength}
                  setImgI2iStrength={imageExt.setImgI2iStrength}
                  imgI2iComfyUrl={imageExt.imgI2iComfyUrl}
                  setImgI2iComfyUrl={imageExt.setImgI2iComfyUrl}
                  onRunImgI2i={imageExt.runImgI2i}
                  videoGenProvider={imageExt.videoGenProvider}
                  onVideoGenProviderChange={imageExt.handleVideoGenProviderChange}
                  videoGenPrompt={imageExt.videoGenPrompt}
                  setVideoGenPrompt={imageExt.setVideoGenPrompt}
                  videoGenModel={imageExt.videoGenModel}
                  setVideoGenModel={imageExt.setVideoGenModel}
                  videoGenDuration={imageExt.videoGenDuration}
                  setVideoGenDuration={imageExt.setVideoGenDuration}
                  videoGenMode={imageExt.videoGenMode}
                  setVideoGenMode={imageExt.setVideoGenMode}
                  videoGenImageFile={imageExt.videoGenImageFile}
                  setVideoGenImageFile={imageExt.setVideoGenImageFile}
                  onRunVideoGen={imageExt.runVideoGen}
                  ocrProvider={imageExt.ocrProvider}
                  onOcrProviderChange={imageExt.handleOcrProviderChange}
                  ocrFile={imageExt.ocrFile}
                  setOcrFile={imageExt.setOcrFile}
                  ocrModel={imageExt.ocrModel}
                  setOcrModel={imageExt.setOcrModel}
                  ocrLocalUrl={imageExt.ocrLocalUrl}
                  setOcrLocalUrl={imageExt.setOcrLocalUrl}
                  onRunOcr={imageExt.runOcr}
                  lipsyncProvider={imageExt.lipsyncProvider}
                  onLipsyncProviderChange={imageExt.handleLipsyncProviderChange}
                  lipsyncVideoFile={imageExt.lipsyncVideoFile}
                  setLipsyncVideoFile={imageExt.setLipsyncVideoFile}
                  lipsyncAudioFile={imageExt.lipsyncAudioFile}
                  setLipsyncAudioFile={imageExt.setLipsyncAudioFile}
                  lipsyncModel={imageExt.lipsyncModel}
                  setLipsyncModel={imageExt.setLipsyncModel}
                  lipsyncLocalUrl={imageExt.lipsyncLocalUrl}
                  setLipsyncLocalUrl={imageExt.setLipsyncLocalUrl}
                  onRunLipsync={imageExt.runLipsync}
                  fieldCls={fieldCls}
                  fileCls={fileCls}
                  labelCls={labelCls}
                  btnSec={btnSec}
                  allowedSubPages={['img_gen', 'img_i2i', 'image_understand', 'ocr']}
                />
              </>
            )}

            {/* 视频工具 */}
            {showVideoTools && (
              <>
                <header className="flex items-center gap-3.5 pb-1">
                  <svg width="36" height="36" viewBox="0 0 28 28" style={{ flexShrink: 0 }}>
                    <rect width="28" height="28" rx="7" fill="#0f766e"/>
                    <rect x="4" y="8" width="14" height="12" rx="2.5" fill="none" stroke="#99f6e4" strokeWidth="1.5"/>
                    <path d="M18 12l6-3v10l-6-3V12z" fill="#5eead4"/>
                  </svg>
                  <div>
                    <h1 className="text-xl font-bold tracking-tight text-slate-900 dark:text-slate-100">视频工具</h1>
                    <p className="text-xs text-slate-400 font-medium mt-0.5">视频生成 · 唇形同步</p>
                  </div>
                </header>
                <MiscPanel
                  miscSubPage={misc.miscSubPage}
                  setMiscSubPage={misc.setMiscSubPage}
                  apiKey={apiKey}
                  setApiKey={setApiKey}
                  cloudEndpoint={cloudEndpoint}
                  setCloudEndpoint={setCloudEndpoint}
                  outputDir={outputDir}
                  setOutputDir={setOutputDir}
                  status={status}
                  imageGenProvider={misc.imageGenProvider}
                  onImageGenProviderChange={misc.handleImageGenProviderChange}
                  imageGenPrompt={misc.imageGenPrompt}
                  setImageGenPrompt={misc.setImageGenPrompt}
                  imageGenModel={misc.imageGenModel}
                  setImageGenModel={misc.setImageGenModel}
                  imageGenSize={misc.imageGenSize}
                  setImageGenSize={misc.setImageGenSize}
                  onRunImageGen={misc.runImageGen}
                  imageUnderstandProvider={misc.imageUnderstandProvider}
                  onImageUnderstandProviderChange={misc.handleImageUnderstandProviderChange}
                  imageUnderstandFile={misc.imageUnderstandFile}
                  setImageUnderstandFile={misc.setImageUnderstandFile}
                  imageUnderstandPrompt={misc.imageUnderstandPrompt}
                  setImageUnderstandPrompt={misc.setImageUnderstandPrompt}
                  imageUnderstandModel={misc.imageUnderstandModel}
                  setImageUnderstandModel={misc.setImageUnderstandModel}
                  onRunImageUnderstand={misc.runImageUnderstand}
                  translateProvider={misc.translateProvider}
                  setTranslateProvider={misc.setTranslateProvider}
                  translateText={misc.translateText}
                  setTranslateText={misc.setTranslateText}
                  translateTarget={misc.translateTarget}
                  setTranslateTarget={misc.setTranslateTarget}
                  translateSource={misc.translateSource}
                  setTranslateSource={misc.setTranslateSource}
                  translateModel={misc.translateModel}
                  setTranslateModel={misc.setTranslateModel}
                  onRunTranslate={misc.runTranslate}
                  codeProvider={misc.codeProvider}
                  setCodeProvider={misc.setCodeProvider}
                  codeModel={misc.codeModel}
                  setCodeModel={misc.setCodeModel}
                  codeMessages={misc.codeMessages}
                  setCodeMessages={misc.setCodeMessages}
                  codeInput={misc.codeInput}
                  setCodeInput={misc.setCodeInput}
                  codeLoading={misc.codeLoading}
                  codeLang={misc.codeLang}
                  setCodeLang={misc.setCodeLang}
                  onSendCodeMessage={misc.sendCodeMessage}
                  imgGenProvider={imageExt.imgGenProvider}
                  onImgGenProviderChange={imageExt.handleImgGenProviderChange}
                  imgGenPrompt={imageExt.imgGenPrompt}
                  setImgGenPrompt={imageExt.setImgGenPrompt}
                  imgGenModel={imageExt.imgGenModel}
                  setImgGenModel={imageExt.setImgGenModel}
                  imgGenSize={imageExt.imgGenSize}
                  setImgGenSize={imageExt.setImgGenSize}
                  imgGenComfyUrl={imageExt.imgGenComfyUrl}
                  setImgGenComfyUrl={imageExt.setImgGenComfyUrl}
                  onRunImgGen={imageExt.runImgGen}
                  imgI2iProvider={imageExt.imgI2iProvider}
                  onImgI2iProviderChange={imageExt.handleImgI2iProviderChange}
                  imgI2iSourceFile={imageExt.imgI2iSourceFile}
                  setImgI2iSourceFile={imageExt.setImgI2iSourceFile}
                  imgI2iRefFile={imageExt.imgI2iRefFile}
                  setImgI2iRefFile={imageExt.setImgI2iRefFile}
                  imgI2iPrompt={imageExt.imgI2iPrompt}
                  setImgI2iPrompt={imageExt.setImgI2iPrompt}
                  imgI2iModel={imageExt.imgI2iModel}
                  setImgI2iModel={imageExt.setImgI2iModel}
                  imgI2iStrength={imageExt.imgI2iStrength}
                  setImgI2iStrength={imageExt.setImgI2iStrength}
                  imgI2iComfyUrl={imageExt.imgI2iComfyUrl}
                  setImgI2iComfyUrl={imageExt.setImgI2iComfyUrl}
                  onRunImgI2i={imageExt.runImgI2i}
                  videoGenProvider={imageExt.videoGenProvider}
                  onVideoGenProviderChange={imageExt.handleVideoGenProviderChange}
                  videoGenPrompt={imageExt.videoGenPrompt}
                  setVideoGenPrompt={imageExt.setVideoGenPrompt}
                  videoGenModel={imageExt.videoGenModel}
                  setVideoGenModel={imageExt.setVideoGenModel}
                  videoGenDuration={imageExt.videoGenDuration}
                  setVideoGenDuration={imageExt.setVideoGenDuration}
                  videoGenMode={imageExt.videoGenMode}
                  setVideoGenMode={imageExt.setVideoGenMode}
                  videoGenImageFile={imageExt.videoGenImageFile}
                  setVideoGenImageFile={imageExt.setVideoGenImageFile}
                  onRunVideoGen={imageExt.runVideoGen}
                  ocrProvider={imageExt.ocrProvider}
                  onOcrProviderChange={imageExt.handleOcrProviderChange}
                  ocrFile={imageExt.ocrFile}
                  setOcrFile={imageExt.setOcrFile}
                  ocrModel={imageExt.ocrModel}
                  setOcrModel={imageExt.setOcrModel}
                  ocrLocalUrl={imageExt.ocrLocalUrl}
                  setOcrLocalUrl={imageExt.setOcrLocalUrl}
                  onRunOcr={imageExt.runOcr}
                  lipsyncProvider={imageExt.lipsyncProvider}
                  onLipsyncProviderChange={imageExt.handleLipsyncProviderChange}
                  lipsyncVideoFile={imageExt.lipsyncVideoFile}
                  setLipsyncVideoFile={imageExt.setLipsyncVideoFile}
                  lipsyncAudioFile={imageExt.lipsyncAudioFile}
                  setLipsyncAudioFile={imageExt.setLipsyncAudioFile}
                  lipsyncModel={imageExt.lipsyncModel}
                  setLipsyncModel={imageExt.setLipsyncModel}
                  lipsyncLocalUrl={imageExt.lipsyncLocalUrl}
                  setLipsyncLocalUrl={imageExt.setLipsyncLocalUrl}
                  onRunLipsync={imageExt.runLipsync}
                  fieldCls={fieldCls}
                  fileCls={fileCls}
                  labelCls={labelCls}
                  btnSec={btnSec}
                  allowedSubPages={['video_gen', 'lipsync']}
                />
              </>
            )}

            {/* 文字工具 */}
            {showTextTools && (
              <div>
                <header className="flex items-center gap-3.5 pb-4">
                  <svg width="36" height="36" viewBox="0 0 28 28" style={{ flexShrink: 0 }}>
                    <rect width="28" height="28" rx="7" fill="#0284c7"/>
                    <path d="M7 9h14M7 14h10M7 19h8" stroke="#bae6fd" strokeWidth="2" strokeLinecap="round"/>
                  </svg>
                  <div>
                    <h1 className="text-xl font-bold tracking-tight text-slate-900 dark:text-slate-100">文字工具</h1>
                    <p className="text-xs text-slate-400 font-medium mt-0.5">LLM 聊天 · 文字翻译 · 代码助手</p>
                  </div>
                </header>
                {/* Tab bar */}
                <div className="flex gap-1 mb-4 p-1 bg-slate-100 dark:bg-slate-800 rounded-xl">
                  {(['llm', 'translate', 'code_assist'] as const).map(tab => {
                    const labels: Record<string, string> = { llm: 'LLM 聊天', translate: '文字翻译', code_assist: '代码助手' };
                    return (
                      <button key={tab}
                        onClick={() => {
                          setTextSubPage(tab);
                          if (tab !== 'llm') misc.setMiscSubPage(tab as MiscSubPage);
                        }}
                        className={`flex-1 py-2 text-sm font-medium rounded-lg transition-all ${
                          textSubPage === tab
                            ? 'bg-white dark:bg-slate-900 text-[#1A8FE3] shadow-sm'
                            : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'
                        }`}>
                        {labels[tab]}
                      </button>
                    );
                  })}
                </div>
                {textSubPage === 'llm' && (
                  <LlmPanel
                    taskType="llm"
                    capabilities={backend.capabilities}
                    selectedProvider={providerMap['llm'] || 'gemini'}
                    needsAuth={!LOCAL_PROVIDERS.has(providerMap['llm'] || 'gemini') && !URL_ONLY_PROVIDERS.has(providerMap['llm'] || 'gemini')}
                    isUrlOnly={URL_ONLY_PROVIDERS.has(providerMap['llm'] || 'gemini')}
                    apiKey={apiKey}
                    cloudEndpoint={cloudEndpoint}
                    engineVersions={backend.engineVersions}
                    setProviderMap={setProviderMap}
                    setApiKey={setApiKey}
                    setCloudEndpoint={setCloudEndpoint}
                    llmMessages={llm.llmMessages}
                    setLlmMessages={llm.setLlmMessages}
                    llmInput={llm.llmInput}
                    setLlmInput={llm.setLlmInput}
                    llmModel={llm.llmModel}
                    setLlmModel={llm.setLlmModel}
                    llmLoading={llm.llmLoading}
                    llmScrollRef={llm.llmScrollRef}
                    onSendLlmMessage={llm.sendLlmMessage}
                    fieldCls={fieldCls}
                    labelCls={labelCls}
                  />
                )}
                {(textSubPage === 'translate' || textSubPage === 'code_assist') && (
                  <MiscPanel
                    miscSubPage={misc.miscSubPage}
                    setMiscSubPage={misc.setMiscSubPage}
                    apiKey={apiKey}
                    setApiKey={setApiKey}
                    cloudEndpoint={cloudEndpoint}
                    setCloudEndpoint={setCloudEndpoint}
                    outputDir={outputDir}
                    setOutputDir={setOutputDir}
                    status={status}
                    imageGenProvider={misc.imageGenProvider}
                    onImageGenProviderChange={misc.handleImageGenProviderChange}
                    imageGenPrompt={misc.imageGenPrompt}
                    setImageGenPrompt={misc.setImageGenPrompt}
                    imageGenModel={misc.imageGenModel}
                    setImageGenModel={misc.setImageGenModel}
                    imageGenSize={misc.imageGenSize}
                    setImageGenSize={misc.setImageGenSize}
                    onRunImageGen={misc.runImageGen}
                    imageUnderstandProvider={misc.imageUnderstandProvider}
                    onImageUnderstandProviderChange={misc.handleImageUnderstandProviderChange}
                    imageUnderstandFile={misc.imageUnderstandFile}
                    setImageUnderstandFile={misc.setImageUnderstandFile}
                    imageUnderstandPrompt={misc.imageUnderstandPrompt}
                    setImageUnderstandPrompt={misc.setImageUnderstandPrompt}
                    imageUnderstandModel={misc.imageUnderstandModel}
                    setImageUnderstandModel={misc.setImageUnderstandModel}
                    onRunImageUnderstand={misc.runImageUnderstand}
                    translateProvider={misc.translateProvider}
                    setTranslateProvider={misc.setTranslateProvider}
                    translateText={misc.translateText}
                    setTranslateText={misc.setTranslateText}
                    translateTarget={misc.translateTarget}
                    setTranslateTarget={misc.setTranslateTarget}
                    translateSource={misc.translateSource}
                    setTranslateSource={misc.setTranslateSource}
                    translateModel={misc.translateModel}
                    setTranslateModel={misc.setTranslateModel}
                    onRunTranslate={misc.runTranslate}
                    codeProvider={misc.codeProvider}
                    setCodeProvider={misc.setCodeProvider}
                    codeModel={misc.codeModel}
                    setCodeModel={misc.setCodeModel}
                    codeMessages={misc.codeMessages}
                    setCodeMessages={misc.setCodeMessages}
                    codeInput={misc.codeInput}
                    setCodeInput={misc.setCodeInput}
                    codeLoading={misc.codeLoading}
                    codeLang={misc.codeLang}
                    setCodeLang={misc.setCodeLang}
                    onSendCodeMessage={misc.sendCodeMessage}
                    imgGenProvider={imageExt.imgGenProvider}
                    onImgGenProviderChange={imageExt.handleImgGenProviderChange}
                    imgGenPrompt={imageExt.imgGenPrompt}
                    setImgGenPrompt={imageExt.setImgGenPrompt}
                    imgGenModel={imageExt.imgGenModel}
                    setImgGenModel={imageExt.setImgGenModel}
                    imgGenSize={imageExt.imgGenSize}
                    setImgGenSize={imageExt.setImgGenSize}
                    imgGenComfyUrl={imageExt.imgGenComfyUrl}
                    setImgGenComfyUrl={imageExt.setImgGenComfyUrl}
                    onRunImgGen={imageExt.runImgGen}
                    imgI2iProvider={imageExt.imgI2iProvider}
                    onImgI2iProviderChange={imageExt.handleImgI2iProviderChange}
                    imgI2iSourceFile={imageExt.imgI2iSourceFile}
                    setImgI2iSourceFile={imageExt.setImgI2iSourceFile}
                    imgI2iRefFile={imageExt.imgI2iRefFile}
                    setImgI2iRefFile={imageExt.setImgI2iRefFile}
                    imgI2iPrompt={imageExt.imgI2iPrompt}
                    setImgI2iPrompt={imageExt.setImgI2iPrompt}
                    imgI2iModel={imageExt.imgI2iModel}
                    setImgI2iModel={imageExt.setImgI2iModel}
                    imgI2iStrength={imageExt.imgI2iStrength}
                    setImgI2iStrength={imageExt.setImgI2iStrength}
                    imgI2iComfyUrl={imageExt.imgI2iComfyUrl}
                    setImgI2iComfyUrl={imageExt.setImgI2iComfyUrl}
                    onRunImgI2i={imageExt.runImgI2i}
                    videoGenProvider={imageExt.videoGenProvider}
                    onVideoGenProviderChange={imageExt.handleVideoGenProviderChange}
                    videoGenPrompt={imageExt.videoGenPrompt}
                    setVideoGenPrompt={imageExt.setVideoGenPrompt}
                    videoGenModel={imageExt.videoGenModel}
                    setVideoGenModel={imageExt.setVideoGenModel}
                    videoGenDuration={imageExt.videoGenDuration}
                    setVideoGenDuration={imageExt.setVideoGenDuration}
                    videoGenMode={imageExt.videoGenMode}
                    setVideoGenMode={imageExt.setVideoGenMode}
                    videoGenImageFile={imageExt.videoGenImageFile}
                    setVideoGenImageFile={imageExt.setVideoGenImageFile}
                    onRunVideoGen={imageExt.runVideoGen}
                    ocrProvider={imageExt.ocrProvider}
                    onOcrProviderChange={imageExt.handleOcrProviderChange}
                    ocrFile={imageExt.ocrFile}
                    setOcrFile={imageExt.setOcrFile}
                    ocrModel={imageExt.ocrModel}
                    setOcrModel={imageExt.setOcrModel}
                    ocrLocalUrl={imageExt.ocrLocalUrl}
                    setOcrLocalUrl={imageExt.setOcrLocalUrl}
                    onRunOcr={imageExt.runOcr}
                    lipsyncProvider={imageExt.lipsyncProvider}
                    onLipsyncProviderChange={imageExt.handleLipsyncProviderChange}
                    lipsyncVideoFile={imageExt.lipsyncVideoFile}
                    setLipsyncVideoFile={imageExt.setLipsyncVideoFile}
                    lipsyncAudioFile={imageExt.lipsyncAudioFile}
                    setLipsyncAudioFile={imageExt.setLipsyncAudioFile}
                    lipsyncModel={imageExt.lipsyncModel}
                    setLipsyncModel={imageExt.setLipsyncModel}
                    lipsyncLocalUrl={imageExt.lipsyncLocalUrl}
                    setLipsyncLocalUrl={imageExt.setLipsyncLocalUrl}
                    onRunLipsync={imageExt.runLipsync}
                    fieldCls={fieldCls}
                    fileCls={fileCls}
                    labelCls={labelCls}
                    btnSec={btnSec}
                    allowedSubPages={[textSubPage as MiscSubPage]}
                  />
                )}
              </div>
            )}

            {/* AI 进阶工具 */}
            {showAdvancedTools && (
              <div>
                <header className="flex items-center gap-3.5 pb-4">
                  <svg width="36" height="36" viewBox="0 0 28 28" style={{ flexShrink: 0 }}>
                    <rect width="28" height="28" rx="7" fill="#7c3aed"/>
                    <circle cx="14" cy="10" r="4" fill="none" stroke="#ddd6fe" strokeWidth="1.5"/>
                    <path d="M7 22c0-3.866 3.134-7 7-7s7 3.134 7 7" fill="none" stroke="#c4b5fd" strokeWidth="1.5" strokeLinecap="round"/>
                    <circle cx="21" cy="10" r="2.5" fill="#a78bfa"/>
                    <circle cx="7" cy="10" r="2.5" fill="#a78bfa"/>
                  </svg>
                  <div>
                    <h1 className="text-xl font-bold tracking-tight text-slate-900 dark:text-slate-100">AI 进阶</h1>
                    <p className="text-xs text-slate-400 font-medium mt-0.5">知识库 · 智能体 · 模型微调</p>
                  </div>
                </header>
                <div className="flex gap-1 mb-4 p-1 bg-slate-100 dark:bg-slate-800 rounded-xl">
                  {([
                    ['rag',      '知识库',   'RAG'      ],
                    ['agent',    '智能体',   'Agent'    ],
                    ['finetune', 'LoRA 微调', 'Fine-tune'],
                  ] as const).map(([tab, label, abbr]) => (
                    <button key={tab}
                      onClick={() => setAdvancedSubPage(tab)}
                      className={`flex-1 py-2 rounded-lg flex flex-col items-center gap-0.5 transition-all ${
                        advancedSubPage === tab
                          ? 'bg-white dark:bg-slate-900 text-[#7c3aed] shadow-sm'
                          : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'
                      }`}>
                      <span className="text-sm font-medium leading-tight">{label}</span>
                      <span className={`text-[10px] font-mono leading-tight ${advancedSubPage === tab ? 'text-[#7c3aed]' : 'text-slate-400 dark:text-slate-600'}`}>{abbr}</span>
                    </button>
                  ))}
                </div>
                {advancedSubPage === 'rag' && (
                  <RagPanel
                    backendUrl={backend.backendBaseUrl}
                    capabilities={backend.capabilities}
                    selectedProvider={providerMap['rag'] || 'ollama'}
                    apiKey={apiKey}
                    cloudEndpoint={cloudEndpoint}
                    setProviderMap={setProviderMap}
                    setApiKey={setApiKey}
                    setCloudEndpoint={setCloudEndpoint}
                    addPendingJob={addPendingJob}
                    resolveJob={resolveJob}
                  />
                )}
                {advancedSubPage === 'agent' && (
                  <AgentPanel
                    backendUrl={backend.backendBaseUrl}
                    capabilities={backend.capabilities}
                    selectedProvider={providerMap['agent'] || 'ollama'}
                    apiKey={apiKey}
                    cloudEndpoint={cloudEndpoint}
                    setProviderMap={setProviderMap}
                    setApiKey={setApiKey}
                    setCloudEndpoint={setCloudEndpoint}
                  />
                )}
                {advancedSubPage === 'finetune' && (
                  <FinetunePanel
                    backendUrl={backend.backendBaseUrl}
                    outputDir={outputDir}
                    setOutputDir={setOutputDir}
                    addPendingJob={addPendingJob}
                    resolveJob={resolveJob}
                  />
                )}
              </div>
            )}

            {/* ── 处理中进度条 ── */}
            {!showHome && !showTasks && status === 'processing' && (
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
                    onClick={handleAbort}>
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

            {/* ── 错误/成功提示 ── */}
            {!showHome && !showTasks && error && (
              <div className="rounded-2xl border border-rose-200/80 dark:border-rose-900/60 bg-rose-50 dark:bg-rose-950/40 px-5 py-4 text-sm text-rose-700 dark:text-rose-300 flex gap-3">
                <svg className="w-4 h-4 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.072 16.5c-.77.833.192 2.5 1.732 2.5z"/></svg>
                <span className="font-semibold leading-relaxed break-all">{error}</span>
              </div>
            )}
            {!showHome && !showTasks && successMsg && !error && (
              <div className="rounded-2xl border border-emerald-200/80 dark:border-emerald-900/60 bg-emerald-50 dark:bg-emerald-950/40 px-5 py-3.5 text-sm text-emerald-700 dark:text-emerald-300 flex items-center gap-2">
                <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7"/></svg>
                <span className="font-medium">{successMsg}</span>
              </div>
            )}

          </div>{/* max-w-3xl */}
        </div>{/* p-4 */}
      </div>{/* flex-1 main scroll */}


    </div>
  );
}
