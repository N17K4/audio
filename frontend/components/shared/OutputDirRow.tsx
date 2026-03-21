import { useState, useEffect, useCallback } from 'react';

interface OutputDirRowProps {
  required?: boolean;
  outputDir: string;
  setOutputDir: (v: string) => void;
  fieldCls: string;
  labelCls: string;
  btnSec: string;
}

interface DirEntry { name: string; path: string; }
interface BrowseResult {
  ok: boolean;
  current: string;
  parent: string | null;
  dirs: DirEntry[];
  shortcuts: DirEntry[];
  error?: string;
}

/** 自动检测后端地址（与 useBackend 同逻辑） */
function detectBackendUrl(): string {
  if (typeof window === 'undefined') return 'http://127.0.0.1:8000';
  const params = new URLSearchParams(window.location.search);
  const fromParam = params.get('backendUrl');
  if (fromParam) return fromParam;
  return 'http://127.0.0.1:8000';
}

export default function OutputDirRow({ required, outputDir, setOutputDir, fieldCls, labelCls, btnSec }: OutputDirRowProps) {
  const [open, setOpen] = useState(false);
  const [browsePath, setBrowsePath] = useState('');
  const [browseResult, setBrowseResult] = useState<BrowseResult | null>(null);
  const [selected, setSelected] = useState('');          // 单击选中的目录
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [backendUrl, setBackendUrl] = useState('');

  useEffect(() => {
    const detected = detectBackendUrl();
    if (typeof window !== 'undefined' && !new URLSearchParams(window.location.search).get('backendUrl')) {
      const origin = window.location.origin;
      fetch(`${origin}/health`).then(r => {
        if (r.ok) setBackendUrl(origin);
        else setBackendUrl(detected);
      }).catch(() => setBackendUrl(detected));
    } else {
      setBackendUrl(detected);
    }
  }, []);

  const browse = useCallback(async (path: string) => {
    if (!backendUrl) return;
    setLoading(true);
    setError('');
    setSelected('');
    try {
      const url = `${backendUrl}/system/browse-dir?path=${encodeURIComponent(path)}`;
      const res = await fetch(url);
      const data: BrowseResult = await res.json();
      if (data.ok) {
        setBrowseResult(data);
        setBrowsePath(data.current);
      } else {
        setError(data.error || '无法访问');
      }
    } catch {
      setError('请求失败');
    } finally {
      setLoading(false);
    }
  }, [backendUrl]);

  const handleOpen = () => {
    setOpen(true);
    browse(outputDir || '');
  };

  const handleSelect = () => {
    // 如有选中子目录则用子目录，否则用当前浏览路径
    setOutputDir(selected || browsePath);
    setOpen(false);
  };

  return (
    <>
      <label className="block">
        <span className={labelCls}>输出目录{required ? '' : '（可选）'}</span>
        <div className="flex w-full rounded-xl border border-slate-200 bg-slate-50/50 text-sm overflow-hidden transition-all focus-within:border-[#1A8FE3] focus-within:ring-2 focus-within:ring-[#1A8FE3]/15 dark:border-slate-700 dark:bg-slate-800/50">
          <input
            className="flex-1 bg-transparent px-3 py-2.5 text-slate-800 placeholder:text-slate-400 outline-none dark:text-slate-200"
            value={outputDir} onChange={e => setOutputDir(e.target.value)} placeholder="/保存/输出/路径" />
          <button type="button" onClick={handleOpen}
            className="px-3 py-2 text-slate-500 hover:text-[#1A8FE3] transition-colors shrink-0 dark:text-slate-400 dark:hover:text-[#1A8FE3]"
            title="浏览目录">
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
            </svg>
          </button>
        </div>
      </label>

      {/* ディレクトリ選択モーダル */}
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setOpen(false)}>
          <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-2xl w-[640px] max-w-[90vw] max-h-[80vh] flex flex-col overflow-hidden"
            onClick={e => e.stopPropagation()}>

            {/* ── ヘッダー ── */}
            <div className="px-6 pt-5 pb-4 border-b border-slate-200 dark:border-slate-700">
              <h3 className="text-lg font-semibold text-slate-800 dark:text-slate-100 mb-3">选择输出目录</h3>
              <div className="flex items-center gap-2">
                <input
                  className="flex-1 text-sm px-3 py-2 rounded-lg bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-200 outline-none border border-slate-200 dark:border-slate-600 focus:border-[#1A8FE3] transition-colors"
                  value={browsePath}
                  onChange={e => setBrowsePath(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') browse(browsePath); }}
                  placeholder="输入路径后回车" />
                <button type="button" onClick={() => browse(browsePath)}
                  className="text-sm px-4 py-2 rounded-lg bg-[#1A8FE3] text-white hover:bg-[#1577c5] transition-colors whitespace-nowrap">
                  前往
                </button>
              </div>
            </div>

            {/* ── ショートカット ── */}
            {browseResult?.shortcuts && browseResult.shortcuts.length > 0 && (
              <div className="px-6 py-2.5 flex gap-2 border-b border-slate-100 dark:border-slate-700 flex-wrap">
                {browseResult.shortcuts.map(s => (
                  <button key={s.path} type="button" onClick={() => browse(s.path)}
                    className="text-sm px-3 py-1.5 rounded-lg bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-600 transition-colors">
                    {s.name}
                  </button>
                ))}
              </div>
            )}

            {/* ── ディレクトリリスト ── */}
            <div className="flex-1 overflow-y-auto px-3 py-2 min-h-0">
              {loading && <div className="text-center text-sm text-slate-400 py-12">加载中…</div>}
              {error && <div className="text-center text-sm text-red-500 py-12">{error}</div>}
              {!loading && !error && browseResult && (
                <>
                  {/* 上级目录 */}
                  {browseResult.parent && (
                    <button type="button" onClick={() => browse(browseResult.parent!)}
                      className="w-full text-left px-4 py-2.5 rounded-lg text-sm text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 flex items-center gap-3 transition-colors">
                      <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
                        <path d="M15 18l-6-6 6-6" />
                      </svg>
                      <span>..（上级目录）</span>
                    </button>
                  )}

                  {browseResult.dirs.length === 0 && (
                    <div className="text-center text-sm text-slate-400 py-12">此目录下无子目录</div>
                  )}

                  {/* 子目录列表：单击选中、双击进入 */}
                  {browseResult.dirs.map(d => (
                    <button key={d.path} type="button"
                      onClick={() => setSelected(d.path)}
                      onDoubleClick={() => browse(d.path)}
                      className={`w-full text-left px-4 py-2.5 rounded-lg text-sm flex items-center gap-3 transition-colors cursor-default
                        ${selected === d.path
                          ? 'bg-[#1A8FE3]/10 text-[#1A8FE3] dark:bg-[#1A8FE3]/20 dark:text-[#5bb8f5]'
                          : 'text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700'}`}>
                      <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
                        className={`shrink-0 ${selected === d.path ? 'text-[#1A8FE3]' : 'text-amber-500'}`}>
                        <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
                      </svg>
                      <span className="truncate">{d.name}</span>
                    </button>
                  ))}
                </>
              )}
            </div>

            {/* ── フッター ── */}
            <div className="px-6 py-4 border-t border-slate-200 dark:border-slate-700 flex items-center justify-between gap-4">
              <span className="text-sm text-slate-500 dark:text-slate-400 truncate flex-1 select-all"
                title={selected || browsePath}>
                {selected || browsePath}
              </span>
              <div className="flex gap-3 shrink-0">
                <button type="button" onClick={() => setOpen(false)}
                  className="px-5 py-2 rounded-lg text-sm text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors">
                  取消
                </button>
                <button type="button" onClick={handleSelect}
                  className="px-5 py-2 rounded-lg text-sm bg-[#1A8FE3] text-white hover:bg-[#1577c5] transition-colors font-medium">
                  选择此目录
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
