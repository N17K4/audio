import type { Status, MediaAction } from '../../types';
import OutputDirRow from '../shared/OutputDirRow';

interface MediaPanelProps {
  mediaFile: File | null;
  setMediaFile: (v: File | null) => void;
  mediaAction: MediaAction;
  setMediaAction: (v: MediaAction) => void;
  mediaOutputFormat: string;
  setMediaOutputFormat: (v: string) => void;
  mediaStartTime: string;
  setMediaStartTime: (v: string) => void;
  mediaDuration: string;
  setMediaDuration: (v: string) => void;
  outputDir: string;
  setOutputDir: (v: string) => void;
  status: Status;
  onRunMediaConvert: () => void;
  fieldCls: string;
  fileCls: string;
  labelCls: string;
  btnSec: string;
}

export default function MediaPanel({
  mediaFile,
  setMediaFile,
  mediaAction,
  setMediaAction,
  mediaOutputFormat,
  setMediaOutputFormat,
  mediaStartTime,
  setMediaStartTime,
  mediaDuration,
  setMediaDuration,
  outputDir,
  setOutputDir,
  status,
  onRunMediaConvert,
  fieldCls,
  fileCls,
  labelCls,
  btnSec,
}: MediaPanelProps) {
  return (
    <section className="rounded-2xl border border-slate-200/80 bg-white p-6 shadow-panel space-y-5 dark:bg-slate-900 dark:border-slate-700/80">

      {/* 操作选择 */}
      <div>
        <span className={labelCls}>操作类型</span>
        <div className="flex rounded-xl border border-slate-200 dark:border-slate-700 overflow-hidden text-sm bg-slate-50/50 dark:bg-slate-800/50">
          {([
            { value: 'convert',       label: '格式转换' },
            { value: 'extract_audio', label: '提取音频' },
            { value: 'clip',          label: '截取片段' },
          ] as { value: MediaAction; label: string }[]).map(opt => (
            <button key={opt.value}
              className={`flex-1 py-2 text-sm font-medium transition-all ${mediaAction === opt.value ? 'bg-slate-800 dark:bg-slate-600 text-white shadow-sm' : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 hover:bg-slate-100 dark:hover:bg-slate-700 dark:hover:text-slate-200'}`}
              onClick={() => setMediaAction(opt.value)}>
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* 输入文件 */}
      <label className="block">
        <span className={labelCls}>
          {mediaAction === 'extract_audio' ? '视频文件' : '输入文件'}
        </span>
        <input className={fileCls} type="file"
          accept={mediaAction === 'extract_audio'
            ? 'video/*,audio/*'
            : 'audio/*,video/*,.mp3,.wav,.m4a,.mp4,.mov,.avi,.mkv,.flac,.ogg'}
          onChange={e => setMediaFile(e.target.files?.[0] || null)} />
        {mediaFile && <p className="text-xs text-slate-400 mt-1.5">{mediaFile.name}（{Math.round(mediaFile.size / 1024)} KB）</p>}
      </label>

      {/* 输出格式 */}
      <label className="block">
        <span className={labelCls}>输出格式</span>
        <select className={fieldCls} value={mediaOutputFormat} onChange={e => setMediaOutputFormat(e.target.value)}>
          <option value="mp3">MP3</option>
          <option value="wav">WAV</option>
          <option value="m4a">M4A</option>
        </select>
      </label>

      {/* 截取参数（仅 clip 模式） */}
      {mediaAction === 'clip' && (
        <div className="flex gap-3 flex-wrap">
          <label className="flex-1 min-w-[120px]">
            <span className={labelCls}>开始时间</span>
            <input className={fieldCls} value={mediaStartTime}
              onChange={e => setMediaStartTime(e.target.value)}
              placeholder="00:00:30" />
            <span className="text-xs text-slate-400 mt-1 block">格式：HH:MM:SS 或秒数</span>
          </label>
          <label className="flex-1 min-w-[120px]">
            <span className={labelCls}>持续时长（可选）</span>
            <input className={fieldCls} value={mediaDuration}
              onChange={e => setMediaDuration(e.target.value)}
              placeholder="00:01:00" />
            <span className="text-xs text-slate-400 mt-1 block">留空则截取到结尾</span>
          </label>
        </div>
      )}

      <OutputDirRow outputDir={outputDir} setOutputDir={setOutputDir} fieldCls={fieldCls} labelCls={labelCls} btnSec={btnSec} />

      <button className="w-full rounded-xl bg-teal-600 hover:bg-teal-700 active:bg-teal-800 py-2.5 text-sm font-semibold text-white shadow-sm transition-all duration-150 active:scale-[0.99] disabled:opacity-60 disabled:cursor-not-allowed"
        onClick={onRunMediaConvert} disabled={status === 'processing' || !mediaFile}>
        {status === 'processing' ? '处理中...' : '开始转换'}
      </button>
    </section>
  );
}
