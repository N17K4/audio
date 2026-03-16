import { useRef, useState } from 'react';

interface FileDropProps {
  /** Current files. Pass single-element array for single-file mode. */
  files: File[];
  onAdd: (newFiles: File[]) => void;
  onRemove: (index: number) => void;
  accept?: string;
  /** Allow adding multiple files. Default false = single file replaces previous. */
  multiple?: boolean;
  /** Label shown in empty state. Default: "拖放文件至此，或浏览文件" */
  emptyLabel?: string;
  /** Format hint shown below label */
  formatHint?: string;
  /** Compact mode: smaller height for inline use. Default false = 200px */
  compact?: boolean;
  /** Icon variant: 'audio' | 'image' | 'file'. Default 'file' */
  iconType?: 'audio' | 'image' | 'file';
}

function UploadIcon({ type, size }: { type: 'audio' | 'image' | 'file'; size: number }) {
  if (type === 'audio') return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth="1.5" strokeLinecap="round">
      <path d="M9 19V6l12-3v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="15" r="3"/>
    </svg>
  );
  if (type === 'image') return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/>
      <polyline points="21 15 16 10 5 21"/>
    </svg>
  );
  // file (default) — also used as "done" icon color changes when file present
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="16 16 12 12 8 16"/><line x1="12" y1="12" x2="12" y2="21"/>
      <path d="M20.39 18.39A5 5 0 0 0 18 9h-1.26A8 8 0 1 0 3 16.3"/>
    </svg>
  );
}

function SuccessIcon({ type, size }: { type: 'audio' | 'image' | 'file'; size: number }) {
  if (type === 'audio') return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="#10b981" strokeWidth="1.5" strokeLinecap="round">
      <path d="M9 19V6l12-3v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="15" r="3"/>
    </svg>
  );
  if (type === 'image') return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="#10b981" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/>
      <polyline points="21 15 16 10 5 21"/>
    </svg>
  );
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="#10b981" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M13 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V9z"/><polyline points="13 2 13 9 20 9"/>
    </svg>
  );
}

export default function FileDrop({
  files,
  onAdd,
  onRemove,
  accept,
  multiple = false,
  emptyLabel = '拖放文件至此，或浏览文件',
  formatHint,
  compact = false,
  iconType = 'file',
}: FileDropProps) {
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const hasFiles = files.length > 0;
  const isSingle = !multiple;
  const smallIconSize = 16;

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
    const dropped = Array.from(e.dataTransfer.files);
    if (dropped.length === 0) return;
    onAdd(isSingle ? [dropped[0]] : dropped);
  }

  function handleInput(e: React.ChangeEvent<HTMLInputElement>) {
    const picked = Array.from(e.target.files || []);
    if (picked.length === 0) return;
    onAdd(isSingle ? [picked[0]] : picked);
    // reset so same file can be re-selected
    e.target.value = '';
  }

  // ── Single file mode ──────────────────────────────────────────────────────
  if (isSingle) {
    const file = files[0] ?? null;
    return (
      <div
        onDragOver={e => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
        onClick={() => inputRef.current?.click()}
        className={`relative flex flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed cursor-pointer transition-all duration-150 select-none ${
          compact ? 'min-h-[80px] py-3 px-3' : 'min-h-[200px] py-10 px-4'
        } ${
          dragOver
            ? 'border-[#1A8FE3] bg-blue-50 dark:bg-blue-900/20'
            : file
              ? 'border-emerald-400 bg-emerald-50/50 dark:bg-emerald-900/10'
              : 'border-slate-300 dark:border-slate-600 bg-slate-50/50 dark:bg-slate-800/50 hover:border-[#1A8FE3] hover:bg-blue-50/30'
        }`}
      >
        {file ? (
          <>
            <SuccessIcon type={iconType} size={compact ? 28 : 48} />
            <div className="text-center">
              <div className={`font-semibold text-slate-700 dark:text-slate-200 truncate max-w-[220px] ${compact ? 'text-xs' : 'text-base'}`}>{file.name}</div>
              <div className="text-xs text-slate-400 mt-0.5">{(file.size / 1024 / 1024).toFixed(2)} MB</div>
            </div>
            <button
              onClick={e => { e.stopPropagation(); onRemove(0); }}
              className="text-xs text-red-400 hover:text-red-500 transition-colors">
              移除
            </button>
          </>
        ) : (
          <>
            <UploadIcon type={iconType} size={compact ? 28 : 56} />
            <div className="text-center">
              <div className={`font-semibold text-slate-600 dark:text-slate-300 ${compact ? 'text-xs' : 'text-base'}`}>
                {compact ? emptyLabel : (
                  <>拖放文件至此，或<span className="text-[#1A8FE3] underline-offset-2 hover:underline">浏览文件</span></>
                )}
              </div>
              {formatHint && <div className="text-xs text-slate-400 mt-1">{formatHint}</div>}
            </div>
          </>
        )}
        <input ref={inputRef} type="file" accept={accept} multiple={false} className="hidden" onChange={handleInput} />
      </div>
    );
  }

  // ── Multi file mode ───────────────────────────────────────────────────────
  return (
    <div
      className={`rounded-2xl border-2 border-dashed transition-all duration-150 select-none overflow-hidden ${
        dragOver
          ? 'border-[#1A8FE3] bg-blue-50 dark:bg-blue-900/20'
          : hasFiles
            ? 'border-emerald-400 bg-emerald-50/50 dark:bg-emerald-900/10'
            : 'border-slate-300 dark:border-slate-600 bg-slate-50/50 dark:bg-slate-800/50'
      }`}
      onDragOver={e => { e.preventDefault(); setDragOver(true); }}
      onDragLeave={() => setDragOver(false)}
      onDrop={handleDrop}
    >
      {hasFiles && (
        <div className="px-3 pt-2 pb-1 space-y-1">
          {files.map((f, i) => (
            <div key={i} className="flex items-center gap-2 py-1.5 px-2 rounded-lg bg-white dark:bg-slate-800 border border-slate-100 dark:border-slate-700">
              <SuccessIcon type={iconType} size={smallIconSize} />
              <span className="text-xs text-slate-700 dark:text-slate-200 truncate flex-1">{f.name}</span>
              <span className="text-xs text-slate-400 shrink-0">{(f.size / 1024 / 1024).toFixed(1)} MB</span>
              <button onClick={e => { e.stopPropagation(); onRemove(i); }} className="text-red-400 hover:text-red-500 shrink-0 ml-1 text-xs">×</button>
            </div>
          ))}
        </div>
      )}
      <div
        onClick={() => inputRef.current?.click()}
        className={`flex items-center justify-center gap-2 cursor-pointer px-3 py-3 hover:bg-blue-50/30 dark:hover:bg-blue-900/10 transition-colors ${hasFiles ? 'border-t border-dashed border-slate-200 dark:border-slate-700' : 'min-h-[100px]'}`}
      >
        <UploadIcon type={iconType} size={20} />
        <span className="text-xs text-slate-500 dark:text-slate-400">
          {hasFiles ? '继续添加' : (emptyLabel ?? '点击或拖拽上传文件（可多选）')}
        </span>
        {formatHint && !hasFiles && <span className="text-xs text-slate-400">— {formatHint}</span>}
      </div>
      <input ref={inputRef} type="file" accept={accept} multiple className="hidden" onChange={handleInput} />
    </div>
  );
}
