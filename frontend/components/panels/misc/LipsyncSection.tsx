'use client';

import ComboSelect from '../../shared/ComboSelect';
import FileDrop from '../../shared/FileDrop';
import ProcessFlow from '../../shared/ProcessFlow';
import OutputDirRow from '../../shared/OutputDirRow';
import type { Status } from '../../../types';
import {
  LIPSYNC_PROVIDERS, LIPSYNC_PROVIDER_LABELS, LIPSYNC_MODELS,
  LOCAL_PROVIDERS, UNSUPPORTED_PROVIDERS,
} from '../../../constants';
import { LIPSYNC_FLOWS } from '../../../constants/flows';

const PILL_BASE = 'rounded-xl border px-2 py-2 text-xs font-medium transition-all text-center leading-tight';
const PILL_ON  = 'border-violet-400 bg-violet-50 text-violet-700 dark:bg-violet-900/30 dark:border-violet-500 dark:text-violet-300';
const PILL_OFF = 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400 hover:border-slate-300 dark:hover:border-slate-600 hover:bg-slate-50 dark:hover:bg-slate-800/50';
const btnPrimary = 'w-full rounded-xl bg-violet-600 hover:bg-violet-700 disabled:opacity-50 px-4 py-2.5 text-sm font-semibold text-white transition-colors';

function shortProv(label: string): string {
  return label.replace(/（[^）]*）/g, '').replace(/【[^】]*】/g, '').trim();
}

interface LipsyncSectionProps {
  status: Status;
  apiKey: string;
  setApiKey: (k: string) => void;
  lipsyncProvider: string;
  onLipsyncProviderChange: (p: string) => void;
  lipsyncVideoFile: File | null;
  setLipsyncVideoFile: (f: File | null) => void;
  lipsyncAudioFile: File | null;
  setLipsyncAudioFile: (f: File | null) => void;
  lipsyncModel: string;
  setLipsyncModel: (m: string) => void;
  lipsyncLocalUrl: string;
  setLipsyncLocalUrl: (u: string) => void;
  onRunLipsync: () => void;
  outputDir: string;
  setOutputDir: (v: string) => void;
  labelCls: string;
  fieldCls: string;
  btnSec: string;
}

export default function LipsyncSection({
  status, apiKey, setApiKey,
  lipsyncProvider, onLipsyncProviderChange,
  lipsyncVideoFile, setLipsyncVideoFile,
  lipsyncAudioFile, setLipsyncAudioFile,
  lipsyncModel, setLipsyncModel,
  onRunLipsync,
  outputDir, setOutputDir,
  labelCls, fieldCls, btnSec,
}: LipsyncSectionProps) {
  const busy = status === 'processing';
  const isLocal = LOCAL_PROVIDERS.has(lipsyncProvider);
  const isUnsupported = UNSUPPORTED_PROVIDERS.has(lipsyncProvider);
  const models = LIPSYNC_MODELS[lipsyncProvider] || [];

  return (
    <div className="rounded-2xl border border-slate-200/80 dark:border-slate-700/80 bg-white dark:bg-slate-900 shadow-panel p-5 space-y-4">
      <div>
        <label className={labelCls}>服务商</label>
        <div className="grid grid-cols-2 gap-2">
          {LIPSYNC_PROVIDERS.map(p => (
            <button key={p} onClick={() => onLipsyncProviderChange(p)} className={`${PILL_BASE} ${lipsyncProvider === p ? PILL_ON : PILL_OFF}`}>
              {shortProv(LIPSYNC_PROVIDER_LABELS[p] || p)}
            </button>
          ))}
        </div>
        {lipsyncProvider === 'liveportrait' && <p className="mt-1.5 text-xs text-sky-600 dark:text-sky-400">本地运行，用驱动视频的表情/动作生成人物动画，无需 API Key</p>}
        {(lipsyncProvider === 'sadtalker' || lipsyncProvider === 'heygen' || lipsyncProvider === 'did') && <p className="mt-1.5 text-xs text-amber-500">暂不支持，敬请期待</p>}
      </div>
      {/* 实际运行流程 */}
      <ProcessFlow steps={LIPSYNC_FLOWS[lipsyncProvider] || LIPSYNC_FLOWS['liveportrait']} color="#be185d" />
      {!isLocal && (
        <div>
          <label className={labelCls}>API Key</label>
          <input className={fieldCls} type="password" value={apiKey} onChange={e => setApiKey(e.target.value)} placeholder="sk-... / Bearer ..." />
        </div>
      )}
      {models.length > 0 && (
        <div>
          <label className={labelCls}>模型</label>
          <ComboSelect
            value={lipsyncModel}
            onChange={setLipsyncModel}
            options={models.map(m => ({ value: m, label: m }))}
            allowCustom
            placeholder="选择模型"
          />
        </div>
      )}
      <div>
        <label className={labelCls}>
          {lipsyncProvider === 'liveportrait' ? '人物图片（源人脸）' : '视频 / 人物图片（驱动源）'}
        </label>
        <FileDrop
          files={lipsyncVideoFile ? [lipsyncVideoFile] : []}
          onAdd={fs => setLipsyncVideoFile(fs[0])}
          onRemove={() => setLipsyncVideoFile(null)}
          accept={lipsyncProvider === 'liveportrait' ? 'image/*' : 'video/*,image/*'}
          compact
          iconType={lipsyncProvider === 'liveportrait' ? 'image' : 'file'}
          emptyLabel={lipsyncProvider === 'liveportrait' ? '点击或拖拽人物图片' : '点击或拖拽视频/图片'}
        />
      </div>
      <div>
        <label className={labelCls}>
          {lipsyncProvider === 'liveportrait' ? '驱动视频（提供动作/表情）' : '音频文件（目标口型音频）'}
        </label>
        <FileDrop
          files={lipsyncAudioFile ? [lipsyncAudioFile] : []}
          onAdd={fs => setLipsyncAudioFile(fs[0])}
          onRemove={() => setLipsyncAudioFile(null)}
          accept={lipsyncProvider === 'liveportrait' ? 'video/*' : 'audio/*'}
          compact
          iconType={lipsyncProvider === 'liveportrait' ? 'file' : 'audio'}
          emptyLabel={lipsyncProvider === 'liveportrait' ? '点击或拖拽驱动视频' : '点击或拖拽音频文件'}
        />
      </div>
      <OutputDirRow required outputDir={outputDir} setOutputDir={setOutputDir} fieldCls={fieldCls} labelCls={labelCls} btnSec={btnSec} />
      <button className={`${btnPrimary} !bg-teal-600 hover:!bg-teal-700`} disabled={busy || !lipsyncVideoFile || !lipsyncAudioFile || isUnsupported} onClick={onRunLipsync}>
        {busy ? '处理中...' : isUnsupported ? '暂不支持' : '开始口型同步'}
      </button>
    </div>
  );
}
