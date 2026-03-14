import type { ChatMessage, CapabilityMap } from '../../types';
import ProviderRow from '../shared/ProviderRow';
import ModelInput from '../shared/ModelInput';

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
  engineVersions,
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
  labelCls,
}: LlmPanelProps) {
  return (
    <section className="rounded-2xl border border-slate-200/80 bg-white shadow-panel flex flex-col dark:bg-slate-900 dark:border-slate-700/80" style={{ height: '540px' }}>
      {/* 顶部配置栏 */}
      <div className="p-5 border-b border-slate-100 dark:border-slate-800 space-y-4">
        <ProviderRow
          taskType={taskType}
          capabilities={capabilities}
          selectedProvider={selectedProvider}
          needsAuth={needsAuth}
          isUrlOnly={isUrlOnly}
          apiKey={apiKey}
          cloudEndpoint={cloudEndpoint}
          engineVersions={engineVersions}
          setProviderMap={setProviderMap}
          setApiKey={setApiKey}
          setCloudEndpoint={setCloudEndpoint}
          fieldCls={fieldCls}
          labelCls={labelCls}
        />
        <label className="block">
          <span className="block text-xs font-medium text-slate-400 mb-1.5 uppercase tracking-wide">模型（可选）</span>
          <ModelInput value={llmModel} onChange={setLlmModel} task="llm" provider={selectedProvider} />
        </label>
      </div>

      {/* 消息列表 */}
      <div ref={llmScrollRef} className="flex-1 overflow-y-auto p-5 space-y-4">
        {llmMessages.length === 0 && (
          <p className="text-center text-sm text-slate-400 dark:text-slate-600 mt-10">在下方输入消息开始对话</p>
        )}
        {llmMessages.map((msg, i) => (
          <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div className={`max-w-[80%] rounded-2xl px-4 py-2.5 text-sm whitespace-pre-wrap leading-relaxed ${
              msg.role === 'user'
                ? 'bg-indigo-600 text-white rounded-br-md shadow-sm'
                : 'bg-slate-100 text-slate-800 rounded-bl-md dark:bg-slate-700 dark:text-slate-200'
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
          className="flex-1 rounded-xl border border-slate-200 bg-slate-50/50 px-3.5 py-2.5 text-sm resize-none focus:border-indigo-400 focus:bg-white focus:ring-2 focus:ring-indigo-500/15 transition-all placeholder:text-slate-400 text-slate-800"
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
