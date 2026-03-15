import type { Status } from '../../types';
import { VIDEO_GEN_PROVIDERS, VIDEO_GEN_PROVIDER_LABELS, VIDEO_GEN_MODELS, VIDEO_GEN_DURATIONS } from '../../constants';

interface VideoGenPanelProps {
  status: Status;
  apiKey: string;
  setApiKey: (k: string) => void;
  cloudEndpoint: string;
  setCloudEndpoint: (e: string) => void;
  videoGenProvider: string;
  onProviderChange: (p: string) => void;
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
  onRun: () => void;
  fieldCls: string;
  fileCls: string;
  labelCls: string;
}

const btnPrimary = 'w-full rounded-xl bg-violet-600 hover:bg-violet-700 disabled:opacity-50 px-4 py-2.5 text-sm font-semibold text-white transition-colors';

export default function VideoGenPanel({
  status, apiKey, setApiKey, cloudEndpoint, setCloudEndpoint,
  videoGenProvider, onProviderChange,
  videoGenPrompt, setVideoGenPrompt,
  videoGenModel, setVideoGenModel,
  videoGenDuration, setVideoGenDuration,
  videoGenMode, setVideoGenMode,
  videoGenImageFile, setVideoGenImageFile,
  onRun,
  fieldCls, fileCls, labelCls,
}: VideoGenPanelProps) {
  const busy = status === 'processing';
  const models = VIDEO_GEN_MODELS[videoGenProvider] || [];
  const durations = VIDEO_GEN_DURATIONS[videoGenProvider] || [5];
  const supportsI2v = videoGenProvider === 'kling' || videoGenProvider === 'wan_video' || videoGenProvider === 'runway';

  return (
    <div className="rounded-2xl border border-slate-200/80 dark:border-slate-700/80 bg-white dark:bg-slate-900 shadow-panel p-5 space-y-4">
      {/* 服务商下拉 */}
      <div>
        <label className={labelCls}>服务商</label>
        <select className={fieldCls} value={videoGenProvider} onChange={e => onProviderChange(e.target.value)}>
          {VIDEO_GEN_PROVIDERS.map(p => (
            <option key={p} value={p}>{VIDEO_GEN_PROVIDER_LABELS[p] || p}</option>
          ))}
        </select>
      </div>

      {/* API Key */}
      <div>
        <label className={labelCls}>API Key</label>
        <input className={fieldCls} type="password" value={apiKey} onChange={e => setApiKey(e.target.value)}
          placeholder="sk-... / Bearer ..." />
      </div>

      {/* 模型 */}
      {models.length > 0 && (
        <div>
          <label className={labelCls}>模型</label>
          <select className={fieldCls} value={videoGenModel} onChange={e => setVideoGenModel(e.target.value)}>
            {models.map(m => <option key={m} value={m}>{m}</option>)}
          </select>
        </div>
      )}

      {/* 生成模式 */}
      {supportsI2v && (
        <div>
          <label className={labelCls}>生成模式</label>
          <div className="flex gap-2">
            <button
              onClick={() => setVideoGenMode('t2v')}
              className={`flex-1 rounded-xl border py-2 text-sm font-medium transition-all ${
                videoGenMode === 't2v'
                  ? 'border-violet-400 bg-violet-50 text-violet-700 dark:bg-violet-900/30 dark:text-violet-300'
                  : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400'
              }`}>
              文字生视频
            </button>
            <button
              onClick={() => setVideoGenMode('i2v')}
              className={`flex-1 rounded-xl border py-2 text-sm font-medium transition-all ${
                videoGenMode === 'i2v'
                  ? 'border-violet-400 bg-violet-50 text-violet-700 dark:bg-violet-900/30 dark:text-violet-300'
                  : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400'
              }`}>
              图片生视频
            </button>
          </div>
        </div>
      )}

      {/* 参考图片（i2v 模式） */}
      {videoGenMode === 'i2v' && (
        <div>
          <label className={labelCls}>参考图片</label>
          <input type="file" accept="image/*" className={fileCls}
            onChange={e => setVideoGenImageFile(e.target.files?.[0] ?? null)} />
        </div>
      )}

      {/* 时长 */}
      <div>
        <label className={labelCls}>时长（秒）</label>
        <select className={fieldCls} value={videoGenDuration} onChange={e => setVideoGenDuration(Number(e.target.value))}>
          {durations.map(d => <option key={d} value={d}>{d} 秒</option>)}
        </select>
      </div>

      {/* 提示词 */}
      <div>
        <label className={labelCls}>视频描述（提示词）</label>
        <textarea rows={4} className={fieldCls}
          value={videoGenPrompt} onChange={e => setVideoGenPrompt(e.target.value)}
          placeholder="描述视频内容和动作，越详细越好..." />
      </div>

      <button
        className={btnPrimary}
        disabled={busy || (!videoGenPrompt.trim() && videoGenMode === 't2v') || (!videoGenImageFile && videoGenMode === 'i2v')}
        onClick={onRun}>
        {busy ? '生成中...' : '生成视频'}
      </button>
    </div>
  );
}
