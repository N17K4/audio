'use client';

import { useRef, useEffect } from 'react';
import ComboSelect from '../../shared/ComboSelect';
import ModelInput, { INPUT_CLS } from '../../shared/ModelInput';
import ProcessFlow from '../../shared/ProcessFlow';
import type { Status, ChatMessage } from '../../../types';
import { PROVIDER_LABELS, DEFAULT_MODELS } from '../../../constants';
import { CODE_FLOW } from '../../../constants/flows';

const CODE_PROVIDERS = ['gemini', 'openai', 'claude', 'deepseek', 'groq', 'mistral', 'xai', 'ollama', 'github'];

interface CodeAssistSectionProps {
  status: Status;
  apiKey: string;
  setApiKey: (k: string) => void;
  cloudEndpoint: string;
  setCloudEndpoint: (e: string) => void;
  codeProvider: string;
  setCodeProvider: (p: string) => void;
  codeModel: string;
  setCodeModel: (m: string) => void;
  codeMessages: ChatMessage[];
  setCodeMessages: (msgs: ChatMessage[]) => void;
  codeInput: string;
  setCodeInput: (t: string) => void;
  codeLoading: boolean;
  codeLang: string;
  setCodeLang: (l: string) => void;
  onSendCodeMessage: () => void;
  labelCls: string;
  fieldCls: string;
  btnSec: string;
}

export default function CodeAssistSection({
  status, apiKey, setApiKey, cloudEndpoint, setCloudEndpoint,
  codeProvider, setCodeProvider,
  codeModel, setCodeModel,
  codeMessages, setCodeMessages,
  codeInput, setCodeInput,
  codeLoading,
  codeLang, setCodeLang,
  onSendCodeMessage,
  labelCls, fieldCls, btnSec,
}: CodeAssistSectionProps) {
  const codeScrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (codeScrollRef.current) {
      codeScrollRef.current.scrollTop = codeScrollRef.current.scrollHeight;
    }
  }, [codeMessages]);

  return (
    <div className="rounded-2xl border border-slate-200/80 dark:border-slate-700/80 bg-white dark:bg-slate-900 shadow-panel overflow-hidden flex flex-col" style={{ minHeight: '520px' }}>
      <div className="px-5 pt-4">
        <ProcessFlow steps={CODE_FLOW} color="#059669" />
      </div>
      {/* 配置栏 */}
      <div className="p-4 border-b border-slate-100 dark:border-slate-800 flex flex-wrap gap-3 items-end">
        <label className="flex flex-col gap-1 min-w-[140px] flex-1">
          <span className={labelCls}>服务商</span>
          <ComboSelect
            value={codeProvider}
            onChange={v => { setCodeProvider(v); setCodeModel(DEFAULT_MODELS.llm?.[v] || ''); }}
            options={CODE_PROVIDERS.map(p => ({ value: p, label: PROVIDER_LABELS[p] || p }))}
            placeholder="选择服务商"
          />
        </label>
        <label className="flex flex-col gap-1 min-w-[160px] flex-1">
          <span className={labelCls}>模型（可选）</span>
          <ModelInput value={codeModel} onChange={setCodeModel} task="llm" provider={codeProvider} />
        </label>
        {codeProvider === 'ollama' ? (
          <label className="flex flex-col gap-1 min-w-[160px] flex-1">
            <span className={labelCls}>服务地址</span>
            <input className={INPUT_CLS} value={cloudEndpoint} onChange={e => setCloudEndpoint(e.target.value)} placeholder="http://localhost:11434" />
          </label>
        ) : (
          <label className="flex flex-col gap-1 min-w-[160px] flex-1">
            <span className={labelCls}>API 密钥</span>
            <input className={INPUT_CLS} type="password" value={apiKey} onChange={e => setApiKey(e.target.value)} placeholder="sk-..." />
          </label>
        )}
      </div>
      <div className="px-4 pb-3">
        <label className={labelCls}>语言/框架（可选）</label>
        <input className={INPUT_CLS} value={codeLang} onChange={e => setCodeLang(e.target.value)}
          placeholder="Python / TypeScript / React / SQL ..." />
      </div>

      {/* 消息区 */}
      <div ref={codeScrollRef} className="flex-1 overflow-y-auto p-4 space-y-3" style={{ maxHeight: '400px' }}>
        {codeMessages.length === 0 && (
          <div className="text-center text-sm text-slate-400 dark:text-slate-600 py-8">
            向代码助手提问，例如：<br />
            <span className="text-slate-300 dark:text-slate-700">&quot;用 Python 写一个快速排序&quot; · &quot;解释这段代码&quot; · &quot;如何优化这个 SQL 查询&quot;</span>
          </div>
        )}
        {codeMessages.map((msg, i) => (
          <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div className={`rounded-2xl px-4 py-2.5 text-sm max-w-[90%] whitespace-pre-wrap ${
              msg.role === 'user'
                ? 'bg-violet-600 text-white'
                : 'bg-slate-100 dark:bg-slate-800 text-slate-800 dark:text-slate-200'
            }`}>
              {msg.content}
            </div>
          </div>
        ))}
        {codeLoading && (
          <div className="flex justify-start">
            <div className="rounded-2xl px-4 py-2.5 bg-slate-100 dark:bg-slate-800">
              <span className="flex gap-1">
                <span className="w-1.5 h-1.5 bg-slate-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                <span className="w-1.5 h-1.5 bg-slate-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                <span className="w-1.5 h-1.5 bg-slate-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
              </span>
            </div>
          </div>
        )}
      </div>

      {/* 输入栏 */}
      <div className="border-t border-slate-100 dark:border-slate-800 p-3 flex gap-2">
        <textarea
          rows={2}
          className={`${fieldCls} flex-1 resize-none`}
          value={codeInput}
          onChange={e => setCodeInput(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); onSendCodeMessage(); } }}
          placeholder="输入你的问题... (Enter 发送，Shift+Enter 换行)"
        />
        <button
          onClick={onSendCodeMessage}
          disabled={codeLoading || !codeInput.trim()}
          className="shrink-0 rounded-xl bg-violet-600 hover:bg-violet-700 disabled:opacity-50 px-4 py-2 text-sm font-semibold text-white transition-colors self-end">
          发送
        </button>
        {codeMessages.length > 0 && (
          <button
            onClick={() => setCodeMessages([])}
            className={`shrink-0 ${btnSec} self-end`}>
            清空
          </button>
        )}
      </div>
    </div>
  );
}
