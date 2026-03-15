import { TASK_LABELS } from '../../constants';
import type { TaskType, Job } from '../../types';
import TaskIcon from '../icons/TaskIcon';
import HomeIcon from '../icons/HomeIcon';
import TasksIcon from '../icons/TasksIcon';

export type Page = 'home' | 'tasks' | 'system' | TaskType;

interface SidebarProps {
  currentPage: Page;
  sidebarCollapsed: boolean;
  sidebarWidth: number;
  isResizing: boolean;
  jobs: Job[];
  onNavigate: (page: Page) => void;
  onToggleCollapse: () => void;
  onResizeStart: (e: React.MouseEvent) => void;
}

export default function Sidebar({
  currentPage,
  sidebarCollapsed,
  sidebarWidth,
  isResizing,
  jobs,
  onNavigate,
  onToggleCollapse,
  onResizeStart,
}: SidebarProps) {
  function NavItem({ page, label, subtitle, icon }: { page: Page; label: string; subtitle?: string; icon: React.ReactNode }) {
    const active = currentPage === page;
    return (
      <button
        onClick={() => onNavigate(page)}
        title={sidebarCollapsed ? label : undefined}
        className={`w-full flex items-center gap-3 px-2.5 py-2 rounded-xl text-sm font-medium transition-all duration-150 ${
          active
            ? 'bg-sky-100 text-sky-700 dark:bg-slate-700 dark:text-sky-400'
            : 'text-sky-600 hover:bg-sky-100/70 hover:text-sky-800 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-200'
        }`}
        style={{ justifyContent: sidebarCollapsed ? 'center' : 'flex-start' }}>
        {icon}
        {!sidebarCollapsed && (
          <div className="flex flex-col min-w-0 text-left">
            <span className="truncate leading-tight">{label}</span>
            {subtitle && <span className="text-xs opacity-50 truncate leading-tight">{subtitle}</span>}
          </div>
        )}
      </button>
    );
  }

  const activeBadge = jobs.filter(j => j.status === 'queued' || j.status === 'running').length;

  return (
    <>
      <aside
        className="flex flex-col shrink-0 bg-sky-50 border-r border-sky-100 overflow-hidden dark:bg-slate-900 dark:border-slate-800"
        style={{ width: sidebarCollapsed ? 60 : sidebarWidth, transition: isResizing ? 'none' : 'width 0.2s ease' }}>

        {/* 品牌区 */}
        <div className={`flex items-center py-5 border-b border-sky-100 dark:border-slate-800 ${sidebarCollapsed ? 'justify-center px-0' : 'px-4 gap-2.5'}`}>
          <svg width="28" height="28" viewBox="0 0 28 28" style={{ flexShrink: 0 }}>
            <rect width="28" height="28" rx="7" fill="#0ea5e9" />
            <path d="M7 18 Q14 8 21 18" stroke="#e0f2fe" strokeWidth="2.2" fill="none" strokeLinecap="round"/>
            <path d="M9 18 Q14 11 19 18" stroke="#bae6fd" strokeWidth="2" fill="none" strokeLinecap="round"/>
          </svg>
          {!sidebarCollapsed && <span className="font-semibold text-sky-900 dark:text-slate-100 text-sm truncate tracking-tight">AI 音频工作台</span>}
        </div>

        {/* 导航 */}
        <nav className="flex-1 py-3 px-2 space-y-0.5 overflow-y-auto overflow-x-hidden">
          <NavItem page="home" label="首页" icon={<HomeIcon />} />
          <div className="my-2 border-t border-sky-100 dark:border-slate-800" />
          {(Object.keys(TASK_LABELS) as TaskType[]).filter(t => t !== 'media' && t !== 'doc').map(t => (
            <NavItem key={t} page={t} label={TASK_LABELS[t]} icon={<TaskIcon task={t} />} />
          ))}
        </nav>

        {/* 底部导航 - 格式转换 & 任务列表 & 系统工具 */}
        <div className="border-t border-sky-100 dark:border-slate-800 px-2 py-2 space-y-0.5">
          <NavItem page="media" label="音视频转换" subtitle="FFmpeg" icon={<TaskIcon task="media" />} />
          <NavItem page="doc"   label="文档转换"   subtitle="pandoc · pdf2docx · PyMuPDF" icon={<TaskIcon task="doc" />} />
          <NavItem page="tasks" label="任务列表" icon={<TasksIcon badge={activeBadge} />} />
          <NavItem page="system" label="系统工具" icon={<svg width="28" height="28" viewBox="0 0 28 28" style={{ flexShrink: 0 }}><rect width="28" height="28" rx="7" fill="#f1f5f9"/><path d="M10.325 8.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" fill="none" stroke="#64748b" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/><path d="M16 14a2 2 0 11-4 0 2 2 0 014 0z" fill="none" stroke="#64748b" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>} />
        </div>

        {/* 折叠按钮 */}
        <div className="border-t border-sky-100 dark:border-slate-800 p-2">
          <button
            onClick={onToggleCollapse}
            className="w-full flex items-center justify-center rounded-xl py-2 text-sky-400 hover:bg-sky-100 hover:text-sky-600 dark:text-slate-500 dark:hover:bg-slate-800 dark:hover:text-slate-300 transition-colors"
            title={sidebarCollapsed ? '展开' : '收起'}>
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              {sidebarCollapsed
                ? <path d="M6 3l5 5-5 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                : <path d="M10 3L5 8l5 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>}
            </svg>
          </button>
        </div>
      </aside>

      {/* ── 拖拽调宽手柄 ── */}
      {!sidebarCollapsed && (
        <div
          className="w-px shrink-0 cursor-col-resize bg-sky-100 hover:bg-sky-300 dark:bg-slate-800 dark:hover:bg-slate-600 transition-colors"
          onMouseDown={onResizeStart}
        />
      )}
    </>
  );
}
