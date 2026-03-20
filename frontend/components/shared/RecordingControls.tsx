import type { Status } from '../../types';

interface RecordingControlsProps {
  status: Status;
  recordedObjectUrl: string | null;
  onStart: () => void;
  onStop: () => void;
}

export default function RecordingControls({ status, recordedObjectUrl, onStart, onStop }: RecordingControlsProps) {
  return (
    <div className="flex gap-2">
      {status === 'idle' && !recordedObjectUrl && (
        <button
          className="flex-1 rounded-xl bg-slate-800 hover:bg-slate-900 py-2.5 text-sm font-semibold text-white shadow-sm transition-all active:scale-[0.99]"
          onClick={onStart}>
          开始录音
        </button>
      )}
      {status === 'recording' && (
        <button
          className="flex-1 rounded-xl bg-rose-600 hover:bg-rose-700 py-2.5 text-sm font-semibold text-white shadow-sm animate-pulse transition-all"
          onClick={onStop}>
          停止录音
        </button>
      )}
      {status === 'processing' && (
        <span className="flex-1 text-center text-sm text-slate-400 py-2.5">处理中...</span>
      )}
      {status === 'idle' && recordedObjectUrl && (
        <button
          className="flex-1 rounded-xl bg-slate-800 hover:bg-slate-900 py-2.5 text-sm font-semibold text-white shadow-sm transition-all active:scale-[0.99]"
          onClick={onStart}>
          重新录音
        </button>
      )}
    </div>
  );
}
