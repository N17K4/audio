import { useState, useRef } from 'react';
import type { Status, Job, VcInputMode } from '../types';
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
  const [ttsRefAudios, setTtsRefAudios] = useState<File[]>([]);
  const [ttsRefInputMode, setTtsRefInputMode] = useState<VcInputMode>('upload');
  const [ttsRefRecordedObjectUrl, setTtsRefRecordedObjectUrl] = useState<string | null>(null);
  const [ttsRecordingDir, setTtsRecordingDir] = useState<string | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  async function startTtsRefRecording() {
    setError('');
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
        audioStream.getTracks().forEach(t => t.stop());
        const blob = new Blob(chunksRef.current, { type: 'audio/webm' });
        if (ttsRefRecordedObjectUrl) URL.revokeObjectURL(ttsRefRecordedObjectUrl);
        const url = URL.createObjectURL(blob);
        setTtsRefRecordedObjectUrl(url);
        setTtsRefAudios([new File([blob], 'recording.webm', { type: 'audio/webm' })]);
        if (api.saveRecording) {
          const fname = `tts_ref_recording_${Date.now()}.webm`;
          const dir = await api.saveRecording(fname, await blob.arrayBuffer());
          setTtsRecordingDir(dir);
        }
        setStatus('idle');
      };
      recorder.start();
      recorderRef.current = recorder;
      setStatus('recording');
    } catch (e) {
      setError(e instanceof Error ? e.message : '启动录音失败');
      setStatus('idle');
    }
  }

  function stopTtsRefRecording() {
    recorderRef.current?.stop();
  }

  function clearTtsRefRecording() {
    if (ttsRefRecordedObjectUrl) URL.revokeObjectURL(ttsRefRecordedObjectUrl);
    setTtsRefRecordedObjectUrl(null);
    setTtsRefAudios([]);
    setTtsRecordingDir(null);
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
    ttsRefAudios, setTtsRefAudios,
    ttsRefInputMode, setTtsRefInputMode,
    ttsRefRecordedObjectUrl,
    ttsRecordingDir,
    startTtsRefRecording, stopTtsRefRecording, clearTtsRefRecording,
    runTts,
  };
}
