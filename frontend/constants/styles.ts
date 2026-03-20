// ─── 共享样式常量 ─────────────────────────────────────────────────────────
export const fieldCls = 'w-full rounded-xl border border-slate-200 bg-slate-50/50 px-3.5 py-2.5 text-sm text-slate-800 placeholder:text-slate-400 focus:border-[#1A8FE3] focus:bg-white focus:ring-2 focus:ring-[#1A8FE3]/15 transition-all dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200 dark:placeholder:text-slate-500 dark:focus:bg-slate-700 dark:focus:border-[#1A8FE3]';
export const fileCls  = 'w-full rounded-xl border border-slate-200 bg-slate-50/50 px-3.5 py-2.5 text-sm text-slate-700 file:mr-3 file:rounded-lg file:border-0 file:bg-indigo-50 file:px-3 file:py-1 file:text-xs file:font-medium file:text-indigo-700 hover:file:bg-indigo-100 transition-all dark:border-slate-600 dark:bg-slate-800 dark:text-slate-300 dark:file:bg-indigo-900/50 dark:file:text-indigo-300 dark:hover:file:bg-indigo-900';
export const labelCls = 'block text-xs font-medium text-slate-400 mb-1.5 uppercase tracking-wide dark:text-slate-500';
export const btnSec   = 'rounded-xl border border-slate-200 bg-slate-100 hover:bg-slate-200 px-4 py-2.5 text-sm font-medium text-slate-600 transition-colors dark:border-slate-600 dark:bg-slate-800 dark:hover:bg-slate-700 dark:text-slate-300';

// ─── 追加共享样式 ─────────────────────────────────────────────────────────────

// セクションコンテナ
export const sectionCls = 'rounded-2xl border border-slate-200/80 bg-white p-6 shadow-panel space-y-5 dark:bg-slate-900 dark:border-slate-700/80';

// プライマリーボタン
export const btnPrimary = 'w-full rounded-xl bg-slate-800 hover:bg-slate-900 disabled:opacity-50 disabled:cursor-not-allowed px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-all duration-150 active:scale-[0.99]';

// 数値入力
export const numCls = (width = 'w-24') =>
  `${width} rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-800/50 px-3 py-2.5 text-sm text-slate-800 dark:text-slate-200 placeholder:text-slate-400 focus:border-[#1A8FE3] focus:ring-2 focus:ring-[#1A8FE3]/15 transition-all text-center`;

// トグルボタン（タブバー内のボタン）
export const toggleBtnCls = (active: boolean) =>
  `flex-1 py-2 text-sm font-medium transition-all ${active ? 'bg-slate-800 dark:bg-slate-600 text-white shadow-sm' : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 hover:bg-slate-100 dark:hover:bg-slate-700 dark:hover:text-slate-200'}`;

// オプション選択ボタン（フォーマット選択等）
export const optionBtnCls = (active: boolean) =>
  `px-3 py-1.5 rounded-lg border text-xs font-semibold transition-all ${active ? 'bg-slate-800 dark:bg-slate-600 border-slate-800 dark:border-slate-600 text-white' : 'border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700'}`;

// Misc セクション Provider Pill
export const pillBase = 'rounded-xl border px-2 py-2 text-xs font-medium transition-all text-center leading-tight';
export const pillOn   = 'border-violet-400 bg-violet-50 text-violet-700 dark:bg-violet-900/30 dark:border-violet-500 dark:text-violet-300';
export const pillOff  = 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400 hover:border-slate-300 dark:hover:border-slate-600 hover:bg-slate-50 dark:hover:bg-slate-800/50';

// Misc セクション主ボタン
export const btnMiscPrimary = 'w-full rounded-xl bg-violet-600 hover:bg-violet-700 disabled:opacity-50 disabled:cursor-not-allowed px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors';

// 録音ダウンロードリンク
export const recordingDownloadCls = 'inline-flex items-center gap-1.5 rounded-lg border border-slate-200 dark:border-slate-600 bg-slate-50 dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 px-3 py-1.5 text-xs text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 transition-colors';

// タブバーコンテナ
export const tabBarCls = 'flex rounded-xl border border-slate-200 dark:border-slate-700 overflow-hidden text-sm bg-slate-50/50 dark:bg-slate-800/50';
