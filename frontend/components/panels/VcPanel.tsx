import { useState } from 'react';
import type { Status, VoiceInfo, CapabilityMap, VcInputMode } from '../../types';
import { LOCAL_PROVIDERS } from '../../constants';
import CustomSelect from '../shared/CustomSelect';
import ProviderRow from '../shared/ProviderRow';
import OutputDirRow from '../shared/OutputDirRow';
import VoiceSelector from '../shared/VoiceSelector';
import CreateVoicePanel from '../shared/CreateVoicePanel';
import HowToSteps from '../shared/HowToSteps';
import FileDrop from '../shared/FileDrop';
import NameInput from '../shared/NameInput';
import ProcessFlow, { FlowStep } from '../shared/ProcessFlow';

// ─── Seed-VC 音色转换流程 ─────────────────────────────────────────────────────
const VC_FLOW_SEED_VC: FlowStep[] = [
  { label: '参考音频' },
  { label: '音色提取',   tech: 'ECAPA-TDNN' },
  { label: '源音频' },
  { label: '内容编码',   tech: 'Whisper Enc' },
  { label: '扩散推理',   tech: 'DiT / CFG' },
  { label: '声码器',     tech: 'BigVGAN' },
  { label: '输出音频' },
];

// ─── RVC 音色转换流程 ─────────────────────────────────────────────────────────
const VC_FLOW_RVC: FlowStep[] = [
  { label: '源音频' },
  { label: 'F0 提取',    tech: 'rmvpe' },
  { label: '内容特征',   tech: 'HuBERT' },
  { label: '推理',       tech: 'VITS / RVC' },
  { label: '声码器',     tech: 'HifiGAN' },
  { label: '输出音频' },
];

// ─── RVC 训练音色流程 ─────────────────────────────────────────────────────────
const VC_FLOW_TRAIN: FlowStep[] = [
  { label: '音频素材' },
  { label: '预处理',     tech: 'resample/slice' },
  { label: 'F0 提取',    tech: 'rmvpe' },
  { label: '特征提取',   tech: 'HuBERT' },
  { label: '训练',       tech: 'VITS' },
  { label: '保存模型',   tech: '.pth' },
];

const VC_STEPS_SEED_VC = [
  { title: '上传参考音频', desc: '上传目标音色的参考录音（3–30 秒效果最佳）' },
  { title: '上传原始音频', desc: '拖拽或选择需要转换音色的音频文件' },
  { title: '开始转换', desc: '本地 Seed-VC 推理，结果在任务列表查看' },
];

const VC_STEPS_RVC = [
  { title: '选择音色模型', desc: '选择或导入 RVC .pth 音色文件' },
  { title: '上传原始音频', desc: '拖拽或选择需要转换音色的音频文件' },
  { title: '开始转换', desc: '本地 RVC 推理，结果在任务列表查看' },
];

const VC_STEPS = [
  { title: '上传参考音频', desc: '上传目标音色的参考录音（3–30 秒效果最佳）' },
  { title: '上传原始音频', desc: '拖拽或选择需要转换音色的音频文件' },
  { title: '开始转换', desc: '本地 Seed-VC / RVC 推理，结果在任务列表查看' },
];

