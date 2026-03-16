import React from 'react';
import type { Page } from './layout/Sidebar';
import type { Job } from '../types';

interface HomePanelProps {
  onNavigate: (page: Page) => void;
  jobs: Job[];
  backendBaseUrl: string;
}

function timeAgo(ts: number): string {
  const diff = Math.floor((Date.now() - ts * 1000) / 1000);
  if (diff < 60) return '刚刚';
  if (diff < 3600) return `${Math.floor(diff / 60)} 分钟前`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} 小时前`;
  return `${Math.floor(diff / 86400)} 天前`;
}

const TYPE_CFG: Record<string, { abbr: string; bg: string }> = {
  tts:             { abbr: 'TTS', bg: '#4f46e5' },
  vc:              { abbr: 'VC',  bg: '#7c3aed' },
  asr:             { abbr: 'STT', bg: '#0284c7' },
  llm:             { abbr: 'LLM', bg: '#059669' },
  voice_chat:      { abbr: 'V+',  bg: '#d97706' },
  media:           { abbr: 'FMT', bg: '#0f766e' },
  doc:             { abbr: 'DOC', bg: '#b45309' },
  image_gen:       { abbr: 'IMG', bg: '#db2777' },
  img_i2i:         { abbr: 'I2I', bg: '#b45309' },
  video_gen:       { abbr: 'VID', bg: '#0f766e' },
  ocr:             { abbr: 'OCR', bg: '#0369a1' },
  lipsync:         { abbr: 'LIP', bg: '#be185d' },
  translate:       { abbr: 'TRL', bg: '#0284c7' },
  image_understand:{ abbr: 'IU',  bg: '#7c3aed' },
};

function JobTypeIcon({ type, size = 32 }: { type: string; size?: number }) {
  const cfg = TYPE_CFG[type] ?? { abbr: '?', bg: '#64748b' };
  const fs = cfg.abbr.length >= 3 ? size * 0.33 : size * 0.4;
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" style={{ flexShrink: 0 }}>
      <rect width="32" height="32" rx="8" fill={cfg.bg} />
      <text x="16" y="16" dominantBaseline="central" textAnchor="middle"
        fontSize={fs} fontWeight="700" fill="#fff"
        fontFamily="-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">
        {cfg.abbr}
      </text>
    </svg>
  );
}

const QUICK_ITEMS: { page: Page; label: string; bg: string; abbr: string }[] = [
  { page: 'audio_tools',   label: 'AI 音频',  bg: '#4f46e5', abbr: '♪' },
  { page: 'misc',          label: 'AI 视图',  bg: '#7c3aed', abbr: '⊞' },
  { page: 'format_convert',label: '格式转换', bg: '#0f766e', abbr: '⇄' },
];

export default function HomePanel({ onNavigate, jobs, backendBaseUrl }: HomePanelProps) {
  const recent = jobs.slice(0, 8);
  const hasJobs = recent.length > 0;

  return (
    <div className="space-y-6">
      {/* 页头 */}
      <div>
        <h1 className="text-3xl font-extrabold tracking-tight text-blue-700 dark:text-blue-400"
          style={{ fontFamily: "'PingFang SC','Microsoft YaHei',sans-serif", letterSpacing: '0.04em' }}>
          AI 工坊
        </h1>
        <p className="text-sm text-slate-400 dark:text-slate-500 mt-1">
          {hasJobs ? `共 ${jobs.length} 条任务记录` : '还没有任务，从下方开始'}
        </p>
      </div>

      {/* 快捷入口 */}
      <div className="flex gap-3">
        {QUICK_ITEMS.map(({ page, label, bg, abbr }) => (
          <button
            key={page}
            onClick={() => onNavigate(page)}
            className="flex-1 flex items-center gap-2.5 rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-4 py-3 text-sm font-semibold text-slate-700 dark:text-slate-200 hover:border-slate-300 dark:hover:border-slate-600 hover:shadow-sm transition-all duration-150"
          >
            <span className="text-base" style={{ color: bg }}>{abbr}</span>
            {label}
          </button>
        ))}
      </div>

      {/* 最近任务 */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <span className="text-xs font-semibold text-slate-400 dark:text-slate-500 uppercase tracking-wider">最近任务</span>
          {hasJobs && (
            <button onClick={() => onNavigate('tasks')}
              className="text-xs text-blue-500 hover:text-blue-600 dark:text-blue-400 dark:hover:text-blue-300 transition-colors">
              查看全部 →
            </button>
          )}
        </div>

        {!hasJobs ? (
          <div className="rounded-2xl border border-dashed border-slate-200 dark:border-slate-700 py-14 text-center">
            <div className="text-3xl mb-3 opacity-30">◎</div>
            <p className="text-sm text-slate-400 dark:text-slate-500">运行一个任务，结果会出现在这里</p>
          </div>
        ) : (
          <div className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 overflow-hidden divide-y divide-slate-100 dark:divide-slate-800">
            {recent.map(job => {
              const isAudio = job.result_url && /\.(wav|mp3|ogg|flac|m4a)$/i.test(job.result_url);
              const isImage = job.result_url && /\.(png|jpg|jpeg|webp|gif)$/i.test(job.result_url);
              const isVideo = job.result_url && /\.(mp4|mov|webm|avi)$/i.test(job.result_url);
              const fullUrl = job.result_url
                ? (job.result_url.startsWith('http') ? job.result_url : `${backendBaseUrl}${job.result_url}`)
                : null;

              return (
                <div key={job.id} className="flex items-center gap-3 px-4 py-3 hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors">
                  <JobTypeIcon type={job.type} size={32} />

                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-slate-800 dark:text-slate-200 truncate">{job.label}</div>
                    <div className="text-xs text-slate-400 dark:text-slate-500 mt-0.5">
                      {job.provider && <span className="mr-2">{job.provider}</span>}
                      {timeAgo(job.created_at)}
                    </div>
                    {job.result_text && (
                      <div className="text-xs text-slate-500 dark:text-slate-400 mt-1 truncate max-w-xs">
                        {job.result_text}
                      </div>
                    )}
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    {job.status === 'completed' && fullUrl && (isAudio || isVideo) && (
                      <a href={fullUrl} target="_blank" rel="noreferrer"
                        className="rounded-lg bg-blue-50 dark:bg-blue-900/30 px-2.5 py-1 text-xs font-medium text-blue-600 dark:text-blue-400 hover:bg-blue-100 dark:hover:bg-blue-900/50 transition-colors">
                        {isVideo ? '▶ 播放' : '▶ 播放'}
                      </a>
                    )}
                    {job.status === 'completed' && fullUrl && isImage && (
                      <a href={fullUrl} target="_blank" rel="noreferrer"
                        className="rounded-lg bg-violet-50 dark:bg-violet-900/30 px-2.5 py-1 text-xs font-medium text-violet-600 dark:text-violet-400 hover:bg-violet-100 dark:hover:bg-violet-900/50 transition-colors">
                        查看
                      </a>
                    )}
                    {job.status === 'running' && (
                      <span className="flex items-center gap-1 text-xs text-amber-500 dark:text-amber-400 font-medium">
                        <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse inline-block" />
                        进行中
                      </span>
                    )}
                    {job.status === 'queued' && (
                      <span className="text-xs text-slate-400 dark:text-slate-500">排队中</span>
                    )}
                    {job.status === 'failed' && (
                      <span className="text-xs text-red-400 dark:text-red-500">失败</span>
                    )}
                    {job.status === 'completed' && !fullUrl && !job.result_text && (
                      <span className="text-xs text-emerald-500 dark:text-emerald-400">完成</span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
