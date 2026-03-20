interface RecordingDownloadLinkProps {
  recordedObjectUrl: string | null;
  filename?: string;
}

export default function RecordingDownloadLink({ recordedObjectUrl, filename = 'recording.webm' }: RecordingDownloadLinkProps) {
  if (!recordedObjectUrl) return null;
  return (
    <a href={recordedObjectUrl} download={filename}
      className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 dark:border-slate-600 bg-slate-50 dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 px-3 py-1.5 text-xs text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 transition-colors">
      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
      </svg>
      下载录音
    </a>
  );
}
