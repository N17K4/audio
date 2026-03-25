import React from 'react';
import type { Page } from './Sidebar';
import type { Job } from '../../types';

interface NavItemDef {
  label: string;
  page: Page;
}

const NAV_ITEMS: NavItemDef[] = [
  { label: '首页',   page: 'home' },
  { label: '音频工具', page: 'audio_tools' },
  { label: '图像工具', page: 'image_tools' },
  { label: '视频工具', page: 'video_tools' },
  { label: '格式转换', page: 'format_convert' },
];

interface TopNavProps {
  currentPage: Page;
  jobs: Job[];
  isDark: boolean;
  isDocker?: boolean;
  setIsDark: React.Dispatch<React.SetStateAction<boolean>>;
  onNavigate: (page: Page, subPage?: string) => void;
}

export default function TopNav({ currentPage, jobs, isDark, isDocker, setIsDark, onNavigate }: TopNavProps) {
  const activeBadge = jobs.filter(j => j.status === 'queued' || j.status === 'running').length;

  return (
    <header className="h-[60px] bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-700 shadow-sm flex items-center px-6 sticky top-0 z-50 shrink-0">
      {/* Logo */}
      <button
        onClick={() => onNavigate('home')}
        className="flex items-center gap-2 mr-8 shrink-0 hover:opacity-80 transition-opacity"
      >
        <svg width="30" height="30" viewBox="0 0 30 30">
          <rect width="30" height="30" rx="8" fill="#1A8FE3" />
          <path d="M7 20 Q15 8 23 20" stroke="#bfdbfe" strokeWidth="2.5" fill="none" strokeLinecap="round"/>
          <path d="M10 20 Q15 12 20 20" stroke="#93c5fd" strokeWidth="2" fill="none" strokeLinecap="round"/>
          <circle cx="15" cy="10" r="2" fill="#dbeafe" />
        </svg>
        <span className="font-bold text-slate-800 dark:text-slate-100 text-sm" style={{ fontFamily: "'PingFang SC','Microsoft YaHei',sans-serif" }}>
          AI 工坊
        </span>
      </button>

      {/* Nav items */}
      <nav className="flex items-center gap-0.5 flex-1">
        {NAV_ITEMS.map(item => {
          const active = currentPage === item.page;
          return (
            <button
              key={item.label}
              onClick={() => onNavigate(item.page)}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${
                active
                  ? 'text-[#1A8FE3] bg-blue-50 dark:bg-blue-950/30'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800'
              }`}
            >
              {item.label}
            </button>
          );
        })}
      </nav>

      {/* Right side */}
      <div className="flex items-center gap-2">
        {/* Tasks */}
        <button
          onClick={() => onNavigate('tasks')}
          title="任务列表"
          className={`relative flex items-center justify-center w-8 h-8 rounded-lg transition-colors ${
            currentPage === 'tasks'
              ? 'bg-blue-50 dark:bg-blue-950/30 text-[#1A8FE3]'
              : 'text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-700 dark:hover:text-slate-200'
          }`}
        >
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/>
            <line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/>
            <line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/>
          </svg>
          {activeBadge > 0 && (
            <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 rounded-full bg-orange-500 text-white text-[10px] font-bold flex items-center justify-center px-0.5">
              {activeBadge > 9 ? '9+' : activeBadge}
            </span>
          )}
        </button>

        {/* Models */}
        {!isDocker && (
          <button
            onClick={() => onNavigate('system')}
            title="模型管理"
            className={`flex items-center justify-center w-8 h-8 rounded-lg transition-colors ${
              currentPage === 'system'
                ? 'bg-blue-50 dark:bg-blue-950/30 text-[#1A8FE3]'
                : 'text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-700 dark:hover:text-slate-200'
            }`}
          >
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M3 5v6c0 1.66 4.03 3 9 3s9-1.34 9-3V5"/>
              <path d="M3 11v6c0 1.66 4.03 3 9 3s9-1.34 9-3v-6"/>
            </svg>
          </button>
        )}

        {/* Dark mode toggle */}
        <button
          onClick={() => setIsDark(v => !v)}
          title={isDark ? '切换到亮色模式' : '切换到暗色模式'}
          className="flex items-center w-[46px] h-[26px] rounded-full transition-all duration-300 border border-slate-200 dark:border-slate-600 shrink-0"
          style={{ background: isDark ? '#334155' : '#e0f2fe' }}
        >
          <span className={`inline-flex w-[20px] h-[20px] rounded-full shadow-sm items-center justify-center text-[10px] font-bold transition-all duration-300 ${isDark ? 'translate-x-[22px] bg-slate-200 text-slate-700' : 'translate-x-[2px] bg-white text-sky-600'}`}>
            {isDark ? '晚' : '早'}
          </span>
        </button>
      </div>
    </header>
  );
}
