import React, { useState, useEffect } from 'react';
import type { Job } from '../types';
import { PROVIDER_LABELS } from '../constants';
import TasksIcon from './icons/TasksIcon';

interface TaskListProps {
  jobs: Job[];
  backendBaseUrl: string;
  setJobs: React.Dispatch<React.SetStateAction<Job[]>>;
  onFetchJobs: () => void;
  outputDir?: string;
  downloadDir?: string;
  addInstantJobResult: (
    type: string, label: string, provider: string, isLocal: boolean,
    result: { status: 'completed' | 'failed'; result_url?: string; result_text?: string; error?: string }
  ) => void;
}

const SPRING_GREEN = '#6db33f';

function Spinner() {
  return (
    <svg className="animate-spin w-3 h-3" viewBox="0 0 24 24" fill="none">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
    </svg>
  );
}

// ─── 各引擎阶段定义 ──────────────────────────────────────────────────────────

const PROVIDER_STAGES: Record<string, string[]> = {
  fish_speech: ['Worker 连接', '语言建模', '声码合成', '保存文件'],
  local_rvc:   ['加载模型', 'F0 提取', '特征转换', '声音合成', '保存文件'],
  seed_vc:     ['加载音频', '扩散推理', '后处理', '保存文件'],
  whisper:     ['加载模型', '音频预处理', '转写识别', '输出文本'],
};

const TRAIN_STAGES = ['预处理', '提取特征', '构建索引', '转换模型', '写出配置'];

const TRAIN_STEP_IDX: Record<string, number> = {
  start: 0, preprocessing: 0, features: 1, index: 2, model: 3, meta: 4, done: 5,
};

/** 返回阶段列表和当前阶段索引（-1=全部待定，stages.length=全部完成） */
function getJobStages(job: Job): { stages: string[]; currentIdx: number; isTrain: boolean } | null {
  if (job.type === 'train') {
    let currentIdx = -1;
    if (job.status === 'completed') currentIdx = TRAIN_STAGES.length;
    else if (job.status === 'running') currentIdx = (job.step ? TRAIN_STEP_IDX[job.step] ?? 0 : 0);
    else if (job.status === 'failed') currentIdx = (job.step ? TRAIN_STEP_IDX[job.step] ?? 0 : 0);
    return { stages: TRAIN_STAGES, currentIdx, isTrain: true };
  }
  const stages = PROVIDER_STAGES[job.provider];
  if (!stages) return null;
  let currentIdx = -1;
  if (job.status === 'running') currentIdx = 0;
  else if (job.status === 'completed') currentIdx = stages.length;
  else if (job.status === 'failed') currentIdx = 0;
  return { stages, currentIdx, isTrain: false };
}

type StageState = 'done' | 'active' | 'failed' | 'pending';

function getStagePillCls(state: StageState, isTrain: boolean): string {
  if (state === 'done')
    return 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-400';
  if (state === 'active')
    return isTrain
      ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400 animate-pulse'
      : 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-400 animate-pulse';
  if (state === 'failed')
    return 'bg-rose-100 text-rose-600 dark:bg-rose-900/40 dark:text-rose-400';
  return 'bg-slate-100 text-slate-400 dark:bg-slate-800 dark:text-slate-500';
}

// ─── 组件 ────────────────────────────────────────────────────────────────────

function fmtTime(ts: number): string {
  const d = new Date(ts * 1000);
  const h = d.getHours().toString().padStart(2, '0');
  const m = d.getMinutes().toString().padStart(2, '0');
  return `${h}:${m}`;
}

function fmtDateTime(ts: number): string {
  const d = new Date(ts * 1000);
  const mo = d.getMonth() + 1;
  const da = d.getDate();
  const h = d.getHours().toString().padStart(2, '0');
  const mi = d.getMinutes().toString().padStart(2, '0');
  return `${mo}月${da}日 ${h}:${mi}`;
}

