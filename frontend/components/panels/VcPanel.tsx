import type { Status, VoiceInfo, CapabilityMap, VcInputMode } from '../../types';
import { LOCAL_PROVIDERS } from '../../constants';
import ProviderRow from '../shared/ProviderRow';
import OutputDirRow from '../shared/OutputDirRow';
import VoiceSelector from '../shared/VoiceSelector';
import CreateVoicePanel from '../shared/CreateVoicePanel';

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
  vcRefAudio: File | null;
  setVcRefAudio: (v: File | null) => void;
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
  outputDir: string;
  setOutputDir: (v: string) => void;
  status: Status;
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
  rvcF0Method: string;
  setRvcF0Method: (v: string) => void;
  rvcFilterRadius: number;
  setRvcFilterRadius: (v: number) => void;
  rvcIndexRate: number;
  setRvcIndexRate: (v: number) => void;
  rvcPitchShift: number;
  setRvcPitchShift: (v: number) => void;
  // Training
  trainVoiceName: string;
  setTrainVoiceName: (v: string) => void;
  trainFile: File | null;
  setTrainFile: (v: File | null) => void;
  trainJobId: string;
  trainJobStatus: string;
  trainProgress: number;
  trainMessage: string;
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
  vcRefAudio,
  setVcRefAudio,
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
  outputDir,
  setOutputDir,
  status,
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
  rvcF0Method,
  setRvcF0Method,
  rvcFilterRadius,
  setRvcFilterRadius,
  rvcIndexRate,
  setRvcIndexRate,
  rvcPitchShift,
  setRvcPitchShift,
  trainVoiceName,
  setTrainVoiceName,
  trainFile,
  setTrainFile,
  trainJobId,
  trainJobStatus,
  trainProgress,
  trainMessage,
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

      {selectedProvider === 'seed_vc' ? (
        <label className="block">
          <span className="block text-xs font-medium text-slate-400 mb-1.5 uppercase tracking-wide">目标音色（音频样本）</span>
          <input className="w-full rounded-xl border border-slate-200 bg-slate-50/50 px-3.5 py-2.5 text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-indigo-50 file:px-3 file:py-1 file:text-xs file:font-medium file:text-indigo-700 hover:file:bg-indigo-100 transition-all" type="file" accept="audio/*"
            onChange={e => setVcRefAudio(e.target.files?.[0] || null)} />
          {vcRefAudio && <p className="text-xs text-slate-400 mt-1.5">{vcRefAudio.name}（{Math.round(vcRefAudio.size / 1024)} KB）</p>}
        </label>
      ) : isLocal ? (
        <>
          <VoiceSelector label="目标音色（RVC 模型）" value={selectedVoiceId} onChange={setSelectedVoiceId} voices={voices} onRefresh={onRefreshVoices} fieldCls={fieldCls} labelCls={labelCls} btnSec={btnSec} />
          <div className="flex justify-end">
            <button className="text-xs font-medium text-indigo-600 hover:text-indigo-700 transition-colors"
              onClick={() => { setNewVoiceEngine('rvc'); setShowCreateVoice(!showCreateVoice); }}>
              + 新建音色
            </button>
          </div>
          {showCreateVoice && (
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
              setShowCreateVoice={setShowCreateVoice}
              onCreateVoice={onCreateVoice}
              fieldCls={fieldCls}
              labelCls={labelCls}
            />
          )}
        </>
      ) : (
        <label className="block">
          <span className="block text-xs font-medium text-slate-400 mb-1.5 uppercase tracking-wide">音色 ID</span>
          <input className="w-full rounded-xl border border-slate-200 bg-slate-50/50 px-3.5 py-2.5 text-sm text-slate-800 placeholder:text-slate-400 focus:border-indigo-400 focus:bg-white focus:ring-2 focus:ring-indigo-500/15 transition-all"
            value={selectedVoiceId} onChange={e => setSelectedVoiceId(e.target.value)} placeholder="ElevenLabs Voice ID" />
        </label>
      )}

      {/* 输入音频 */}
      <div className="space-y-3">
        <span className="block text-xs font-medium text-slate-400 uppercase tracking-wide">输入音频</span>
        <div className="flex rounded-xl border border-slate-200 dark:border-slate-700 overflow-hidden text-sm bg-slate-50/50 dark:bg-slate-800/50">
          {(['upload', 'record'] as VcInputMode[]).map(m => (
            <button key={m}
              className={`flex-1 py-2 text-sm font-medium transition-all ${vcInputMode === m ? 'bg-slate-800 dark:bg-slate-600 text-white shadow-sm' : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 hover:bg-slate-100 dark:hover:bg-slate-700 dark:hover:text-slate-200'}`}
              onClick={() => setVcInputMode(m)}>
              {m === 'record' ? '实时录音' : '上传文件'}
            </button>
          ))}
        </div>
        {vcInputMode === 'upload' ? (
          <div className="space-y-3">
            <input className="w-full rounded-xl border border-slate-200 bg-slate-50/50 px-3.5 py-2.5 text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-indigo-50 file:px-3 file:py-1 file:text-xs file:font-medium file:text-indigo-700 hover:file:bg-indigo-100 transition-all" type="file" accept="audio/*"
              onChange={e => setVcFile(e.target.files?.[0] || null)} />
            {vcFile && <p className="text-xs text-slate-400">{vcFile.name}（{Math.round(vcFile.size / 1024)} KB）</p>}
            <button className="w-full rounded-xl bg-indigo-600 hover:bg-indigo-700 active:bg-indigo-800 py-2.5 text-sm font-semibold text-white shadow-sm hover:shadow-button-primary transition-all duration-150 active:scale-[0.99] disabled:opacity-50 disabled:cursor-not-allowed"
              onClick={() => vcFile && onHandleVoiceConvert(vcFile)} disabled={status === 'processing' || !vcFile}>
              {status === 'processing' ? '处理中...' : '开始转换'}
            </button>
          </div>
        ) : (
          <div className="flex gap-2">
            {status === 'idle' && (
              <button className="flex-1 rounded-xl bg-indigo-600 hover:bg-indigo-700 py-2.5 text-sm font-semibold text-white shadow-sm transition-all active:scale-[0.99]" onClick={onStartVcRecording}>开始录音</button>
            )}
            {status === 'recording' && (
              <button className="flex-1 rounded-xl bg-rose-600 hover:bg-rose-700 py-2.5 text-sm font-semibold text-white shadow-sm animate-pulse transition-all" onClick={onStopVcRecording}>停止录音</button>
            )}
            {status === 'processing' && <span className="text-sm text-slate-400 py-2 opacity-0 pointer-events-none">处理中...</span>}
          </div>
        )}
      </div>

      <OutputDirRow required outputDir={outputDir} setOutputDir={setOutputDir} fieldCls={fieldCls} labelCls={labelCls} btnSec={btnSec} />

      {/* 高级设置（折叠） */}
      <details className="border border-slate-200/80 dark:border-slate-700/80 rounded-2xl overflow-hidden dark:bg-slate-900">
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
                <span className="text-xs text-slate-400 mt-1 block">降噪迭代次数，步数越多细节越丰富但越慢。快速预览用 5 步，正式输出用 15～20 步，默认 10</span>
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
                    className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${seedVcF0Condition ? 'bg-indigo-600' : 'bg-slate-300 dark:bg-slate-600'}`}
                    onClick={() => setSeedVcF0Condition(!seedVcF0Condition)}>
                    <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${seedVcF0Condition ? 'translate-x-6' : 'translate-x-1'}`} />
                  </button>
                </div>
                <p className="text-xs text-slate-400">开启后模型会保留原始音频的音调走势（语调起伏）。适合说话/朗读场景；转换歌声时建议关闭，避免音调被锁死</p>
              </div>
              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <span className={labelCls + ' mb-0'}>音频美化</span>
                  <button
                    className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${seedVcEnablePostprocess ? 'bg-indigo-600' : 'bg-slate-300 dark:bg-slate-600'}`}
                    onClick={() => setSeedVcEnablePostprocess(!seedVcEnablePostprocess)}>
                    <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${seedVcEnablePostprocess ? 'translate-x-6' : 'translate-x-1'}`} />
                  </button>
                </div>
                <p className="text-xs text-slate-400">对输出做峰值归一化（统一响度）和高通滤波（消除低频底噪）。一般保持开启；需要原始输出用于后期处理时可关闭</p>
              </div>
            </>
          )}
          {selectedProvider === 'local_rvc' && (
            <>
              <label className="block">
                <span className={labelCls}>F0 提取方法</span>
                <select className={fieldCls} value={rvcF0Method} onChange={e => setRvcF0Method(e.target.value)}>
                  <option value="rmvpe">rmvpe（推荐）</option>
                  <option value="harvest">harvest</option>
                  <option value="pm">pm（最快）</option>
                </select>
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
            </>
          )}
          {selectedProvider !== 'seed_vc' && selectedProvider !== 'local_rvc' && (
            <p className="text-xs text-slate-400">当前服务商暂无高级参数</p>
          )}
        </div>
      </details>

      {/* 训练（折叠） */}
      <details className="border border-slate-200/80 dark:border-slate-700/80 rounded-2xl overflow-hidden dark:bg-slate-900">
        <summary className="text-sm font-medium text-slate-500 dark:text-slate-400 cursor-pointer px-5 py-3.5 hover:bg-slate-50 dark:hover:bg-slate-800 hover:text-slate-700 dark:hover:text-slate-200 transition-colors list-none flex items-center justify-between">
          <span>RVC 音色训练</span>
          <svg className="w-4 h-4 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </summary>
        <div className="px-5 pb-5 pt-3 space-y-4 border-t border-slate-100 dark:border-slate-800">
          <label className="block">
            <span className={labelCls}>音色名称</span>
            <input className={fieldCls} value={trainVoiceName} onChange={e => setTrainVoiceName(e.target.value)} placeholder="我的音色" />
          </label>
          <label className="block">
            <span className={labelCls}>训练数据集（ZIP 压缩包或单个音频文件）</span>
            <input className={`${fileCls} w-full`} type="file" accept=".zip,.wav,.mp3,.flac,.ogg,.m4a"
              onChange={e => setTrainFile(e.target.files?.[0] || null)} />
            <span className="text-xs text-slate-400 mt-1 block">建议提供 5-30 分钟本人语音，打包成 ZIP 上传效果最佳</span>
          </label>

          {/* 高级设置 */}
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

          {/* 进度 */}
          {trainJobStatus && (
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-xs text-slate-500">
                <span>状态：{trainJobStatus}</span>
                {trainProgress > 0 && trainProgress < 100 && (
                  <span>{trainProgress}%</span>
                )}
              </div>
              {trainProgress > 0 && trainProgress < 100 && (
                <div className="w-full bg-slate-100 dark:bg-slate-700 rounded-full h-1.5 overflow-hidden">
                  <div className="bg-indigo-500 h-full rounded-full transition-all duration-500" style={{ width: `${trainProgress}%` }} />
                </div>
              )}
              {trainMessage && (
                <p className="text-xs text-slate-400 truncate">{trainMessage}</p>
              )}
            </div>
          )}

          <button
            className="w-full rounded-xl bg-slate-700 hover:bg-slate-800 py-2.5 text-sm font-semibold text-white shadow-sm transition-all active:scale-[0.99] disabled:opacity-50 disabled:cursor-not-allowed"
            onClick={onStartTraining}
            disabled={trainJobStatus === 'running' || trainJobStatus === '排队中'}
          >
            {trainJobStatus === 'running' ? '训练中...' : trainJobStatus === '排队中' ? '排队中...' : '提交训练'}
          </button>
        </div>
      </details>
    </section>
  );
}
