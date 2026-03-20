'use client';

import ComboSelect from '../../shared/ComboSelect';
import FileDrop from '../../shared/FileDrop';
import ProcessFlow from '../../shared/ProcessFlow';
import OutputDirRow from '../../shared/OutputDirRow';
import type { Status } from '../../../types';
import {
  VIDEO_GEN_PROVIDERS, VIDEO_GEN_PROVIDER_LABELS, VIDEO_GEN_MODELS, VIDEO_GEN_DURATIONS,
  LOCAL_PROVIDERS, UNSUPPORTED_PROVIDERS,
} from '../../../constants';
import { VIDEO_GEN_FLOW_LOCAL, VIDEO_GEN_FLOW_CLOUD } from '../../../constants/flows';

const PILL_BASE = 'rounded-xl border px-2 py-2 text-xs font-medium transition-all text-center leading-tight';
const PILL_ON  = 'border-violet-400 bg-violet-50 text-violet-700 dark:bg-violet-900/30 dark:border-violet-500 dark:text-violet-300';
const PILL_OFF = 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400 hover:border-slate-300 dark:hover:border-slate-600 hover:bg-slate-50 dark:hover:bg-slate-800/50';
const btnPrimary = 'w-full rounded-xl bg-violet-600 hover:bg-violet-700 disabled:opacity-50 px-4 py-2.5 text-sm font-semibold text-white transition-colors';

function shortProv(label: string): string {
  return label.replace(/（[^）]*）/g, '').replace(/【[^】]*】/g, '').trim();
}

interface VideoGenSectionProps {
  status: Status;
  apiKey: string;
  setApiKey: (k: string) => void;
  videoGenProvider: string;
  onVideoGenProviderChange: (p: string) => void;
  videoGenPrompt: string;
  setVideoGenPrompt: (t: string) => void;
  videoGenModel: string;
  setVideoGenModel: (m: string) => void;
  videoGenDuration: number;
  setVideoGenDuration: (d: number) => void;
  videoGenMode: 't2v' | 'i2v';
  setVideoGenMode: (m: 't2v' | 'i2v') => void;
  videoGenImageFile: File | null;
  setVideoGenImageFile: (f: File | null) => void;
  onRunVideoGen: () => void;
  outputDir: string;
  setOutputDir: (v: string) => void;
  labelCls: string;
  fieldCls: string;
  btnSec: string;
}

