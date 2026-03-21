'use client';

import { useEffect } from 'react';
import type { TaskType, MiscSubPage, MediaAction, DocSubPage, ToolboxSubPage } from '../types';
import { TASK_LABELS, TASK_PHASES, TASK_ICON_CFG, LOCAL_PROVIDERS, URL_ONLY_PROVIDERS } from '../constants';
import { fieldCls, fileCls, labelCls, btnSec } from '../constants/styles';

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
import { useNavigation } from '../hooks/useNavigation';
import { useAppState } from '../hooks/useAppState';
import { useVcExtended } from '../hooks/useVcExtended';
import { useVoiceManager } from '../hooks/useVoiceManager';

// Components
import TopNav from './layout/TopNav';
import type { Page } from './layout/Sidebar';
import HomePanel from './HomePanel';
import TaskList from './TaskList';
import SystemPanel from './SystemPanel';
import TaskIcon from './icons/TaskIcon';
import TtsPanel from './panels/TtsPanel';
import VcPanel from './panels/VcPanel';
import AsrPanel from './panels/AsrPanel';
import LlmPanel from './panels/LlmPanel';
import VoiceChatPanel from './panels/VoiceChatPanel';
import MediaPanel from './panels/MediaPanel';
import DocPanel from './panels/DocPanel';
import MiscPanel from './panels/MiscPanel';
import RagPanel from './panels/RagPanel';
import AgentPanel from './panels/AgentPanel';
import FinetunePanel from './panels/FinetunePanel';

