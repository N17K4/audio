import { useEffect, useState } from 'react';
import type { Status, TaskType } from '../types';
import { TASK_LABELS, TASK_PHASES, LS } from '../constants';
import { rlog } from '../utils';

export function useAppState() {
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

  // ─── 共享设置 ─────────────────────────────────────────────────────────────
  const [providerMap, setProviderMap] = useState<Record<string, string>>({
    tts: 'fish_speech', vc: 'seed_vc', asr: 'faster_whisper', llm: 'gemini',
  });
  const [apiKey, setApiKey] = useState('');
  const [cloudEndpoint, setCloudEndpoint] = useState('');
  const [outputDir, setOutputDir] = useState('');

  // ─── 持久化 ──────────────────────────────────────────────────────────────
  const [taskType, setTaskType] = useState<TaskType>('tts');

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
  function updateProcessingTimer(currentTaskType: TaskType) {
    // This is called from the effect in AppShell
  }

  return {
    error, setError,
    successMsg, setSuccessMsg,
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
    persistedTaskType: taskType,
    setPersistedTaskType: setTaskType,
  };
}
