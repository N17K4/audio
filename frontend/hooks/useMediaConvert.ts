import { useState, useRef } from 'react';
import type { Status, MediaAction } from '../types';
import { safeJson } from '../utils';

interface UseMediaConvertParams {
  backendBaseUrl: string;
  outputDir: string;
  setStatus: (s: Status) => void;
  setProcessingStartTime: (t: number | null) => void;
  setError: (e: string) => void;
  addInstantJobResult: (
    type: string, label: string, provider: string, isLocal: boolean,
    result: { status: 'completed' | 'failed'; result_url?: string; result_text?: string; error?: string },
  ) => void;
}

export function useMediaConvert({
  backendBaseUrl,
  outputDir,
  setStatus,
  setProcessingStartTime,
  setError,
  addInstantJobResult,
}: UseMediaConvertParams) {
  const [mediaFile, setMediaFile] = useState<File | null>(null);
  const [mediaAction, setMediaAction] = useState<MediaAction>('convert');
  const [mediaOutputFormat, setMediaOutputFormat] = useState('mp3');
  const [mediaStartTime, setMediaStartTime] = useState('');
  const [mediaDuration, setMediaDuration] = useState('');
  const abortCtrlRef = useRef<AbortController | null>(null);

  async function runMediaConvert() {
    if (!mediaFile) { setError('请选择要转换的文件'); return; }
    setError('');
    const t0 = Date.now();
    setProcessingStartTime(t0);
    setStatus('processing');
    const ctrl = new AbortController();
    abortCtrlRef.current = ctrl;
    const label = `格式转换 · ${mediaFile.name}`;
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
      if (!res.ok) throw new Error(`转换失败（${res.status}）${data?.detail ? `：${data.detail}` : ''}`);
      const url = data?.result_url || '';
      if (!url) throw new Error('响应中无结果链接');
      addInstantJobResult('media', label, 'ffmpeg', false, { status: 'completed', result_url: url });
    } catch (e: any) {
      if (e?.name === 'AbortError') { setError('已取消'); }
      else { addInstantJobResult('media', label, 'ffmpeg', false, { status: 'failed', error: e instanceof Error ? e.message : '转换失败' }); }
    } finally {
      setStatus('idle');
      setProcessingStartTime(null);
      abortCtrlRef.current = null;
    }
  }

  function abortCurrentRequest() { abortCtrlRef.current?.abort(); }

  return {
    mediaFile, setMediaFile,
    mediaAction, setMediaAction,
    mediaOutputFormat, setMediaOutputFormat,
    mediaStartTime, setMediaStartTime,
    mediaDuration, setMediaDuration,
    runMediaConvert,
    abortCurrentRequest,
  };
}