export default function AppShell() {
  // ─── App state ─────────────────────────────────────────────────────────────
  const appState = useAppState();
  const {
    error, setError, successMsg, setSuccessMsg,
    status, setStatus,
    processingStartTime, setProcessingStartTime,
    elapsedSec, setElapsedSec,
    processingPhaseStr, setProcessingPhaseStr,
    isDark, setIsDark,
    isElectron,
    providerMap, setProviderMap,
    apiKey, setApiKey,
    cloudEndpoint, setCloudEndpoint,
    outputDir, setOutputDir,
  } = appState;

  // ─── Backend ───────────────────────────────────────────────────────────────
  const backend = useBackend();

  // ─── Jobs ──────────────────────────────────────────────────────────────────
  const { jobs, setJobs, fetchJobs, addInstantJobResult, addPendingJob, resolveJob, pollJobResult } = useJobs(
    backend.backendBaseUrl,
    backend.backendReady,
  );

  // ─── Misc (needed early for setMiscSubPage in navigation) ──────────────────
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

  // ─── Navigation ───────────────────────────────────────────────────────────
  const nav = useNavigation({
    backendBaseUrl: backend.backendBaseUrl,
    setMiscSubPage: misc.setMiscSubPage,
    fetchJobs,
  });

  const {
    taskType, setTaskType,
    showHome, showTasks, showAudioTools, showFormatConvert,
    showImageTools, showVideoTools, showTextTools, showAdvancedTools,
    tasksTab, setTasksTab,
    advancedSubPage, setAdvancedSubPage,
    textSubPage, setTextSubPage,
    formatGroup, setFormatGroup,
    hwAccelDetected,
    currentPage,
    navigate,
  } = nav;

  // Sync persisted taskType from appState into navigation
  useEffect(() => {
    if (appState.persistedTaskType && appState.persistedTaskType !== taskType) {
      setTaskType(appState.persistedTaskType);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Sync navigation taskType back to persisted
  useEffect(() => {
    appState.setPersistedTaskType(taskType);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [taskType]);

  // ─── Derived values ────────────────────────────────────────────────────────
  const selectedProvider = providerMap[taskType] || 'gemini';
  const isLocal = LOCAL_PROVIDERS.has(selectedProvider);
  const isUrlOnly = URL_ONLY_PROVIDERS.has(selectedProvider);
  const needsAuth = !isLocal && !isUrlOnly;

  // ─── VC Extended ───────────────────────────────────────────────────────────
  const vcExt = useVcExtended();

  // ─── Voice Manager ─────────────────────────────────────────────────────────
  const voiceMgr = useVoiceManager({
    backendBaseUrl: backend.backendBaseUrl,
    voices: backend.voices,
    fetchVoices: backend.fetchVoices,
    setSelectedVoiceId: backend.setSelectedVoiceId,
    setError,
    setSuccessMsg,
    setJobs,
  });

  // ─── Default outputDir from backend ────────────────────────────────────────
  useEffect(() => {
    if (!outputDir && backend.downloadDir) setOutputDir(backend.downloadDir);
  }, [backend.downloadDir]);

  // ─── TTS ───────────────────────────────────────────────────────────────────
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

  // ─── VC ────────────────────────────────────────────────────────────────────
  const vc = useVC({
    backendBaseUrl: backend.backendBaseUrl,
    selectedProvider,
    isLocal,
    apiKey,
    cloudEndpoint,
    outputDir,
    needsAuth,
    selectedVoiceId: backend.selectedVoiceId,
    vcRefAudios: vcExt.vcRefAudios,
    status,
    setStatus,
    setProcessingStartTime,
    setError,
    setSuccessMsg,
    setJobs,
    addInstantJobResult,
    seedVcDiffusionSteps: vcExt.seedVcDiffusionSteps,
    seedVcPitchShift: vcExt.seedVcPitchShift,
    seedVcF0Condition: vcExt.seedVcF0Condition,
    seedVcEnablePostprocess: vcExt.seedVcEnablePostprocess,
    seedVcCfgRate: vcExt.seedVcCfgRate,
    rvcF0Method: vcExt.rvcF0Method,
    rvcFilterRadius: vcExt.rvcFilterRadius,
    rvcIndexRate: vcExt.rvcIndexRate,
    rvcPitchShift: vcExt.rvcPitchShift,
    rvcRmsMixRate: vcExt.rvcRmsMixRate,
    rvcProtect: vcExt.rvcProtect,
  });

  // ─── ASR ───────────────────────────────────────────────────────────────────
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

  // ─── LLM ──────────────────────────────────────────────────────────────────
  const llm = useLLM({
    backendBaseUrl: backend.backendBaseUrl,
    selectedProvider,
    apiKey,
    cloudEndpoint,
    needsAuth,
    setError,
  });

  // ─── Voice Chat ────────────────────────────────────────────────────────────
  const voiceChat = useVoiceChat({
    backendBaseUrl: backend.backendBaseUrl,
    setError,
    pollJobResult,
  });

  // ─── Media Convert ─────────────────────────────────────────────────────────
  const media = useMediaConvert({
    backendBaseUrl: backend.backendBaseUrl,
    outputDir,
    setStatus,
    setProcessingStartTime,
    setError,
    addPendingJob,
    resolveJob,
  });

  // ─── Toolbox ───────────────────────────────────────────────────────────────
  const toolbox = useToolbox({
    backendBaseUrl: backend.backendBaseUrl,
    outputDir,
    setStatus,
    setProcessingStartTime,
    setError,
    addInstantJobResult,
  });

  // ─── Doc Convert ───────────────────────────────────────────────────────────
  const doc = useDocConvert({
    backendBaseUrl: backend.backendBaseUrl,
    outputDir,
    setStatus,
    setProcessingStartTime,
    setError,
    addPendingJob,
    resolveJob,
  });

  // ─── Image Ext ─────────────────────────────────────────────────────────────
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

  // ─── Processing timer ─────────────────────────────────────────────────────
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

  // ─── Abort handler ─────────────────────────────────────────────────────────
  function handleAbort() {
    vc.abortCurrentRequest();
    asr.abortCurrentRequest();
    media.abortCurrentRequest();
  }

  // ─── Build MiscPanel common props ──────────────────────────────────────────
  const miscPanelProps = {
    miscSubPage: misc.miscSubPage,
    setMiscSubPage: misc.setMiscSubPage,
    apiKey,
    setApiKey,
    cloudEndpoint,
    setCloudEndpoint,
    outputDir,
    setOutputDir,
    status,
    imageGenProvider: misc.imageGenProvider,
    onImageGenProviderChange: misc.handleImageGenProviderChange,
    imageGenPrompt: misc.imageGenPrompt,
    setImageGenPrompt: misc.setImageGenPrompt,
    imageGenModel: misc.imageGenModel,
    setImageGenModel: misc.setImageGenModel,
    imageGenSize: misc.imageGenSize,
    setImageGenSize: misc.setImageGenSize,
    onRunImageGen: misc.runImageGen,
    imageUnderstandProvider: misc.imageUnderstandProvider,
    onImageUnderstandProviderChange: misc.handleImageUnderstandProviderChange,
    imageUnderstandFile: misc.imageUnderstandFile,
    setImageUnderstandFile: misc.setImageUnderstandFile,
    imageUnderstandPrompt: misc.imageUnderstandPrompt,
    setImageUnderstandPrompt: misc.setImageUnderstandPrompt,
    imageUnderstandModel: misc.imageUnderstandModel,
    setImageUnderstandModel: misc.setImageUnderstandModel,
    onRunImageUnderstand: misc.runImageUnderstand,
    translateProvider: misc.translateProvider,
    setTranslateProvider: misc.setTranslateProvider,
    translateText: misc.translateText,
    setTranslateText: misc.setTranslateText,
    translateTarget: misc.translateTarget,
    setTranslateTarget: misc.setTranslateTarget,
    translateSource: misc.translateSource,
    setTranslateSource: misc.setTranslateSource,
    translateModel: misc.translateModel,
    setTranslateModel: misc.setTranslateModel,
    onRunTranslate: misc.runTranslate,
    codeProvider: misc.codeProvider,
    setCodeProvider: misc.setCodeProvider,
    codeModel: misc.codeModel,
    setCodeModel: misc.setCodeModel,
    codeMessages: misc.codeMessages,
    setCodeMessages: misc.setCodeMessages,
    codeInput: misc.codeInput,
    setCodeInput: misc.setCodeInput,
    codeLoading: misc.codeLoading,
    codeLang: misc.codeLang,
    setCodeLang: misc.setCodeLang,
    onSendCodeMessage: misc.sendCodeMessage,
    imgGenProvider: imageExt.imgGenProvider,
    onImgGenProviderChange: imageExt.handleImgGenProviderChange,
    imgGenPrompt: imageExt.imgGenPrompt,
    setImgGenPrompt: imageExt.setImgGenPrompt,
    imgGenModel: imageExt.imgGenModel,
    setImgGenModel: imageExt.setImgGenModel,
    imgGenSize: imageExt.imgGenSize,
    setImgGenSize: imageExt.setImgGenSize,
    imgGenComfyUrl: imageExt.imgGenComfyUrl,
    setImgGenComfyUrl: imageExt.setImgGenComfyUrl,
    onRunImgGen: imageExt.runImgGen,
    imgI2iProvider: imageExt.imgI2iProvider,
    onImgI2iProviderChange: imageExt.handleImgI2iProviderChange,
    imgI2iSourceFile: imageExt.imgI2iSourceFile,
    setImgI2iSourceFile: imageExt.setImgI2iSourceFile,
    imgI2iRefFile: imageExt.imgI2iRefFile,
    setImgI2iRefFile: imageExt.setImgI2iRefFile,
    imgI2iPrompt: imageExt.imgI2iPrompt,
    setImgI2iPrompt: imageExt.setImgI2iPrompt,
    imgI2iModel: imageExt.imgI2iModel,
    setImgI2iModel: imageExt.setImgI2iModel,
    imgI2iStrength: imageExt.imgI2iStrength,
    setImgI2iStrength: imageExt.setImgI2iStrength,
    imgI2iComfyUrl: imageExt.imgI2iComfyUrl,
    setImgI2iComfyUrl: imageExt.setImgI2iComfyUrl,
    onRunImgI2i: imageExt.runImgI2i,
    videoGenProvider: imageExt.videoGenProvider,
    onVideoGenProviderChange: imageExt.handleVideoGenProviderChange,
    videoGenPrompt: imageExt.videoGenPrompt,
    setVideoGenPrompt: imageExt.setVideoGenPrompt,
    videoGenModel: imageExt.videoGenModel,
    setVideoGenModel: imageExt.setVideoGenModel,
    videoGenDuration: imageExt.videoGenDuration,
    setVideoGenDuration: imageExt.setVideoGenDuration,
    videoGenMode: imageExt.videoGenMode,
    setVideoGenMode: imageExt.setVideoGenMode,
    videoGenImageFile: imageExt.videoGenImageFile,
    setVideoGenImageFile: imageExt.setVideoGenImageFile,
    onRunVideoGen: imageExt.runVideoGen,
    ocrProvider: imageExt.ocrProvider,
    onOcrProviderChange: imageExt.handleOcrProviderChange,
    ocrFile: imageExt.ocrFile,
    setOcrFile: imageExt.setOcrFile,
    ocrModel: imageExt.ocrModel,
    setOcrModel: imageExt.setOcrModel,
    ocrLocalUrl: imageExt.ocrLocalUrl,
    setOcrLocalUrl: imageExt.setOcrLocalUrl,
    onRunOcr: imageExt.runOcr,
    lipsyncProvider: imageExt.lipsyncProvider,
    onLipsyncProviderChange: imageExt.handleLipsyncProviderChange,
    lipsyncVideoFile: imageExt.lipsyncVideoFile,
    setLipsyncVideoFile: imageExt.setLipsyncVideoFile,
    lipsyncAudioFile: imageExt.lipsyncAudioFile,
    setLipsyncAudioFile: imageExt.setLipsyncAudioFile,
    lipsyncModel: imageExt.lipsyncModel,
    setLipsyncModel: imageExt.setLipsyncModel,
    lipsyncLocalUrl: imageExt.lipsyncLocalUrl,
    setLipsyncLocalUrl: imageExt.setLipsyncLocalUrl,
    onRunLipsync: imageExt.runLipsync,
    fieldCls,
    fileCls,
    labelCls,
    btnSec,
  };

  // ─── Render ────────────────────────────────────────────────────────────────
  return (
    <div className={`flex flex-col h-screen overflow-hidden bg-slate-50 text-slate-900 dark:bg-slate-950 dark:text-slate-100 ${isDark ? 'dark' : ''}`}>

      <TopNav
        currentPage={currentPage}
        jobs={jobs}
        isDark={isDark}
        setIsDark={setIsDark}
        onNavigate={navigate}
      />

      {/* -- main content area -- */}
      <div className="flex-1 overflow-y-auto min-w-0 bg-slate-50 dark:bg-slate-950">
        <div className="p-6 md:p-8">
          <div className="mx-auto w-full space-y-5 max-w-5xl">

            {/* Home */}
            {showHome && <HomePanel onNavigate={(page, sub) => navigate(page as Page, sub)} jobs={jobs} backendBaseUrl={backend.backendBaseUrl} />}

            {/* Tasks + Settings tabs */}
            {showTasks && (() => {
              const TASKS_TABS = [
                { id: 'tasks',  label: '管理页面' },
                { id: 'about',  label: '功能说明' },
                { id: 'models', label: '模型管理' },
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

            {/* Audio tools header + sub tabs */}
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

            {/* Format convert header */}
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

            {/* Misc header (backward compat) */}
            {!showHome && !showTasks && !showAudioTools && !showFormatConvert && taskType === 'misc' && (
              <header className="flex items-center gap-3.5 pb-1">
                <TaskIcon task="misc" size={36} />
                <div>
                  <h1 className="text-xl font-bold tracking-tight text-slate-900 dark:text-slate-100">{TASK_LABELS['misc']}</h1>
                  <p className="text-xs text-slate-400 font-medium mt-0.5">{TASK_ICON_CFG['misc'].abbr}</p>
                </div>
              </header>
            )}

            {/* TTS Panel */}
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
                onRenameVoice={voiceMgr.renameVoice}
                onDeleteVoice={voiceMgr.deleteVoice}
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
                showCreateVoice={voiceMgr.showCreateVoice}
                setShowCreateVoice={voiceMgr.setShowCreateVoice}
                newVoiceEngine={voiceMgr.newVoiceEngine}
                setNewVoiceEngine={voiceMgr.setNewVoiceEngine}
                newVoiceName={voiceMgr.newVoiceName}
                setNewVoiceName={voiceMgr.setNewVoiceName}
                creatingVoice={voiceMgr.creatingVoice}
                setNewVoiceModel={voiceMgr.setNewVoiceModel}
                setNewVoiceIndex={voiceMgr.setNewVoiceIndex}
                setNewVoiceRef={voiceMgr.setNewVoiceRef}
                setNewVoiceGptModel={voiceMgr.setNewVoiceGptModel}
                setNewVoiceSovitsModel={voiceMgr.setNewVoiceSovitsModel}
                newVoiceRefText={voiceMgr.newVoiceRefText}
                setNewVoiceRefText={voiceMgr.setNewVoiceRefText}
                onCreateVoice={voiceMgr.createVoice}
                trainVoiceName={voiceMgr.trainVoiceName}
                setTrainVoiceName={voiceMgr.setTrainVoiceName}
                trainFiles={voiceMgr.trainFiles}
                setTrainFiles={voiceMgr.setTrainFiles}
                onStartTraining={voiceMgr.startTraining}
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

            {/* VC Panel */}
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
                vcInputMode={vcExt.vcInputMode}
                setVcInputMode={vcExt.setVcInputMode}
                vcFile={vcExt.vcFile}
                setVcFile={vcExt.setVcFile}
                vcRefAudios={vcExt.vcRefAudios}
                setVcRefAudios={vcExt.setVcRefAudios}
                showCreateVoice={voiceMgr.showCreateVoice}
                setShowCreateVoice={voiceMgr.setShowCreateVoice}
                newVoiceEngine={voiceMgr.newVoiceEngine}
                setNewVoiceEngine={voiceMgr.setNewVoiceEngine}
                newVoiceName={voiceMgr.newVoiceName}
                setNewVoiceName={voiceMgr.setNewVoiceName}
                creatingVoice={voiceMgr.creatingVoice}
                setNewVoiceModel={voiceMgr.setNewVoiceModel}
                setNewVoiceIndex={voiceMgr.setNewVoiceIndex}
                setNewVoiceRef={voiceMgr.setNewVoiceRef}
                onCreateVoice={voiceMgr.createVoice}
                onDeleteVoice={voiceMgr.deleteVoice}
                onRenameVoice={voiceMgr.renameVoice}
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
                seedVcDiffusionSteps={vcExt.seedVcDiffusionSteps}
                setSeedVcDiffusionSteps={vcExt.setSeedVcDiffusionSteps}
                seedVcPitchShift={vcExt.seedVcPitchShift}
                setSeedVcPitchShift={vcExt.setSeedVcPitchShift}
                seedVcF0Condition={vcExt.seedVcF0Condition}
                setSeedVcF0Condition={vcExt.setSeedVcF0Condition}
                seedVcEnablePostprocess={vcExt.seedVcEnablePostprocess}
                setSeedVcEnablePostprocess={vcExt.setSeedVcEnablePostprocess}
                seedVcCfgRate={vcExt.seedVcCfgRate}
                setSeedVcCfgRate={vcExt.setSeedVcCfgRate}
                rvcF0Method={vcExt.rvcF0Method}
                setRvcF0Method={vcExt.setRvcF0Method}
                rvcFilterRadius={vcExt.rvcFilterRadius}
                setRvcFilterRadius={vcExt.setRvcFilterRadius}
                rvcIndexRate={vcExt.rvcIndexRate}
                setRvcIndexRate={vcExt.setRvcIndexRate}
                rvcPitchShift={vcExt.rvcPitchShift}
                setRvcPitchShift={vcExt.setRvcPitchShift}
                rvcRmsMixRate={vcExt.rvcRmsMixRate}
                setRvcRmsMixRate={vcExt.setRvcRmsMixRate}
                rvcProtect={vcExt.rvcProtect}
                setRvcProtect={vcExt.setRvcProtect}
                trainVoiceName={voiceMgr.trainVoiceName}
                setTrainVoiceName={voiceMgr.setTrainVoiceName}
                trainFiles={voiceMgr.trainFiles}
                setTrainFiles={voiceMgr.setTrainFiles}
                trainEpochs={voiceMgr.trainEpochs}
                setTrainEpochs={voiceMgr.setTrainEpochs}
                trainF0Method={voiceMgr.trainF0Method}
                setTrainF0Method={voiceMgr.setTrainF0Method}
                trainSampleRate={voiceMgr.trainSampleRate}
                setTrainSampleRate={voiceMgr.setTrainSampleRate}
                onStartTraining={voiceMgr.startTraining}
                fieldCls={fieldCls}
                fileCls={fileCls}
                labelCls={labelCls}
                btnSec={btnSec}
              />
            )}

            {/* ASR Panel */}
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

            {/* LLM Panel */}
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

            {/* Voice Chat Panel */}
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

            {/* Format convert: tabs + content */}
            {showFormatConvert && (
              <>
                <div className="space-y-1">
                  {/* Media tools */}
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
                  {/* Doc tools */}
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

            {/* Misc Panel (backward compat) */}
            {!showHome && !showTasks && !showAudioTools && !showFormatConvert && taskType === 'misc' && (
              <MiscPanel {...miscPanelProps} />
            )}

            {/* Image tools */}
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
                <MiscPanel {...miscPanelProps} allowedSubPages={['img_gen', 'img_i2i', 'image_understand', 'ocr']} />
              </>
            )}

            {/* Video tools */}
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
                <MiscPanel {...miscPanelProps} allowedSubPages={['video_gen', 'lipsync']} />
              </>
            )}

            {/* Text tools */}
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
                  <MiscPanel {...miscPanelProps} allowedSubPages={[textSubPage as MiscSubPage]} />
                )}
              </div>
            )}

            {/* Advanced tools */}
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

            {/* Processing progress bar */}
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

            {/* Error/Success messages */}
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

          </div>{/* max-w-5xl */}
        </div>{/* p-6 */}
      </div>{/* flex-1 main scroll */}

    </div>
  );
}