export default function TaskList({ jobs, backendBaseUrl, setJobs, onFetchJobs, outputDir, downloadDir, addInstantJobResult }: TaskListProps) {
  const activeJobs = jobs.filter(j => j.status === 'queued' || j.status === 'running');

  // ── 烟雾测试（fire-and-forget，结果写入 task.log）──────────────────────────
  const [smokeRunning, setSmokeRunning] = useState(false);
  const [smoke2Running, setSmoke2Running] = useState(false);

  async function runSmokeTest(endpoint: string, setRunning: (v: boolean) => void) {
    setRunning(true);
    try {
      const r = await fetch(`${backendBaseUrl}/${endpoint}`, { method: 'POST' });
      if (r.ok && r.body) {
        const reader = r.body.getReader();
        while (true) {
          const { done } = await reader.read();
          if (done) break;
        }
      }
    } catch { /**/ }
    onFetchJobs();
    setRunning(false);
  }

  // ── 历史记录区域：运行记录 / 日志 切换 ──────────────────────────────────────
  const [historyView, setHistoryView] = useState<'jobs' | 'log'>('jobs');
  const [taskLogContent, setTaskLogContent] = useState<string | null>(null);

  async function loadTaskLog() {
    try {
      const r = await fetch(`${backendBaseUrl}/system/logs/task.log`);
      const d = await r.json();
      setTaskLogContent(d?.content ?? '（暂无日志）');
    } catch {
      setTaskLogContent('（加载失败）');
    }
  }
  const doneJobs = jobs.filter(j => j.status === 'completed' || j.status === 'failed');
  const now = Date.now() / 1000;

  function fmtElapsed(j: Job) {
    const base = j.status === 'completed' || j.status === 'failed'
      ? (j.completed_at || now) - (j.started_at || j.created_at)
      : now - (j.started_at || j.created_at);
    const s = Math.max(0, Math.round(base));
    return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m${s % 60}s`;
  }

  function StatusBadge({ job }: { job: Job }) {
    if (job.status === 'queued')
      return <span className="rounded-full bg-slate-100 dark:bg-slate-700 px-2.5 py-0.5 text-[11px] font-semibold text-slate-500 dark:text-slate-400">排队中</span>;
    if (job.status === 'running')
      return <span className="rounded-full bg-indigo-100 dark:bg-indigo-900/50 px-2.5 py-0.5 text-[11px] font-semibold text-indigo-600 dark:text-indigo-400 animate-pulse">处理中</span>;
    if (job.status === 'completed')
      return <span className="rounded-full bg-emerald-100 dark:bg-emerald-900/50 px-2.5 py-0.5 text-[11px] font-semibold text-emerald-600 dark:text-emerald-400">完成</span>;
    return <span className="rounded-full bg-rose-100 dark:bg-rose-900/50 px-2.5 py-0.5 text-[11px] font-semibold text-rose-600 dark:text-rose-400">失败</span>;
  }

  function TypeBadge({ job }: { job: Job }) {
    const color =
      job.type === 'tts'              ? 'bg-indigo-600' :
      job.type === 'vc'               ? 'bg-violet-600' :
      job.type === 'asr'              ? 'bg-sky-600'    :
      job.type === 'media'            ? 'bg-teal-600'   :
      job.type === 'doc'              ? 'bg-amber-700'  :
      job.type === 'toolbox'          ? 'bg-amber-700'  :
      job.type === 'train'            ? 'bg-amber-600'  :
      job.type === 'image_gen'        ? 'bg-purple-600' :
      job.type === 'image_understand' ? 'bg-fuchsia-600' :
      job.type === 'translate'        ? 'bg-emerald-600' :
      job.type === 'voice_create'     ? 'bg-pink-600'    :
      job.type === 'media_convert'    ? 'bg-teal-600'    : 'bg-slate-600';
    const abbr =
      job.type === 'tts'              ? 'TTS' :
      job.type === 'vc'               ? 'VC'  :
      job.type === 'asr'              ? 'STT' :
      job.type === 'media'            ? 'FMT' :
      job.type === 'doc'              ? 'DOC' :
      job.type === 'toolbox'          ? 'DOC' :
      job.type === 'train'            ? 'TRN' :
      job.type === 'image_gen'        ? 'IMG' :
      job.type === 'image_understand' ? 'VIS' :
      job.type === 'translate'        ? 'TRL' :
      job.type === 'voice_create'     ? 'VOC' :
      job.type === 'media_convert'    ? 'FMT' : job.type.toUpperCase().slice(0, 3);
    return <span className={`rounded-lg ${color} px-2 py-0.5 text-[10px] font-bold text-white uppercase tracking-wide`}>{abbr}</span>;
  }

  function StageRail({ job }: { job: Job }) {
    const info = getJobStages(job);
    if (!info) return null;
    const { stages, currentIdx, isTrain } = info;

    return (
      <div className="pt-1.5 space-y-1.5">
        {/* 进度条 */}
        {(job.status === 'running' || job.status === 'queued') && (
          isTrain && typeof job.progress === 'number' ? (
            <div className="space-y-1">
              {job.step_msg && (
                <p className="text-[11px] text-slate-400 truncate">{job.step_msg}</p>
              )}
              <div className="flex items-center gap-2">
                <div className="flex-1 bg-slate-100 dark:bg-slate-700 rounded-full h-1.5 overflow-hidden">
                  <div className="bg-amber-500 h-full rounded-full transition-all duration-500"
                    style={{ width: `${job.progress}%` }} />
                </div>
                <span className="text-[11px] tabular-nums font-mono text-slate-400 shrink-0">{job.progress}%</span>
              </div>
            </div>
          ) : (
            <div className="bg-slate-100 dark:bg-slate-700 rounded-full h-1 overflow-hidden">
              <div className="h-full w-2/5 bg-indigo-400 dark:bg-indigo-500 rounded-full"
                style={{ animation: 'progress-indeterminate 1.5s ease-in-out infinite' }} />
            </div>
          )
        )}

        {/* 阶段 pills */}
        <div className="flex items-center gap-1 flex-wrap">
          {stages.map((stage, i) => {
            let state: StageState;
            if (i < currentIdx) state = 'done';
            else if (i === currentIdx) state = job.status === 'failed' ? 'failed' : 'active';
            else state = 'pending';

            return (
              <div key={stage} className="flex items-center gap-1">
                <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium whitespace-nowrap transition-colors ${getStagePillCls(state, isTrain)}`}>
                  {stage}
                </span>
                {i < stages.length - 1 && (
                  <svg className="w-2.5 h-2.5 text-slate-300 dark:text-slate-600 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                )}
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  const [expandedParamJobId, setExpandedParamJobId] = useState<string | null>(null);

  function JobRow({ job }: { job: Job }) {
    const hasParams = job.params && Object.keys(job.params).length > 0;
    return (
      <>
      <div className="flex items-start gap-3 px-5 py-3.5 border-b border-slate-100 dark:border-slate-800 last:border-0 hover:bg-slate-50 dark:hover:bg-slate-800/40 transition-colors">
        <div className="mt-0.5"><TypeBadge job={job} /></div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-medium text-slate-800 dark:text-slate-200 truncate max-w-[280px]">{job.label}</span>
            <StatusBadge job={job} />
          </div>
          <div className="flex items-center gap-3 text-xs text-slate-400 mt-0.5">
            <span>{PROVIDER_LABELS[job.provider] || job.provider}</span>
            {(job.status === 'running' || job.status === 'completed' || job.status === 'failed') && (
              <span className="tabular-nums font-mono">{fmtElapsed(job)}</span>
            )}
          </div>

          {/* 进度条 + 阶段 */}
          <StageRail job={job} />

          {/* 结果 / 错误 */}
          {job.status === 'completed' && job.result_url && (() => {
            const ext = job.result_url.split('.').pop()?.toLowerCase() ?? '';
            const isAudio = ['mp3', 'wav', 'flac', 'm4a', 'aac', 'ogg', 'opus'].includes(ext);
            const isVideo = ['mp4', 'webm', 'mov', 'mkv'].includes(ext);
            const isImage = ['png', 'jpg', 'jpeg', 'webp', 'bmp', 'gif'].includes(ext);
            return (
              <div className="pt-2 space-y-1.5">
                {isAudio && <audio controls src={job.result_url} className="w-full h-8" />}
                {isVideo && <video controls src={job.result_url} className="w-full rounded-lg max-h-48" />}
                {isImage && <img src={job.result_url} alt="result" className="max-w-full rounded-lg max-h-48 object-contain" />}
                <div className="flex items-center gap-2 flex-wrap">
                  <a href={job.result_url} target="_blank" rel="noreferrer"
                    className="text-[11px] text-indigo-500 hover:text-indigo-700 underline break-all">{job.result_url}</a>
                  <a href={job.result_url} download
                    className="shrink-0 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 px-2 py-0.5 text-[11px] text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 transition-colors whitespace-nowrap">
                    下载文件
                  </a>
                </div>
              </div>
            );
          })()}
          {job.status === 'completed' && job.result_text && (
            <pre className="whitespace-pre-wrap text-xs text-slate-700 dark:text-slate-300 bg-slate-50 dark:bg-slate-800 rounded-lg px-3 py-2 leading-relaxed mt-1.5">{job.result_text}</pre>
          )}
          {job.status === 'failed' && job.error && (
            <pre className="whitespace-pre-wrap break-words text-xs text-rose-500 pt-1">{job.error}</pre>
          )}
        </div>
        <div className="shrink-0 flex flex-col items-end gap-1.5">
          <span className="text-[10px] tabular-nums text-slate-400 dark:text-slate-500 whitespace-nowrap">
            {fmtDateTime(job.created_at)}
          </span>
          <div className="flex items-center gap-1.5">
            {hasParams && (
              <button
                className="rounded-lg border border-indigo-200 dark:border-indigo-800 bg-indigo-50 dark:bg-indigo-900/30 hover:bg-indigo-100 dark:hover:bg-indigo-800/50 px-2.5 py-1 text-xs text-indigo-500 dark:text-indigo-400 hover:text-indigo-700 dark:hover:text-indigo-300 transition-colors whitespace-nowrap"
                onClick={() => setExpandedParamJobId(expandedParamJobId === job.id ? null : job.id)}>
                参数
              </button>
            )}
            {(job.status === 'queued' || job.status === 'running') ? (
              <button
                className="rounded-lg border border-orange-200 dark:border-orange-800 bg-orange-50 dark:bg-orange-900/30 hover:bg-orange-100 dark:hover:bg-orange-800/50 px-2.5 py-1 text-xs text-orange-500 dark:text-orange-400 hover:text-orange-700 dark:hover:text-orange-300 transition-colors"
                onClick={async () => {
                  await fetch(`${backendBaseUrl}/jobs/${job.id}`, { method: 'DELETE' }).catch(() => {});
                  setJobs(prev => prev.filter(j => j.id !== job.id));
                }}>
                中断
              </button>
            ) : (
              <button
                className="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 px-2.5 py-1 text-xs text-slate-400 hover:text-rose-500 transition-colors"
                onClick={async () => {
                  await fetch(`${backendBaseUrl}/jobs/${job.id}`, { method: 'DELETE' }).catch(() => {});
                  setJobs(prev => prev.filter(j => j.id !== job.id));
                }}>
                删除
              </button>
            )}
          </div>
        </div>
      </div>
      {expandedParamJobId === job.id && hasParams && (
        <div className="bg-slate-50 dark:bg-slate-800/50 border-t border-slate-100 dark:border-slate-800 px-5 py-3">
          <p className="text-xs font-semibold text-slate-600 dark:text-slate-300 mb-2">任务参数</p>
          <pre className="text-xs text-slate-700 dark:text-slate-300 bg-white dark:bg-slate-900 rounded p-3 overflow-x-auto max-h-48 overflow-y-auto">
            {JSON.stringify(job.params, null, 2)}
          </pre>
        </div>
      )}
    </>
    );
  }

  return (
    <div className="space-y-5">
      <header className="flex items-center gap-3.5 pb-1">
        <TasksIcon size={36} badge={activeJobs.length} />
        <div className="flex-1">
          <h1 className="text-xl font-bold tracking-tight text-slate-900 dark:text-slate-100">管理页面</h1>
          <p className="text-xs text-slate-400 font-medium mt-0.5">TTS · VC · STT · 图像生成 · 图像处理 · 视频生成 · OCR · 口型同步 · 文档转换 · 媒体转换</p>
        </div>
        <button className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 hover:bg-slate-50 px-3 py-1.5 text-xs font-medium text-slate-500 transition-colors" onClick={onFetchJobs}>刷新</button>
        {doneJobs.length > 0 && (
          <button className="rounded-xl border border-rose-200 dark:border-rose-900 bg-white dark:bg-slate-900 hover:bg-rose-50 px-3 py-1.5 text-xs font-medium text-rose-500 transition-colors"
            onClick={async () => {
              await fetch(`${backendBaseUrl}/jobs?status=done`, { method: 'DELETE' }).catch(() => {});
              setJobs(prev => prev.filter(j => j.status === 'queued' || j.status === 'running'));
              setTaskLogContent(null);
            }}>清空已完成</button>
        )}
      </header>

      {jobs.length === 0 ? (
        <div className="rounded-2xl border border-slate-200/80 bg-white dark:bg-slate-900 dark:border-slate-700/80 p-12 text-center text-sm text-slate-400">
          暂无任务
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
          {/* 历史记录：运行记录 / 日志 两个按钮 */}
          <section className="rounded-2xl border border-slate-200/80 bg-white dark:bg-slate-900 dark:border-slate-700/80 shadow-panel overflow-hidden">
            <div className="px-5 py-3 border-b border-slate-100 dark:border-slate-800 flex items-center gap-3">
              <button
                className={`text-xs font-semibold transition-colors ${historyView === 'jobs' ? 'text-slate-700 dark:text-slate-200' : 'text-slate-400 hover:text-slate-600 dark:hover:text-slate-300'}`}
                onClick={() => setHistoryView('jobs')}>
                运行记录{doneJobs.length > 0 ? `（${doneJobs.length}）` : ''}
              </button>
              <button
                className={`text-xs font-semibold transition-colors ${historyView === 'log' ? 'text-slate-700 dark:text-slate-200' : 'text-slate-400 hover:text-slate-600 dark:hover:text-slate-300'}`}
                onClick={() => { setHistoryView('log'); loadTaskLog(); }}>
                日志
              </button>
              {historyView === 'log' && (
                <>
                  <span className="text-[11px] text-slate-400 dark:text-slate-500 font-mono">task.log</span>
                  <button className="ml-auto text-xs text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition-colors"
                    onClick={loadTaskLog}>
                    刷新
                  </button>
                </>
              )}
            </div>
            {historyView === 'jobs' && doneJobs.length > 0 && (
              <div>{doneJobs.map(j => <JobRow key={j.id} job={j} />)}</div>
            )}
            {historyView === 'jobs' && doneJobs.length === 0 && (
              <div className="px-5 py-8 text-center text-sm text-slate-400">暂无历史记录</div>
            )}
            {historyView === 'log' && (
              <div className="px-5 py-3">
                <pre className="rounded border border-slate-800 bg-slate-950 text-green-400 p-4 text-xs font-mono leading-relaxed overflow-y-auto whitespace-pre-wrap break-all"
                  style={{ maxHeight: '24rem' }}>
                  {taskLogContent ?? '（加载中…）'}
                </pre>
              </div>
            )}
          </section>
        </>
      )}
      {/* 烟雾测试 */}
      <section className="rounded-2xl border border-slate-200/80 bg-white dark:bg-slate-900 dark:border-slate-700/80 shadow-panel overflow-hidden">
        <div className="px-5 py-3 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <span className="text-xs font-semibold text-slate-500 dark:text-slate-400">烟雾测试</span>
            <p className="text-[11px] text-slate-400 dark:text-slate-500 mt-0.5">7 大引擎 13 项测试（1.Fish Speech · 2.GPT-SoVITS · 3.Seed-VC · 4.RVC · 5.Faster Whisper · 6.FaceFusion · 7.FFmpeg）</p>
          </div>
          <button
            className="rounded-lg px-3 py-1.5 text-xs font-medium text-white flex items-center gap-1.5 transition-all hover:opacity-90 disabled:opacity-50 shrink-0"
            style={{ backgroundColor: SPRING_GREEN }}
            disabled={smokeRunning || !backendBaseUrl}
            onClick={() => runSmokeTest('smoketest/run', setSmokeRunning)}
          >
            {smokeRunning ? <><Spinner />运行中…</> : '运行烟雾测试'}
          </button>
        </div>
      </section>
      {/* 烟雾测试 2 */}
      <section className="rounded-2xl border border-slate-200/80 bg-white dark:bg-slate-900 dark:border-slate-700/80 shadow-panel overflow-hidden">
        <div className="px-5 py-3 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <span className="text-xs font-semibold text-slate-500 dark:text-slate-400">烟雾测试 2</span>
            <p className="text-[11px] text-slate-400 dark:text-slate-500 mt-0.5">高级功能测试（RAG 知识库 · Agent 智能体 · LoRA 微调）</p>
            <div className="mt-2 text-[11px] text-slate-500 dark:text-slate-400 space-y-1 font-mono">
              <p>📥 会自动拉取的资源：</p>
              <p className="ml-3">├─ nomic-embed-text (~274MB, RAG 向量嵌入)</p>
              <p className="ml-3">└─ qwen2.5:0.5b (~370MB, Agent 推理)</p>
            </div>
            <p className="text-[11px] text-amber-600 dark:text-amber-500 mt-2">⚠️ 前置要求：</p>
            <p className="text-[11px] text-slate-400 dark:text-slate-500 ml-3">• ollama serve 运行中</p>
            <p className="text-[11px] text-slate-400 dark:text-slate-500 ml-3">• pnpm run ml 已执行</p>
            <p className="text-[11px] text-slate-400 dark:text-slate-500 mt-1">💡 需要网络连接（首次拉取较慢，可能 5-10 分钟）</p>
          </div>
          <button
            className="rounded-lg px-3 py-1.5 text-xs font-medium text-white flex items-center gap-1.5 transition-all hover:opacity-90 disabled:opacity-50 shrink-0"
            style={{ backgroundColor: SPRING_GREEN }}
            disabled={smoke2Running || !backendBaseUrl}
            onClick={() => runSmokeTest('smoketest2/run', setSmoke2Running)}
          >
            {smoke2Running ? <><Spinner />运行中…</> : '运行烟雾测试 2'}
          </button>
        </div>
      </section>
      {/* 健康检查 */}
      <HealthCheck backendBaseUrl={backendBaseUrl} />
      {/* 运行日志 */}
      <LogViewer backendBaseUrl={backendBaseUrl} />
    </div>
  );
}

// ─── 健康检查组件 ────────────────────────────────────────────────────────────
function HealthCheck({ backendBaseUrl }: { backendBaseUrl: string }) {
  const [result, setResult] = useState<{ status: string; raw: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const [refreshedAt, setRefreshedAt] = useState<Date | null>(null);

  async function doCheck() {
    if (!backendBaseUrl) return;
    setLoading(true); setResult(null);
    try {
      const r = await fetch(`${backendBaseUrl}/health`);
      const j = await r.json().catch(() => null);
      setResult({ status: j?.status ?? (r.ok ? 'ok' : 'error'), raw: JSON.stringify(j, null, 2) });
    } catch (e: any) {
      setResult({ status: 'error', raw: `请求失败：${e.message}` });
    }
    setRefreshedAt(new Date());
    setLoading(false);
  }

  // 不自动检查，用户手动点击"重新检查"按钮触发

  const s = result?.status;
  const isOk = s === 'ok';

  return (
    <section className="rounded-2xl border border-slate-200/80 bg-white dark:bg-slate-900 dark:border-slate-700/80 shadow-panel overflow-hidden">
      <div className="px-5 py-3 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between gap-3">
        <div className="min-w-0">
          <span className="text-xs font-semibold text-slate-500 dark:text-slate-400">健康检查</span>
          <p className="text-[11px] text-slate-400 dark:text-slate-500 mt-0.5">检查后端服务的运行状态与组件健康度</p>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          {refreshedAt && !loading && (
            <span className="text-[11px] text-slate-400">更新于 {refreshedAt.toLocaleTimeString('zh-CN')}</span>
          )}
          <button
            className="rounded-lg px-3 py-1.5 text-xs font-medium text-white flex items-center gap-1.5 transition-all hover:opacity-90 disabled:opacity-50"
            style={{ backgroundColor: SPRING_GREEN }}
            disabled={loading || !backendBaseUrl}
            onClick={doCheck}
          >
            {loading ? <><Spinner />检查中…</> : '重新检查'}
          </button>
        </div>
      </div>
      {result && (
        <div className="px-5 py-3 space-y-3">
          <div className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-semibold ${
            isOk ? 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-400'
            : s === 'degraded' ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400'
            : 'bg-red-100 text-red-600 dark:bg-red-900/40 dark:text-red-400'
          }`}>
            <span className={`w-2 h-2 rounded-full ${isOk ? 'bg-green-500' : s === 'degraded' ? 'bg-amber-500' : 'bg-red-500'}`} />
            {isOk ? '运行正常' : s === 'degraded' ? '部分降级' : '异常'}
          </div>
          <pre className="rounded border border-slate-800 bg-slate-950 text-green-400 p-4 text-xs font-mono overflow-x-auto whitespace-pre-wrap leading-relaxed">{result.raw}</pre>
        </div>
      )}
    </section>
  );
}

// ─── 日志查看组件 ────────────────────────────────────────────────────────────
function LogViewer({ backendBaseUrl }: { backendBaseUrl: string }) {
  const [logContent, setLogContent] = useState<{ name: string; content: string } | null>(null);
  const [logFiles, setLogFiles] = useState<string[]>([]);
  const [logDir, setLogDir] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!backendBaseUrl) return;
    fetch(`${backendBaseUrl}/system/logs`).then(r => r.json()).then(data => {
      if (Array.isArray(data)) { setLogFiles(data); } // 兼容旧格式
      else { setLogFiles(data.files || []); setLogDir(data.dir || ''); }
    }).catch(() => {});
  }, [backendBaseUrl]);

  async function loadLog(name: string) {
    if (logContent?.name === name) { setLogContent(null); return; }
    if (!backendBaseUrl) return;
    setLoading(true);
    try {
      const r = await fetch(`${backendBaseUrl}/system/logs/${encodeURIComponent(name)}`);
      const res = await r.json();
      setLogContent({ name, content: res.content || '' });
    } catch {
      setLogContent({ name, content: '（读取失败）' });
    }
    setLoading(false);
  }

  if (logFiles.length === 0) return null;

  return (
    <section className="rounded-2xl border border-slate-200/80 bg-white dark:bg-slate-900 dark:border-slate-700/80 shadow-panel overflow-hidden">
      <div className="px-5 py-3 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between gap-3">
        <div className="min-w-0">
          <span className="text-xs font-semibold text-slate-500 dark:text-slate-400">运行日志</span>
          <p className="text-[11px] text-slate-400 dark:text-slate-500 mt-0.5">
            查看各进程的运行日志，用于排查问题
            {logDir && <span className="ml-1 text-slate-300 dark:text-slate-600">· {logDir}</span>}
          </p>
        </div>
      </div>
      <div className="px-5 py-3">
        <div className="flex items-center gap-2 flex-wrap">
          {logFiles.map(name => (
            <button key={name}
              className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-all disabled:opacity-50 ${
                logContent?.name === name
                  ? 'text-white'
                  : 'border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-700'
              }`}
              style={logContent?.name === name ? { backgroundColor: SPRING_GREEN } : undefined}
              disabled={loading}
              onClick={() => loadLog(name)}>
              {name}
            </button>
          ))}
        </div>
        {logContent && (
          <pre className="mt-3 rounded border border-slate-800 bg-slate-950 text-green-400 p-4 text-xs font-mono overflow-x-auto whitespace-pre-wrap leading-relaxed" style={{ maxHeight: '24rem' }}>
            {logContent.content || '（空）'}
          </pre>
        )}
      </div>
    </section>
  );
}
