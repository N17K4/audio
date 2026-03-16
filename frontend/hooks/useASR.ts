import { useState, useRef } from 'react';
import type { Status, VcInputMode } from '../types';
import { safeJson } from '../utils';

interface UseASRParams {
  backendBaseUrl: string;
  selectedProvider: string;
  isLocal: boolean;
  apiKey: string;
  cloudEndpoint: string;
  needsAuth: boolean;
  setStatus: (s: Status) => void;
  setProcessingStartTime: (t: number | null) => void;
  setError: (e: string) => void;
  addInstantJobResult: (
    type: string, label: string, provider: string, isLocal: boolean,
    result: { status: 'completed' | 'failed'; result_url?: string; result_text?: string; error?: string },
  ) => void;
}

export function useASR({
  backendBaseUrl,
  selectedProvider,
  isLocal,
  apiKey,
  cloudEndpoint,
  needsAuth,
  setStatus,
  setProcessingStartTime,
  setError,
  addInstantJobResult,
}: UseASRParams) {
  const [asrFile, setAsrFile] = useState<File | null>(null);
  const [asrModel, setAsrModel] = useState('');
  const [asrInputMode, setAsrInputMode] = useState<VcInputMode>('upload');
  const [asrRecordedObjectUrl, setAsrRecordedObjectUrl] = useState<string | null>(null);
  const [asrRecordingDir, setAsrRecordingDir] = useState<string | null>(null);
  const abortCtrlRef = useRef<AbortController | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  async function startAsrRecording() {
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
        if (asrRecordedObjectUrl) URL.revokeObjectURL(asrRecordedObjectUrl);
        const url = URL.createObjectURL(blob);
        setAsrRecordedObjectUrl(url);
        setAsrFile(new File([blob], 'recording.webm', { type: 'audio/webm' }));
        if (api.saveRecording) {
          const fname = `asr_recording_${Date.now()}.webm`;
          const dir = await api.saveRecording(fname, await blob.arrayBuffer());
          setAsrRecordingDir(dir);
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

  function stopAsrRecording() {
    recorderRef.current?.stop();
  }

  function clearAsrRecording() {
    if (asrRecordedObjectUrl) URL.revokeObjectURL(asrRecordedObjectUrl);
    setAsrRecordedObjectUrl(null);
    setAsrFile(null);
    setAsrRecordingDir(null);
  }

  async function runAsr() {
    if (!asrFile) { setError(asrInputMode === 'record' ? '请先录音' : '请选择音频文件'); return; }
    if (needsAuth && !apiKey.trim()) { setError('该服务商需要 API 密钥'); return; }
    setError('');
    const t0 = Date.now();
    setProcessingStartTime(t0);
    setStatus('processing');
    const ctrl = new AbortController();
    abortCtrlRef.current = ctrl;
    const label = `STT · ${asrFile.name}`;
    try {
      const fd = new FormData();
      fd.append('provider', selectedProvider);
      fd.append('file', asrFile);
      fd.append('model', asrModel);
      fd.append('api_key', apiKey);
      fd.append('cloud_endpoint', cloudEndpoint);
      const res = await fetch(`${backendBaseUrl}/tasks/stt`, { method: 'POST', body: fd, signal: ctrl.signal });
      const data = await safeJson(res);
      if (!res.ok) throw new Error(`任务失败（${res.status}）${data?.detail ? `：${data.detail}` : ''}`);
      const textOut = String(data?.text || data?.message || data?.summary || data?.result_text || '');
      addInstantJobResult('asr', label, selectedProvider, isLocal, { status: 'completed', result_text: textOut });
    } catch (e: any) {
      if (e?.name === 'AbortError') { setError('已取消'); }
      else { addInstantJobResult('asr', label, selectedProvider, isLocal, { status: 'failed', error: e instanceof Error ? e.message : '任务失败' }); }
    } finally {
      setStatus('idle');
      setProcessingStartTime(null);
      abortCtrlRef.current = null;
    }
  }

  function abortCurrentRequest() { abortCtrlRef.current?.abort(); }

  return {
    asrFile, setAsrFile,
    asrModel, setAsrModel,
    asrInputMode, setAsrInputMode,
    asrRecordedObjectUrl,
    asrRecordingDir,
    startAsrRecording, stopAsrRecording, clearAsrRecording,
    runAsr, abortCurrentRequest,
  };
}
