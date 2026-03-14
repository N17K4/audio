import type { TaskType } from '../types';
import type { Page } from './layout/Sidebar';
import TaskIcon from './icons/TaskIcon';

const HOME_CARDS: { task: TaskType; title: string; desc: string }[] = [
  { task: 'tts',        title: 'TTS 文本转语音', desc: '输入文字，选择音色，生成语音文件' },
  { task: 'vc',         title: 'VC 音色转换',   desc: '将音频转换为目标音色，支持本地和云端' },
  { task: 'asr',        title: 'STT 语音转文字', desc: '上传音频，识别为文字，支持多语言' },
  { task: 'llm',        title: 'LLM 聊天',      desc: '与大语言模型对话，支持多种服务商' },
  { task: 'media',      title: '格式转换',       desc: '音频互转、视频提取音频、按时间截取片段' },
  { task: 'voice_chat', title: 'LLM 语音聊天',  desc: '语音输入 → AI 回复 → 语音播报' },
];

interface HomePanelProps {
  onNavigate: (page: Page) => void;
}

export default function HomePanel({ onNavigate }: HomePanelProps) {
  return (
    <div className="space-y-8">
      <div className="pt-2">
        <h1 className="text-3xl font-bold tracking-tight text-slate-900 dark:text-slate-50">AI 音频工作台</h1>
        <p className="text-sm text-slate-400 mt-2 font-medium dark:text-slate-500">选择一项功能开始使用</p>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {HOME_CARDS.map(({ task, title, desc }) => (
          <button key={task} onClick={() => onNavigate(task)}
            className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-card text-left hover:border-indigo-300/80 hover:shadow-panel transition-all duration-200 group active:scale-[0.99] dark:bg-slate-900 dark:border-slate-700/80 dark:hover:border-indigo-500/50">
            <div className="flex items-start gap-4">
              <TaskIcon task={task} size={40} />
              <div className="flex-1 min-w-0">
                <div className="font-semibold text-slate-800 group-hover:text-indigo-700 dark:text-slate-200 dark:group-hover:text-indigo-400 transition-colors text-[15px]">{title}</div>
                <div className="text-xs text-slate-400 dark:text-slate-500 mt-1 leading-relaxed">{desc}</div>
              </div>
              <svg className="w-4 h-4 text-slate-300 group-hover:text-indigo-400 dark:text-slate-600 mt-0.5 shrink-0 transition-colors" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
