import type { Status, CapabilityMap, VcInputMode } from '../../types';
import ProviderRow from '../shared/ProviderRow';
import ModelInput from '../shared/ModelInput';
import HowToSteps from '../shared/HowToSteps';
import FileDrop from '../shared/FileDrop';
import ProcessFlow, { FlowStep } from '../shared/ProcessFlow';
import RecordingControls from '../shared/RecordingControls';
import RecordingDownloadLink from '../shared/RecordingDownloadLink';
import TabBar from '../shared/TabBar';

// ─── 本地 Whisper / Faster-Whisper 流程 ──────────────────────────────────────
const ASR_FLOW_LOCAL: FlowStep[] = [
  { label: '音频文件' },
  { label: 'VAD 切分',   tech: 'silero-vad' },
  { label: '声学编码',   tech: 'Whisper Encoder' },
  { label: 'Beam 解码',  tech: 'Beam Search' },
  { label: '文字输出' },
];

// ─── 云端 STT（OpenAI / Deepgram 等）流程 ────────────────────────────────────
const ASR_FLOW_CLOUD: FlowStep[] = [
  { label: '音频文件' },
  { label: '格式转换',   tech: 'ffmpeg' },
  { label: '云端识别',   tech: 'OpenAI/Deepgram' },
  { label: '文字输出' },
];

const ASR_STEPS = [
  { title: '上传音频', desc: '支持 MP3 / WAV / FLAC 等格式，拖拽即可' },
  { title: '选择引擎', desc: '本地 Whisper 或 Deepgram / Groq 等云端 STT' },
  { title: '获取文稿', desc: '转录完成后文字显示在任务列表' },
];

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
  asrInputMode: VcInputMode;
  setAsrInputMode: (v: VcInputMode) => void;
  asrRecordedObjectUrl: string | null;
  asrRecordingDir: string | null;
  onStartAsrRecording: () => void;
  onStopAsrRecording: () => void;
  onClearAsrRecording: () => void;
  outputDir: string;
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
  asrInputMode,
  setAsrInputMode,
  asrRecordedObjectUrl,
  asrRecordingDir,
  onStartAsrRecording,
  onStopAsrRecording,
  onClearAsrRecording,
  outputDir,
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

      {/* 实际运行流程 */}
      {(selectedProvider === 'whisper' || selectedProvider === 'faster_whisper')
        ? <ProcessFlow steps={ASR_FLOW_LOCAL} color="#0284c7" />
        : <ProcessFlow steps={ASR_FLOW_CLOUD} color="#6366f1" />}

      <label className="block">
        <span className="block text-xs font-medium text-slate-400 mb-1.5 uppercase tracking-wide">模型（可选）</span>
        <ModelInput value={asrModel} onChange={setAsrModel} task="asr" provider={selectedProvider} />
      </label>

      {/* 输入音频 */}
      <div className="space-y-3">
        <span className="block text-xs font-medium text-slate-400 uppercase tracking-wide">输入音频</span>
        <TabBar
          tabs={[{ value: 'upload' as const, label: '上传文件' }, { value: 'record' as const, label: '电脑内录' }]}
          value={asrInputMode}
          onChange={m => { setAsrInputMode(m); if (m === 'upload') onClearAsrRecording(); }}
        />

        {asrInputMode === 'upload' ? (
          <FileDrop
            files={asrFile ? [asrFile] : []}
            onAdd={fs => setAsrFile(fs[0])}
            onRemove={() => setAsrFile(null)}
            accept="audio/*"
            iconType="audio"
            formatHint="支持 MP3、WAV、FLAC、M4A、OGG"
          />
        ) : (
          <div className="space-y-3">
            <RecordingControls status={status} recordedObjectUrl={asrRecordedObjectUrl} onStart={onStartAsrRecording} onStop={onStopAsrRecording} />

            {/* 录音结果播放器 */}
            {asrRecordedObjectUrl && (
              <div className="space-y-2">
                <audio controls src={asrRecordedObjectUrl} className="w-full h-9" />
                <RecordingDownloadLink recordedObjectUrl={asrRecordedObjectUrl} filename="asr_recording.webm" />
              </div>
            )}
          </div>
        )}
      </div>

      <button className="w-full rounded-xl bg-[#1A8FE3] hover:bg-[#1680d0] active:bg-[#1472bc] py-2.5 text-sm font-semibold text-white shadow-sm transition-all duration-150 active:scale-[0.99] disabled:opacity-60 disabled:cursor-not-allowed" onClick={onRunAsr} disabled={status === 'processing' || status === 'recording' || !asrFile}>
        {status === 'processing' ? '处理中...' : '转文本'}
      </button>

      <HowToSteps steps={ASR_STEPS} />
    </section>
  );
}
