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

export type ClipEndMode = 'duration' | 'endtime';

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

  // 截取片段：开始时间
  const [startMin, setStartMin] = useState('');
  const [startSec, setStartSec] = useState('');

  // 截取片段：结束方式
  const [clipEndMode, setClipEndMode] = useState<ClipEndMode>('duration');
  const [durationMin, setDurationMin] = useState('');
  const [durationSec, setDurationSec] = useState('');
  const [endMin, setEndMin] = useState('');
  const [endSec, setEndSec] = useState('');

  const abortCtrlRef = useRef<AbortController | null>(null);

  async function runMediaConvert() {
    if (!mediaFile) { setError('请选择要转换的文件'); return; }
    if (!outputDir.trim()) { setError('请选择输出目录'); return; }
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
      fd.append('output_dir', outputDir);

      if (mediaAction === 'clip') {
        const startSecs = (parseInt(startMin || '0') || 0) * 60 + (parseInt(startSec || '0') || 0);
        fd.append('start_time', String(startSecs));

        let durSecs = 0;
        if (clipEndMode === 'duration') {
          durSecs = (parseInt(durationMin || '0') || 0) * 60 + (parseInt(durationSec || '0') || 0);
        } else {
          const endSecs = (parseInt(endMin || '0') || 0) * 60 + (parseInt(endSec || '0') || 0);
          durSecs = Math.max(0, endSecs - startSecs);
        }
        if (durSecs > 0) fd.append('duration', String(durSecs));
      } else {
        fd.append('start_time', '');
        fd.append('duration', '');
      }

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
    startMin, setStartMin,
    startSec, setStartSec,
    clipEndMode, setClipEndMode,
    durationMin, setDurationMin,
    durationSec, setDurationSec,
    endMin, setEndMin,
    endSec, setEndSec,
    runMediaConvert,
    abortCurrentRequest,
  };
}
