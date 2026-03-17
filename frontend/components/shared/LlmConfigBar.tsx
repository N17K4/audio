/**
 * LlmConfigBar — 可复用的 LLM 配置栏
 *
 * 包含：服务商、模型、API密钥/服务地址
 * 在 LLM、Agent、RAG 等 Panel 中复用
 */

import { CapabilityMap } from '../../types';
import { PROVIDER_LABELS, PROVIDER_MODELS, DEFAULT_MODELS, DEFAULT_CAPS } from '../../constants';
import ComboSelect from './ComboSelect';

interface LlmConfigBarProps {
  task: string;
  capabilities: CapabilityMap;
  selectedProvider: string;
  llmModel: string;
  apiKey: string;
  cloudEndpoint: string;
  onProviderChange: (provider: string) => void;
  onModelChange: (model: string) => void;
  onApiKeyChange: (key: string) => void;
  onCloudEndpointChange: (endpoint: string) => void;
}

export default function LlmConfigBar({
  task,
  capabilities,
  selectedProvider,
  llmModel,
  apiKey,
  cloudEndpoint,
  onProviderChange,
  onModelChange,
  onApiKeyChange,
  onCloudEndpointChange,
}: LlmConfigBarProps) {
  return (
    <div className="p-4 border-b border-slate-100 dark:border-slate-800 flex flex-wrap gap-3 items-end">
      {/* 服务商 */}
      <label className="flex flex-col gap-1 min-w-[160px] flex-1">
        <span className="text-xs font-medium text-slate-400 uppercase tracking-wide">服务商</span>
        <ComboSelect
          value={selectedProvider}
          onChange={onProviderChange}
          options={(capabilities[task]?.length ? capabilities[task] : DEFAULT_CAPS[task as keyof typeof DEFAULT_CAPS] || []).map(p => ({ value: p, label: PROVIDER_LABELS[p] || p }))}
          placeholder="选择服务商"
        />
      </label>

      {/* 模型 */}
      <label className="flex flex-col gap-1 min-w-[160px] flex-1">
        <span className="text-xs font-medium text-slate-400 uppercase tracking-wide">模型</span>
        <ComboSelect
          value={llmModel}
          onChange={onModelChange}
          options={(PROVIDER_MODELS[task]?.[selectedProvider] ?? []).map(m => ({ value: m, label: m }))}
          placeholder={DEFAULT_MODELS[task]?.[selectedProvider] ? `默认：${DEFAULT_MODELS[task]?.[selectedProvider]}` : '选择模型'}
        />
      </label>

      {/* API 密钥 */}
      {selectedProvider !== 'ollama' && (
        <label className="flex flex-col gap-1 min-w-[180px] flex-1">
          <span className="text-xs font-medium text-slate-400 uppercase tracking-wide">API 密钥</span>
          <input
            type="password"
            className="rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-800 px-3 py-2 text-sm text-slate-800 dark:text-slate-200 focus:border-[#1A8FE3] focus:ring-2 focus:ring-[#1A8FE3]/15 transition-all outline-none placeholder:text-slate-400"
            value={apiKey}
            onChange={e => onApiKeyChange(e.target.value)}
            placeholder="服务商 API 密钥"
          />
        </label>
      )}

      {/* 服务地址 */}
      {selectedProvider === 'ollama' && (
        <label className="flex flex-col gap-1 min-w-[180px] flex-1">
          <span className="text-xs font-medium text-slate-400 uppercase tracking-wide">服务地址</span>
          <input
            className="rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-800 px-3 py-2 text-sm text-slate-800 dark:text-slate-200 focus:border-[#1A8FE3] focus:ring-2 focus:ring-[#1A8FE3]/15 transition-all outline-none placeholder:text-slate-400"
            value={cloudEndpoint}
            onChange={e => onCloudEndpointChange(e.target.value)}
            placeholder="http://127.0.0.1:11434"
          />
        </label>
      )}
    </div>
  );
}
