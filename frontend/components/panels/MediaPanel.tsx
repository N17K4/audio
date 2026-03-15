import { useEffect } from 'react';
import type { MediaAction } from '../../types';
import type { ClipEndMode } from '../../hooks/useMediaConvert';
import OutputDirRow from '../shared/OutputDirRow';

const AUDIO_FORMATS = [
  { value: 'mp3',  label: 'MP3'  },
  { value: 'wav',  label: 'WAV'  },
  { value: 'flac', label: 'FLAC' },
  { value: 'm4a',  label: 'M4A'  },
  { value: 'aac',  label: 'AAC'  },
  { value: 'ogg',  label: 'OGG'  },
  { value: 'opus', label: 'Opus' },
];

const VIDEO_FORMATS = [
  { value: 'mp4',  label: 'MP4'  },
  { value: 'webm', label: 'WebM' },
  { value: 'mkv',  label: 'MKV'  },
  { value: 'mov',  label: 'MOV'  },
];

const VIDEO_EXTS = new Set(['mp4', 'mov', 'avi', 'mkv', 'webm', 'flv', 'wmv', 'm4v', 'ts', 'mts']);

function isVideoFile(file: File | null) {
  if (!file) return false;
  const ext = file.name.split('.').pop()?.toLowerCase() || '';
  return file.type.startsWith('video/') || VIDEO_EXTS.has(ext);
}

interface MediaPanelProps {
  mediaFile: File | null;
  setMediaFile: (v: File | null) => void;
  mediaAction: MediaAction;
  setMediaAction: (v: MediaAction) => void;
  mediaOutputFormat: string;
  setMediaOutputFormat: (v: string) => void;
  startMin: string;
  setStartMin: (v: string) => void;
  startSec: string;
  setStartSec: (v: string) => void;
  clipEndMode: ClipEndMode;
  setClipEndMode: (v: ClipEndMode) => void;
  durationMin: string;
  setDurationMin: (v: string) => void;
  durationSec: string;
  setDurationSec: (v: string) => void;
  endMin: string;
  setEndMin: (v: string) => void;
  endSec: string;
  setEndSec: (v: string) => void;
  outputDir: string;
  setOutputDir: (v: string) => void;
  status: string;
  onRunMediaConvert: () => void;
  fieldCls: string;
  fileCls: string;
  labelCls: string;
  btnSec: string;
}

function MinSecInput({ minVal, secVal, onMin, onSec }: {
  minVal: string; secVal: string;
  onMin: (v: string) => void; onSec: (v: string) => void;
}) {
  const numCls = 'w-20 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-800/50 px-3 py-2.5 text-sm text-slate-800 dark:text-slate-200 placeholder:text-slate-400 focus:border-indigo-400 focus:ring-2 focus:ring-indigo-500/15 transition-all text-center';
  return (
    <div className="flex items-center gap-2">
      <input className={numCls} type="number" min="0" placeholder="0" value={minVal} onChange={e => onMin(e.target.value)} />
      <span className="text-sm text-slate-500 dark:text-slate-400 shrink-0">分</span>
      <input className={numCls} type="number" min="0" max="59" placeholder="0" value={secVal} onChange={e => onSec(e.target.value)} />
      <span className="text-sm text-slate-500 dark:text-slate-400 shrink-0">秒</span>
    </div>
  );
}

