import React, { useState } from 'react';
import type { Page } from './layout/Sidebar';
import type { Job } from '../types';
import { TOOL_CARDS, type ToolCategory } from '../constants';

interface HomePanelProps {
  onNavigate: (page: Page, subPage?: string) => void;
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
  tts:              { abbr: 'TTS', bg: '#4f46e5' },
  vc:               { abbr: 'VC',  bg: '#7c3aed' },
  asr:              { abbr: 'STT', bg: '#0284c7' },
  llm:              { abbr: 'LLM', bg: '#059669' },
  voice_chat:       { abbr: 'V+',  bg: '#d97706' },
  media:            { abbr: 'FMT', bg: '#0f766e' },
  doc:              { abbr: 'DOC', bg: '#b45309' },
  image_gen:        { abbr: 'IMG', bg: '#db2777' },
  img_i2i:          { abbr: 'I2I', bg: '#b45309' },
  video_gen:        { abbr: 'VID', bg: '#0f766e' },
  ocr:              { abbr: 'OCR', bg: '#0369a1' },
  lipsync:          { abbr: 'LIP', bg: '#be185d' },
  translate:        { abbr: 'TRL', bg: '#0284c7' },
  image_understand: { abbr: 'IU',  bg: '#7c3aed' },
};

function JobTypeIcon({ type, size = 18 }: { type: string; size?: number }) {
  const cfg = TYPE_CFG[type] ?? { abbr: '?', bg: '#64748b' };
  const fs = cfg.abbr.length >= 3 ? size * 0.33 : size * 0.42;
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

function ToolIcon({ type, color, size = 28 }: { type: string; color: string; size?: number }) {
  const s = size;
  switch (type) {
    case 'tts':
      return (
        <svg width={s} height={s} viewBox="0 0 28 28" fill="none">
          <rect x="2"  y="17" width="3.5" height="8"  rx="1.75" stroke={color} strokeWidth="1.5" fill="none"/>
          <rect x="7"  y="13" width="3.5" height="12" rx="1.75" stroke={color} strokeWidth="1.5" fill="none"/>
          <rect x="12" y="7"  width="3.5" height="18" rx="1.75" stroke={color} strokeWidth="1.5" fill="none"/>
          <rect x="17" y="11" width="3.5" height="14" rx="1.75" stroke={color} strokeWidth="1.5" fill="none"/>
          <rect x="22" y="15" width="3.5" height="10" rx="1.75" stroke={color} strokeWidth="1.5" fill="none"/>
        </svg>
      );
    case 'vc':
      return (
        <svg width={s} height={s} viewBox="0 0 28 28" fill="none">
          <rect x="4" y="6" width="5" height="8" rx="2.5" stroke={color} strokeWidth="1.5"/>
          <path d="M4 13q0 3.5 2.5 3.5T9 13" stroke={color} strokeWidth="1.5" fill="none"/>
          <line x1="6.5" y1="16.5" x2="6.5" y2="20" stroke={color} strokeWidth="1.5" strokeLinecap="round"/>
          <path d="M12 14 L16 14 M14.5 12 L16.5 14 L14.5 16" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
          <rect x="19" y="6" width="5" height="8" rx="2.5" stroke={color} strokeWidth="1.5"/>
          <path d="M19 13q0 3.5 2.5 3.5T24 13" stroke={color} strokeWidth="1.5" fill="none"/>
          <line x1="21.5" y1="16.5" x2="21.5" y2="20" stroke={color} strokeWidth="1.5" strokeLinecap="round"/>
        </svg>
      );
    case 'asr':
      return (
        <svg width={s} height={s} viewBox="0 0 28 28" fill="none">
          <rect x="10" y="3" width="8" height="11" rx="4" stroke={color} strokeWidth="1.5"/>
          <path d="M6 13q0 8 8 8t8-8" stroke={color} strokeWidth="1.5" fill="none" strokeLinecap="round"/>
          <line x1="14" y1="21" x2="14" y2="24" stroke={color} strokeWidth="1.5" strokeLinecap="round"/>
          <line x1="4"  y1="25" x2="12" y2="25" stroke={color} strokeWidth="1.5" strokeLinecap="round"/>
          <line x1="16" y1="25" x2="24" y2="25" stroke={color} strokeWidth="1.5" strokeLinecap="round"/>
        </svg>
      );
    case 'llm':
      return (
        <svg width={s} height={s} viewBox="0 0 28 28" fill="none">
          <rect x="3"  y="3"  width="18" height="13" rx="4" stroke={color} strokeWidth="1.5"/>
          <line x1="7"  y1="8"  x2="13" y2="8"  stroke={color} strokeWidth="1.5" strokeLinecap="round"/>
          <line x1="7"  y1="11" x2="17" y2="11" stroke={color} strokeWidth="1.5" strokeLinecap="round"/>
          <path d="M7 16 L5 22 L11 19" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="none"/>
          <rect x="13" y="16" width="12" height="9" rx="3" stroke={color} strokeWidth="1.5"/>
          <line x1="16" y1="20" x2="22" y2="20" stroke={color} strokeWidth="1.5" strokeLinecap="round"/>
        </svg>
      );
    case 'voice_chat':
      return (
        <svg width={s} height={s} viewBox="0 0 28 28" fill="none">
          <path d="M5 16 C5 8 23 8 23 16" stroke={color} strokeWidth="1.5" fill="none" strokeLinecap="round"/>
          <rect x="2"  y="14" width="5.5" height="8" rx="2.75" stroke={color} strokeWidth="1.5"/>
          <rect x="20.5" y="14" width="5.5" height="8" rx="2.75" stroke={color} strokeWidth="1.5"/>
        </svg>
      );
    case 'image_gen':
      return (
        <svg width={s} height={s} viewBox="0 0 28 28" fill="none">
          <rect x="2" y="5" width="20" height="16" rx="2.5" stroke={color} strokeWidth="1.5"/>
          <path d="M5 18 L9 11 L14 16 L17 13 L21 18" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
          <circle cx="17" cy="10" r="2" stroke={color} strokeWidth="1.5"/>
          <path d="M23 3 L24 6 L27 7 L24 8 L23 11 L22 8 L19 7 L22 6 Z" stroke={color} strokeWidth="1.2" strokeLinejoin="round" fill="none"/>
        </svg>
      );
    case 'img_i2i':
      return (
        <svg width={s} height={s} viewBox="0 0 28 28" fill="none">
          <rect x="1"  y="6"  width="11" height="11" rx="2.5" stroke={color} strokeWidth="1.5"/>
          <rect x="16" y="11" width="11" height="11" rx="2.5" stroke={color} strokeWidth="1.5"/>
          <path d="M14 14 L16 17 L14 20" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
          <line x1="7" y1="17" x2="16" y2="17" stroke={color} strokeWidth="1.5" strokeLinecap="round"/>
        </svg>
      );
    case 'image_understand':
      return (
        <svg width={s} height={s} viewBox="0 0 28 28" fill="none">
          <path d="M2 14 Q14 4 26 14 Q14 24 2 14 Z" stroke={color} strokeWidth="1.5" fill="none"/>
          <circle cx="14" cy="14" r="4" stroke={color} strokeWidth="1.5"/>
          <circle cx="14" cy="14" r="1.5" fill={color}/>
        </svg>
      );
    case 'ocr':
      return (
        <svg width={s} height={s} viewBox="0 0 28 28" fill="none">
          <path d="M3 8 L3 3 L8 3"   stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
          <path d="M20 3 L25 3 L25 8" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
          <path d="M3 20 L3 25 L8 25" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
          <path d="M25 20 L25 25 L20 25" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
          <line x1="7"  y1="10" x2="17" y2="10" stroke={color} strokeWidth="1.5" strokeLinecap="round"/>
          <line x1="7"  y1="14" x2="21" y2="14" stroke={color} strokeWidth="1.5" strokeLinecap="round"/>
          <line x1="7"  y1="18" x2="14" y2="18" stroke={color} strokeWidth="1.5" strokeLinecap="round"/>
        </svg>
      );
    case 'video_gen':
      return (
        <svg width={s} height={s} viewBox="0 0 28 28" fill="none">
          <rect x="2"  y="7"  width="20" height="14" rx="2.5" stroke={color} strokeWidth="1.5"/>
          <rect x="3"  y="8"  width="3"  height="3"  rx="0.75" stroke={color} strokeWidth="1.2"/>
          <rect x="3"  y="13" width="3"  height="3"  rx="0.75" stroke={color} strokeWidth="1.2"/>
          <rect x="3"  y="18" width="3"  height="2.5" rx="0.75" stroke={color} strokeWidth="1.2"/>
          <rect x="18" y="8"  width="3"  height="3"  rx="0.75" stroke={color} strokeWidth="1.2"/>
          <rect x="18" y="13" width="3"  height="3"  rx="0.75" stroke={color} strokeWidth="1.2"/>
          <rect x="18" y="18" width="3"  height="2.5" rx="0.75" stroke={color} strokeWidth="1.2"/>
          <path d="M10 11 L17 14 L10 17 Z" stroke={color} strokeWidth="1.5" strokeLinejoin="round"/>
        </svg>
      );
    case 'lipsync':
      return (
        <svg width={s} height={s} viewBox="0 0 28 28" fill="none">
          <circle cx="14" cy="13" r="9" stroke={color} strokeWidth="1.5"/>
          <circle cx="10.5" cy="11" r="1.5" fill={color}/>
          <circle cx="17.5" cy="11" r="1.5" fill={color}/>
          <path d="M9 16 Q14 21 19 16" stroke={color} strokeWidth="1.5" fill="none" strokeLinecap="round"/>
          <path d="M2 25 Q5 22 8 25 Q11 28 14 25" stroke={color} strokeWidth="1.5" fill="none" strokeLinecap="round"/>
        </svg>
      );
    case 'media':
      return (
        <svg width={s} height={s} viewBox="0 0 28 28" fill="none">
          <path d="M4 9 L21 9 M18 6 L21 9 L18 12" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
          <path d="M24 19 L7 19 M10 16 L7 19 L10 22" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      );
    case 'doc':
      return (
        <svg width={s} height={s} viewBox="0 0 28 28" fill="none">
          <path d="M5 3 L18 3 L23 8 L23 25 L5 25 Z" stroke={color} strokeWidth="1.5" strokeLinejoin="round"/>
          <path d="M18 3 L18 8 L23 8" stroke={color} strokeWidth="1.5" strokeLinejoin="round" fill="none"/>
          <line x1="9"  y1="12" x2="19" y2="12" stroke={color} strokeWidth="1.5" strokeLinecap="round"/>
          <line x1="9"  y1="16" x2="19" y2="16" stroke={color} strokeWidth="1.5" strokeLinecap="round"/>
          <line x1="9"  y1="20" x2="15" y2="20" stroke={color} strokeWidth="1.5" strokeLinecap="round"/>
        </svg>
      );
    case 'translate':
      return (
        <svg width={s} height={s} viewBox="0 0 28 28" fill="none">
          <circle cx="14" cy="14" r="11" stroke={color} strokeWidth="1.5"/>
          <ellipse cx="14" cy="14" rx="5" ry="11" stroke={color} strokeWidth="1.5"/>
          <line x1="3" y1="14" x2="25" y2="14" stroke={color} strokeWidth="1.5"/>
          <path d="M4 9 Q14 7 24 9"  stroke={color} strokeWidth="1.2" fill="none"/>
          <path d="M4 19 Q14 21 24 19" stroke={color} strokeWidth="1.2" fill="none"/>
        </svg>
      );
    default:
      return (
        <svg width={s} height={s} viewBox="0 0 28 28" fill="none">
          <circle cx="14" cy="14" r="10" stroke={color} strokeWidth="1.5"/>
          <text x="14" y="14" textAnchor="middle" dominantBaseline="central" fill={color} fontSize="10" fontWeight="700">?</text>
        </svg>
      );
  }
}

const CATEGORY_TABS: { key: ToolCategory; label: string }[] = [
  { key: 'all',     label: '全部' },
  { key: 'audio',   label: '音频' },
  { key: 'image',   label: '图像' },
  { key: 'video',   label: '视频' },
  { key: 'convert', label: '转换' },
];

export default function HomePanel({ onNavigate, jobs, backendBaseUrl: _backendBaseUrl }: HomePanelProps) {
  const [search, setSearch]     = useState('');
  const [category, setCategory] = useState<ToolCategory>('all');

  const filtered = TOOL_CARDS.filter(t => {
    const matchCat    = category === 'all' || (t.category as readonly string[]).includes(category);
    const matchSearch = !search || t.label.includes(search) || t.desc.includes(search);
    return matchCat && matchSearch;
  });

  const recent  = jobs.slice(0, 10);
  const hasJobs = recent.length > 0;

  return (
    <div className="space-y-5">
      {/* 搜索栏 */}
      <div className="relative mb-5">
        <svg className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none"
          width="16" height="16" viewBox="0 0 16 16" fill="none">
          <circle cx="6.5" cy="6.5" r="4.5" stroke="currentColor" strokeWidth="1.5"/>
          <path d="M10 10 L14 14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
        </svg>
        <input
          type="text"
          placeholder="搜索工具…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="w-full rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 pl-11 pr-4 py-3.5 text-sm text-slate-800 dark:text-slate-200 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-400 shadow-sm transition-all"
        />
      </div>

      {/* 分类 Tab */}
      <div className="flex gap-1.5 flex-wrap">
        {CATEGORY_TABS.map(tab => (
          <button
            key={tab.key}
            onClick={() => setCategory(tab.key)}
            className={`px-3.5 py-1.5 rounded-full text-xs font-semibold transition-all duration-150 ${
              category === tab.key
                ? 'text-white shadow-sm'
                : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700'
            }`}
            style={category === tab.key ? { backgroundColor: '#1A8FE3' } : undefined}>
            {tab.label}
          </button>
        ))}
      </div>

      {/* 工具网格 */}
      {filtered.length === 0 ? (
        <div className="py-12 text-center text-sm text-slate-400 dark:text-slate-500">没有匹配的工具</div>
      ) : (
        <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
          {filtered.map((card, idx) => (
            <button
              key={`${card.id}-${card.iconType}-${idx}`}
              onClick={() => onNavigate(card.id as Parameters<typeof onNavigate>[0], (card as any).subPage)}
              className="flex flex-col items-center gap-2 p-3 bg-white dark:bg-slate-800 rounded-xl border border-slate-100 dark:border-slate-700 hover:shadow-md hover:border-slate-200 dark:hover:border-slate-600 transition-all duration-150 text-center w-full">
              {/* 图标框 */}
              <div className="w-10 h-10 rounded-xl shrink-0 flex items-center justify-center"
                style={{ background: card.iconBg }}>
                <ToolIcon type={card.iconType} color={card.iconColor} size={22} />
              </div>
              {/* 文字 */}
              <div className="min-w-0 w-full">
                <div className="text-xs font-semibold text-slate-800 dark:text-slate-100 leading-tight line-clamp-1">
                  {card.label}
                </div>
                <div className="text-[10px] text-slate-500 dark:text-slate-400 mt-0.5 leading-snug line-clamp-1">
                  {card.desc}
                </div>
              </div>
            </button>
          ))}
        </div>
      )}

      {/* 最近任务 */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-semibold text-slate-400 dark:text-slate-500 uppercase tracking-wider">最近任务</span>
          {hasJobs && (
            <button onClick={() => onNavigate('tasks')}
              className="text-xs text-blue-500 hover:text-blue-600 dark:text-blue-400 dark:hover:text-blue-300 transition-colors">
              查看全部 →
            </button>
          )}
        </div>
        {!hasJobs ? (
          <p className="text-xs text-slate-400 dark:text-slate-500">运行一个任务，结果会出现在这里</p>
        ) : (
          <div className="flex gap-2 overflow-x-auto pb-1" style={{ scrollbarWidth: 'none' }}>
            {recent.map(job => (
              <div key={job.id}
                className="flex items-center gap-1.5 rounded-full bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 px-3 py-1.5 shrink-0">
                <JobTypeIcon type={job.type} size={18} />
                <span className="text-xs text-slate-600 dark:text-slate-300 max-w-[110px] truncate">{job.label}</span>
                {job.status === 'running'   && <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse shrink-0"/>}
                {job.status === 'completed' && <span className="text-[10px] text-emerald-500 shrink-0">✓</span>}
                {job.status === 'failed'    && <span className="text-[10px] text-red-400 shrink-0">✗</span>}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