interface VcPanelProps {
  taskType: 'vc';
  capabilities: CapabilityMap;
  selectedProvider: string;
  isLocal: boolean;
  needsAuth: boolean;
  isUrlOnly: boolean;
  apiKey: string;
  cloudEndpoint: string;
  engineVersions: Record<string, { version: string; ready: boolean }>;
  setProviderMap: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  setApiKey: (v: string) => void;
  setCloudEndpoint: (v: string) => void;
  selectedVoiceId: string;
  setSelectedVoiceId: (v: string) => void;
  voices: VoiceInfo[];
  onRefreshVoices: () => void;
  vcInputMode: VcInputMode;
  setVcInputMode: (v: VcInputMode) => void;
  vcFile: File | null;
  setVcFile: (v: File | null) => void;
  vcRefAudios: File[];
  setVcRefAudios: (v: File[]) => void;
  showCreateVoice: boolean;
  setShowCreateVoice: (v: boolean) => void;
  newVoiceEngine: string;
  setNewVoiceEngine: (v: string) => void;
  newVoiceName: string;
  setNewVoiceName: (v: string) => void;
  creatingVoice: boolean;
  setNewVoiceModel: (v: File | null) => void;
  setNewVoiceIndex: (v: File | null) => void;
  setNewVoiceRef: (v: File | null) => void;
  onCreateVoice: () => void;
  onDeleteVoice: (voiceId: string) => void;
  onRenameVoice: (voiceId: string, newName: string) => void;
  outputDir: string;
  setOutputDir: (v: string) => void;
  status: Status;
  vcRecordedFile: File | null;
  vcRecordedObjectUrl: string | null;
  vcRecordingDir: string | null;
  onClearVcRecording: () => void;
  onHandleVoiceConvert: (audio: Blob | File) => void;
  onStartVcRecording: () => void;
  onStopVcRecording: () => void;
  // Advanced settings
  seedVcDiffusionSteps: number;
  setSeedVcDiffusionSteps: (v: number) => void;
  seedVcPitchShift: number;
  setSeedVcPitchShift: (v: number) => void;
  seedVcF0Condition: boolean;
  setSeedVcF0Condition: (v: boolean) => void;
  seedVcEnablePostprocess: boolean;
  setSeedVcEnablePostprocess: (v: boolean) => void;
  seedVcCfgRate: number;
  setSeedVcCfgRate: (v: number) => void;
  rvcF0Method: string;
  setRvcF0Method: (v: string) => void;
  rvcFilterRadius: number;
  setRvcFilterRadius: (v: number) => void;
  rvcIndexRate: number;
  setRvcIndexRate: (v: number) => void;
  rvcPitchShift: number;
  setRvcPitchShift: (v: number) => void;
  rvcRmsMixRate: number;
  setRvcRmsMixRate: (v: number) => void;
  rvcProtect: number;
  setRvcProtect: (v: number) => void;
  // Training
  trainVoiceName: string;
  setTrainVoiceName: (v: string) => void;
  trainFiles: File[];
  setTrainFiles: (v: File[]) => void;
  // Training advanced
  trainEpochs: number;
  setTrainEpochs: (v: number) => void;
  trainF0Method: string;
  setTrainF0Method: (v: string) => void;
  trainSampleRate: number;
  setTrainSampleRate: (v: number) => void;
  onStartTraining: () => void;
  fieldCls: string;
  fileCls: string;
  labelCls: string;
  btnSec: string;
}

