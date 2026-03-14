import type { VoiceChatMsg, VoiceChatStatus, VoiceInfo } from '../../types';
import { PROVIDER_LABELS, LOCAL_PROVIDERS, PROVIDER_TO_ENGINE } from '../../constants';
import ModelInput from '../shared/ModelInput';
import VoiceSelector from '../shared/VoiceSelector';

interface VoiceChatPanelProps {
  vchatMsgs: VoiceChatMsg[];
  setVchatMsgs: React.Dispatch<React.SetStateAction<VoiceChatMsg[]>>;
  vchatStatus: VoiceChatStatus;
  vchatSttProvider: string;
  setVchatSttProvider: (v: string) => void;
  vchatSttModel: string;
  setVchatSttModel: (v: string) => void;
  vchatLlmProvider: string;
  setVchatLlmProvider: (v: string) => void;
  vchatLlmModel: string;
  setVchatLlmModel: (v: string) => void;
  vchatTtsProvider: string;
  setVchatTtsProvider: (v: string) => void;
  vchatTtsModel: string;
  setVchatTtsModel: (v: string) => void;
  vchatVoiceId: string;
  setVchatVoiceId: (v: string) => void;
  vchatApiKey: string;
  setVchatApiKey: (v: string) => void;
  vchatEndpoint: string;
  setVchatEndpoint: (v: string) => void;
  engineVersions: Record<string, { version: string; ready: boolean }>;
  voices: VoiceInfo[];
  onRefreshVoices: () => void;
  vchatScrollRef: React.RefObject<HTMLDivElement>;
  onStartRecording: () => void;
  onStopRecording: () => void;
  fieldCls: string;
  labelCls: string;
  btnSec: string;
}

