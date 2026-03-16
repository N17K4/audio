import type { Status, VoiceInfo, CapabilityMap, VcInputMode } from '../../types';
import { LOCAL_PROVIDERS } from '../../constants';
import ProviderRow from '../shared/ProviderRow';
import OutputDirRow from '../shared/OutputDirRow';
import ModelInput from '../shared/ModelInput';
import FileDrop from '../shared/FileDrop';
import ProcessFlow, { FlowStep } from '../shared/ProcessFlow';

// ─── Fish Speech 本地 TTS 流程 ────────────────────────────────────────────────
const TTS_FLOW_FISH: FlowStep[] = [
  { label: '文字输入' },
  { label: '分词/G2P',    tech: 'Tokenizer' },
  { label: '声学建模',    tech: 'Fish Speech LLM' },
  { label: '参考音色',    tech: 'ECAPA-TDNN' },
  { label: '声码器',      tech: 'FireflyGAN' },
  { label: '音频输出' },
];

// ─── 云端 TTS（OpenAI / ElevenLabs 等）流程 ──────────────────────────────────
const TTS_FLOW_CLOUD: FlowStep[] = [
  { label: '文字输入' },
  { label: '分句处理' },
  { label: '云端合成',    tech: 'API' },
  { label: '音频输出' },
];

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
  ttsRefAudios: File[];
  setTtsRefAudios: (v: File[]) => void;
  ttsRefInputMode: VcInputMode;
  setTtsRefInputMode: (v: VcInputMode) => void;
  ttsRefRecordedObjectUrl: string | null;
  ttsRecordingDir: string | null;
  onStartTtsRefRecording: () => void;
  onStopTtsRefRecording: () => void;
  onClearTtsRefRecording: () => void;
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
  ttsRefAudios,
  setTtsRefAudios,
  ttsRefInputMode,
  setTtsRefInputMode,
  ttsRefRecordedObjectUrl,
  ttsRecordingDir,
  onStartTtsRefRecording,
  onStopTtsRefRecording,
  onClearTtsRefRecording,
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

      {/* 实际运行流程 */}
      {selectedProvider === 'fish_speech'
        ? <ProcessFlow steps={TTS_FLOW_FISH} color="#f59e0b" />
        : <ProcessFlow steps={TTS_FLOW_CLOUD} color="#6366f1" />}

      {selectedProvider === 'fish_speech' ? (
        <div className="space-y-3">
          <span className="block text-xs font-medium text-slate-400 mb-1.5 uppercase tracking-wide">目标音色（音频样本）</span>
          {/* 上传/录音 Tab */}
          <div className="flex rounded-xl border border-slate-200 dark:border-slate-700 overflow-hidden text-sm bg-slate-50/50 dark:bg-slate-800/50">
            {(['upload', 'record'] as VcInputMode[]).map(m => (
              <button key={m}
                className={`flex-1 py-2 text-sm font-medium transition-all ${ttsRefInputMode === m ? 'bg-slate-800 dark:bg-slate-600 text-white shadow-sm' : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 hover:bg-slate-100 dark:hover:bg-slate-700 dark:hover:text-slate-200'}`}
                onClick={() => { setTtsRefInputMode(m); if (m === 'upload') onClearTtsRefRecording(); }}>
                {m === 'record' ? '电脑内录' : '上传文件'}
              </button>
            ))}
          </div>

          {ttsRefInputMode === 'upload' ? (
            <FileDrop
              files={ttsRefAudios}
              onAdd={fs => setTtsRefAudios([...ttsRefAudios, ...fs])}
              onRemove={i => setTtsRefAudios(ttsRefAudios.filter((_, j) => j !== i))}
              accept="audio/*"
              multiple
              iconType="audio"
              emptyLabel="点击或拖拽参考音频（可多选）"
              formatHint="3–30 秒每段效果最佳"
            />
          ) : (
            <div className="space-y-3">
              {/* 录音控制按钮 */}
              <div className="flex gap-2">
                {status === 'idle' && !ttsRefRecordedObjectUrl && (
                  <button className="flex-1 rounded-xl bg-indigo-600 hover:bg-indigo-700 py-2.5 text-sm font-semibold text-white shadow-sm transition-all active:scale-[0.99]" onClick={onStartTtsRefRecording}>开始录音</button>
                )}
                {status === 'recording' && (
                  <button className="flex-1 rounded-xl bg-rose-600 hover:bg-rose-700 py-2.5 text-sm font-semibold text-white shadow-sm animate-pulse transition-all" onClick={onStopTtsRefRecording}>停止录音</button>
                )}
                {status === 'processing' && (
                  <span className="flex-1 text-center text-sm text-slate-400 py-2.5">处理中...</span>
                )}
                {status === 'idle' && ttsRefRecordedObjectUrl && (
                  <button className="flex-1 rounded-xl bg-indigo-600 hover:bg-indigo-700 py-2.5 text-sm font-semibold text-white shadow-sm transition-all active:scale-[0.99]" onClick={onStartTtsRefRecording}>重新录音</button>
                )}
              </div>

              {/* 录音结果播放器 */}
              {ttsRefRecordedObjectUrl && (
                <div className="space-y-2">
                  <audio controls src={ttsRefRecordedObjectUrl} className="w-full h-9" />
                  {ttsRecordingDir && window.electronAPI?.openDir && (
                    <button
                      onClick={() => window.electronAPI!.openDir!(ttsRecordingDir)}
                      className="flex items-center gap-1.5 rounded-lg border border-slate-200 dark:border-slate-600 bg-slate-50 dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 px-3 py-1.5 text-xs text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 transition-colors">
                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
                      </svg>
                      打开录音目录
                    </button>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
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
      <button className="w-full rounded-xl bg-indigo-600 hover:bg-indigo-700 active:bg-indigo-800 py-2.5 text-sm font-semibold text-white shadow-sm hover:shadow-button-primary transition-all duration-150 active:scale-[0.99] disabled:opacity-60 disabled:cursor-not-allowed" onClick={onRunTts} disabled={status === 'processing' || status === 'recording'}>
        {status === 'processing' ? '处理中...' : '开始合成'}
      </button>
    </section>
  );
}
