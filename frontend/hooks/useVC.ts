import { useState, useRef } from 'react';
import type { Status, Job } from '../types';
import { LOCAL_PROVIDERS } from '../constants';
import { safeJson } from '../utils';

interface UseVCParams {
  backendBaseUrl: string;
  selectedProvider: string;
  isLocal: boolean;
  apiKey: string;
  cloudEndpoint: string;
  outputDir: string;
  needsAuth: boolean;
  selectedVoiceId: string;
  vcRefAudio: File | null;
  status: Status;
  setStatus: (s: Status) => void;
  setProcessingStartTime: (t: number | null) => void;
  setError: (e: string) => void;
  setSuccessMsg: (m: string) => void;
  setJobs: React.Dispatch<React.SetStateAction<Job[]>>;
  addInstantJobResult: (
    type: string, label: string, provider: string, isLocal: boolean,
    result: { status: 'completed' | 'failed'; result_url?: string; result_text?: string; error?: string },
  ) => void;
  onNavigateTasks: () => void;
  // Seed-VC settings
  seedVcDiffusionSteps: number;
  seedVcPitchShift: number;
  seedVcF0Condition: boolean;
  seedVcEnablePostprocess: boolean;
  seedVcCfgRate: number;
  // RVC settings
  rvcF0Method: string;
  rvcFilterRadius: number;
  rvcIndexRate: number;
  rvcPitchShift: number;
  rvcRmsMixRate: number;
  rvcProtect: number;
}

export function useVC({
  backendBaseUrl,
  selectedProvider,
  isLocal,
  apiKey,
  cloudEndpoint,
  outputDir,
  needsAuth,
  selectedVoiceId,
  vcRefAudio,
  status,
  setStatus,
  setProcessingStartTime,
  setError,
  setSuccessMsg,
  setJobs,
  addInstantJobResult,
  onNavigateTasks,
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
}: UseVCParams) {
  const [vcRecordedFile, setVcRecordedFile] = useState<File | null>(null);
  const [vcRecordedObjectUrl, setVcRecordedObjectUrl] = useState<string | null>(null);
  const [vcRecordingDir, setVcRecordingDir] = useState<string | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const abortCtrlRef = useRef<AbortController | null>(null);

  async function handleVoiceConvert(audio: Blob | File) {
    const isSeedVc = selectedProvider === 'seed_vc';
    if (!isSeedVc && !selectedVoiceId) { setStatus('idle'); setError('请选择目标音色'); return; }
    if (isSeedVc && !vcRefAudio) { setStatus('idle'); setError('请上传 Seed-VC 参考音频'); return; }
    if (!outputDir.trim()) { setStatus('idle'); setError('请填写输出目录'); return; }
    if (needsAuth && !apiKey.trim()) { setStatus('idle'); setError('该服务商需要 API 密钥'); return; }
    setError('');
    setStatus('processing');
    const t0 = Date.now();
    setProcessingStartTime(t0);
    const ctrl = new AbortController();
    abortCtrlRef.current = ctrl;
    const fd = new FormData();
    fd.append('file', audio, audio instanceof File ? audio.name : 'audio.webm');
    fd.append('voice_id', isSeedVc ? '_seed_vc_direct_' : selectedVoiceId);
    fd.append('mode', isLocal ? 'local' : 'cloud');
    fd.append('provider', selectedProvider);
    fd.append('api_key', apiKey);
    fd.append('cloud_endpoint', cloudEndpoint);
    fd.append('output_dir', outputDir);
    if (isSeedVc && vcRefAudio) fd.append('reference_audio', vcRefAudio);
    if (isSeedVc) {
      fd.append('diffusion_steps', String(seedVcDiffusionSteps));
      fd.append('pitch_shift', String(seedVcPitchShift));
      fd.append('f0_condition', String(seedVcF0Condition));
      fd.append('cfg_rate', String(seedVcCfgRate));
      fd.append('enable_postprocess', String(seedVcEnablePostprocess));
    } else if (selectedProvider === 'local_rvc') {
      fd.append('pitch_shift', String(rvcPitchShift));
      fd.append('f0_method', rvcF0Method);
      fd.append('filter_radius', String(rvcFilterRadius));
      fd.append('index_rate', String(rvcIndexRate));
      fd.append('rms_mix_rate', String(rvcRmsMixRate));
      fd.append('protect', String(rvcProtect));
    }
    try {
      const res = await fetch(`${backendBaseUrl}/convert`, { method: 'POST', body: fd, signal: ctrl.signal });
      const data = await safeJson(res);
      if (!res.ok) throw new Error(`转换失败（${res.status}）${data?.detail ? `：${data.detail}` : ''}`);
      const vcLabel = `VC · ${selectedProvider}`;
      if (data?.job_id) {
        const pending: Job = { id: data.job_id, type: 'vc', label: vcLabel, provider: selectedProvider, is_local: true, status: 'queued', created_at: Date.now() / 1000, started_at: null, completed_at: null, result_url: null, result_text: null, error: null };
        setJobs(prev => [pending, ...prev]);
        onNavigateTasks();
      } else {
        const url = data?.result_url;
        if (!url) throw new Error('响应中无结果链接');
        addInstantJobResult('vc', vcLabel, selectedProvider, false, { status: 'completed', result_url: url });
      }
    } catch (e: any) {
      if (e?.name === 'AbortError') { setError('已取消'); }
      else {
        addInstantJobResult('vc', `VC · ${selectedProvider}`, selectedProvider, false, { status: 'failed', error: e instanceof Error ? e.message : '转换失败' });
      }
    } finally {
      setStatus('idle');
      setProcessingStartTime(null);
      abortCtrlRef.current = null;
    }
  }

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
        audioStream.getTracks().forEach(t => t.stop());
        const blob = new Blob(chunksRef.current, { type: 'audio/webm' });
        if (vcRecordedObjectUrl) URL.revokeObjectURL(vcRecordedObjectUrl);
        setVcRecordedObjectUrl(URL.createObjectURL(blob));
        setVcRecordedFile(new File([blob], 'recording.webm', { type: 'audio/webm' }));
        const api = window.electronAPI;
        if (api?.saveRecording) {
          const fname = `vc_recording_${Date.now()}.webm`;
          const dir = await api.saveRecording(fname, await blob.arrayBuffer());
          setVcRecordingDir(dir);
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

  function stopVcRecording() { recorderRef.current?.stop(); }

  function clearVcRecording() {
    if (vcRecordedObjectUrl) URL.revokeObjectURL(vcRecordedObjectUrl);
    setVcRecordedFile(null);
    setVcRecordedObjectUrl(null);
    setVcRecordingDir(null);
  }

  function abortCurrentRequest() { abortCtrlRef.current?.abort(); }

  return { handleVoiceConvert, startVcRecording, stopVcRecording, vcRecordedFile, vcRecordedObjectUrl, vcRecordingDir, clearVcRecording, abortCurrentRequest };
}
