import { useState } from 'react';
import type { Status, VoiceInfo, CapabilityMap, VcInputMode } from '../../types';
import { LOCAL_PROVIDERS } from '../../constants';
import ProviderRow from '../shared/ProviderRow';
import OutputDirRow from '../shared/OutputDirRow';
import ModelInput from '../shared/ModelInput';
import FileDrop from '../shared/FileDrop';
import VoiceSelector from '../shared/VoiceSelector';
import CreateVoicePanel from '../shared/CreateVoicePanel';
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

// ─── GPT-SoVITS 本地 TTS 流程 ─────────────────────────────────────────────────
const TTS_FLOW_GPT_SOVITS: FlowStep[] = [
  { label: '文字输入' },
  { label: '分词/G2P',    tech: 'Tokenizer' },
  { label: '语义预测',    tech: 'GPT 模型' },
  { label: '参考音色',    tech: '声纹提取' },
  { label: '声学合成',    tech: 'SoVITS VITS' },
  { label: '音频输出' },
];

// ─── CosyVoice 2 本地 TTS 流程 ───────────────────────────────────────────────
const TTS_FLOW_COSYVOICE: FlowStep[] = [
  { label: '文字输入' },
  { label: '文本编码',    tech: 'LLM Encoder' },
  { label: '参考音色',    tech: 'Speaker Embedding' },
  { label: 'Flow 解码',   tech: 'Flow Matching' },
  { label: '声码器',      tech: 'HiFi-GAN' },
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
  voices: VoiceInfo[];
  ttsVoiceId: string;
  setTtsVoiceId: (v: string) => void;
  onRefreshVoices: () => void;
  onRenameVoice: (voiceId: string, newName: string) => void;
  onDeleteVoice: (voiceId: string) => void;
  // GPT-SoVITS 高级参数
  gptSovitsTextLang: string;
  setGptSovitsTextLang: (v: string) => void;
  gptSovitsPromptLang: string;
  setGptSovitsPromptLang: (v: string) => void;
  gptSovitsRefText: string;
  setGptSovitsRefText: (v: string) => void;
  gptSovitsTopK: number;
  setGptSovitsTopK: (v: number) => void;
  gptSovitsTopP: number;
  setGptSovitsTopP: (v: number) => void;
  gptSovitsTemperature: number;
  setGptSovitsTemperature: (v: number) => void;
  gptSovitsSpeed: number;
  setGptSovitsSpeed: (v: number) => void;
  gptSovitsRepetitionPenalty: number;
  setGptSovitsRepetitionPenalty: (v: number) => void;
  gptSovitsSeed: number;
  setGptSovitsSeed: (v: number) => void;
  gptSovitsTextSplitMethod: string;
  setGptSovitsTextSplitMethod: (v: string) => void;
  gptSovitsBatchSize: number;
  setGptSovitsBatchSize: (v: number) => void;
  gptSovitsParallelInfer: boolean;
  setGptSovitsParallelInfer: (v: boolean) => void;
  gptSovitsFragmentInterval: number;
  setGptSovitsFragmentInterval: (v: number) => void;
  gptSovitsSampleSteps: number;
  setGptSovitsSampleSteps: (v: number) => void;
  // 导入音色
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
  setNewVoiceGptModel: (v: File | null) => void;
  setNewVoiceSovitsModel: (v: File | null) => void;
  newVoiceRefText: string;
  setNewVoiceRefText: (v: string) => void;
  onCreateVoice: () => void;
  // 训练
  trainVoiceName: string;
  setTrainVoiceName: (v: string) => void;
  trainFiles: File[];
  setTrainFiles: (v: File[]) => void;
  onStartTraining: () => void;
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
  voices,
  ttsVoiceId,
  setTtsVoiceId,
  onRefreshVoices,
  onRenameVoice,
  onDeleteVoice,
  gptSovitsTextLang,
  setGptSovitsTextLang,
  gptSovitsPromptLang,
  setGptSovitsPromptLang,
  gptSovitsRefText,
  setGptSovitsRefText,
  gptSovitsTopK,
  setGptSovitsTopK,
  gptSovitsTopP,
  setGptSovitsTopP,
  gptSovitsTemperature,
  setGptSovitsTemperature,
  gptSovitsSpeed,
  setGptSovitsSpeed,
  gptSovitsRepetitionPenalty,
  setGptSovitsRepetitionPenalty,
  gptSovitsSeed,
  setGptSovitsSeed,
  gptSovitsTextSplitMethod,
  setGptSovitsTextSplitMethod,
  gptSovitsBatchSize,
  setGptSovitsBatchSize,
  gptSovitsParallelInfer,
  setGptSovitsParallelInfer,
  gptSovitsFragmentInterval,
  setGptSovitsFragmentInterval,
  gptSovitsSampleSteps,
  setGptSovitsSampleSteps,
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
  setNewVoiceGptModel,
  setNewVoiceSovitsModel,
  newVoiceRefText,
  setNewVoiceRefText,
  onCreateVoice,
  trainVoiceName,
  setTrainVoiceName,
  trainFiles,
  setTrainFiles,
  onStartTraining,
  outputDir,
  setOutputDir,
  status,
  onRunTts,
  fieldCls,
  fileCls,
  labelCls,
  btnSec,
}: TtsPanelProps) {
  const gptSovitsVoices = voices.filter(v => v.engine === 'gpt_sovits');
  const isGptSovits = selectedProvider === 'gpt_sovits';

  // GPT-SoVITS 3タブ
  const [voiceTab, setVoiceTab] = useState<'select' | 'import' | 'train'>('select');
  // 高级参数折叠
  const [showAdvanced, setShowAdvanced] = useState(false);
  // 改名状态
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
      {selectedProvider === 'fish_speech'
        ? <ProcessFlow steps={TTS_FLOW_FISH} color="#f59e0b" />
        : selectedProvider === 'gpt_sovits'
        ? <ProcessFlow steps={TTS_FLOW_GPT_SOVITS} color="#10b981" />
        : selectedProvider === 'cosyvoice'
        ? <ProcessFlow steps={TTS_FLOW_COSYVOICE} color="#8b5cf6" />
        : <ProcessFlow steps={TTS_FLOW_CLOUD} color="#6366f1" />}

      {/* ─── GPT-SoVITS 3タブ UI ──────────────────────────────────────────── */}
      {isGptSovits ? (
        <div className="space-y-4">
          {/* タブ切替 */}
          <div className="flex rounded-xl border border-slate-200 dark:border-slate-700 overflow-hidden text-sm bg-slate-50/50 dark:bg-slate-800/50">
            {([['select', '选择音色'], ['import', '导入音色'], ['train', '训练音色']] as const).map(([tab, label]) => (
              <button key={tab}
                className={`flex-1 py-2 text-sm font-medium transition-all ${voiceTab === tab ? 'bg-slate-800 dark:bg-slate-600 text-white shadow-sm' : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 hover:bg-slate-100 dark:hover:bg-slate-700 dark:hover:text-slate-200'}`}
                onClick={() => {
                  if (tab === 'import') setNewVoiceEngine('gpt_sovits');
                  setVoiceTab(tab);
                }}>
                {label}
              </button>
            ))}
          </div>

          {/* 选择音色タブ */}
          {voiceTab === 'select' && (
            <div className="space-y-3">
              <VoiceSelector
                label="音色模型（GPT-SoVITS 训练模型）"
                value={ttsVoiceId}
                onChange={v => { setTtsVoiceId(v); setRenamingId(null); }}
                voices={gptSovitsVoices}
                onRefresh={onRefreshVoices}
                fieldCls={fieldCls}
                labelCls={labelCls}
                btnSec={btnSec}
              />
              {/* 改名/删除 */}
              {ttsVoiceId && (
                renamingId === ttsVoiceId ? (
                  <div className="flex gap-2">
                    <input
                      className={`flex-1 ${fieldCls}`}
                      value={renameValue}
                      onChange={e => setRenameValue(e.target.value)}
                      onKeyDown={e => {
                        if (e.key === 'Enter' && renameValue.trim()) { onRenameVoice(ttsVoiceId, renameValue.trim()); setRenamingId(null); }
                        else if (e.key === 'Escape') setRenamingId(null);
                      }}
                      autoFocus
                      placeholder="输入新名称"
                    />
                    <button className="rounded-xl bg-[#1A8FE3] hover:bg-[#1680d0] px-3 py-2 text-xs font-medium text-white transition-colors disabled:opacity-50"
                      disabled={!renameValue.trim()}
                      onClick={() => { onRenameVoice(ttsVoiceId, renameValue.trim()); setRenamingId(null); }}>
                      确认
                    </button>
                    <button className="rounded-xl border border-slate-200 dark:border-slate-600 px-3 py-2 text-xs font-medium text-slate-500 hover:text-slate-700 transition-colors"
                      onClick={() => setRenamingId(null)}>
                      取消
                    </button>
                  </div>
                ) : (
                  <div className="flex justify-end gap-3">
                    {!voices.find(v => v.voice_id === ttsVoiceId)?.is_builtin && (
                      <>
                        <button className="text-xs font-medium text-indigo-500 hover:text-indigo-600 transition-colors"
                          onClick={() => { const v = voices.find(x => x.voice_id === ttsVoiceId); setRenameValue(v?.name || ''); setRenamingId(ttsVoiceId); }}>
                          重命名
                        </button>
                        <button className="text-xs font-medium text-rose-500 hover:text-rose-600 transition-colors"
                          onClick={() => onDeleteVoice(ttsVoiceId)}>
                          删除音色
                        </button>
                      </>
                    )}
                  </div>
                )
              )}
            </div>
          )}

          {/* 导入音色タブ */}
          {voiceTab === 'import' && (
            <CreateVoicePanel
              engine="gpt_sovits"
              newVoiceEngine={newVoiceEngine}
              newVoiceName={newVoiceName}
              creatingVoice={creatingVoice}
              setNewVoiceEngine={setNewVoiceEngine}
              setNewVoiceName={setNewVoiceName}
              setNewVoiceModel={setNewVoiceModel}
              setNewVoiceIndex={setNewVoiceIndex}
              setNewVoiceRef={setNewVoiceRef}
              setNewVoiceGptModel={setNewVoiceGptModel}
              setNewVoiceSovitsModel={setNewVoiceSovitsModel}
              newVoiceRefText={newVoiceRefText}
              setNewVoiceRefText={setNewVoiceRefText}
              setShowCreateVoice={(v) => { if (!v) setVoiceTab('select'); setShowCreateVoice(v); }}
              onCreateVoice={onCreateVoice}
              fieldCls={fieldCls}
              fileCls={fileCls}
              labelCls={labelCls}
            />
          )}

          {/* 训练音色タブ */}
          {voiceTab === 'train' && (
            <div className="space-y-4">
              <label className="block">
                <span className={labelCls}>音色名称</span>
                <input className={fieldCls} value={trainVoiceName} onChange={e => setTrainVoiceName(e.target.value)}
                  placeholder="请输入音色名称（如 my_trained_voice）" />
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
              <button className="w-full rounded-xl bg-slate-700 hover:bg-slate-800 py-2.5 text-sm font-semibold text-white shadow-sm transition-all active:scale-[0.99] disabled:opacity-50 disabled:cursor-not-allowed"
                onClick={onStartTraining}
                disabled={!trainVoiceName.trim() || trainFiles.length === 0}>
                提交训练
              </button>
            </div>
          )}

          {/* ─── 高级参数（折叠） ──────────────────────────────────────────── */}
          <div>
            <button
              className="flex items-center gap-1.5 text-xs font-medium text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition-colors"
              onClick={() => setShowAdvanced(!showAdvanced)}>
              <svg className={`w-3.5 h-3.5 transition-transform ${showAdvanced ? 'rotate-90' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
              高级参数
            </button>
            {showAdvanced && (
              <div className="mt-3 space-y-4 rounded-xl border border-slate-100 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-800/40 p-4">

                {/* ── 语言设置 ── */}
                <div className="text-[10px] font-bold text-slate-300 dark:text-slate-600 uppercase tracking-widest">语言设置</div>
                <div className="grid grid-cols-2 gap-3">
                  <label className="block">
                    <span className={labelCls}>合成文本语言</span>
                    <select className={fieldCls} value={gptSovitsTextLang} onChange={e => setGptSovitsTextLang(e.target.value)}>
                      <option value="auto">自动检测</option>
                      <option value="zh">中文</option>
                      <option value="ja">日语</option>
                      <option value="en">英语</option>
                      <option value="ko">韩语</option>
                      <option value="yue">粤语</option>
                    </select>
                    <span className="text-[10px] text-slate-400 mt-0.5 block">要合成的文本所使用的语言</span>
                  </label>
                  <label className="block">
                    <span className={labelCls}>参考音频语言</span>
                    <select className={fieldCls} value={gptSovitsPromptLang} onChange={e => setGptSovitsPromptLang(e.target.value)}>
                      <option value="auto">自动检测</option>
                      <option value="zh">中文</option>
                      <option value="ja">日语</option>
                      <option value="en">英语</option>
                      <option value="ko">韩语</option>
                      <option value="yue">粤语</option>
                    </select>
                    <span className="text-[10px] text-slate-400 mt-0.5 block">参考音频中说话人所用的语言</span>
                  </label>
                </div>

                {/* 参考音频文本 */}
                <label className="block">
                  <span className={labelCls}>参考音频文本</span>
                  <textarea className={fieldCls} value={gptSovitsRefText} onChange={e => setGptSovitsRefText(e.target.value)}
                    rows={2} placeholder="输入参考音频对应的文本（few-shot 模式必填）" />
                  <span className="text-[10px] text-slate-400 mt-0.5 block">对应参考音频的文字内容，填写后模型能更准确地克隆音色和语调</span>
                </label>

                {/* ── 采样控制 ── */}
                <div className="text-[10px] font-bold text-slate-300 dark:text-slate-600 uppercase tracking-widest pt-2">采样控制</div>

                {/* top_k */}
                <label className="block">
                  <span className={labelCls}>Top-K 采样: {gptSovitsTopK}</span>
                  <input type="range" className="w-full accent-emerald-500" min={1} max={100} step={1}
                    value={gptSovitsTopK} onChange={e => setGptSovitsTopK(Number(e.target.value))} />
                  <span className="text-[10px] text-slate-400 mt-0.5 block">每步只从概率最高的 K 个 token 中采样。值越小输出越稳定，越大越多样。推荐 5–20</span>
                </label>

                {/* top_p */}
                <label className="block">
                  <span className={labelCls}>Top-P 采样: {gptSovitsTopP.toFixed(2)}</span>
                  <input type="range" className="w-full accent-emerald-500" min={0} max={1} step={0.01}
                    value={gptSovitsTopP} onChange={e => setGptSovitsTopP(Number(e.target.value))} />
                  <span className="text-[10px] text-slate-400 mt-0.5 block">核采样（Nucleus Sampling），只保留累计概率达到 P 的 token。1.0 = 不过滤</span>
                </label>

                {/* temperature */}
                <label className="block">
                  <span className={labelCls}>采样温度: {gptSovitsTemperature.toFixed(2)}</span>
                  <input type="range" className="w-full accent-emerald-500" min={0.01} max={2} step={0.01}
                    value={gptSovitsTemperature} onChange={e => setGptSovitsTemperature(Number(e.target.value))} />
                  <span className="text-[10px] text-slate-400 mt-0.5 block">控制随机性：低值（0.1–0.5）输出稳定但可能单调，高值（0.8–1.5）更有表现力但可能不稳定</span>
                </label>

                {/* repetition_penalty */}
                <label className="block">
                  <span className={labelCls}>重复惩罚: {gptSovitsRepetitionPenalty.toFixed(2)}</span>
                  <input type="range" className="w-full accent-emerald-500" min={1.0} max={2.0} step={0.05}
                    value={gptSovitsRepetitionPenalty} onChange={e => setGptSovitsRepetitionPenalty(Number(e.target.value))} />
                  <span className="text-[10px] text-slate-400 mt-0.5 block">抑制重复 token 的生成。1.0 = 无惩罚，1.35 是推荐值。过高可能导致语音不自然</span>
                </label>

                {/* seed */}
                <label className="block">
                  <span className={labelCls}>随机种子</span>
                  <input type="number" className={fieldCls} value={gptSovitsSeed}
                    onChange={e => setGptSovitsSeed(Number(e.target.value))} min={-1} />
                  <span className="text-[10px] text-slate-400 mt-0.5 block">固定种子可复现相同结果。-1 = 每次随机。相同文本+种子 = 相同语音输出</span>
                </label>

                {/* ── 速度 & 音质 ── */}
                <div className="text-[10px] font-bold text-slate-300 dark:text-slate-600 uppercase tracking-widest pt-2">速度 & 音质</div>

                {/* speed */}
                <label className="block">
                  <span className={labelCls}>语速: {gptSovitsSpeed.toFixed(1)}x</span>
                  <input type="range" className="w-full accent-emerald-500" min={0.5} max={2} step={0.1}
                    value={gptSovitsSpeed} onChange={e => setGptSovitsSpeed(Number(e.target.value))} />
                  <span className="text-[10px] text-slate-400 mt-0.5 block">语音播放速度倍率。0.5x = 半速（慢），2.0x = 两倍速（快）</span>
                </label>

                {/* sample_steps */}
                <label className="block">
                  <span className={labelCls}>采样步数 (VITS v3): {gptSovitsSampleSteps}</span>
                  <input type="range" className="w-full accent-emerald-500" min={4} max={100} step={4}
                    value={gptSovitsSampleSteps} onChange={e => setGptSovitsSampleSteps(Number(e.target.value))} />
                  <span className="text-[10px] text-slate-400 mt-0.5 block">SoVITS V3 扩散模型采样迭代次数。步数越多质量越高但速度越慢，推荐 16–32</span>
                </label>

                {/* fragment_interval */}
                <label className="block">
                  <span className={labelCls}>片段间隔: {gptSovitsFragmentInterval.toFixed(2)}s</span>
                  <input type="range" className="w-full accent-emerald-500" min={0.01} max={1} step={0.01}
                    value={gptSovitsFragmentInterval} onChange={e => setGptSovitsFragmentInterval(Number(e.target.value))} />
                  <span className="text-[10px] text-slate-400 mt-0.5 block">分段合成时各段之间的静音间隔（秒）。影响语句之间的停顿时长</span>
                </label>

                {/* ── 文本处理 & 性能 ── */}
                <div className="text-[10px] font-bold text-slate-300 dark:text-slate-600 uppercase tracking-widest pt-2">文本处理 & 性能</div>

                {/* text_split_method */}
                <label className="block">
                  <span className={labelCls}>文本切分方式</span>
                  <select className={fieldCls} value={gptSovitsTextSplitMethod} onChange={e => setGptSovitsTextSplitMethod(e.target.value)}>
                    <option value="cut0">不切分（整段合成）</option>
                    <option value="cut1">按4句一切</option>
                    <option value="cut2">按50字一切</option>
                    <option value="cut3">按中文句号切</option>
                    <option value="cut4">按英文句号切</option>
                    <option value="cut5">按标点符号切（推荐）</option>
                  </select>
                  <span className="text-[10px] text-slate-400 mt-0.5 block">长文本自动切分策略。切分后分段推理再拼接，可提高稳定性和速度</span>
                </label>

                {/* batch_size */}
                <label className="block">
                  <span className={labelCls}>批处理大小: {gptSovitsBatchSize}</span>
                  <input type="range" className="w-full accent-emerald-500" min={1} max={20} step={1}
                    value={gptSovitsBatchSize} onChange={e => setGptSovitsBatchSize(Number(e.target.value))} />
                  <span className="text-[10px] text-slate-400 mt-0.5 block">每次推理处理的文本片段数量。增大可加速（需更多显存），建议根据 GPU 调整</span>
                </label>

                {/* parallel_infer */}
                <label className="flex items-center gap-2">
                  <input type="checkbox" className="w-4 h-4 accent-emerald-500 rounded" checked={gptSovitsParallelInfer}
                    onChange={e => setGptSovitsParallelInfer(e.target.checked)} />
                  <div>
                    <span className="text-xs font-medium text-slate-500 dark:text-slate-400">启用并行推理</span>
                    <span className="text-[10px] text-slate-400 block">允许多段文本同时推理，可显著加速长文本合成</span>
                  </div>
                </label>
              </div>
            )}
          </div>
        </div>
      ) : selectedProvider === 'fish_speech' ? (
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
                  {ttsRecordingDir && (
                    <a href={ttsRefRecordedObjectUrl} download={`tts_ref_recording.webm`}
                      className="flex items-center gap-1.5 rounded-lg border border-slate-200 dark:border-slate-600 bg-slate-50 dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 px-3 py-1.5 text-xs text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 transition-colors">
                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                      </svg>
                      下载录音
                    </a>
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