export default function VideoGenSection({
  status, apiKey, setApiKey,
  videoGenProvider, onVideoGenProviderChange,
  videoGenPrompt, setVideoGenPrompt,
  videoGenModel, setVideoGenModel,
  videoGenDuration, setVideoGenDuration,
  videoGenMode, setVideoGenMode,
  videoGenImageFile, setVideoGenImageFile,
  onRunVideoGen,
  outputDir, setOutputDir,
  labelCls, fieldCls, btnSec,
}: VideoGenSectionProps) {
  const busy = status === 'processing';
  const isLocal = LOCAL_PROVIDERS.has(videoGenProvider);
  const isUnsupported = UNSUPPORTED_PROVIDERS.has(videoGenProvider);
  const models = VIDEO_GEN_MODELS[videoGenProvider] || [];
  const durations = VIDEO_GEN_DURATIONS[videoGenProvider] || [5];
  const supportsI2v = videoGenProvider === 'kling' || videoGenProvider === 'wan_local' || videoGenProvider === 'wan_video' || videoGenProvider === 'runway';

  return (
    <div className="rounded-2xl border border-slate-200/80 dark:border-slate-700/80 bg-white dark:bg-slate-900 shadow-panel p-5 space-y-4">
      {isLocal
        ? <ProcessFlow steps={VIDEO_GEN_FLOW_LOCAL} color="#0f766e" />
        : <ProcessFlow steps={VIDEO_GEN_FLOW_CLOUD} color="#0f766e" />}
      <div>
        <label className={labelCls}>服务商</label>
        <div className="grid grid-cols-3 gap-2">
          {VIDEO_GEN_PROVIDERS.map(p => (
            <button key={p} onClick={() => onVideoGenProviderChange(p)} className={`${PILL_BASE} ${videoGenProvider === p ? PILL_ON : PILL_OFF}`}>
              {shortProv(VIDEO_GEN_PROVIDER_LABELS[p] || p)}
            </button>
          ))}
        </div>
        {videoGenProvider === 'wan_local' && <p className="mt-1.5 text-xs text-sky-600 dark:text-sky-400">本地运行，无需 API Key，首次需下载模型（约 6 GB）</p>}
        {videoGenProvider === 'kling' && <p className="mt-1.5 text-xs text-slate-400 dark:text-slate-500">快手可灵（klingai.com）。API Key 直接粘贴官方格式：Access Key: xxx Secret Key: xxx</p>}
        {(videoGenProvider === 'wan_video' || videoGenProvider === 'runway' || videoGenProvider === 'pika' || videoGenProvider === 'sora') && <p className="mt-1.5 text-xs text-amber-500">暂不支持，敬请期待</p>}
      </div>
      {!isLocal && (
        <div>
          <label className={labelCls}>API Key</label>
          <input className={fieldCls} type="password" value={apiKey} onChange={e => setApiKey(e.target.value)}
            placeholder={videoGenProvider === 'kling' ? '粘贴：Access Key: xxx Secret Key: xxx' : 'sk-... / Bearer ...'} />
        </div>
      )}
      <div>
        <label className={labelCls}>模型</label>
        <ComboSelect
          value={videoGenModel}
          onChange={setVideoGenModel}
          options={models.map(m => ({ value: m, label: m }))}
          placeholder={models[0] ? `默认：${models[0]}` : '输入模型名称'}
          allowCustom
        />
        {videoGenModel === 'Wan2.1-T2V-1.3B' && <p className="mt-1.5 text-xs text-slate-400 dark:text-slate-500">文生视频（T2V），1.3B 轻量本地版</p>}
        {videoGenModel === 'Wan2.1-I2V-1.3B' && <p className="mt-1.5 text-xs text-slate-400 dark:text-slate-500">图生视频（I2V），需配合上方参考图片使用</p>}
        {videoGenModel === 'kling-v2' && <p className="mt-1.5 text-xs text-slate-400 dark:text-slate-500">可灵最新版，画质最佳</p>}
        {videoGenModel === 'kling-v1-5' && <p className="mt-1.5 text-xs text-slate-400 dark:text-slate-500">可灵 v1.5，速度与质量平衡</p>}
      </div>
      {supportsI2v && (
        <div>
          <label className={labelCls}>生成模式</label>
          <div className="flex gap-2">
            {(['t2v', 'i2v'] as const).map(mode => (
              <button key={mode} onClick={() => setVideoGenMode(mode)}
                className={`flex-1 rounded-xl border py-2 text-sm font-medium transition-all ${
                  videoGenMode === mode
                    ? 'border-violet-400 bg-violet-50 text-violet-700 dark:bg-violet-900/30 dark:text-violet-300'
                    : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400'
                }`}>
                {mode === 't2v' ? '文字生视频' : '图片生视频'}
              </button>
            ))}
          </div>
        </div>
      )}
      {videoGenMode === 'i2v' && (
        <div>
          <label className={labelCls}>参考图片</label>
          <FileDrop
            files={videoGenImageFile ? [videoGenImageFile] : []}
            onAdd={fs => setVideoGenImageFile(fs[0])}
            onRemove={() => setVideoGenImageFile(null)}
            accept="image/*"
            compact
            iconType="image"
            emptyLabel="点击或拖拽参考图片"
          />
        </div>
      )}
      <div>
        <label className={labelCls}>时长（秒）</label>
        <ComboSelect
          value={String(videoGenDuration)}
          onChange={v => setVideoGenDuration(Number(v))}
          options={durations.map(d => ({ value: String(d), label: `${d} 秒` }))}
          placeholder="选择时长"
        />
      </div>
      <div>
        <label className={labelCls}>视频描述（提示词）</label>
        <textarea rows={4} className={fieldCls} value={videoGenPrompt} onChange={e => setVideoGenPrompt(e.target.value)} placeholder="描述视频内容和动作，越详细越好..." />
      </div>
      <OutputDirRow required outputDir={outputDir} setOutputDir={setOutputDir} fieldCls={fieldCls} labelCls={labelCls} btnSec={btnSec} />
      <button
        className={btnPrimary}
        disabled={busy || isUnsupported || (!videoGenPrompt.trim() && videoGenMode === 't2v') || (!videoGenImageFile && videoGenMode === 'i2v')}
        onClick={onRunVideoGen}>
        {busy ? '生成中...' : isUnsupported ? '暂不支持' : '生成视频'}
      </button>
    </div>
  );
}
