import { useState, useEffect, useRef } from 'react';
import type { ChatMessage } from '../types';
import { safeJson } from '../utils';

interface UseLLMParams {
  backendBaseUrl: string;
  selectedProvider: string;
  apiKey: string;
  cloudEndpoint: string;
  needsAuth: boolean;
  setError: (e: string) => void;
}

export function useLLM({
  backendBaseUrl,
  selectedProvider,
  apiKey,
  cloudEndpoint,
  needsAuth,
  setError,
}: UseLLMParams) {
  const [llmMessages, setLlmMessages] = useState<ChatMessage[]>([]);
  const [llmInput, setLlmInput] = useState('');
  const [llmModel, setLlmModel] = useState('');
  const [llmLoading, setLlmLoading] = useState(false);
  const llmScrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (llmScrollRef.current) llmScrollRef.current.scrollTop = llmScrollRef.current.scrollHeight;
  }, [llmMessages]);

  async function sendLlmMessage() {
    const text = llmInput.trim();
    if (!text || llmLoading) return;
    if (needsAuth && !apiKey.trim()) { setError('该服务商需要 API 密钥'); return; }
    const userMsg: ChatMessage = { role: 'user', content: text, ts: Date.now() };
    const nextMsgs = [...llmMessages, userMsg];
    setLlmMessages(nextMsgs);
    setLlmInput('');
    setLlmLoading(true);
    setError('');
    try {
      const fd = new FormData();
      fd.append('provider', selectedProvider);
      fd.append('model', llmModel);
      fd.append('api_key', apiKey);
      fd.append('cloud_endpoint', cloudEndpoint);
      fd.append('messages', JSON.stringify(nextMsgs.map(m => ({ role: m.role, content: m.content }))));
      const res = await fetch(`${backendBaseUrl}/tasks/llm`, { method: 'POST', body: fd });
      const data = await safeJson(res);
      if (!res.ok) throw new Error(`LLM 失败（${res.status}）${data?.detail ? `：${data.detail}` : ''}`);
      const reply = data?.text || '';
      setLlmMessages(prev => [...prev, { role: 'assistant', content: reply, ts: Date.now() }]);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'LLM 请求失败');
    } finally {
      setLlmLoading(false);
    }
  }

  return {
    llmMessages, setLlmMessages,
    llmInput, setLlmInput,
    llmModel, setLlmModel,
    llmLoading,
    llmScrollRef,
    sendLlmMessage,
  };
}
