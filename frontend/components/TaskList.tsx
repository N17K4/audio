import type { Job } from '../types';
import { PROVIDER_LABELS } from '../constants';
import TasksIcon from './icons/TasksIcon';

interface TaskListProps {
  jobs: Job[];
  backendBaseUrl: string;
  setJobs: React.Dispatch<React.SetStateAction<Job[]>>;
  onFetchJobs: () => void;
}

export default function TaskList({ jobs, backendBaseUrl, setJobs, onFetchJobs }: TaskListProps) {
  const activeJobs = jobs.filter(j => j.status === 'queued' || j.status === 'running');
  const doneJobs = jobs.filter(j => j.status === 'completed' || j.status === 'failed');
  const now = Date.now() / 1000;

  function fmtElapsed(j: Job) {
    const base = j.status === 'completed' || j.status === 'failed'
      ? (j.completed_at || now) - (j.started_at || j.created_at)
      : now - (j.started_at || j.created_at);
    const s = Math.max(0, Math.round(base));
    return s < 60 ? `${s}s` : `${Math.floor(s/60)}m${s%60}s`;
  }

  function StatusBadge({ job }: { job: Job }) {
    if (job.status === 'queued') return <span className="rounded-full bg-slate-100 dark:bg-slate-700 px-2.5 py-0.5 text-[11px] font-semibold text-slate-500 dark:text-slate-400">排队中</span>;
    if (job.status === 'running') return <span className="rounded-full bg-indigo-100 dark:bg-indigo-900/50 px-2.5 py-0.5 text-[11px] font-semibold text-indigo-600 dark:text-indigo-400 animate-pulse">处理中</span>;
    if (job.status === 'completed') return <span className="rounded-full bg-emerald-100 dark:bg-emerald-900/50 px-2.5 py-0.5 text-[11px] font-semibold text-emerald-600 dark:text-emerald-400">完成</span>;
    return <span className="rounded-full bg-rose-100 dark:bg-rose-900/50 px-2.5 py-0.5 text-[11px] font-semibold text-rose-600 dark:text-rose-400">失败</span>;
  }

  function TypeBadge({ job }: { job: Job }) {
    const color = job.type === 'tts' ? 'bg-indigo-600' : job.type === 'vc' ? 'bg-violet-600' : job.type === 'asr' ? 'bg-sky-600' : job.type === 'media' ? 'bg-teal-600' : 'bg-slate-600';
    const abbr = job.type === 'tts' ? 'TTS' : job.type === 'vc' ? 'VC' : job.type === 'asr' ? 'STT' : job.type === 'media' ? 'FMT' : job.type.toUpperCase().slice(0, 3);
    return <span className={`rounded-lg ${color} px-2 py-0.5 text-[10px] font-bold text-white uppercase tracking-wide`}>{abbr}</span>;
  }

  function JobRow({ job }: { job: Job }) {
    return (
      <div className="flex items-start gap-3 px-5 py-3.5 border-b border-slate-100 dark:border-slate-800 last:border-0 hover:bg-slate-50 dark:hover:bg-slate-800/40 transition-colors">
        <div className="mt-0.5"><TypeBadge job={job} /></div>
        <div className="flex-1 min-w-0 space-y-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-medium text-slate-800 dark:text-slate-200 truncate max-w-[280px]">{job.label}</span>
            <StatusBadge job={job} />
          </div>
          <div className="flex items-center gap-3 text-xs text-slate-400">
            <span>{PROVIDER_LABELS[job.provider] || job.provider}</span>
            {(job.status === 'running' || job.status === 'completed' || job.status === 'failed') && (
              <span className="tabular-nums font-mono">{fmtElapsed(job)}</span>
            )}
          </div>
          {job.status === 'completed' && job.result_url && (
            <div className="pt-1 space-y-1.5">
              <audio controls src={job.result_url} className="w-full h-8" />
              <a href={job.result_url} target="_blank" rel="noreferrer" className="text-[11px] text-indigo-500 hover:text-indigo-700 underline break-all">{job.result_url}</a>
            </div>
          )}
          {job.status === 'completed' && job.result_text && (
            <pre className="whitespace-pre-wrap text-xs text-slate-700 dark:text-slate-300 bg-slate-50 dark:bg-slate-800 rounded-lg px-3 py-2 leading-relaxed mt-1">{job.result_text}</pre>
          )}
          {job.status === 'failed' && job.error && (
            <p className="text-xs text-rose-500 break-all pt-0.5">{job.error}</p>
          )}
        </div>
        {(job.status === 'queued' || job.status === 'running') ? (
          <button
            className="shrink-0 rounded-lg border border-orange-200 dark:border-orange-800 bg-orange-50 dark:bg-orange-900/30 hover:bg-orange-100 dark:hover:bg-orange-800/50 px-2.5 py-1 text-xs text-orange-500 dark:text-orange-400 hover:text-orange-700 dark:hover:text-orange-300 transition-colors"
            onClick={async () => {
              await fetch(`${backendBaseUrl}/jobs/${job.id}`, { method: 'DELETE' }).catch(() => {});
              setJobs(prev => prev.filter(j => j.id !== job.id));
            }}>
            中断
          </button>
        ) : (
          <button
            className="shrink-0 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 px-2.5 py-1 text-xs text-slate-400 hover:text-rose-500 transition-colors"
            onClick={async () => {
              await fetch(`${backendBaseUrl}/jobs/${job.id}`, { method: 'DELETE' }).catch(() => {});
              setJobs(prev => prev.filter(j => j.id !== job.id));
            }}>
            删除
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <header className="flex items-center gap-3.5 pb-1">
        <TasksIcon size={36} badge={activeJobs.length} />
        <div className="flex-1">
          <h1 className="text-xl font-bold tracking-tight text-slate-900 dark:text-slate-100">任务列表</h1>
          <p className="text-xs text-slate-400 font-medium mt-0.5">TTS / VC 异步任务队列</p>
        </div>
        <button className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 hover:bg-slate-50 px-3 py-1.5 text-xs font-medium text-slate-500 transition-colors" onClick={onFetchJobs}>刷新</button>
        {doneJobs.length > 0 && (
          <button className="rounded-xl border border-rose-200 dark:border-rose-900 bg-white dark:bg-slate-900 hover:bg-rose-50 px-3 py-1.5 text-xs font-medium text-rose-500 transition-colors"
            onClick={async () => {
              await fetch(`${backendBaseUrl}/jobs?status=done`, { method: 'DELETE' }).catch(() => {});
              setJobs(prev => prev.filter(j => j.status === 'queued' || j.status === 'running'));
            }}>清空已完成</button>
        )}
      </header>

      {jobs.length === 0 ? (
        <div className="rounded-2xl border border-slate-200/80 bg-white dark:bg-slate-900 dark:border-slate-700/80 p-12 text-center text-sm text-slate-400">
          暂无任务，提交 TTS 或音色转换后在此查看进度
        </div>
      ) : (
        <>
          {activeJobs.length > 0 && (
            <section className="rounded-2xl border border-indigo-200/80 dark:border-indigo-800/60 bg-white dark:bg-slate-900 shadow-panel overflow-hidden">
              <div className="px-5 py-3 border-b border-indigo-100 dark:border-indigo-900/60 flex items-center gap-2">
                <svg className="w-3.5 h-3.5 text-indigo-500 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
                </svg>
                <span className="text-xs font-semibold text-indigo-600 dark:text-indigo-400">进行中（{activeJobs.length}）</span>
              </div>
              {activeJobs.map(j => <JobRow key={j.id} job={j} />)}
            </section>
          )}
          {doneJobs.length > 0 && (
            <section className="rounded-2xl border border-slate-200/80 bg-white dark:bg-slate-900 dark:border-slate-700/80 shadow-panel overflow-hidden">
              <div className="px-5 py-3 border-b border-slate-100 dark:border-slate-800">
                <span className="text-xs font-semibold text-slate-400">历史记录（{doneJobs.length}）</span>
              </div>
              {doneJobs.map(j => <JobRow key={j.id} job={j} />)}
            </section>
          )}
        </>
      )}
    </div>
  );
}
