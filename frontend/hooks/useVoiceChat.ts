import { useState, useEffect, useRef } from 'react';
import type { VoiceChatMsg, VoiceChatStatus, Job } from '../types';
import { LOCAL_PROVIDERS, URL_ONLY_PROVIDERS } from '../constants';
import { safeJson } from '../utils';

interface UseVoiceChatParams {
  backendBaseUrl: string;
  setError: (e: string) => void;
  pollJobResult: (jobId: string, timeoutMs?: number) => Promise<Job>;
}

export function useVoiceChat({
  backendBaseUrl,
  setError,
  pollJobResult,
}: UseVoiceChatParams) {
  const [vchatMsgs, setVchatMsgs] = useState<VoiceChatMsg[]>([]);
  const [vchatStatus, setVchatStatus] = useState<VoiceChatStatus>('idle');
  const [vchatSttProvider, setVchatSttProvider] = useState('faster_whisper');
  const [vchatSttModel, setVchatSttModel] = useState('');
  const [vchatLlmProvider, setVchatLlmProvider] = useState('gemini');
  const [vchatLlmModel, setVchatLlmModel] = useState('');
  const [vchatTtsProvider, setVchatTtsProvider] = useState('fish_speech');
  const [vchatTtsModel, setVchatTtsModel] = useState('');
  const [vchatTtsRefAudios, setVchatTtsRefAudios] = useState<File[]>([]);
  const [vchatApiKey, setVchatApiKey] = useState('');
  const [vchatEndpoint, setVchatEndpoint] = useState('');
  const vchatScrollRef = useRef<HTMLDivElement>(null);
  const vchatRecorderRef = useRef<MediaRecorder | null>(null);
  const vchatChunksRef = useRef<Blob[]>([]);

  useEffect(() => {
    if (vchatScrollRef.current) vchatScrollRef.current.scrollTop = vchatScrollRef.current.scrollHeight;
  }, [vchatMsgs]);

  function vchatIsLocalStt() { return LOCAL_PROVIDERS.has(vchatSttProvider); }
  function vchatIsLocalLlm() { return LOCAL_PROVIDERS.has(vchatLlmProvider) || URL_ONLY_PROVIDERS.has(vchatLlmProvider); }
  function vchatIsLocalTts() { return LOCAL_PROVIDERS.has(vchatTtsProvider); }

  async function startVchatRecording() {
    if (vchatStatus !== 'idle') return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      vchatChunksRef.current = [];
      const recorder = new MediaRecorder(stream);
      recorder.ondataavailable = e => { if (e.data.size > 0) vchatChunksRef.current.push(e.data); };
      recorder.onstop = async () => {
        stream.getTracks().forEach(t => t.stop());
        const blob = new Blob(vchatChunksRef.current, { type: 'audio/webm' });
        await runVchatPipeline(blob);
      };
      recorder.start();
      vchatRecorderRef.current = recorder;
      setVchatStatus('recording');
    } catch (e) {
      setError(e instanceof Error ? e.message : '无法访问麦克风');
    }
  }

  function stopVchatRecording() {
    vchatRecorderRef.current?.stop();
    setVchatStatus('transcribing');
  }

  async function runVchatPipeline(audioBlob: Blob) {
    try {
      // 1. STT
      setVchatStatus('transcribing');
      const sttFd = new FormData();
      sttFd.append('provider', vchatSttProvider);
      sttFd.append('file', audioBlob, 'audio.webm');
      sttFd.append('model', vchatSttModel);
      sttFd.append('api_key', vchatIsLocalStt() ? '' : vchatApiKey);
      sttFd.append('cloud_endpoint', vchatEndpoint);
      const sttRes = await fetch(`${backendBaseUrl}/tasks/stt`, { method: 'POST', body: sttFd });
      const sttData = await safeJson(sttRes);
      if (!sttRes.ok) throw new Error(`STT 失败：${sttData?.detail || sttRes.status}`);
      const userText = (sttData?.text || '').trim();
      if (!userText) { setVchatStatus('idle'); return; }

      const userMsg: VoiceChatMsg = { role: 'user', text: userText, ts: Date.now() };
      setVchatMsgs(prev => [...prev, userMsg]);

      // 2. LLM
      setVchatStatus('thinking');
      const history = [...vchatMsgs, userMsg].map(m => ({ role: m.role, content: m.text }));
      const llmFd = new FormData();
      llmFd.append('provider', vchatLlmProvider);
      llmFd.append('model', vchatLlmModel);
      llmFd.append('api_key', vchatIsLocalLlm() ? '' : vchatApiKey);
      llmFd.append('cloud_endpoint', vchatEndpoint);
      llmFd.append('messages', JSON.stringify(history));
      const llmRes = await fetch(`${backendBaseUrl}/tasks/llm`, { method: 'POST', body: llmFd });
      const llmData = await safeJson(llmRes);
      if (!llmRes.ok) throw new Error(`LLM 失败：${llmData?.detail || llmRes.status}`);
      const replyText = (llmData?.text || '').trim();

      // 3. TTS
      setVchatStatus('speaking');
      const ttsFd = new FormData();
      ttsFd.append('provider', vchatTtsProvider);
      ttsFd.append('text', replyText);
      ttsFd.append('model', vchatTtsModel);
      ttsFd.append('api_key', vchatIsLocalTts() ? '' : vchatApiKey);
      ttsFd.append('cloud_endpoint', vchatEndpoint);
      ttsFd.append('output_dir', '');
      vchatTtsRefAudios.forEach(f => ttsFd.append('reference_audio', f, f.name));
      const ttsRes = await fetch(`${backendBaseUrl}/tasks/tts`, { method: 'POST', body: ttsFd });
      const ttsData = await safeJson(ttsRes);
      let audioUrl = '';
      if (ttsRes.ok) {
        if (ttsData?.result_url) {
          audioUrl = ttsData.result_url;
        } else if (ttsData?.job_id) {
          try {
            const done = await pollJobResult(ttsData.job_id, 120000);
            audioUrl = done.result_url || '';
          } catch { /**/ }
        }
      }

      setVchatMsgs(prev => [...prev, { role: 'assistant', text: replyText, audioUrl, ts: Date.now() }]);
    } catch (e) {
      setError(e instanceof Error ? e.message : '语音对话失败');
    } finally {
      setVchatStatus('idle');
    }
  }

  return {
    vchatMsgs, setVchatMsgs,
    vchatStatus,
    vchatSttProvider, setVchatSttProvider,
    vchatSttModel, setVchatSttModel,
    vchatLlmProvider, setVchatLlmProvider,
    vchatLlmModel, setVchatLlmModel,
    vchatTtsProvider, setVchatTtsProvider,
    vchatTtsModel, setVchatTtsModel,
    vchatTtsRefAudios, setVchatTtsRefAudios,
    vchatApiKey, setVchatApiKey,
    vchatEndpoint, setVchatEndpoint,
    vchatScrollRef,
    startVchatRecording,
    stopVchatRecording,
  };
}
