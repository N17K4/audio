import type { ChatMessage, CapabilityMap } from '../../types';
import { INPUT_CLS } from '../shared/ModelInput';
import LlmConfigBar from '../shared/LlmConfigBar';
import ProcessFlow, { FlowStep } from '../shared/ProcessFlow';
import LoadingDots from '../shared/LoadingDots';
import ChatBubble from '../shared/ChatBubble';

// ─── LLM 聊天实际流程 ─────────────────────────────────────────────────────────
const LLM_FLOW: FlowStep[] = [
  { label: '用户输入' },
  { label: 'System Prompt', tech: 'Context 注入' },
  { label: 'LLM 推理',      tech: 'Transformer' },
  { label: '流式解码',       tech: 'Streaming Tokens' },
  { label: '输出文字' },
];

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
    <>
    <ProcessFlow steps={LLM_FLOW} color="#4f46e5" />
    <section className="rounded-2xl border border-slate-200/80 bg-white shadow-panel flex flex-col dark:bg-slate-900 dark:border-slate-700/80" style={{ height: 'calc(100vh - 256px)', minHeight: '480px', maxHeight: '720px' }}>
      {/* 顶部配置栏（始终可见） */}
      <LlmConfigBar
        task={taskType}
        capabilities={capabilities}
        selectedProvider={selectedProvider}
        llmModel={llmModel}
        apiKey={apiKey}
        cloudEndpoint={cloudEndpoint}
        onProviderChange={v => setProviderMap(prev => ({ ...prev, [taskType]: v }))}
        onModelChange={setLlmModel}
        onApiKeyChange={setApiKey}
        onCloudEndpointChange={setCloudEndpoint}
      />

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
          <ChatBubble key={i} role={msg.role} content={msg.content} />
        ))}
        {llmLoading && (
          <div className="flex justify-start">
            <div className="bg-slate-100 dark:bg-slate-700 rounded-2xl rounded-bl-md px-4 py-2.5 text-sm text-slate-400 dark:text-slate-500 flex items-center gap-2">
              <LoadingDots />
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
    </>
  );
}
