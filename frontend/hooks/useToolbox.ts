import { useState, useRef } from 'react';
import type { Status, ToolboxSubPage } from '../types';
import { safeJson } from '../utils';

interface UseToolboxParams {
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

export function useToolbox({
  backendBaseUrl,
  outputDir,
  setStatus,
  setProcessingStartTime,
  setError,
  addInstantJobResult,
}: UseToolboxParams) {
  const [toolSubPage, setToolSubPage] = useState<ToolboxSubPage>('image');

  // 图片处理
  const [imgFile, setImgFile] = useState<File | null>(null);
  const [imgOutputFmt, setImgOutputFmt] = useState('png');
  const [imgResizeW, setImgResizeW] = useState('');
  const [imgResizeH, setImgResizeH] = useState('');
  const [imgQuality, setImgQuality] = useState('85');

  // 二维码
  const [qrMode, setQrMode] = useState<'generate' | 'decode'>('generate');
  const [qrText, setQrText] = useState('');
  const [qrFile, setQrFile] = useState<File | null>(null);

  // 文本编码
  const [encFile, setEncFile] = useState<File | null>(null);
  const [encTarget, setEncTarget] = useState('utf-8');

  const abortCtrlRef = useRef<AbortController | null>(null);

  // currentSubPage 由外部传入（DocPanel 的 docSubPage），避免 toolSubPage 状态与 DocPanel 不同步
  async function runToolbox(currentSubPage: ToolboxSubPage) {
    setError('');

    let action = '';
    let label = '';
    let file: File | null = null;

    if (currentSubPage === 'image') {
      if (!imgFile) { setError('请选择图片文件'); return; }
      action = 'image_convert'; label = `图片处理 · ${imgFile.name}`; file = imgFile;
    } else if (currentSubPage === 'qr') {
      if (qrMode === 'generate') {
        if (!qrText.trim()) { setError('请输入二维码内容'); return; }
        action = 'qr_generate'; label = `生成二维码 · ${qrText.slice(0, 20)}`;
      } else {
        if (!qrFile) { setError('请选择图片文件'); return; }
        action = 'qr_decode'; label = `识别二维码 · ${qrFile.name}`; file = qrFile;
      }
    } else {
      if (!encFile) { setError('请选择文本文件'); return; }
      if (!outputDir.trim()) { setError('请选择输出目录'); return; }
      action = 'text_encoding'; label = `编码转换 · ${encFile.name}`; file = encFile;
    }

    setStatus('processing');
    setProcessingStartTime(Date.now());
    const ctrl = new AbortController();
    abortCtrlRef.current = ctrl;

    try {
      const fd = new FormData();
      fd.append('action', action);
      if (file) fd.append('file', file);
      if (action === 'qr_generate') fd.append('text_input', qrText.trim());
      if (action === 'image_convert') {
        fd.append('output_format', imgOutputFmt);
        fd.append('resize_w', imgResizeW);
        fd.append('resize_h', imgResizeH);
        fd.append('quality', imgQuality);
      }
      if (action === 'text_encoding') fd.append('output_format', encTarget);
      fd.append('output_dir', outputDir);

      const res = await fetch(`${backendBaseUrl}/tasks/toolbox`, { method: 'POST', body: fd, signal: ctrl.signal });
      const data = await safeJson(res);
      if (!res.ok) throw new Error(`处理失败（${res.status}）${data?.detail ? `：${data.detail}` : ''}`);

      // 成功：添加任务记录并跳转到任务列表
      addInstantJobResult('toolbox', label, 'local', true, {
        status: 'completed',
        result_url: data?.result_url || undefined,
        result_text: data?.result_text || undefined,
      });
    } catch (e: any) {
      if (e?.name === 'AbortError') {
        setError('已取消');
      } else {
        // 出错：只在当前页显示错误，不跳转，不加入任务列表
        setError(e instanceof Error ? e.message : '处理失败');
      }
    } finally {
      setStatus('idle');
      setProcessingStartTime(null);
      abortCtrlRef.current = null;
    }
  }

  function abortCurrentRequest() { abortCtrlRef.current?.abort(); }

  return {
    toolSubPage, setToolSubPage,
    imgFile, setImgFile, imgOutputFmt, setImgOutputFmt,
    imgResizeW, setImgResizeW, imgResizeH, setImgResizeH,
    imgQuality, setImgQuality,
    qrMode, setQrMode, qrText, setQrText, qrFile, setQrFile,
    encFile, setEncFile, encTarget, setEncTarget,
    runToolbox, abortCurrentRequest,
  };
}
