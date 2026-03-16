import { useState, useRef } from 'react';
import type { Status, DocSubPage } from '../types';
import { safeJson } from '../utils';

type JobResult = { status: 'completed' | 'failed'; result_url?: string; result_text?: string; error?: string };

interface UseDocConvertParams {
  backendBaseUrl: string;
  outputDir: string;
  setStatus: (s: Status) => void;
  setProcessingStartTime: (t: number | null) => void;
  setError: (e: string) => void;
  addPendingJob: (type: string, label: string, provider: string, isLocal: boolean) => string;
  resolveJob: (id: string, result: JobResult) => void;
}

export function useDocConvert({
  backendBaseUrl,
  outputDir,
  setStatus,
  setProcessingStartTime,
  setError,
  addPendingJob,
  resolveJob,
}: UseDocConvertParams) {
  const [docSubPage, setDocSubPage] = useState<DocSubPage>('pdf_to_word');
  const [docFile, setDocFile] = useState<File | null>(null);
  const [docOutputFormat, setDocOutputFormat] = useState('docx');
  const [docExtractMode, setDocExtractMode] = useState<'text' | 'images'>('text');

  const abortCtrlRef = useRef<AbortController | null>(null);

  async function runDocConvert() {
    if (!docFile) { setError('请选择要转换的文件'); return; }
    if (!outputDir.trim()) { setError('请选择输出目录'); return; }
    setError('');
    setStatus('processing');
    setProcessingStartTime(Date.now());
    const ctrl = new AbortController();
    abortCtrlRef.current = ctrl;

    const actionLabel: Partial<Record<DocSubPage, string>> = {
      pdf_to_word: 'PDF 转 Word',
      doc_convert: '文档互转',
      pdf_extract: 'PDF 提取',
    };
    const label = `${actionLabel[docSubPage] ?? docSubPage} · ${docFile.name}`;
    const jobId = addPendingJob('doc', label, 'local', true);

    try {
      const fd = new FormData();
      fd.append('file', docFile);
      fd.append('action', docSubPage);
      fd.append('output_format', docOutputFormat);
      fd.append('extract_mode', docExtractMode);
      fd.append('output_dir', outputDir);

      const res = await fetch(`${backendBaseUrl}/tasks/doc-convert`, { method: 'POST', body: fd, signal: ctrl.signal });
      const data = await safeJson(res);
      if (!res.ok) throw new Error(`转换失败（${res.status}）${data?.detail ? `：${data.detail}` : ''}`);
      const url = data?.result_url || '';
      const text = data?.result_text || '';
      if (!url && !text) throw new Error('响应中无结果');
      resolveJob(jobId, { status: 'completed', result_url: url || undefined, result_text: text || undefined });
    } catch (e: any) {
      if (e?.name === 'AbortError') { setError('已取消'); resolveJob(jobId, { status: 'failed', error: '已取消' }); }
      else { resolveJob(jobId, { status: 'failed', error: e instanceof Error ? e.message : '转换失败' }); }
    } finally {
      setStatus('idle');
      setProcessingStartTime(null);
      abortCtrlRef.current = null;
    }
  }

  function abortCurrentRequest() { abortCtrlRef.current?.abort(); }

  return {
    docSubPage, setDocSubPage,
    docFile, setDocFile,
    docOutputFormat, setDocOutputFormat,
    docExtractMode, setDocExtractMode,
    runDocConvert,
    abortCurrentRequest,
  };
}
