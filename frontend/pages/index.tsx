import { useEffect, useRef, useState } from 'react';
import type { Status, TaskType, VcInputMode, ToolboxSubPage } from '../types';
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

// Components
import Sidebar from '../components/layout/Sidebar';
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

export default function Home() {
  // ─── 导航状态 ─────────────────────────────────────────────────────────────
  const [taskType, setTaskType] = useState<TaskType>('tts');
  const [showHome, setShowHome] = useState(true);
  const [showTasks, setShowTasks] = useState(false);
  const [showSystem, setShowSystem] = useState(false);

  const currentPage: Page = showHome ? 'home' : showTasks ? 'tasks' : showSystem ? 'system' : taskType;

  function navigate(page: Page) {
    if (page === 'home') { setShowHome(true); setShowTasks(false); setShowSystem(false); }
    else if (page === 'tasks') { setShowHome(false); setShowTasks(true); setShowSystem(false); fetchJobs(); }
    else if (page === 'system') { setShowHome(false); setShowTasks(false); setShowSystem(true); }
    else { setShowHome(false); setShowTasks(false); setShowSystem(false); setTaskType(page as TaskType); }
  }

  function navigateTasks() {
    setShowHome(false); setShowTasks(true); setShowSystem(false);
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

  // ─── 侧边栏 ───────────────────────────────────────────────────────────────
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState(180);
  const isResizingRef = useRef(false);
  const resizeStartXRef = useRef(0);
  const resizeStartWidthRef = useRef(0);

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

  // ─── 共享设置 ─────────────────────────────────────────────────────────────
  const [providerMap, setProviderMap] = useState<Record<string, string>>({
    tts: 'fish_speech', vc: 'seed_vc', asr: 'whisper', llm: 'gemini',
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
  const [vcRefAudio, setVcRefAudio] = useState<File | null>(null);
  const [seedVcDiffusionSteps, setSeedVcDiffusionSteps] = useState(10);
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
  const [creatingVoice, setCreatingVoice] = useState(false);

  // ─── 训练状态 ─────────────────────────────────────────────────────────────
  const [trainVoiceName, setTrainVoiceName] = useState('我的音色');
  const [trainFile, setTrainFile] = useState<File | null>(null);
  // 训练高级参数
  const [trainEpochs, setTrainEpochs] = useState(0);
  const [trainF0Method, setTrainF0Method] = useState('harvest');
  const [trainSampleRate, setTrainSampleRate] = useState(40000);

  // ─── 共享样式常量 ─────────────────────────────────────────────────────────
  const fieldCls = 'w-full rounded-xl border border-slate-200 bg-slate-50/50 px-3.5 py-2.5 text-sm text-slate-800 placeholder:text-slate-400 focus:border-indigo-400 focus:bg-white focus:ring-2 focus:ring-indigo-500/15 transition-all dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200 dark:placeholder:text-slate-500 dark:focus:bg-slate-700 dark:focus:border-indigo-400';
  const fileCls  = 'w-full rounded-xl border border-slate-200 bg-slate-50/50 px-3.5 py-2.5 text-sm text-slate-700 file:mr-3 file:rounded-lg file:border-0 file:bg-indigo-50 file:px-3 file:py-1 file:text-xs file:font-medium file:text-indigo-700 hover:file:bg-indigo-100 transition-all dark:border-slate-600 dark:bg-slate-800 dark:text-slate-300 dark:file:bg-indigo-900/50 dark:file:text-indigo-300 dark:hover:file:bg-indigo-900';
  const labelCls = 'block text-xs font-medium text-slate-400 mb-1.5 uppercase tracking-wide dark:text-slate-500';
  const btnSec   = 'rounded-xl border border-slate-200 bg-slate-100 hover:bg-slate-200 px-4 py-2.5 text-sm font-medium text-slate-600 transition-colors dark:border-slate-600 dark:bg-slate-800 dark:hover:bg-slate-700 dark:text-slate-300';

  // ─── Hooks ────────────────────────────────────────────────────────────────
  const backend = useBackend();
  // Sync vchatVoiceId from backend hook into voice chat if backend hook manages it separately
  // Actually useBackend manages selectedVoiceId & vchatVoiceId, use them directly

  const { jobs, setJobs, fetchJobs, addInstantJobResult, addPendingJob, resolveJob, pollJobResult } = useJobs(
    backend.backendBaseUrl,
    backend.backendReady,
    navigateTasks,
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
    onNavigateTasks: navigateTasks,
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
    vcRefAudio,
    status,
    setStatus,
    setProcessingStartTime,
    setError,
    setSuccessMsg,
    setJobs,
    addInstantJobResult,
    onNavigateTasks: navigateTasks,
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
    onNavigateTasks: navigateTasks,
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
    onNavigateTasks: navigateTasks,
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
    onNavigateTasks: navigateTasks,
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
      const res = await fetch(`${backend.backendBaseUrl}/voices/create`, { method: 'POST', body: fd });
      let data: any = null;
      try { data = await res.json(); } catch { /**/ }
      if (!res.ok) throw new Error(`创建失败（${res.status}）${data?.detail ? `：${data.detail}` : ''}`);
      setSuccessMsg(`音色已创建：${data.voice_name}（ID: ${data.voice_id}）`);
      setShowCreateVoice(false);
      setNewVoiceName(''); setNewVoiceModel(null); setNewVoiceIndex(null); setNewVoiceRef(null);
      await backend.fetchVoices();
      backend.setSelectedVoiceId(data.voice_id);
    } catch (e) {
      setError(e instanceof Error ? e.message : '创建音色失败');
    } finally {
      setCreatingVoice(false);
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
    if (!trainFile) { setError('请先选择训练数据集'); return; }
    if (!trimmedName) { setError('请输入音色名称'); return; }
    const duplicate = backend.voices.some(v => v.name.toLowerCase() === trimmedName.toLowerCase());
    if (duplicate) { setError(`音色名称「${trimmedName}」已存在，请使用其他名称`); return; }
    setError(''); setSuccessMsg('');
    const normalized = trimmedName.toLowerCase().replace(/[^a-z0-9_-]+/g, '_').replace(/^_+|_+$/g, '');
    const autoVoiceId = `${normalized || 'voice'}_${Date.now().toString().slice(-6)}`;
    const fd = new FormData();
    fd.append('dataset', trainFile);
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
      navigateTasks();
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
    <div className={`flex h-screen overflow-hidden bg-slate-50 text-slate-900 dark:bg-slate-950 dark:text-slate-100 ${isDark ? 'dark' : ''}`}>

      <Sidebar
        currentPage={currentPage}
        sidebarCollapsed={sidebarCollapsed}
        sidebarWidth={sidebarWidth}
        isResizing={isResizingRef.current}
        jobs={jobs}
        onNavigate={navigate}
        onToggleCollapse={() => setSidebarCollapsed(v => !v)}
        onResizeStart={e => {
          isResizingRef.current = true;
          resizeStartXRef.current = e.clientX;
          resizeStartWidthRef.current = sidebarWidth;
          document.body.style.userSelect = 'none';
          document.body.style.cursor = 'col-resize';
        }}
      />

      {/* ── 深色模式切换按钮（固定右上角）── */}
      <button
        onClick={() => setIsDark(v => !v)}
        title={isDark ? '切换到亮色模式' : '切换到暗色模式'}
        className={`fixed top-4 right-4 z-50 flex items-center w-[52px] h-[28px] rounded-full transition-all duration-300 shadow-md ${isDark ? 'bg-slate-700' : 'bg-sky-200'}`}
      >
        <span className={`absolute w-[22px] h-[22px] rounded-full shadow-sm flex items-center justify-center text-[11px] font-bold transition-all duration-300 ${isDark ? 'translate-x-[26px] bg-slate-200 text-slate-700' : 'translate-x-[3px] bg-white text-sky-600'}`}>
          {isDark ? '晚' : '早'}
        </span>
      </button>

      {/* ── 主内容区 ── */}
      <div className="flex-1 overflow-y-auto min-w-0 bg-slate-50 dark:bg-slate-950">
        <div className="p-6 md:p-8">
          <div className="mx-auto w-full max-w-3xl space-y-5">

            {/* 首页 */}
            {showHome && <HomePanel onNavigate={navigate} />}

            {/* 任务列表 */}
            {showTasks && (
              <TaskList
                jobs={jobs}
                backendBaseUrl={backend.backendBaseUrl}
                setJobs={setJobs}
                onFetchJobs={fetchJobs}
                outputDir={outputDir}
              />
            )}

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

            {/* TTS 面板 */}
            {!showHome && !showTasks && !showSystem && taskType === 'tts' && (
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
                ttsRefAudio={tts.ttsRefAudio}
                setTtsRefAudio={tts.setTtsRefAudio}
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
            {!showHome && !showTasks && !showSystem && taskType === 'vc' && (
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
                vcRefAudio={vcRefAudio}
                setVcRefAudio={setVcRefAudio}
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
                outputDir={outputDir}
                setOutputDir={setOutputDir}
                status={status}
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
                trainFile={trainFile}
                setTrainFile={setTrainFile}
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
            {!showHome && !showTasks && !showSystem && taskType === 'asr' && (
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
                status={status}
                onRunAsr={asr.runAsr}
                fieldCls={fieldCls}
                labelCls={labelCls}
              />
            )}

            {/* LLM 聊天面板 */}
            {!showHome && !showTasks && !showSystem && taskType === 'llm' && (
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
            {!showHome && !showTasks && !showSystem && taskType === 'voice_chat' && (
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
                vchatVoiceId={voiceChat.vchatVoiceId}
                setVchatVoiceId={voiceChat.setVchatVoiceId}
                vchatApiKey={voiceChat.vchatApiKey}
                setVchatApiKey={voiceChat.setVchatApiKey}
                vchatEndpoint={voiceChat.vchatEndpoint}
                setVchatEndpoint={voiceChat.setVchatEndpoint}
                engineVersions={backend.engineVersions}
                voices={backend.voices}
                onRefreshVoices={backend.fetchVoices}
                vchatScrollRef={voiceChat.vchatScrollRef}
                onStartRecording={voiceChat.startVchatRecording}
                onStopRecording={voiceChat.stopVchatRecording}
                downloadDir={backend.downloadDir}
                fieldCls={fieldCls}
                labelCls={labelCls}
                btnSec={btnSec}
              />
            )}

            {/* 格式转换面板 */}
            {!showHome && !showTasks && !showSystem && taskType === 'media' && (
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
                outputDir={outputDir}
                setOutputDir={setOutputDir}
                status={status}
                onRunMediaConvert={() => { navigateTasks(); media.runMediaConvert(); }}
                onRunSubtitleConvert={() => { navigateTasks(); media.runSubtitleConvert(); }}
                fieldCls={fieldCls}
                fileCls={fileCls}
                labelCls={labelCls}
                btnSec={btnSec}
              />
            )}

            {/* 文档与工具面板 */}
            {!showHome && !showTasks && !showSystem && taskType === 'doc' && (
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

            {/* 系统工具 */}
            {showSystem && (
              <SystemPanel
                backendBaseUrl={backend.backendBaseUrl}
                isElectron={isElectron}
              />
            )}

          </div>{/* max-w-3xl */}
        </div>{/* p-4 */}
      </div>{/* flex-1 main scroll */}

    </div>
  );
}
