import { useState } from 'react';
import type { Status, Job } from '../types';
import { safeJson } from '../utils';

interface UseTTSParams {
  backendBaseUrl: string;
  selectedProvider: string;
  apiKey: string;
  cloudEndpoint: string;
  outputDir: string;
  needsAuth: boolean;
  setStatus: (s: Status) => void;
  setProcessingStartTime: (t: number | null) => void;
  setError: (e: string) => void;
  setJobs: React.Dispatch<React.SetStateAction<Job[]>>;
  addInstantJobResult: (
    type: string, label: string, provider: string, isLocal: boolean,
    result: { status: 'completed' | 'failed'; result_url?: string; result_text?: string; error?: string },
  ) => void;
  onNavigateTasks: () => void;
}

export function useTTS({
  backendBaseUrl,
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
  onNavigateTasks,
}: UseTTSParams) {
  const [ttsText, setTtsText] = useState('你好，这是一段测试语音。');
  const [ttsModel, setTtsModel] = useState('');
  const [ttsVoice, setTtsVoice] = useState('');
  const [ttsRefAudio, setTtsRefAudio] = useState<File | null>(null);

  async function runTts() {
    if (!ttsText.trim()) { setError('请输入合成文本'); return; }
    if (!outputDir.trim()) { setError('请填写输出目录'); return; }
    if (needsAuth && !apiKey.trim()) { setError('该服务商需要 API 密钥'); return; }
    setError('');
    const t0 = Date.now();
    setProcessingStartTime(t0);
    setStatus('processing');
    const label = `TTS · ${ttsText.slice(0, 30) + (ttsText.length > 30 ? '…' : '')}`;
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
        const pending: Job = { id: data.job_id, type: 'tts', label, provider: selectedProvider, is_local: true, status: 'queued', created_at: Date.now() / 1000, started_at: null, completed_at: null, result_url: null, result_text: null, error: null };
        setJobs(prev => [pending, ...prev]);
        onNavigateTasks();
      } else {
        addInstantJobResult('tts', label, selectedProvider, false, { status: 'completed', result_url: data?.result_url || undefined });
      }
    } catch (e: any) {
      addInstantJobResult('tts', label, selectedProvider, false, { status: 'failed', error: e instanceof Error ? e.message : '任务失败' });
    } finally {
      setStatus('idle');
      setProcessingStartTime(null);
    }
  }

  return {
    ttsText, setTtsText,
    ttsModel, setTtsModel,
    ttsVoice, setTtsVoice,
    ttsRefAudio, setTtsRefAudio,
    runTts,
  };
}
