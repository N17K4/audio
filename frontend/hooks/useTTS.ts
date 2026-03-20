import { useState, useEffect } from 'react';
import type { Status, Job, VcInputMode } from '../types';
import { safeJson } from '../utils';
import { useAudioRecorder } from './useAudioRecorder';

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
}: UseTTSParams) {
  const [ttsText, setTtsText] = useState('你好，这是一段测试语音。');
  const [ttsModel, setTtsModel] = useState('');
  const [ttsVoice, setTtsVoice] = useState('');
  const [ttsVoiceId, setTtsVoiceId] = useState('');
  const [ttsRefAudios, setTtsRefAudios] = useState<File[]>([]);
  const [ttsRefInputMode, setTtsRefInputMode] = useState<VcInputMode>('upload');
  const recorder = useAudioRecorder({ setStatus, setError });

  useEffect(() => {
    if (recorder.recordedFile) {
      setTtsRefAudios([recorder.recordedFile]);
    }
  }, [recorder.recordedFile]);

  // GPT-SoVITS 高級パラメータ
  const [gptSovitsTextLang, setGptSovitsTextLang] = useState('auto');
  const [gptSovitsPromptLang, setGptSovitsPromptLang] = useState('auto');
  const [gptSovitsRefText, setGptSovitsRefText] = useState('');
  const [gptSovitsTopK, setGptSovitsTopK] = useState(15);
  const [gptSovitsTopP, setGptSovitsTopP] = useState(1.0);
  const [gptSovitsTemperature, setGptSovitsTemperature] = useState(1.0);
  const [gptSovitsSpeed, setGptSovitsSpeed] = useState(1.0);
  const [gptSovitsRepetitionPenalty, setGptSovitsRepetitionPenalty] = useState(1.35);
  const [gptSovitsSeed, setGptSovitsSeed] = useState(-1);
  const [gptSovitsTextSplitMethod, setGptSovitsTextSplitMethod] = useState('cut5');
  const [gptSovitsBatchSize, setGptSovitsBatchSize] = useState(1);
  const [gptSovitsParallelInfer, setGptSovitsParallelInfer] = useState(true);
  const [gptSovitsFragmentInterval, setGptSovitsFragmentInterval] = useState(0.3);
  const [gptSovitsSampleSteps, setGptSovitsSampleSteps] = useState(32);

  function clearTtsRefRecording() {
    recorder.clearRecording();
    setTtsRefAudios([]);
  }

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
      if (selectedProvider === 'fish_speech') {
        ttsRefAudios.forEach(f => fd.append('reference_audio', f));
      }
      if (selectedProvider === 'gpt_sovits') {
        if (ttsVoiceId) fd.append('voice_id', ttsVoiceId);
        fd.append('text_lang', gptSovitsTextLang);
        fd.append('prompt_lang', gptSovitsPromptLang);
        if (gptSovitsRefText.trim()) fd.append('ref_text', gptSovitsRefText);
        fd.append('top_k', String(gptSovitsTopK));
        fd.append('top_p', String(gptSovitsTopP));
        fd.append('temperature', String(gptSovitsTemperature));
        fd.append('speed', String(gptSovitsSpeed));
        fd.append('repetition_penalty', String(gptSovitsRepetitionPenalty));
        fd.append('seed', String(gptSovitsSeed));
        fd.append('text_split_method', gptSovitsTextSplitMethod);
        fd.append('batch_size', String(gptSovitsBatchSize));
        fd.append('parallel_infer', gptSovitsParallelInfer ? '1' : '0');
        fd.append('fragment_interval', String(gptSovitsFragmentInterval));
        fd.append('sample_steps', String(gptSovitsSampleSteps));
      }
      const res = await fetch(`${backendBaseUrl}/tasks/tts`, { method: 'POST', body: fd });
      const data = await safeJson(res);
      if (!res.ok) throw new Error(`任务失败（${res.status}）${data?.detail ? `：${data.detail}` : ''}`);
      if (data?.job_id) {
        const pending: Job = { id: data.job_id, type: 'tts', label, provider: selectedProvider, is_local: true, status: 'queued', created_at: Date.now() / 1000, started_at: null, completed_at: null, result_url: null, result_text: null, error: null };
        setJobs(prev => [pending, ...prev]);
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
    ttsVoiceId, setTtsVoiceId,
    ttsRefAudios, setTtsRefAudios,
    ttsRefInputMode, setTtsRefInputMode,
    ttsRefRecordedObjectUrl: recorder.recordedObjectUrl,
    ttsRecordingDir: recorder.recordingDir,
    startTtsRefRecording: recorder.startRecording, stopTtsRefRecording: recorder.stopRecording, clearTtsRefRecording,
    gptSovitsTextLang, setGptSovitsTextLang,
    gptSovitsPromptLang, setGptSovitsPromptLang,
    gptSovitsRefText, setGptSovitsRefText,
    gptSovitsTopK, setGptSovitsTopK,
    gptSovitsTopP, setGptSovitsTopP,
    gptSovitsTemperature, setGptSovitsTemperature,
    gptSovitsSpeed, setGptSovitsSpeed,
    gptSovitsRepetitionPenalty, setGptSovitsRepetitionPenalty,
    gptSovitsSeed, setGptSovitsSeed,
    gptSovitsTextSplitMethod, setGptSovitsTextSplitMethod,
    gptSovitsBatchSize, setGptSovitsBatchSize,
    gptSovitsParallelInfer, setGptSovitsParallelInfer,
    gptSovitsFragmentInterval, setGptSovitsFragmentInterval,
    gptSovitsSampleSteps, setGptSovitsSampleSteps,
    runTts,
  };
}
