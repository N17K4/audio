import { useState } from 'react';
import {
  IMG_GEN_MODELS, IMG_GEN_SIZES,
  IMG_I2I_MODELS,
  VIDEO_GEN_MODELS, VIDEO_GEN_DURATIONS,
  OCR_MODELS, LIPSYNC_MODELS,
} from '../constants';

interface UseImageExtProps {
  backendBaseUrl: string;
  apiKey: string;
  cloudEndpoint: string;
  setStatus: (s: import('../types').Status) => void;
  setProcessingStartTime: (t: number | null) => void;
  setError: (e: string) => void;
  addInstantJobResult: (type: string, label: string, provider: string, isLocal: boolean, result: { status: 'completed' | 'failed'; result_url?: string; result_text?: string; error?: string }) => void;
  fetchJobs: () => Promise<void>;
  onNavigateTasks: () => void;
}

export function useImageExt({
  backendBaseUrl,
  apiKey,
  cloudEndpoint,
  setStatus,
  setProcessingStartTime,
  setError,
  addInstantJobResult,
  fetchJobs,
  onNavigateTasks,
}: UseImageExtProps) {

  // ── 图像生成状态 ──
  const [imgGenProvider, setImgGenProvider] = useState('comfyui');
  const [imgGenPrompt, setImgGenPrompt] = useState('');
  const [imgGenModel, setImgGenModel] = useState('');
  const [imgGenSize, setImgGenSize] = useState('1024x1024');
  const [imgGenComfyUrl, setImgGenComfyUrl] = useState('http://127.0.0.1:8188');

  // ── 换脸换图状态 ──
  const [imgI2iProvider, setImgI2iProvider] = useState('comfyui');
  const [imgI2iSourceFile, setImgI2iSourceFile] = useState<File | null>(null);
  const [imgI2iRefFile, setImgI2iRefFile] = useState<File | null>(null);
  const [imgI2iPrompt, setImgI2iPrompt] = useState('');
  const [imgI2iModel, setImgI2iModel] = useState('');
  const [imgI2iStrength, setImgI2iStrength] = useState(0.75);
  const [imgI2iComfyUrl, setImgI2iComfyUrl] = useState('http://127.0.0.1:8188');

  // ── 视频生成状态 ──
  const [videoGenProvider, setVideoGenProvider] = useState('kling');
  const [videoGenPrompt, setVideoGenPrompt] = useState('');
  const [videoGenModel, setVideoGenModel] = useState('kling-v2');
  const [videoGenDuration, setVideoGenDuration] = useState(5);
  const [videoGenImageFile, setVideoGenImageFile] = useState<File | null>(null);
  const [videoGenMode, setVideoGenMode] = useState<'t2v' | 'i2v'>('t2v');

  // 切换 provider 时更新默认 model/size
  function handleImgGenProviderChange(p: string) {
    setImgGenProvider(p);
    const models = IMG_GEN_MODELS[p] || [];
    setImgGenModel(models[0] || '');
    const sizes = IMG_GEN_SIZES[p] || [];
    setImgGenSize(sizes[0] || '1024x1024');
  }

  function handleImgI2iProviderChange(p: string) {
    setImgI2iProvider(p);
    const models = IMG_I2I_MODELS[p] || [];
    setImgI2iModel(models[0] || '');
  }

  function handleVideoGenProviderChange(p: string) {
    setVideoGenProvider(p);
    const models = VIDEO_GEN_MODELS[p] || [];
    setVideoGenModel(models[0] || '');
    const durations = VIDEO_GEN_DURATIONS[p] || [5];
    setVideoGenDuration(durations[0]);
  }

  // ── 图像生成 ──
  async function runImgGen() {
    if (!imgGenPrompt.trim()) { setError('请输入图像描述'); return; }
    setError('');
    setStatus('processing');
    setProcessingStartTime(Date.now());
    try {
      const fd = new FormData();
      fd.append('prompt', imgGenPrompt.trim());
      fd.append('provider', imgGenProvider);
      fd.append('api_key', imgGenProvider === 'comfyui' ? '' : apiKey);
      fd.append('cloud_endpoint', imgGenProvider === 'comfyui' ? imgGenComfyUrl : cloudEndpoint);
      fd.append('model', imgGenModel);
      if (imgGenProvider === 'openai' || imgGenProvider === 'dashscope') {
        fd.append('size', imgGenSize);
      } else {
        fd.append('aspect_ratio', imgGenSize);
      }
      const res = await fetch(`${backendBaseUrl}/tasks/image-gen`, { method: 'POST', body: fd });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.detail || `请求失败 (${res.status})`);
      if (data.job_id) {
        await fetchJobs();
        onNavigateTasks();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : '图像生成失败');
    } finally {
      setStatus('idle');
      setProcessingStartTime(null);
    }
  }

  // ── 换脸换图 ──
  async function runImgI2i() {
    if (!imgI2iSourceFile) { setError('请上传源图片'); return; }
    setError('');
    setStatus('processing');
    setProcessingStartTime(Date.now());
    try {
      const fd = new FormData();
      fd.append('source_image', imgI2iSourceFile);
      if (imgI2iRefFile) fd.append('reference_image', imgI2iRefFile);
      fd.append('prompt', imgI2iPrompt.trim());
      fd.append('provider', imgI2iProvider);
      fd.append('api_key', imgI2iProvider === 'comfyui' ? '' : apiKey);
      fd.append('cloud_endpoint', imgI2iProvider === 'comfyui' ? imgI2iComfyUrl : cloudEndpoint);
      fd.append('model', imgI2iModel);
      fd.append('strength', String(imgI2iStrength));
      const res = await fetch(`${backendBaseUrl}/tasks/image-i2i`, { method: 'POST', body: fd });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.detail || `请求失败 (${res.status})`);
      if (data.job_id) {
        await fetchJobs();
        onNavigateTasks();
      } else if (data.result_url || data.image_url) {
        addInstantJobResult('image_i2i', `换脸换图 · ${imgI2iSourceFile.name}`, imgI2iProvider, imgI2iProvider === 'comfyui', {
          status: 'completed', result_url: data.result_url || data.image_url,
        });
        onNavigateTasks();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : '换脸换图失败');
    } finally {
      setStatus('idle');
      setProcessingStartTime(null);
    }
  }

  // ── 视频生成 ──
  async function runVideoGen() {
    if (!videoGenPrompt.trim() && videoGenMode === 't2v') { setError('请输入视频描述'); return; }
    if (!videoGenImageFile && videoGenMode === 'i2v') { setError('请上传参考图片'); return; }
    setError('');
    setStatus('processing');
    setProcessingStartTime(Date.now());
    try {
      const fd = new FormData();
      fd.append('prompt', videoGenPrompt.trim());
      fd.append('provider', videoGenProvider);
      fd.append('api_key', apiKey);
      fd.append('cloud_endpoint', cloudEndpoint);
      fd.append('model', videoGenModel);
      fd.append('duration', String(videoGenDuration));
      fd.append('mode', videoGenMode);
      if (videoGenImageFile) fd.append('image', videoGenImageFile);
      const res = await fetch(`${backendBaseUrl}/tasks/video-gen`, { method: 'POST', body: fd });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.detail || `请求失败 (${res.status})`);
      if (data.job_id) {
        await fetchJobs();
        onNavigateTasks();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : '视频生成失败');
    } finally {
      setStatus('idle');
      setProcessingStartTime(null);
    }
  }

  // ── OCR 状态 ──
  const [ocrProvider, setOcrProvider] = useState('got_ocr');
  const [ocrFile, setOcrFile] = useState<File | null>(null);
  const [ocrModel, setOcrModel] = useState('GOT-OCR2.0');
  const [ocrLocalUrl, setOcrLocalUrl] = useState('http://127.0.0.1:8890');

  function handleOcrProviderChange(p: string) {
    setOcrProvider(p);
    const models = OCR_MODELS[p] || [];
    if (models.length > 0) setOcrModel(models[0]);
  }

  async function runOcr() {
    if (!ocrFile) { setError('请上传图片或文档'); return; }
    setError('');
    setStatus('processing');
    setProcessingStartTime(Date.now());
    try {
      const fd = new FormData();
      fd.append('file', ocrFile);
      fd.append('provider', ocrProvider);
      fd.append('api_key', ocrProvider === 'got_ocr' ? '' : apiKey);
      fd.append('cloud_endpoint', ocrProvider === 'got_ocr' ? ocrLocalUrl : cloudEndpoint);
      fd.append('model', ocrModel);
      const res = await fetch(`${backendBaseUrl}/tasks/ocr`, { method: 'POST', body: fd });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.detail || `请求失败 (${res.status})`);
      addInstantJobResult('ocr', `OCR · ${ocrFile.name}`, ocrProvider, ocrProvider === 'got_ocr', {
        status: 'completed', result_text: data.text || '',
      });
      onNavigateTasks();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'OCR 识别失败');
    } finally {
      setStatus('idle');
      setProcessingStartTime(null);
    }
  }

  // ── 口型同步状态 ──
  const [lipsyncProvider, setLipsyncProvider] = useState('liveportrait');
  const [lipsyncVideoFile, setLipsyncVideoFile] = useState<File | null>(null);
  const [lipsyncAudioFile, setLipsyncAudioFile] = useState<File | null>(null);
  const [lipsyncModel, setLipsyncModel] = useState('');
  const [lipsyncLocalUrl, setLipsyncLocalUrl] = useState('http://127.0.0.1:7860');

  function handleLipsyncProviderChange(p: string) {
    setLipsyncProvider(p);
    const models = LIPSYNC_MODELS[p] || [];
    setLipsyncModel(models[0] || '');
  }

  async function runLipsync() {
    if (!lipsyncVideoFile) { setError('请上传视频或人物图片'); return; }
    if (!lipsyncAudioFile) { setError('请上传音频文件'); return; }
    setError('');
    setStatus('processing');
    setProcessingStartTime(Date.now());
    try {
      const fd = new FormData();
      fd.append('video', lipsyncVideoFile);
      fd.append('audio', lipsyncAudioFile);
      fd.append('provider', lipsyncProvider);
      const isLocal = lipsyncProvider === 'liveportrait' || lipsyncProvider === 'sadtalker';
      fd.append('api_key', isLocal ? '' : apiKey);
      fd.append('cloud_endpoint', isLocal ? lipsyncLocalUrl : cloudEndpoint);
      fd.append('model', lipsyncModel);
      const res = await fetch(`${backendBaseUrl}/tasks/lipsync`, { method: 'POST', body: fd });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.detail || `请求失败 (${res.status})`);
      if (data.job_id) {
        await fetchJobs();
        onNavigateTasks();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : '口型同步失败');
    } finally {
      setStatus('idle');
      setProcessingStartTime(null);
    }
  }

  return {
    // image gen
    imgGenProvider, handleImgGenProviderChange,
    imgGenPrompt, setImgGenPrompt,
    imgGenModel, setImgGenModel,
    imgGenSize, setImgGenSize,
    imgGenComfyUrl, setImgGenComfyUrl,
    runImgGen,
    // image i2i
    imgI2iProvider, handleImgI2iProviderChange,
    imgI2iSourceFile, setImgI2iSourceFile,
    imgI2iRefFile, setImgI2iRefFile,
    imgI2iPrompt, setImgI2iPrompt,
    imgI2iModel, setImgI2iModel,
    imgI2iStrength, setImgI2iStrength,
    imgI2iComfyUrl, setImgI2iComfyUrl,
    runImgI2i,
    // video gen
    videoGenProvider, handleVideoGenProviderChange,
    videoGenPrompt, setVideoGenPrompt,
    videoGenModel, setVideoGenModel,
    videoGenDuration, setVideoGenDuration,
    videoGenImageFile, setVideoGenImageFile,
    videoGenMode, setVideoGenMode,
    runVideoGen,
    // ocr
    ocrProvider, handleOcrProviderChange,
    ocrFile, setOcrFile,
    ocrModel, setOcrModel,
    ocrLocalUrl, setOcrLocalUrl,
    runOcr,
    // lipsync
    lipsyncProvider, handleLipsyncProviderChange,
    lipsyncVideoFile, setLipsyncVideoFile,
    lipsyncAudioFile, setLipsyncAudioFile,
    lipsyncModel, setLipsyncModel,
    lipsyncLocalUrl, setLipsyncLocalUrl,
    runLipsync,
  };
}
