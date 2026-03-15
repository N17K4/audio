import React from 'react';
import type { Page } from './layout/Sidebar';

type HomeCard = { page: Page; title: string; subtitle: string; desc: string; icon: React.ReactNode };

const HOME_CARDS: HomeCard[] = [
  {
    page: 'audio_tools',
    title: 'AI音频',
    subtitle: 'TTS · VC · STT · LLM · 语音聊天',
    desc: '文本合成语音、音色转换、语音识别、大模型对话',
    icon: (
      <svg width="48" height="48" viewBox="0 0 48 48">
        <rect width="48" height="48" rx="12" fill="#4f46e5"/>
        <rect x="8"  y="22" width="4" height="10" rx="2" fill="#c7d2fe"/>
        <rect x="15" y="15" width="4" height="18" rx="2" fill="#a5b4fc"/>
        <rect x="22" y="10" width="4" height="28" rx="2" fill="#818cf8"/>
        <rect x="29" y="17" width="4" height="14" rx="2" fill="#a5b4fc"/>
        <rect x="36" y="24" width="4" height="7"  rx="2" fill="#c7d2fe"/>
      </svg>
    ),
  },
  {
    page: 'format_convert',
    title: '格式转换',
    subtitle: '音视频 · 文档',
    desc: 'FFmpeg 音视频互转、截取片段、文档格式处理',
    icon: (
      <svg width="48" height="48" viewBox="0 0 48 48">
        <rect width="48" height="48" rx="12" fill="#0f766e"/>
        <path d="M10 17h18M10 17l6-6M10 17l6 6" stroke="#99f6e4" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"/>
        <path d="M38 31H20M38 31l-6-6M38 31l-6 6" stroke="#5eead4" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"/>
      </svg>
    ),
  },
  {
    page: 'misc',
    title: 'AI扩展',
    subtitle: '图像 · 翻译 · 视频',
    desc: '图像生成与处理、多语言翻译、AI 视频生成',
    icon: (
      <svg width="48" height="48" viewBox="0 0 48 48">
        <rect width="48" height="48" rx="12" fill="#7c3aed"/>
        <rect x="10" y="10" width="12" height="12" rx="3" fill="#ddd6fe"/>
        <rect x="26" y="10" width="12" height="12" rx="3" fill="#c4b5fd"/>
        <rect x="10" y="26" width="12" height="12" rx="3" fill="#c4b5fd"/>
        <rect x="26" y="26" width="12" height="12" rx="3" fill="#a78bfa"/>
      </svg>
    ),
  },
];

interface HomePanelProps {
  onNavigate: (page: Page) => void;
}

export default function HomePanel({ onNavigate }: HomePanelProps) {
  return (
    <div className="space-y-8">
      {/* 页头 */}
      <div className="pt-2 text-center">
        <h1 className="text-4xl font-extrabold tracking-tight text-blue-700 dark:text-blue-400"
          style={{ fontFamily: "'PingFang SC','Microsoft YaHei',sans-serif", letterSpacing: '0.04em' }}>
          AI 工坊
        </h1>
        <p className="text-sm text-blue-400 mt-2 font-medium dark:text-blue-500">
          选择一项功能，立即开始
        </p>
      </div>

      {/* 三列卡片 */}
      <div className="grid grid-cols-3 gap-5">
        {HOME_CARDS.map(({ page, title, subtitle, desc, icon }) => (
          <button
            key={page}
            onClick={() => onNavigate(page)}
            className="group relative flex flex-col items-center gap-4 rounded-2xl border-2 border-blue-200 bg-white px-5 py-8 text-center shadow-md
              hover:-translate-y-1.5 hover:shadow-xl hover:border-blue-400 hover:shadow-blue-100
              active:translate-y-0 active:shadow-md
              transition-all duration-200 ease-out
              dark:bg-slate-900 dark:border-blue-800 dark:hover:border-blue-500 dark:hover:shadow-blue-900/30"
          >
            <div className="transition-transform duration-200 group-hover:scale-110">
              {icon}
            </div>
            <div>
              <div
                className="font-bold text-blue-800 group-hover:text-blue-600 dark:text-blue-300 dark:group-hover:text-blue-400 transition-colors"
                style={{ fontSize: '16px', fontFamily: "'PingFang SC','Microsoft YaHei',sans-serif" }}>
                {title}
              </div>
              <div className="text-xs text-blue-400 dark:text-blue-600 mt-0.5 font-medium">{subtitle}</div>
            </div>
            <div className="text-xs text-slate-400 dark:text-slate-500 leading-relaxed">
              {desc}
            </div>
            <div className="absolute inset-x-0 bottom-0 h-1 rounded-b-2xl bg-gradient-to-r from-blue-200 via-blue-400 to-blue-200 opacity-0 group-hover:opacity-100 transition-opacity duration-200" />
          </button>
        ))}
      </div>
    </div>
  );
}
