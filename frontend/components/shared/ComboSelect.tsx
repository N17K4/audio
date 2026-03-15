import { useState, useRef, useEffect, useCallback } from 'react';

const BASE = 'w-full rounded-xl border border-slate-200 bg-white text-slate-800 placeholder:text-slate-400 focus:border-indigo-400 focus:ring-2 focus:ring-indigo-500/15 outline-none transition-all';
const NORMAL_CLS = `${BASE} px-3.5 py-2.5 text-sm`;
const COMPACT_CLS = `${BASE} px-2.5 py-2 text-xs`;

export default function ComboSelect({
  value, onChange, options, placeholder, allowCustom = false, compact = false,
}: {
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  placeholder?: string;
  allowCustom?: boolean;
  compact?: boolean;
}) {
  const currentLabel = options.find(o => o.value === value)?.label ?? value;
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [activeIdx, setActiveIdx] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const displayValue = open ? query : currentLabel;
  const filtered = query.trim()
    ? options.filter(o =>
        o.label.toLowerCase().includes(query.toLowerCase()) ||
        o.value.toLowerCase().includes(query.toLowerCase())
      )
    : options;
  const showDrop = open && filtered.length > 0;

  const select = useCallback((opt: { value: string; label: string }) => {
    onChange(opt.value);
    setQuery('');
    setOpen(false);
    setActiveIdx(-1);
  }, [onChange]);

  const close = useCallback(() => {
    setOpen(false);
    setQuery('');
    setActiveIdx(-1);
  }, []);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (!containerRef.current?.contains(e.target as Node)) close();
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [close]);

  useEffect(() => {
    if (activeIdx >= 0 && listRef.current) {
      const el = listRef.current.children[activeIdx] as HTMLElement;
      el?.scrollIntoView({ block: 'nearest' });
    }
  }, [activeIdx]);

  return (
    <div ref={containerRef} className="relative w-full">
      <input
        ref={inputRef}
        className={compact ? COMPACT_CLS : NORMAL_CLS}
        value={displayValue}
        placeholder={placeholder ?? '选择或输入...'}
        autoComplete="off"
        spellCheck={false}
        onFocus={() => { setOpen(true); setQuery(''); setActiveIdx(-1); }}
        onChange={e => {
          const v = e.target.value;
          setQuery(v);
          setOpen(true);
          setActiveIdx(-1);
          if (allowCustom) onChange(v);
        }}
        onKeyDown={e => {
          if (!showDrop) return;
          if (e.key === 'ArrowDown') { e.preventDefault(); setActiveIdx(i => Math.min(i + 1, filtered.length - 1)); }
          else if (e.key === 'ArrowUp') { e.preventDefault(); setActiveIdx(i => Math.max(i - 1, -1)); }
          else if (e.key === 'Enter' && activeIdx >= 0) { e.preventDefault(); select(filtered[activeIdx]); }
          else if (e.key === 'Escape') close();
        }}
      />
      {showDrop && (
        <ul ref={listRef} className="absolute z-50 mt-1 w-full max-h-52 overflow-y-auto rounded-xl border border-slate-200 bg-white shadow-lg py-1">
          {filtered.map((opt, i) => (
            <li
              key={opt.value}
              className={`px-3.5 py-2 text-sm cursor-pointer select-none transition-colors ${
                i === activeIdx ? 'bg-indigo-50 text-indigo-700' : 'text-slate-700 hover:bg-slate-50'
              }`}
              onMouseDown={e => { e.preventDefault(); select(opt); }}
              onMouseEnter={() => setActiveIdx(i)}
            >
              {opt.label}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