export default function MediaPanel({
  mediaFile, setMediaFile,
  mediaAction, setMediaAction,
  mediaOutputFormat, setMediaOutputFormat,
  startMin, setStartMin, startSec, setStartSec,
  clipEndMode, setClipEndMode,
  durationMin, setDurationMin, durationSec, setDurationSec,
  endMin, setEndMin, endSec, setEndSec,
  outputDir, setOutputDir,
  status, onRunMediaConvert,
  fieldCls, fileCls, labelCls, btnSec,
}: MediaPanelProps) {
  const isVideo = isVideoFile(mediaFile);

  // 切换文件类型时，若当前选中格式不适用则重置
  useEffect(() => {
    if (!isVideo && VIDEO_FORMATS.some(f => f.value === mediaOutputFormat)) {
      setMediaOutputFormat('mp3');
    }
  }, [isVideo]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <section className="rounded-2xl border border-slate-200/80 bg-white p-6 shadow-panel space-y-5 dark:bg-slate-900 dark:border-slate-700/80">

      {/* 操作选择 */}
      <div>
        <span className={labelCls}>操作类型</span>
        <div className="flex rounded-xl border border-slate-200 dark:border-slate-700 overflow-hidden text-sm bg-slate-50/50 dark:bg-slate-800/50">
          {([
            { value: 'convert', label: '格式转换' },
            { value: 'clip',    label: '截取片段' },
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
        <span className={labelCls}>输入文件</span>
        <input className={fileCls} type="file"
          accept="audio/*,video/*,.mp3,.wav,.m4a,.mp4,.mov,.avi,.mkv,.flac,.ogg,.aac,.opus"
          onChange={e => setMediaFile(e.target.files?.[0] || null)} />
        {mediaFile && <p className="text-xs text-slate-400 mt-1.5">{mediaFile.name}（{Math.round(mediaFile.size / 1024)} KB）</p>}
      </label>

      {/* 输出格式 */}
      <div>
        <span className={labelCls}>输出格式</span>
        <div className="space-y-2">
          <div className="flex items-center gap-1.5 mb-0.5">
            <span className="text-xs">🎵</span>
            <p className="text-xs text-slate-400 dark:text-slate-500">音频</p>
          </div>
          <div className="flex flex-wrap gap-2">
            {AUDIO_FORMATS.map(f => (
              <button key={f.value}
                className={`px-3 py-1.5 rounded-lg border text-xs font-semibold transition-all ${mediaOutputFormat === f.value ? 'bg-slate-800 dark:bg-slate-600 border-slate-800 dark:border-slate-600 text-white' : 'border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700'}`}
                onClick={() => setMediaOutputFormat(f.value)}>
                {f.label}
              </button>
            ))}
          </div>
          {!mediaFile || isVideo ? (
            <>
              <div className="flex items-center gap-1.5 mt-1">
                <span className="text-xs">🎬</span>
                <p className="text-xs text-slate-400 dark:text-slate-500">视频</p>
              </div>
              <div className="flex flex-wrap gap-2">
                {VIDEO_FORMATS.map(f => (
                  <button key={f.value}
                    className={`px-3 py-1.5 rounded-lg border text-xs font-semibold transition-all ${mediaOutputFormat === f.value ? 'bg-slate-800 dark:bg-slate-600 border-slate-800 dark:border-slate-600 text-white' : 'border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700'}`}
                    onClick={() => setMediaOutputFormat(f.value)}>
                    {f.label}
                  </button>
                ))}
              </div>
            </>
          ) : null}
        </div>
      </div>

      {/* 截取参数（仅 clip 模式） */}
      {mediaAction === 'clip' && (
        <div className="space-y-4">
          {/* 开始时间 */}
          <div>
            <span className={labelCls}>开始时间</span>
            <MinSecInput minVal={startMin} secVal={startSec} onMin={setStartMin} onSec={setStartSec} />
          </div>

          {/* 结束方式切换 */}
          <div className="space-y-3">
            <div className="flex items-center gap-4">
              <span className={labelCls} style={{ marginBottom: 0 }}>结束方式</span>
              {(['duration', 'endtime'] as ClipEndMode[]).map(mode => (
                <label key={mode} className="flex items-center gap-1.5 cursor-pointer">
                  <input type="radio" checked={clipEndMode === mode} onChange={() => setClipEndMode(mode)}
                    className="accent-indigo-600" />
                  <span className="text-sm text-slate-600 dark:text-slate-300">
                    {mode === 'duration' ? '持续时长' : '结束时间'}
                  </span>
                </label>
              ))}
            </div>
            {clipEndMode === 'duration' ? (
              <MinSecInput minVal={durationMin} secVal={durationSec} onMin={setDurationMin} onSec={setDurationSec} />
            ) : (
              <MinSecInput minVal={endMin} secVal={endSec} onMin={setEndMin} onSec={setEndSec} />
            )}
          </div>
        </div>
      )}

      {/* 输出目录（必选） */}
      <OutputDirRow outputDir={outputDir} setOutputDir={setOutputDir} fieldCls={fieldCls} labelCls={labelCls} btnSec={btnSec} required />

      <button className="w-full rounded-xl bg-teal-600 hover:bg-teal-700 active:bg-teal-800 py-2.5 text-sm font-semibold text-white shadow-sm transition-all duration-150 active:scale-[0.99] disabled:opacity-60 disabled:cursor-not-allowed"
        onClick={onRunMediaConvert} disabled={status === 'processing' || !mediaFile || !outputDir.trim()}>
        {status === 'processing' ? '处理中...' : '开始转换'}
      </button>
    </section>
  );
}
