import { useState } from 'react';
import type { MiscSubPage, ChatMessage } from '../types';
import { IMAGE_GEN_MODELS, IMAGE_GEN_SIZES, IMAGE_UNDERSTAND_MODELS, DEFAULT_MODELS } from '../constants';

interface UseMiscProps {
  backendBaseUrl: string;
  apiKey: string;
  cloudEndpoint: string;
  setStatus: (s: import('../types').Status) => void;
  setProcessingStartTime: (t: number | null) => void;
  setError: (e: string) => void;
  addInstantJobResult: (type: string, label: string, provider: string, isLocal: boolean, result: { status: 'completed' | 'failed'; result_url?: string; result_text?: string; error?: string }) => void;
  fetchJobs: () => Promise<void>;
}

export function useMisc({
  backendBaseUrl,
  apiKey,
  cloudEndpoint,
  setStatus,
  setProcessingStartTime,
  setError,
  addInstantJobResult,
  fetchJobs,
}: UseMiscProps) {
  const [miscSubPage, setMiscSubPage] = useState<MiscSubPage>('img_gen');

  // ── 图像生成状态 ──
  const [imageGenProvider, setImageGenProvider] = useState('openai');
  const [imageGenPrompt, setImageGenPrompt] = useState('');
  const [imageGenModel, setImageGenModel] = useState('dall-e-3');
  const [imageGenSize, setImageGenSize] = useState('1024x1024');

  // ── 图像理解状态 ──
  const [imageUnderstandProvider, setImageUnderstandProvider] = useState('gemini');
  const [imageUnderstandFile, setImageUnderstandFile] = useState<File | null>(null);
  const [imageUnderstandPrompt, setImageUnderstandPrompt] = useState('请详细描述这张图片');
  const [imageUnderstandModel, setImageUnderstandModel] = useState('gemini-2.5-flash');

  // ── 代码助手状态 ──
  const [codeProvider, setCodeProvider] = useState('gemini');
  const [codeModel, setCodeModel] = useState('gemini-2.5-flash');
  const [codeMessages, setCodeMessages] = useState<ChatMessage[]>([]);
  const [codeInput, setCodeInput] = useState('');
  const [codeLoading, setCodeLoading] = useState(false);
  const [codeLang, setCodeLang] = useState('');

  // ── 翻译状态 ──
  const [translateProvider, setTranslateProvider] = useState('gemini');
  const [translateText, setTranslateText] = useState('');
  const [translateTarget, setTranslateTarget] = useState('中文');
  const [translateSource, setTranslateSource] = useState('自动检测');
  const [translateModel, setTranslateModel] = useState('gemini-2.5-flash');

  // 当切换 provider 时自动更新默认 model/size
  function handleImageGenProviderChange(p: string) {
    setImageGenProvider(p);
    const models = IMAGE_GEN_MODELS[p] || [];
    if (models.length > 0) setImageGenModel(models[0]);
    const sizes = IMAGE_GEN_SIZES[p] || [];
    if (sizes.length > 0) setImageGenSize(sizes[0]);
  }

  function handleImageUnderstandProviderChange(p: string) {
    setImageUnderstandProvider(p);
    const models = IMAGE_UNDERSTAND_MODELS[p] || [];
    if (models.length > 0) setImageUnderstandModel(models[0]);
  }

  async function runImageGen() {
    if (!imageGenPrompt.trim()) { setError('请输入图像描述'); return; }
    setError('');
    setStatus('processing');
    setProcessingStartTime(Date.now());
    try {
      const fd = new FormData();
      fd.append('prompt', imageGenPrompt.trim());
      fd.append('provider', imageGenProvider);
      fd.append('api_key', apiKey);
      fd.append('cloud_endpoint', cloudEndpoint);
      fd.append('model', imageGenModel);
      // size vs aspect_ratio depending on provider
      if (imageGenProvider === 'openai' || imageGenProvider === 'dashscope') {
        fd.append('size', imageGenSize);
      } else {
        fd.append('aspect_ratio', imageGenSize);
      }
      const res = await fetch(`${backendBaseUrl}/tasks/image-gen`, { method: 'POST', body: fd });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.detail || `请求失败 (${res.status})`);
      // Returns job_id for queued job — fetch once to seed polling
      if (data.job_id) {
        await fetchJobs();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : '图像生成失败');
    } finally {
      setStatus('idle');
      setProcessingStartTime(null);
    }
  }

  async function runImageUnderstand() {
    if (!imageUnderstandFile) { setError('请先上传图片'); return; }
    setError('');
    setStatus('processing');
    setProcessingStartTime(Date.now());
    try {
      const fd = new FormData();
      fd.append('file', imageUnderstandFile);
      fd.append('provider', imageUnderstandProvider);
      fd.append('prompt', imageUnderstandPrompt.trim() || '请详细描述这张图片');
      fd.append('api_key', imageUnderstandProvider === 'ollama' ? '' : apiKey);
      fd.append('cloud_endpoint', cloudEndpoint);
      fd.append('model', imageUnderstandModel);
      const res = await fetch(`${backendBaseUrl}/tasks/image-understand`, { method: 'POST', body: fd });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.detail || `请求失败 (${res.status})`);
      const label = `图像理解 · ${imageUnderstandFile.name}`;
      addInstantJobResult('image_understand', label, imageUnderstandProvider, false, {
        status: 'completed', result_text: data.text || '',
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : '图像理解失败');
    } finally {
      setStatus('idle');
      setProcessingStartTime(null);
    }
  }

  async function sendCodeMessage() {
    if (!codeInput.trim() || codeLoading) return;
    const userMsg: ChatMessage = { role: 'user', content: codeInput.trim(), ts: Date.now() };
    const nextMessages = [...codeMessages, userMsg];
    setCodeMessages(nextMessages);
    setCodeInput('');
    setCodeLoading(true);
    try {
      const systemPrompt = `你是专业的编程助手，精通各种编程语言和框架。${codeLang ? `当前语言/框架：${codeLang}。` : ''}请提供清晰、准确的代码和解释，代码块用 Markdown 格式输出。`;
      const messagesPayload = [
        { role: 'system', content: systemPrompt },
        ...nextMessages.map(m => ({ role: m.role, content: m.content })),
      ];
      const fd = new FormData();
      fd.append('messages', JSON.stringify(messagesPayload));
      fd.append('provider', codeProvider);
      fd.append('api_key', codeProvider === 'ollama' ? '' : apiKey);
      fd.append('cloud_endpoint', cloudEndpoint);
      fd.append('model', codeModel);
      const res = await fetch(`${backendBaseUrl}/tasks/llm`, { method: 'POST', body: fd });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.detail || `请求失败 (${res.status})`);
      const assistMsg: ChatMessage = { role: 'assistant', content: data.text || '', ts: Date.now() };
      setCodeMessages(prev => [...prev, assistMsg]);
    } catch (e) {
      const errMsg: ChatMessage = {
        role: 'assistant',
        content: `❌ ${e instanceof Error ? e.message : '请求失败'}`,
        ts: Date.now(),
      };
      setCodeMessages(prev => [...prev, errMsg]);
    } finally {
      setCodeLoading(false);
    }
  }

  async function runTranslate() {
    if (!translateText.trim()) { setError('请输入要翻译的文本'); return; }
    setError('');
    setStatus('processing');
    setProcessingStartTime(Date.now());
    try {
      const fd = new FormData();
      fd.append('text', translateText.trim());
      fd.append('target_lang', translateTarget);
      fd.append('source_lang', translateSource);
      fd.append('provider', translateProvider);
      fd.append('api_key', translateProvider === 'ollama' ? '' : apiKey);
      fd.append('cloud_endpoint', cloudEndpoint);
      fd.append('model', translateModel);
      const res = await fetch(`${backendBaseUrl}/tasks/translate`, { method: 'POST', body: fd });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.detail || `请求失败 (${res.status})`);
      const snippet = translateText.trim().slice(0, 20);
      const label = `翻译→${translateTarget} · ${snippet}${translateText.length > 20 ? '…' : ''}`;
      addInstantJobResult('translate', label, translateProvider, false, {
        status: 'completed', result_text: data.text || '',
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : '翻译失败');
    } finally {
      setStatus('idle');
      setProcessingStartTime(null);
    }
  }

  return {
    miscSubPage, setMiscSubPage,
    // image gen
    imageGenProvider, handleImageGenProviderChange,
    imageGenPrompt, setImageGenPrompt,
    imageGenModel, setImageGenModel,
    imageGenSize, setImageGenSize,
    runImageGen,
    // image understand
    imageUnderstandProvider, handleImageUnderstandProviderChange,
    imageUnderstandFile, setImageUnderstandFile,
    imageUnderstandPrompt, setImageUnderstandPrompt,
    imageUnderstandModel, setImageUnderstandModel,
    runImageUnderstand,
    // translate
    translateProvider, setTranslateProvider,
    translateText, setTranslateText,
    translateTarget, setTranslateTarget,
    translateSource, setTranslateSource,
    translateModel, setTranslateModel,
    runTranslate,
    // code assist
    codeProvider, setCodeProvider,
    codeModel, setCodeModel,
    codeMessages, setCodeMessages,
    codeInput, setCodeInput,
    codeLoading,
    codeLang, setCodeLang,
    sendCodeMessage,
  };
}
