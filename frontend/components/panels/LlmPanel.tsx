import type { ChatMessage, CapabilityMap } from '../../types';
import { PROVIDER_LABELS } from '../../constants';
import ModelInput, { INPUT_CLS } from '../shared/ModelInput';

interface LlmPanelProps {
  taskType: 'llm';
  capabilities: CapabilityMap;
  selectedProvider: string;
  needsAuth: boolean;
  isUrlOnly: boolean;
  apiKey: string;
  cloudEndpoint: string;
  engineVersions: Record<string, { version: string; ready: boolean }>;
  setProviderMap: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  setApiKey: (v: string) => void;
  setCloudEndpoint: (v: string) => void;
  llmMessages: ChatMessage[];
  setLlmMessages: React.Dispatch<React.SetStateAction<ChatMessage[]>>;
  llmInput: string;
  setLlmInput: (v: string) => void;
  llmModel: string;
  setLlmModel: (v: string) => void;
  llmLoading: boolean;
  llmScrollRef: React.RefObject<HTMLDivElement>;
  onSendLlmMessage: () => void;
  fieldCls: string;
  labelCls: string;
}

export default function LlmPanel({
  taskType,
  capabilities,
  selectedProvider,
  needsAuth,
  isUrlOnly,
  apiKey,
  cloudEndpoint,
  setProviderMap,
  setApiKey,
  setCloudEndpoint,
  llmMessages,
  setLlmMessages,
  llmInput,
  setLlmInput,
  llmModel,
  setLlmModel,
  llmLoading,
  llmScrollRef,
  onSendLlmMessage,
  fieldCls,
}: LlmPanelProps) {
  return (
    <section className="rounded-2xl border border-slate-200/80 bg-white shadow-panel flex flex-col dark:bg-slate-900 dark:border-slate-700/80" style={{ height: 'calc(100vh - 220px)', minHeight: '480px', maxHeight: '760px' }}>
      {/* 顶部配置栏（始终可见） */}
      <div className="p-4 border-b border-slate-100 dark:border-slate-800 flex flex-wrap gap-3 items-end">
        {/* 服务商下拉 */}
        <label className="flex flex-col gap-1 min-w-[160px] flex-1">
          <span className="text-xs font-medium text-slate-400 uppercase tracking-wide">服务商</span>
          <select
            className={INPUT_CLS}
            value={selectedProvider}
            onChange={e => setProviderMap(prev => ({ ...prev, [taskType]: e.target.value }))}
          >
            {(capabilities[taskType] ?? []).map(p => (
              <option key={p} value={p}>{PROVIDER_LABELS[p] ?? p}</option>
            ))}
          </select>
        </label>
        {/* 模型 */}
        <label className="flex flex-col gap-1 min-w-[160px] flex-1">
          <span className="text-xs font-medium text-slate-400 uppercase tracking-wide">模型（可选）</span>
          <ModelInput value={llmModel} onChange={setLlmModel} task="llm" provider={selectedProvider} />
        </label>
        {/* API 密钥 */}
        {needsAuth && (
          <label className="flex flex-col gap-1 min-w-[180px] flex-1">
            <span className="text-xs font-medium text-slate-400 uppercase tracking-wide">API 密钥</span>
            <input type="password" className="rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-800 px-3 py-2 text-sm text-slate-800 dark:text-slate-200 focus:border-[#1A8FE3] focus:ring-2 focus:ring-[#1A8FE3]/15 transition-all outline-none placeholder:text-slate-400"
              value={apiKey} onChange={e => setApiKey(e.target.value)} placeholder="服务商 API 密钥" />
          </label>
        )}
        {/* 服务地址 */}
        {isUrlOnly && (
          <label className="flex flex-col gap-1 min-w-[180px] flex-1">
            <span className="text-xs font-medium text-slate-400 uppercase tracking-wide">服务地址</span>
            <input className="rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-800 px-3 py-2 text-sm text-slate-800 dark:text-slate-200 focus:border-[#1A8FE3] focus:ring-2 focus:ring-[#1A8FE3]/15 transition-all outline-none placeholder:text-slate-400"
              value={cloudEndpoint} onChange={e => setCloudEndpoint(e.target.value)} placeholder="http://localhost:11434" />
          </label>
        )}
      </div>

      {/* 消息列表 */}
      <div ref={llmScrollRef} className="flex-1 overflow-y-auto p-5 space-y-4" style={{ scrollbarWidth: 'thin', scrollbarColor: '#cbd5e1 transparent' }}>
        {llmMessages.length === 0 && (
          <div className="flex flex-col items-center gap-4 mt-8">
            <p className="text-sm text-slate-400 dark:text-slate-500">你可以这样开始：</p>
            <div className="grid grid-cols-2 gap-2 w-full max-w-md">
              {['帮我用中文总结以下内容：', '翻译成英文：', '用简单语言解释：', '写一封专业邮件：'].map(s => (
                <button key={s} onClick={() => setLlmInput(s)}
                  className="text-left px-4 py-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:border-[#1A8FE3] hover:bg-blue-50/30 dark:hover:bg-blue-900/10 text-sm text-slate-600 dark:text-slate-300 transition-all shadow-sm">
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}
        {llmMessages.map((msg, i) => (
          <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div className={`max-w-[80%] rounded-2xl px-4 py-2.5 text-[14px] whitespace-pre-wrap leading-relaxed ${
              msg.role === 'user'
                ? 'bg-indigo-600 text-white rounded-br-md shadow-sm'
                : 'bg-white border border-slate-200 text-slate-800 rounded-bl-md shadow-sm dark:bg-slate-800 dark:border-slate-700 dark:text-slate-200'
            }`}>
              {msg.content}
            </div>
          </div>
        ))}
        {llmLoading && (
          <div className="flex justify-start">
            <div className="bg-slate-100 dark:bg-slate-700 rounded-2xl rounded-bl-md px-4 py-2.5 text-sm text-slate-400 dark:text-slate-500 flex items-center gap-2">
              <span className="inline-flex gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-slate-400 animate-bounce [animation-delay:0ms]" />
                <span className="w-1.5 h-1.5 rounded-full bg-slate-400 animate-bounce [animation-delay:150ms]" />
                <span className="w-1.5 h-1.5 rounded-full bg-slate-400 animate-bounce [animation-delay:300ms]" />
              </span>
            </div>
          </div>
        )}
      </div>

      {/* 输入区 */}
      <div className="p-4 border-t border-slate-100 dark:border-slate-800 flex gap-3 items-end">
        <textarea
          className="flex-1 rounded-xl border border-slate-200 bg-slate-50/50 px-3.5 py-2.5 text-sm resize-none focus:border-[#1A8FE3] focus:bg-white focus:ring-2 focus:ring-[#1A8FE3]/15 transition-all placeholder:text-slate-400 text-slate-800 outline-none"
          rows={2}
          placeholder="输入消息，Enter 发送，Shift+Enter 换行"
          value={llmInput}
          onChange={e => setLlmInput(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); onSendLlmMessage(); } }}
        />
        <div className="flex flex-col gap-1.5">
          <button
            className="rounded-xl bg-indigo-600 hover:bg-indigo-700 px-4 py-2 text-sm font-semibold text-white shadow-sm transition-all disabled:opacity-50 disabled:cursor-not-allowed active:scale-[0.98]"
            onClick={onSendLlmMessage} disabled={llmLoading || !llmInput.trim()}>
            发送
          </button>
          <button
            className="rounded-xl border border-slate-200 bg-slate-50 hover:bg-slate-100 px-4 py-2 text-xs text-slate-500 transition-colors"
            onClick={() => setLlmMessages([])}>
            清空
          </button>
        </div>
      </div>
    </section>
  );
}
