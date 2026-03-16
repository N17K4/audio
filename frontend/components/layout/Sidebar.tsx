import { TASK_LABELS } from '../../constants';
import type { TaskType, Job } from '../../types';

export type Page = 'home' | 'tasks' | 'system' | TaskType | 'audio_tools' | 'format_convert' | 'image_tools' | 'video_tools' | 'text_tools' | 'misc';

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
        className={`w-full flex items-center gap-3 px-2.5 py-2 rounded-xl text-sm font-semibold transition-all duration-150 ${
          active
            ? 'bg-blue-500 text-white shadow-sm dark:bg-blue-600 dark:text-white'
            : 'text-slate-600 hover:bg-slate-100 hover:text-slate-800 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-200'
        }`}
        style={{ justifyContent: sidebarCollapsed ? 'center' : 'flex-start' }}>
        {icon}
        {!sidebarCollapsed && (
          <div className="flex flex-col min-w-0 text-left">
            <span className="truncate leading-tight">{label}</span>
            {subtitle && <span className="text-xs opacity-60 truncate leading-tight">{subtitle}</span>}
          </div>
        )}
      </button>
    );
  }

  const activeBadge = jobs.filter(j => j.status === 'queued' || j.status === 'running').length;

  return (
    <>
      <aside
        className="flex flex-col shrink-0 border-r border-slate-200 overflow-hidden bg-white dark:bg-slate-900 dark:border-slate-800"
        style={{ width: sidebarCollapsed ? 60 : sidebarWidth, transition: isResizing ? 'none' : 'width 0.2s ease' }}>

        {/* 品牌区 — 点击返回首页 */}
        <button
          onClick={() => onNavigate('home')}
          className={`flex items-center py-4 border-b border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors ${sidebarCollapsed ? 'justify-center px-0 w-full' : 'px-4 gap-2.5 w-full'}`}>
          <svg width="30" height="30" viewBox="0 0 30 30" style={{ flexShrink: 0 }}>
            <rect width="30" height="30" rx="8" fill="#3b82f6" />
            <path d="M7 20 Q15 8 23 20" stroke="#bfdbfe" strokeWidth="2.5" fill="none" strokeLinecap="round"/>
            <path d="M10 20 Q15 12 20 20" stroke="#93c5fd" strokeWidth="2" fill="none" strokeLinecap="round"/>
            <circle cx="15" cy="10" r="2" fill="#dbeafe" />
          </svg>
          {!sidebarCollapsed && (
            <span className="font-extrabold text-blue-700 dark:text-slate-100 text-sm truncate text-left"
              style={{ fontFamily: "'PingFang SC','Microsoft YaHei',sans-serif", letterSpacing: '0.03em' }}>
              AI 工坊
            </span>
          )}
        </button>

        {/* 主导航 */}
        <nav className="flex-1 py-2 px-2 space-y-1 overflow-y-auto overflow-x-hidden">
          <NavItem page="audio_tools" label="音频工具" subtitle="TTS · 音色转换 · STT · 语音聊天" icon={
            <svg width="28" height="28" viewBox="0 0 28 28" style={{ flexShrink: 0 }}>
              <rect width="28" height="28" rx="7" fill="#4f46e5"/>
              <rect x="5" y="13" width="2.5" height="6" rx="1.2" fill="#c7d2fe"/>
              <rect x="9" y="9" width="2.5" height="10" rx="1.2" fill="#a5b4fc"/>
              <rect x="13" y="6" width="2.5" height="16" rx="1.2" fill="#818cf8"/>
              <rect x="17" y="10" width="2.5" height="8" rx="1.2" fill="#a5b4fc"/>
              <rect x="21" y="14" width="2.5" height="4" rx="1.2" fill="#c7d2fe"/>
            </svg>
          } />
          <NavItem page="image_tools" label="图像工具" subtitle="图像生成 · 换脸 · OCR" icon={
            <svg width="28" height="28" viewBox="0 0 28 28" style={{ flexShrink: 0 }}>
              <rect width="28" height="28" rx="7" fill="#db2777"/>
              <rect x="5" y="7" width="18" height="14" rx="3" fill="none" stroke="#fce7f3" strokeWidth="1.5"/>
              <circle cx="10" cy="12" r="2" fill="#fbcfe8"/>
              <path d="M5 18l5-5 4 4 3-3 6 4" stroke="#f9a8d4" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          } />
          <NavItem page="video_tools" label="视频工具" subtitle="视频生成 · 唇形同步" icon={
            <svg width="28" height="28" viewBox="0 0 28 28" style={{ flexShrink: 0 }}>
              <rect width="28" height="28" rx="7" fill="#0f766e"/>
              <rect x="4" y="8" width="14" height="12" rx="2.5" fill="none" stroke="#99f6e4" strokeWidth="1.5"/>
              <path d="M18 12l6-3v10l-6-3V12z" fill="#5eead4"/>
            </svg>
          } />
          <NavItem page="text_tools" label="文字工具" subtitle="LLM · 翻译 · 代码" icon={
            <svg width="28" height="28" viewBox="0 0 28 28" style={{ flexShrink: 0 }}>
              <rect width="28" height="28" rx="7" fill="#0284c7"/>
              <path d="M7 9h14M7 14h10M7 19h8" stroke="#bae6fd" strokeWidth="2" strokeLinecap="round"/>
            </svg>
          } />
          <NavItem page="format_convert" label="格式转换" subtitle="音视频 · 文档" icon={
            <svg width="28" height="28" viewBox="0 0 28 28" style={{ flexShrink: 0 }}>
              <rect width="28" height="28" rx="7" fill="#0f766e"/>
              <path d="M7 10h10M7 10l3-3M7 10l3 3" stroke="#99f6e4" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              <path d="M21 18H11M21 18l-3-3M21 18l-3 3" stroke="#5eead4" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          } />
        </nav>

        {/* 底部工具区 */}
        <div className="px-2 pb-1 space-y-1">
          <NavItem page="tasks" label="任务列表" icon={
            <svg width="28" height="28" viewBox="0 0 28 28" style={{ flexShrink: 0 }}>
              <rect width="28" height="28" rx="7" fill="#15803d"/>
              <rect x="7" y="8" width="14" height="2.5" rx="1.25" fill="#bbf7d0"/>
              <rect x="7" y="12.75" width="10" height="2.5" rx="1.25" fill="#bbf7d0"/>
              <rect x="7" y="17.5" width="7" height="2.5" rx="1.25" fill="#bbf7d0"/>
              {activeBadge > 0 && <>
                <circle cx="22" cy="7" r="5" fill="#f97316"/>
                <text x="22" y="7" dominantBaseline="central" textAnchor="middle" fontSize="6" fontWeight="700" fill="#fff" fontFamily="-apple-system,sans-serif">{activeBadge > 9 ? '9+' : activeBadge}</text>
              </>}
            </svg>
          } />
          <NavItem page="system" label="设置" icon={
            <svg width="28" height="28" viewBox="0 0 28 28" style={{ flexShrink: 0 }}>
              <rect width="28" height="28" rx="7" fill="#334155"/>
              <path d="M10.325 8.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" fill="none" stroke="#94a3b8" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              <path d="M16 14a2 2 0 11-4 0 2 2 0 014 0z" fill="none" stroke="#94a3b8" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          } />
        </div>

        {/* 折叠按钮 */}
        <div className="border-t border-slate-200 dark:border-slate-800 p-2">
          <button
            onClick={onToggleCollapse}
            className="w-full flex items-center justify-center rounded-xl py-2 text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:text-slate-500 dark:hover:bg-slate-800 dark:hover:text-slate-300 transition-colors"
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
          className="w-px shrink-0 cursor-col-resize bg-slate-200 hover:bg-slate-400 dark:bg-slate-800 dark:hover:bg-slate-600 transition-colors"
          onMouseDown={onResizeStart}
        />
      )}
    </>
  );
}