export default function VcPanel({
  taskType,
  capabilities,
  selectedProvider,
  isLocal,
  needsAuth,
  isUrlOnly,
  apiKey,
  cloudEndpoint,
  engineVersions,
  setProviderMap,
  setApiKey,
  setCloudEndpoint,
  selectedVoiceId,
  setSelectedVoiceId,
  voices,
  onRefreshVoices,
  vcInputMode,
  setVcInputMode,
  vcFile,
  setVcFile,
  vcRefAudios,
  setVcRefAudios,
  showCreateVoice,
  setShowCreateVoice,
  newVoiceEngine,
  setNewVoiceEngine,
  newVoiceName,
  setNewVoiceName,
  creatingVoice,
  setNewVoiceModel,
  setNewVoiceIndex,
  setNewVoiceRef,
  onCreateVoice,
  onDeleteVoice,
  onRenameVoice,
  outputDir,
  setOutputDir,
  status,
  vcRecordedFile,
  vcRecordedObjectUrl,
  vcRecordingDir,
  onClearVcRecording,
  onHandleVoiceConvert,
  onStartVcRecording,
  onStopVcRecording,
  seedVcDiffusionSteps,
  setSeedVcDiffusionSteps,
  seedVcPitchShift,
  setSeedVcPitchShift,
  seedVcF0Condition,
  setSeedVcF0Condition,
  seedVcEnablePostprocess,
  setSeedVcEnablePostprocess,
  seedVcCfgRate,
  setSeedVcCfgRate,
  rvcF0Method,
  setRvcF0Method,
  rvcFilterRadius,
  setRvcFilterRadius,
  rvcIndexRate,
  setRvcIndexRate,
  rvcPitchShift,
  setRvcPitchShift,
  rvcRmsMixRate,
  setRvcRmsMixRate,
  rvcProtect,
  setRvcProtect,
  trainVoiceName,
  setTrainVoiceName,
  trainFiles,
  setTrainFiles,
  trainEpochs,
  setTrainEpochs,
  trainF0Method,
  setTrainF0Method,
  trainSampleRate,
  setTrainSampleRate,
  onStartTraining,
  fieldCls,
  fileCls,
  labelCls,
  btnSec,
}: VcPanelProps) {
  const [voiceTab, setVoiceTab] = useState<'select' | 'import' | 'train'>('select');
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');

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
      {selectedProvider === 'seed_vc'
        ? <ProcessFlow steps={VC_FLOW_SEED_VC} color="#0ea5e9" />
        : voiceTab === 'train'
          ? <ProcessFlow steps={VC_FLOW_TRAIN} color="#10b981" />
          : <ProcessFlow steps={VC_FLOW_RVC} color="#8b5cf6" />}

      {/* 目标音色 */}
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <span className="w-5 h-5 rounded-full text-white text-[10px] font-bold flex items-center justify-center shrink-0" style={{ backgroundColor: '#1A8FE3' }}>1</span>
          <span className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide">目标音色</span>
        </div>

        {selectedProvider === 'seed_vc' ? (
          <div>
            <span className="block text-xs text-slate-400 mb-1.5">参考音频样本（可选多个，3–30 秒每段效果最佳）</span>
            <FileDrop
              files={vcRefAudios}
              onAdd={fs => setVcRefAudios([...vcRefAudios, ...fs])}
              onRemove={i => setVcRefAudios(vcRefAudios.filter((_, j) => j !== i))}
              accept="audio/*"
              multiple
              iconType="audio"
              emptyLabel="点击或拖拽参考音频（可多选）"
              formatHint="3–30 秒每段效果最佳"
            />
          </div>
        ) : isLocal ? (
          <>
            {/* Tab 栏 */}
            <div className="flex rounded-xl border border-slate-200 dark:border-slate-700 overflow-hidden text-sm bg-slate-50/50 dark:bg-slate-800/50">
              {([['select', '选择音色'], ['import', '导入音色'], ['train', '训练音色']] as const).map(([tab, label]) => (
                <button key={tab}
                  className={`flex-1 py-2 text-sm font-medium transition-all ${voiceTab === tab ? 'bg-slate-800 dark:bg-slate-600 text-white shadow-sm' : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 hover:bg-slate-100 dark:hover:bg-slate-700 dark:hover:text-slate-200'}`}
                  onClick={() => {
                    if (tab === 'import') setNewVoiceEngine('rvc');
                    setVoiceTab(tab);
                  }}>
                  {label}
                </button>
              ))}
            </div>

            {/* 选择音色 */}
            {voiceTab === 'select' && (
              <div className="space-y-3">
                <VoiceSelector label="" value={selectedVoiceId} onChange={v => { setSelectedVoiceId(v); setRenamingId(null); }} voices={voices} onRefresh={onRefreshVoices} fieldCls={fieldCls} labelCls={labelCls} btnSec={btnSec} />
                {selectedVoiceId && (
                  <>
                    {renamingId === selectedVoiceId ? (
                      <div className="flex gap-2">
                        <input
                          className="flex-1 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-800/50 px-3 py-2 text-sm text-slate-800 dark:text-slate-200 focus:border-[#1A8FE3] focus:ring-2 focus:ring-[#1A8FE3]/15 transition-all"
                          value={renameValue}
                          onChange={e => setRenameValue(e.target.value)}
                          onKeyDown={e => {
                            if (e.key === 'Enter' && renameValue.trim()) {
                              onRenameVoice(selectedVoiceId, renameValue.trim());
                              setRenamingId(null);
                            } else if (e.key === 'Escape') {
                              setRenamingId(null);
                            }
                          }}
                          autoFocus
                          placeholder="输入新名称"
                        />
                        <button
                          className="rounded-xl bg-[#1A8FE3] hover:bg-[#1680d0] px-3 py-2 text-xs font-medium text-white transition-colors disabled:opacity-50"
                          disabled={!renameValue.trim()}
                          onClick={() => { onRenameVoice(selectedVoiceId, renameValue.trim()); setRenamingId(null); }}>
                          确认
                        </button>
                        <button
                          className="rounded-xl border border-slate-200 dark:border-slate-600 px-3 py-2 text-xs font-medium text-slate-500 hover:text-slate-700 transition-colors"
                          onClick={() => setRenamingId(null)}>
                          取消
                        </button>
                      </div>
                    ) : (
                      <div className="flex justify-end gap-3">
                        {!voices.find(v => v.voice_id === selectedVoiceId)?.is_builtin && (
                          <button className="text-xs font-medium text-indigo-500 hover:text-indigo-600 transition-colors"
                            onClick={() => {
                              const v = voices.find(x => x.voice_id === selectedVoiceId);
                              setRenameValue(v?.name || '');
                              setRenamingId(selectedVoiceId);
                            }}>
                            重命名
                          </button>
                        )}
                        {!voices.find(v => v.voice_id === selectedVoiceId)?.is_builtin && (
                          <button className="text-xs font-medium text-rose-500 hover:text-rose-600 transition-colors"
                            onClick={() => onDeleteVoice(selectedVoiceId)}>
                            删除音色
                          </button>
                        )}
                      </div>
                    )}
                  </>
                )}
              </div>
            )}

            {/* 导入音色 */}
            {voiceTab === 'import' && (
              <CreateVoicePanel
                engine="rvc"
                newVoiceEngine={newVoiceEngine}
                newVoiceName={newVoiceName}
                creatingVoice={creatingVoice}
                setNewVoiceEngine={setNewVoiceEngine}
                setNewVoiceName={setNewVoiceName}
                setNewVoiceModel={setNewVoiceModel}
                setNewVoiceIndex={setNewVoiceIndex}
                setNewVoiceRef={setNewVoiceRef}
                setShowCreateVoice={(v) => { if (!v) setVoiceTab('select'); setShowCreateVoice(v); }}
                onCreateVoice={onCreateVoice}
                fieldCls={fieldCls}
                fileCls={fileCls}
                labelCls={labelCls}
              />
            )}

            {/* 训练音色 */}
            {voiceTab === 'train' && (
              <div className="space-y-4">
                <label className="block">
                  <span className={labelCls}>音色名称</span>
                  <NameInput value={trainVoiceName} onChange={setTrainVoiceName} placeholder="请输入音色名称（如 my_trained_voice）" />
                </label>
                <div>
                  <span className={labelCls}>训练数据集（ZIP 压缩包或多个音频文件）</span>
                  <FileDrop
                    files={trainFiles}
                    onAdd={fs => setTrainFiles([...trainFiles, ...fs])}
                    onRemove={i => setTrainFiles(trainFiles.filter((_, j) => j !== i))}
                    accept=".zip,.wav,.mp3,.flac,.ogg,.m4a"
                    multiple
                    iconType="file"
                    emptyLabel="点击或拖拽训练数据"
                    formatHint="ZIP 或多个音频文件"
                  />
                </div>

                <details className="border border-slate-100 dark:border-slate-700 rounded-xl overflow-hidden">
                  <summary className="text-xs font-medium text-slate-400 cursor-pointer px-4 py-2.5 hover:bg-slate-50 dark:hover:bg-slate-800 list-none flex items-center justify-between">
                    <span>高级设置</span>
                    <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                    </svg>
                  </summary>
                  <div className="px-4 pb-4 pt-2 space-y-3 border-t border-slate-50 dark:border-slate-700">
                    <label className="block">
                      <span className={labelCls}>精细训练轮数（{trainEpochs === 0 ? '仅构建索引（快速）' : `${trainEpochs} 轮`}）</span>
                      <input type="range" min={0} max={500} step={50} className="w-full accent-indigo-600"
                        value={trainEpochs} onChange={e => setTrainEpochs(Number(e.target.value))} />
                      <span className="text-xs text-slate-400 mt-1 block">0 = 快速模式，仅构建 FAISS 特征索引（分钟级）；&gt;0 = 精细微调模型，效果更好但耗时更长（需要 GPU）</span>
                    </label>
                    <label className="block">
                      <span className={labelCls}>F0 提取方法</span>
                      <select className={fieldCls} value={trainF0Method} onChange={e => setTrainF0Method(e.target.value)}>
                        <option value="harvest">harvest（稳定，推荐）</option>
                        <option value="rmvpe">rmvpe（精度高，需要额外模型）</option>
                        <option value="pm">pm（最快，精度低）</option>
                      </select>
                    </label>
                    <label className="block">
                      <span className={labelCls}>目标采样率</span>
                      <select className={fieldCls} value={trainSampleRate} onChange={e => setTrainSampleRate(Number(e.target.value))}>
                        <option value={40000}>40000 Hz（标准 RVC v2）</option>
                        <option value={48000}>48000 Hz（高清）</option>
                      </select>
                    </label>
                  </div>
                </details>

                <button
                  className="w-full rounded-xl bg-slate-700 hover:bg-slate-800 py-2.5 text-sm font-semibold text-white shadow-sm transition-all active:scale-[0.99] disabled:opacity-50 disabled:cursor-not-allowed"
                  onClick={onStartTraining}
                >
                  提交训练
                </button>
              </div>
            )}
          </>
        ) : (
          <label className="block">
            <span className="block text-xs text-slate-400 mb-1.5">音色 ID</span>
            <input className="w-full rounded-xl border border-slate-200 bg-slate-50/50 px-3.5 py-2.5 text-sm text-slate-800 placeholder:text-slate-400 focus:border-[#1A8FE3] focus:bg-white focus:ring-2 focus:ring-[#1A8FE3]/15 transition-all"
              value={selectedVoiceId} onChange={e => setSelectedVoiceId(e.target.value)} placeholder="ElevenLabs Voice ID" />
          </label>
        )}
      </div>

      {/* 输入音频 */}
      {(!isLocal || voiceTab === 'select') && <div className="space-y-3">
        <div className="flex items-center gap-2">
          <span className="w-5 h-5 rounded-full text-white text-[10px] font-bold flex items-center justify-center shrink-0" style={{ backgroundColor: '#1A8FE3' }}>2</span>
          <span className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide">输入音频</span>
        </div>
        <div className="flex rounded-xl border border-slate-200 dark:border-slate-700 overflow-hidden text-sm bg-slate-50/50 dark:bg-slate-800/50">
          {(['upload', 'record'] as VcInputMode[]).map(m => (
            <button key={m}
              className={`flex-1 py-2 text-sm font-medium transition-all ${vcInputMode === m ? 'bg-slate-800 dark:bg-slate-600 text-white shadow-sm' : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 hover:bg-slate-100 dark:hover:bg-slate-700 dark:hover:text-slate-200'}`}
              onClick={() => setVcInputMode(m)}>
              {m === 'record' ? '电脑内录' : '上传文件'}
            </button>
          ))}
        </div>
        {vcInputMode === 'upload' ? (
          <FileDrop
            files={vcFile ? [vcFile] : []}
            onAdd={fs => setVcFile(fs[0])}
            onRemove={() => setVcFile(null)}
            accept="audio/*"
            iconType="audio"
            formatHint="支持 MP3、WAV、FLAC、M4A、OGG"
          />
        ) : (
          <div className="flex gap-2">
            {status === 'idle' && !vcRecordedFile && (
              <button className="flex-1 rounded-xl bg-[#1A8FE3] hover:bg-[#1680d0] py-2.5 text-sm font-semibold text-white shadow-sm transition-all active:scale-[0.99]" onClick={onStartVcRecording}>开始录音</button>
            )}
            {status === 'recording' && (
              <button className="flex-1 rounded-xl bg-rose-600 hover:bg-rose-700 py-2.5 text-sm font-semibold text-white shadow-sm animate-pulse transition-all" onClick={onStopVcRecording}>停止录音</button>
            )}
            {status === 'idle' && vcRecordedFile && (
              <button className="flex-1 rounded-xl bg-[#1A8FE3] hover:bg-[#1680d0] py-2.5 text-sm font-semibold text-white shadow-sm transition-all active:scale-[0.99]" onClick={onStartVcRecording}>重新录音</button>
            )}
            {status === 'processing' && <span className="text-sm text-slate-400 py-2">处理中...</span>}
          </div>
        )}
        {vcInputMode === 'record' && vcRecordedObjectUrl && (
          <div className="space-y-2">
            <audio controls src={vcRecordedObjectUrl} className="w-full h-9" />
            {vcRecordingDir && vcRecordedObjectUrl && (
              <a href={vcRecordedObjectUrl} download="vc_recording.webm"
                className="flex items-center gap-1.5 rounded-lg border border-slate-200 dark:border-slate-600 bg-slate-50 dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 px-3 py-1.5 text-xs text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 transition-colors">
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                </svg>
                下载录音
              </a>
            )}
          </div>
        )}
      </div>}

      {(!isLocal || voiceTab === 'select') && <OutputDirRow required outputDir={outputDir} setOutputDir={setOutputDir} fieldCls={fieldCls} labelCls={labelCls} btnSec={btnSec} />}

      {/* 高级设置（折叠） */}
      {(!isLocal || voiceTab === 'select') && <details className="border border-slate-200/80 dark:border-slate-700/80 rounded-2xl overflow-hidden dark:bg-slate-900">
        <summary className="text-sm font-medium text-slate-500 dark:text-slate-400 cursor-pointer px-5 py-3.5 hover:bg-slate-50 dark:hover:bg-slate-800 hover:text-slate-700 dark:hover:text-slate-200 transition-colors list-none flex items-center justify-between">
          <span>高级设置</span>
          <svg className="w-4 h-4 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </summary>
        <div className="px-5 pb-5 pt-3 space-y-4 border-t border-slate-100 dark:border-slate-800">
          {selectedProvider === 'seed_vc' && (
            <>
              <label className="block">
                <span className={labelCls}>扩散步数（{seedVcDiffusionSteps}）</span>
                <input type="range" min={1} max={30} step={1} className="w-full accent-indigo-600"
                  value={seedVcDiffusionSteps} onChange={e => setSeedVcDiffusionSteps(Number(e.target.value))} />
                <span className="text-xs text-slate-400 mt-1 block">降噪迭代次数，步数越多细节越丰富但越慢。⚠️ 每分钟音频约需 1～2 分钟（MPS）。快速预览用 4～6 步，正式输出用 10～15 步，默认 8</span>
              </label>
              <label className="block">
                <span className={labelCls}>音调偏移（{seedVcPitchShift} 半音）</span>
                <input type="range" min={-12} max={12} step={1} className="w-full accent-indigo-600"
                  value={seedVcPitchShift} onChange={e => setSeedVcPitchShift(Number(e.target.value))} />
                <span className="text-xs text-slate-400 mt-1 block">转换后整体升高或降低音调，1 个八度 = 12 半音。例：男声参考转女声输出时调 +5，女声参考转男声时调 -5</span>
              </label>
              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <span className={labelCls + ' mb-0'}>F0 条件化</span>
                  <button
                    className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${seedVcF0Condition ? 'bg-[#1A8FE3]' : 'bg-slate-300 dark:bg-slate-600'}`}
                    onClick={() => setSeedVcF0Condition(!seedVcF0Condition)}>
                    <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${seedVcF0Condition ? 'translate-x-6' : 'translate-x-1'}`} />
                  </button>
                </div>
                <p className="text-xs text-slate-400">开启后模型会保留原始音频的音调走势（语调起伏）。适合说话/朗读场景；转换歌声时建议关闭，避免音调被锁死</p>
                <p className="text-xs text-amber-500 font-medium">⚠ Mac / Apple Silicon：F0 条件化每次重新加载模型，耗时可能超过 20 分钟，建议保持关闭</p>
              </div>
              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <span className={labelCls + ' mb-0'}>音频美化</span>
                  <button
                    className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${seedVcEnablePostprocess ? 'bg-[#1A8FE3]' : 'bg-slate-300 dark:bg-slate-600'}`}
                    onClick={() => setSeedVcEnablePostprocess(!seedVcEnablePostprocess)}>
                    <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${seedVcEnablePostprocess ? 'translate-x-6' : 'translate-x-1'}`} />
                  </button>
                </div>
                <p className="text-xs text-slate-400">对输出做峰值归一化（统一响度）和高通滤波（消除低频底噪）。一般保持开启；需要原始输出用于后期处理时可关闭</p>
              </div>
              <label className="block">
                <span className={labelCls}>引导强度（{seedVcCfgRate.toFixed(2)}）</span>
                <input type="range" min={0} max={1} step={0.05} className="w-full accent-indigo-600"
                  value={seedVcCfgRate} onChange={e => setSeedVcCfgRate(Number(e.target.value))} />
                <span className="text-xs text-slate-400 mt-1 block">控制向参考音色靠拢的强度（CFG rate）。越高越像参考音色，但过高可能产生伪音；建议范围 0.5～0.8，默认 0.7</span>
              </label>
            </>
          )}
          {selectedProvider === 'local_rvc' && (
            <>
              <label className="block">
                <span className={labelCls}>F0 提取方法</span>
                <CustomSelect
                  value={rvcF0Method}
                  onChange={setRvcF0Method}
                  options={[
                    { value: 'rmvpe', label: 'rmvpe（推荐）' },
                    { value: 'harvest', label: 'harvest' },
                    { value: 'pm', label: 'pm（最快）' },
                  ]}
                />
                <span className="text-xs text-slate-400 mt-1 block">分析原始音频音调的算法。rmvpe 精度最高适合大多数场景；harvest 更稳定适合低质量录音；pm 最快但精度低，仅用于测试</span>
              </label>
              <label className="block">
                <span className={labelCls}>F0 平滑度（{rvcFilterRadius}）</span>
                <input type="range" min={1} max={7} step={1} className="w-full accent-indigo-600"
                  value={rvcFilterRadius} onChange={e => setRvcFilterRadius(Number(e.target.value))} />
                <span className="text-xs text-slate-400 mt-1 block">对音调曲线做中值滤波，消除突变噪声。值越大越平滑，但会损失语调细节。说话/朗读用 3（默认），有颤音的歌声用 1～2</span>
              </label>
              <label className="block">
                <span className={labelCls}>索引混合率（{rvcIndexRate.toFixed(2)}）</span>
                <input type="range" min={0} max={1} step={0.05} className="w-full accent-indigo-600"
                  value={rvcIndexRate} onChange={e => setRvcIndexRate(Number(e.target.value))} />
                <span className="text-xs text-slate-400 mt-1 block">控制目标音色特征文件（.index）的混合比例，越高越贴近目标音色但可能出现电音。音色不像时调高到 0.9，出现电音/伪音时调低到 0.5</span>
              </label>
              <label className="block">
                <span className={labelCls}>音调偏移（{rvcPitchShift} 半音）</span>
                <input type="range" min={-12} max={12} step={1} className="w-full accent-indigo-600"
                  value={rvcPitchShift} onChange={e => setRvcPitchShift(Number(e.target.value))} />
                <span className="text-xs text-slate-400 mt-1 block">转换后整体升降音调，1 个八度 = 12 半音。用女声模型转男声时调 -12（降一个八度），男声模型转女声时调 +12</span>
              </label>
              <label className="block">
                <span className={labelCls}>音量包络混合率（{rvcRmsMixRate.toFixed(2)}）</span>
                <input type="range" min={0} max={1} step={0.05} className="w-full accent-indigo-600"
                  value={rvcRmsMixRate} onChange={e => setRvcRmsMixRate(Number(e.target.value))} />
                <span className="text-xs text-slate-400 mt-1 block">0 = 使用目标音色的响度包络（推荐），1 = 保留原始音频的响度，中间值为混合。若输出忽大忽小可适当调高</span>
              </label>
              <label className="block">
                <span className={labelCls}>清音保护（{rvcProtect.toFixed(2)}）</span>
                <input type="range" min={0.01} max={0.5} step={0.01} className="w-full accent-indigo-600"
                  value={rvcProtect} onChange={e => setRvcProtect(Number(e.target.value))} />
                <span className="text-xs text-slate-400 mt-1 block">保护辅音、爆破音不受 F0 条件化影响，防止"嗒嗒"等人工痕迹。值越大保护越强但音色影响越小；默认 0.33，问题严重时调低到 0.1</span>
              </label>
            </>
          )}
          {selectedProvider !== 'seed_vc' && selectedProvider !== 'local_rvc' && (
            <p className="text-xs text-slate-400">当前服务商暂无高级参数</p>
          )}
        </div>
      </details>}

      {(!isLocal || voiceTab === 'select') && (
        <button className="w-full rounded-xl bg-[#1A8FE3] hover:bg-[#1680d0] active:bg-[#1472bc] py-2.5 text-sm font-semibold text-white shadow-sm transition-all duration-150 active:scale-[0.99] disabled:opacity-50 disabled:cursor-not-allowed"
          onClick={() => {
            const audio = vcInputMode === 'upload' ? vcFile : vcRecordedFile;
            if (audio) onHandleVoiceConvert(audio);
          }}
          disabled={status === 'processing' || status === 'recording' || (vcInputMode === 'upload' ? !vcFile : !vcRecordedFile)}>
          {status === 'processing' ? '处理中...' : '开始转换'}
        </button>
      )}

      {(!isLocal || voiceTab === 'select') && (
        <HowToSteps steps={
          selectedProvider === 'seed_vc' ? VC_STEPS_SEED_VC :
          selectedProvider === 'local_rvc' ? VC_STEPS_RVC :
          VC_STEPS
        } />
      )}

    </section>
  );
}