export default function VoiceChatPanel({
  vchatMsgs,
  setVchatMsgs,
  vchatStatus,
  vchatSttProvider,
  setVchatSttProvider,
  vchatSttModel,
  setVchatSttModel,
  vchatLlmProvider,
  setVchatLlmProvider,
  vchatLlmModel,
  setVchatLlmModel,
  vchatTtsProvider,
  setVchatTtsProvider,
  vchatTtsModel,
  setVchatTtsModel,
  vchatVoiceId,
  setVchatVoiceId,
  vchatApiKey,
  setVchatApiKey,
  vchatEndpoint,
  setVchatEndpoint,
  engineVersions,
  voices,
  onRefreshVoices,
  vchatScrollRef,
  onStartRecording,
  onStopRecording,
  fieldCls,
  labelCls,
  btnSec,
}: VoiceChatPanelProps) {
  return (
    <section className="rounded-2xl border border-slate-200/80 bg-white shadow-panel flex flex-col dark:bg-slate-900 dark:border-slate-700/80" style={{ height: '660px' }}>
      {/* 顶部配置区（常显） */}
      <div className="p-5 border-b border-slate-100 dark:border-slate-800 space-y-4">
        <p className="text-xs text-slate-400 leading-relaxed">
          语音对话流程：你说话 → <span className="font-semibold text-slate-600">STT</span> 转文字 → <span className="font-semibold text-slate-600">LLM</span> 生成回复 → <span className="font-semibold text-slate-600">TTS</span> 合成播放
        </p>
        {/* API 密钥（共用） */}
        <div className="flex gap-3 flex-wrap">
          <label className="flex-1 min-w-[160px]">
            <span className="block text-xs font-medium text-slate-400 mb-1.5 uppercase tracking-wide">API 密钥（云服务共用）</span>
            <input className="w-full rounded-xl border border-slate-200 bg-slate-50/50 px-3.5 py-2.5 text-sm text-slate-800 placeholder:text-slate-400 focus:border-indigo-400 focus:bg-white focus:ring-2 focus:ring-indigo-500/15 transition-all" type="password"
              value={vchatApiKey} onChange={e => setVchatApiKey(e.target.value)} placeholder="云服务 API 密钥" />
          </label>
          <label className="flex-1 min-w-[160px]">
            <span className="block text-xs font-medium text-slate-400 mb-1.5 uppercase tracking-wide">服务地址（Ollama 等）</span>
            <input className="w-full rounded-xl border border-slate-200 bg-slate-50/50 px-3.5 py-2.5 text-sm text-slate-800 placeholder:text-slate-400 focus:border-indigo-400 focus:bg-white focus:ring-2 focus:ring-indigo-500/15 transition-all"
              value={vchatEndpoint} onChange={e => setVchatEndpoint(e.target.value)} placeholder="http://localhost:11434" />
          </label>
        </div>

        <div className="grid grid-cols-3 gap-3">
          {/* STT */}
          <div className="space-y-2">
            <span className="block text-xs font-semibold text-indigo-600 uppercase tracking-wide">① STT</span>
            <select className="w-full rounded-xl border border-slate-200 bg-slate-50/50 px-2.5 py-2 text-xs text-slate-800 focus:border-indigo-400 focus:ring-2 focus:ring-indigo-500/15 transition-all"
              value={vchatSttProvider} onChange={e => setVchatSttProvider(e.target.value)}>
              {['whisper', 'openai', 'gemini'].map(p => <option key={p} value={p}>{PROVIDER_LABELS[p] || p}</option>)}
            </select>
            {!LOCAL_PROVIDERS.has(vchatSttProvider) && (
              <ModelInput value={vchatSttModel} onChange={setVchatSttModel} task="asr" provider={vchatSttProvider} placeholder="模型（可选）" />
            )}
            {LOCAL_PROVIDERS.has(vchatSttProvider) && engineVersions[PROVIDER_TO_ENGINE[vchatSttProvider]] && (
              <span className="text-[11px] font-mono text-slate-400">v{engineVersions[PROVIDER_TO_ENGINE[vchatSttProvider]].version}</span>
            )}
          </div>
          {/* LLM */}
          <div className="space-y-2">
            <span className="block text-xs font-semibold text-indigo-600 uppercase tracking-wide">② LLM</span>
            <select className="w-full rounded-xl border border-slate-200 bg-slate-50/50 px-2.5 py-2 text-xs text-slate-800 focus:border-indigo-400 focus:ring-2 focus:ring-indigo-500/15 transition-all"
              value={vchatLlmProvider} onChange={e => setVchatLlmProvider(e.target.value)}>
              {['gemini', 'openai', 'ollama', 'github'].map(p => <option key={p} value={p}>{PROVIDER_LABELS[p] || p}</option>)}
            </select>
            <ModelInput value={vchatLlmModel} onChange={setVchatLlmModel} task="llm" provider={vchatLlmProvider} />
          </div>
          {/* TTS */}
          <div className="space-y-2">
            <span className="block text-xs font-semibold text-indigo-600 uppercase tracking-wide">③ TTS</span>
            <select className="w-full rounded-xl border border-slate-200 bg-slate-50/50 px-2.5 py-2 text-xs text-slate-800 focus:border-indigo-400 focus:ring-2 focus:ring-indigo-500/15 transition-all"
              value={vchatTtsProvider} onChange={e => setVchatTtsProvider(e.target.value)}>
              {['fish_speech', 'openai', 'gemini', 'elevenlabs'].map(p => <option key={p} value={p}>{PROVIDER_LABELS[p] || p}</option>)}
            </select>
            {!LOCAL_PROVIDERS.has(vchatTtsProvider) && (
              <ModelInput value={vchatTtsModel} onChange={setVchatTtsModel} task="tts" provider={vchatTtsProvider} placeholder="模型（可选）" />
            )}
            {LOCAL_PROVIDERS.has(vchatTtsProvider) && engineVersions[PROVIDER_TO_ENGINE[vchatTtsProvider]] && (
              <span className="text-[11px] font-mono text-slate-400">v{engineVersions[PROVIDER_TO_ENGINE[vchatTtsProvider]].version}</span>
            )}
          </div>
        </div>

        {/* TTS 音色 */}
        <VoiceSelector label="TTS 音色（语音合成用）" value={vchatVoiceId} onChange={setVchatVoiceId} voices={voices} onRefresh={onRefreshVoices} fieldCls={fieldCls} labelCls={labelCls} btnSec={btnSec} />
      </div>

      {/* 对话记录 */}
      <div ref={vchatScrollRef} className="flex-1 overflow-y-auto p-5 space-y-4">
        {vchatMsgs.length === 0 && (
          <p className="text-center text-sm text-slate-400 dark:text-slate-600 mt-10">点击下方麦克风开始语音对话</p>
        )}
        {vchatMsgs.map((msg, i) => (
          <div key={i} className={`flex items-end gap-2 ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            {msg.role === 'assistant' && (
              <div className="w-7 h-7 rounded-full bg-indigo-100 dark:bg-indigo-900/60 flex items-center justify-center text-[10px] font-semibold text-indigo-600 dark:text-indigo-300 shrink-0">AI</div>
            )}
            <div className="max-w-[78%] space-y-1.5">
              <div className={`rounded-2xl px-4 py-2.5 text-sm whitespace-pre-wrap leading-relaxed ${
                msg.role === 'user'
                  ? 'bg-indigo-600 text-white rounded-br-md shadow-sm'
                  : 'bg-slate-100 text-slate-800 rounded-bl-md dark:bg-slate-700 dark:text-slate-200'
              }`}>
                {msg.text}
              </div>
              {msg.audioUrl && (
                <audio controls src={msg.audioUrl} className="w-full h-8" />
              )}
            </div>
            {msg.role === 'user' && (
              <div className="w-7 h-7 rounded-full bg-slate-200 dark:bg-slate-700 flex items-center justify-center text-[10px] font-semibold text-slate-500 dark:text-slate-300 shrink-0">我</div>
            )}
          </div>
        ))}
      </div>

      {/* 状态栏 */}
      <div className="px-5 py-2 border-t border-slate-100 dark:border-slate-800 text-center">
        {vchatStatus === 'idle' && <span className="text-xs text-slate-400">就绪</span>}
        {vchatStatus === 'recording' && <span className="text-xs text-rose-500 font-semibold animate-pulse">● 正在录音</span>}
        {vchatStatus === 'transcribing' && <span className="text-xs text-amber-500 font-medium">语音识别中...</span>}
        {vchatStatus === 'thinking' && <span className="text-xs text-indigo-500 font-medium">AI 思考中...</span>}
        {vchatStatus === 'speaking' && <span className="text-xs text-emerald-500 font-medium">合成语音...</span>}
      </div>

      {/* 控制区 */}
      <div className="p-5 border-t border-slate-100 dark:border-slate-800 flex items-center justify-center gap-5">
        {vchatStatus === 'idle' && (
          <>
            <button
              className="w-14 h-14 rounded-full bg-indigo-600 hover:bg-indigo-700 text-white text-xl shadow-md hover:shadow-lg active:scale-95 transition-all duration-150"
              onClick={onStartRecording}>
              🎤
            </button>
            {vchatMsgs.length > 0 && (
              <button className="rounded-xl border border-slate-200 bg-slate-50 hover:bg-slate-100 px-4 py-2 text-xs font-medium text-slate-500 transition-colors"
                onClick={() => setVchatMsgs([])}>
                清空
              </button>
            )}
          </>
        )}
        {vchatStatus === 'recording' && (
          <button
            className="w-14 h-14 rounded-full bg-rose-600 hover:bg-rose-700 text-white text-xl shadow-md animate-pulse transition-all"
            onClick={onStopRecording}>
            ⏹
          </button>
        )}
        {(vchatStatus === 'transcribing' || vchatStatus === 'thinking' || vchatStatus === 'speaking') && (
          <div className="w-14 h-14 rounded-full bg-slate-100 flex items-center justify-center">
            <span className="inline-flex gap-1">
              <span className="w-2 h-2 rounded-full bg-slate-400 animate-bounce [animation-delay:0ms]" />
              <span className="w-2 h-2 rounded-full bg-slate-400 animate-bounce [animation-delay:150ms]" />
              <span className="w-2 h-2 rounded-full bg-slate-400 animate-bounce [animation-delay:300ms]" />
            </span>
          </div>
        )}
      </div>
    </section>
  );
}
