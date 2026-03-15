import type { Status, CapabilityMap } from '../../types';
import ProviderRow from '../shared/ProviderRow';
import ModelInput from '../shared/ModelInput';

interface AsrPanelProps {
  taskType: 'asr';
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
  asrFile: File | null;
  setAsrFile: (v: File | null) => void;
  asrModel: string;
  setAsrModel: (v: string) => void;
  status: Status;
  onRunAsr: () => void;
  fieldCls: string;
  labelCls: string;
}

export default function AsrPanel({
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
  asrFile,
  setAsrFile,
  asrModel,
  setAsrModel,
  status,
  onRunAsr,
  fieldCls,
  labelCls,
}: AsrPanelProps) {
  return (
    <section className="rounded-2xl border border-slate-200/80 bg-white p-6 shadow-panel space-y-5 dark:bg-slate-900 dark:border-slate-700/80">
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
      <div className="border-t border-slate-100 dark:border-slate-800" />

      <label className="block">
        <span className="block text-xs font-medium text-slate-400 mb-1.5 uppercase tracking-wide">模型（可选）</span>
        <ModelInput value={asrModel} onChange={setAsrModel} task="asr" provider={selectedProvider} />
      </label>

      <label className="block">
        <span className="block text-xs font-medium text-slate-400 mb-1.5 uppercase tracking-wide">输入音频</span>
        <input className="w-full rounded-xl border border-slate-200 bg-slate-50/50 px-3.5 py-2.5 text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-indigo-50 file:px-3 file:py-1 file:text-xs file:font-medium file:text-indigo-700 hover:file:bg-indigo-100 transition-all" type="file" accept="audio/*"
          onChange={e => setAsrFile(e.target.files?.[0] || null)} />
        {asrFile && <span className="text-xs text-slate-400 mt-1.5 block">{asrFile.name}（{Math.round(asrFile.size / 1024)} KB）</span>}
      </label>

      <button className="w-full rounded-xl bg-indigo-600 hover:bg-indigo-700 active:bg-indigo-800 py-2.5 text-sm font-semibold text-white shadow-sm hover:shadow-button-primary transition-all duration-150 active:scale-[0.99] disabled:opacity-60 disabled:cursor-not-allowed" onClick={onRunAsr} disabled={status === 'processing'}>
        {status === 'processing' ? '处理中...' : '开始识别'}
      </button>
    </section>
  );
}
