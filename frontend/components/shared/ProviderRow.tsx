import { PROVIDER_LABELS, PROVIDER_TO_ENGINE, DEFAULT_CAPS } from '../../constants';
import type { TaskType, CapabilityMap } from '../../types';

interface ProviderRowProps {
  taskType: TaskType;
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
  fieldCls: string;
  labelCls: string;
}

function shortLabel(label: string): string {
  return label.replace(/（[^）]*）/g, '').trim();
}

export default function ProviderRow({
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
  fieldCls,
  labelCls,
}: ProviderRowProps) {
  const caps = capabilities[taskType] || DEFAULT_CAPS[taskType] || [];
  const engineKey = PROVIDER_TO_ENGINE[selectedProvider];
  const engineInfo = engineKey ? engineVersions[engineKey] : undefined;
  return (
    <div className="space-y-3">
      <div>
        <span className={labelCls}>服务商</span>
        <div className="grid grid-cols-3 gap-2">
          {caps.map(p => (
            <button key={p}
              onClick={() => setProviderMap(prev => ({ ...prev, [taskType]: p }))}
              className={`rounded-xl border px-2 py-2 text-xs font-medium transition-all text-center leading-tight ${
                selectedProvider === p
                  ? 'border-violet-400 bg-violet-50 text-violet-700 dark:bg-violet-900/30 dark:border-violet-500 dark:text-violet-300'
                  : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400 hover:border-slate-300 dark:hover:border-slate-600 hover:bg-slate-50 dark:hover:bg-slate-800/50'
              }`}>
              {shortLabel(PROVIDER_LABELS[p] || p)}
            </button>
          ))}
        </div>
      </div>
      {needsAuth && (
        <label className="block">
          <span className={labelCls}>API 密钥</span>
          <input className={fieldCls} type="password"
            value={apiKey} onChange={e => setApiKey(e.target.value)} placeholder="服务商 API 密钥" />
        </label>
      )}
      {isUrlOnly && (
        <label className="block">
          <span className={labelCls}>服务地址</span>
          <input className={fieldCls}
            value={cloudEndpoint} onChange={e => setCloudEndpoint(e.target.value)} placeholder="http://localhost:11434" />
        </label>
      )}
      {engineInfo && (
        <div className="flex items-center gap-2 text-xs">
          <span className={`rounded-full px-2.5 py-0.5 font-mono text-[11px] font-semibold ${engineInfo.ready ? 'bg-emerald-50 text-emerald-600 border border-emerald-200/80' : 'bg-amber-50 text-amber-600 border border-amber-200/80'}`}>
            v{engineInfo.version}
          </span>
          {engineInfo.ready
            ? <span className="text-slate-400">模型已就绪</span>
            : <span className="text-amber-500">缺少模型权重，请先下载 checkpoints</span>
          }
        </div>
      )}
    </div>
  );
}
