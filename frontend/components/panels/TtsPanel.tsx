import type { Status, VoiceInfo, CapabilityMap } from '../../types';
import { LOCAL_PROVIDERS } from '../../constants';
import ProviderRow from '../shared/ProviderRow';
import OutputDirRow from '../shared/OutputDirRow';
import ModelInput from '../shared/ModelInput';

interface TtsPanelProps {
  taskType: 'tts';
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
  ttsText: string;
  setTtsText: (v: string) => void;
  ttsModel: string;
  setTtsModel: (v: string) => void;
  ttsVoice: string;
  setTtsVoice: (v: string) => void;
  ttsRefAudio: File | null;
  setTtsRefAudio: (v: File | null) => void;
  outputDir: string;
  setOutputDir: (v: string) => void;
  status: Status;
  onRunTts: () => void;
  fieldCls: string;
  fileCls: string;
  labelCls: string;
  btnSec: string;
}

export default function TtsPanel({
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
  ttsText,
  setTtsText,
  ttsModel,
  setTtsModel,
  ttsVoice,
  setTtsVoice,
  ttsRefAudio,
  setTtsRefAudio,
  outputDir,
  setOutputDir,
  status,
  onRunTts,
  fieldCls,
  fileCls,
  labelCls,
  btnSec,
}: TtsPanelProps) {
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

      {selectedProvider === 'fish_speech' ? (
        <label className="block">
          <span className="block text-xs font-medium text-slate-400 mb-1.5 uppercase tracking-wide">目标音色（音频样本）</span>
          <input className="w-full rounded-xl border border-slate-200 bg-slate-50/50 px-3.5 py-2.5 text-sm text-slate-800 file:mr-3 file:rounded-lg file:border-0 file:bg-indigo-50 file:px-3 file:py-1 file:text-xs file:font-medium file:text-indigo-700 hover:file:bg-indigo-100 transition-all" type="file" accept="audio/*"
            onChange={e => setTtsRefAudio(e.target.files?.[0] || null)} />
          {ttsRefAudio && <p className="text-xs text-slate-400 mt-1.5">{ttsRefAudio.name}（{Math.round(ttsRefAudio.size / 1024)} KB）</p>}
        </label>
      ) : selectedProvider === 'elevenlabs' ? (
        <label className="block">
          <span className="block text-xs font-medium text-slate-400 mb-1.5 uppercase tracking-wide">音色 ID</span>
          <input className="w-full rounded-xl border border-slate-200 bg-slate-50/50 px-3.5 py-2.5 text-sm text-slate-800 placeholder:text-slate-400 focus:border-indigo-400 focus:bg-white focus:ring-2 focus:ring-indigo-500/15 transition-all"
            value={ttsVoice} onChange={e => setTtsVoice(e.target.value)} placeholder="ElevenLabs Voice ID" />
        </label>
      ) : (
        <label className="block">
          <span className="block text-xs font-medium text-slate-400 mb-1.5 uppercase tracking-wide">音色（可选）</span>
          <input className="w-full rounded-xl border border-slate-200 bg-slate-50/50 px-3.5 py-2.5 text-sm text-slate-800 placeholder:text-slate-400 focus:border-indigo-400 focus:bg-white focus:ring-2 focus:ring-indigo-500/15 transition-all"
            value={ttsVoice} onChange={e => setTtsVoice(e.target.value)}
            placeholder={selectedProvider === 'gemini' ? 'Kore' : 'alloy'} />
        </label>
      )}

      {!LOCAL_PROVIDERS.has(selectedProvider) && (
        <label className="block">
          <span className="block text-xs font-medium text-slate-400 mb-1.5 uppercase tracking-wide">模型（可选）</span>
          <ModelInput value={ttsModel} onChange={setTtsModel} task="tts" provider={selectedProvider} />
        </label>
      )}

      <label className="block">
        <span className="block text-xs font-medium text-slate-400 mb-1.5 uppercase tracking-wide">输入文本</span>
        <textarea className="w-full rounded-xl border border-slate-200 bg-slate-50/50 px-3.5 py-3 text-sm text-slate-800 placeholder:text-slate-400 focus:border-indigo-400 focus:bg-white focus:ring-2 focus:ring-indigo-500/15 transition-all resize-none"
          value={ttsText} onChange={e => setTtsText(e.target.value)} rows={5} />
        <span className="text-xs text-slate-400 mt-1 block">{ttsText.length} 字</span>
      </label>

      <OutputDirRow required outputDir={outputDir} setOutputDir={setOutputDir} fieldCls={fieldCls} labelCls={labelCls} btnSec={btnSec} />
      <button className="w-full rounded-xl bg-indigo-600 hover:bg-indigo-700 active:bg-indigo-800 py-2.5 text-sm font-semibold text-white shadow-sm hover:shadow-button-primary transition-all duration-150 active:scale-[0.99] disabled:opacity-60 disabled:cursor-not-allowed" onClick={onRunTts} disabled={status === 'processing'}>
        {status === 'processing' ? '处理中...' : '开始合成'}
      </button>
    </section>
  );
}
