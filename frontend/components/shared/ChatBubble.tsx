interface ChatBubbleProps {
  role: 'user' | 'assistant';
  content: string;
  audioUrl?: string;
  showAvatar?: boolean;
}

export default function ChatBubble({ role, content, audioUrl, showAvatar }: ChatBubbleProps) {
  const isUser = role === 'user';
  return (
    <div className={`flex items-end gap-2 ${isUser ? 'justify-end' : 'justify-start'}`}>
      {!isUser && showAvatar && (
        <div className="w-7 h-7 rounded-full bg-indigo-100 dark:bg-indigo-900/60 flex items-center justify-center text-[10px] font-semibold text-indigo-600 dark:text-indigo-300 shrink-0">AI</div>
      )}
      <div className={`max-w-[80%] space-y-1.5`}>
        <div className={`rounded-2xl px-4 py-2.5 text-sm whitespace-pre-wrap leading-relaxed ${
          isUser
            ? 'bg-indigo-600 text-white rounded-br-md shadow-sm'
            : 'bg-white border border-slate-200 text-slate-800 rounded-bl-md shadow-sm dark:bg-slate-800 dark:border-slate-700 dark:text-slate-200'
        }`}>
          {content}
        </div>
        {audioUrl && <audio controls src={audioUrl} className="w-full h-8" />}
      </div>
      {isUser && showAvatar && (
        <div className="w-7 h-7 rounded-full bg-slate-200 dark:bg-slate-700 flex items-center justify-center text-[10px] font-semibold text-slate-500 dark:text-slate-300 shrink-0">我</div>
      )}
    </div>
  );
}
