import { PROVIDER_MODELS, DEFAULT_MODELS } from '../../constants';
import { useState, useRef, useEffect, useCallback } from 'react';

export const INPUT_CLS = 'w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm text-slate-800 placeholder:text-slate-400 focus:border-[#1A8FE3] focus:ring-2 focus:ring-[#1A8FE3]/15 outline-none transition-all dark:bg-slate-800 dark:border-slate-700 dark:text-slate-200 dark:placeholder:text-slate-500';

export default function ModelInput({
  value, onChange, task, provider, placeholder,
}: {
  value: string; onChange: (v: string) => void;
  task: string; provider: string; placeholder?: string;
}) {
  const options = PROVIDER_MODELS[task]?.[provider] ?? [];
  const defaultModel = DEFAULT_MODELS[task]?.[provider];
  const ph = placeholder ?? (defaultModel ? `默认：${defaultModel}` : '留空用默认');

  const [open, setOpen] = useState(false);
  const [activeIdx, setActiveIdx] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const filtered = options.length === 0
    ? []
    : value.trim() === ''
      ? options
      : options.filter(m => m.toLowerCase().includes(value.toLowerCase()));

  const showDrop = open && filtered.length > 0;

  const select = useCallback((m: string) => {
    onChange(m);
    setOpen(false);
    setActiveIdx(-1);
    inputRef.current?.blur();
  }, [onChange]);

  // 点击外部关闭
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (!containerRef.current?.contains(e.target as Node)) {
        setOpen(false);
        setActiveIdx(-1);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // 活跃项滚动到视野
  useEffect(() => {
    if (activeIdx >= 0 && listRef.current) {
      const el = listRef.current.children[activeIdx] as HTMLElement;
      el?.scrollIntoView({ block: 'nearest' });
    }
  }, [activeIdx]);

  if (options.length === 0) {
    return (
      <input
        className={INPUT_CLS}
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={ph}
        autoComplete="off"
      />
    );
  }

  return (
    <div ref={containerRef} className="relative w-full">
      <input
        ref={inputRef}
        className={INPUT_CLS}
        value={value}
        placeholder={ph}
        autoComplete="off"
        spellCheck={false}
        onFocus={() => { setOpen(true); setActiveIdx(-1); }}
        onChange={e => { onChange(e.target.value); setOpen(true); setActiveIdx(-1); }}
        onKeyDown={e => {
          if (!showDrop) return;
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            setActiveIdx(i => Math.min(i + 1, filtered.length - 1));
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setActiveIdx(i => Math.max(i - 1, -1));
          } else if (e.key === 'Enter') {
            if (activeIdx >= 0) { e.preventDefault(); select(filtered[activeIdx]); }
          } else if (e.key === 'Escape') {
            setOpen(false); setActiveIdx(-1);
          }
        }}
      />

      {showDrop && (
        <ul
          ref={listRef}
          className="absolute z-50 mt-1 w-full max-h-52 overflow-y-auto rounded-xl border border-slate-200 bg-white shadow-lg py-1"
        >
          {filtered.map((m, i) => (
            <li
              key={m}
              className={`px-3.5 py-2 text-sm cursor-pointer select-none transition-colors ${
                i === activeIdx
                  ? 'bg-indigo-50 text-indigo-700'
                  : 'text-slate-700 hover:bg-slate-50'
              }`}
              onMouseDown={e => { e.preventDefault(); select(m); }}
              onMouseEnter={() => setActiveIdx(i)}
            >
              {m}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
