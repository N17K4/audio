import React, { useState, useEffect } from 'react';
import type { DiskRow } from '../types';

interface SystemPanelProps {
  backendBaseUrl: string;
  isElectron: boolean;
}

export default function SystemPanel({ backendBaseUrl, isElectron }: SystemPanelProps) {
  const [healthResult, setHealthResult] = useState<{ status: string; raw: string } | null>(null);
  const [healthLoading, setHealthLoading] = useState(false);
  const [healthCollapsed, setHealthCollapsed] = useState(false);
  const [diskRows, setDiskRows] = useState<DiskRow[] | null>(null);
  const [diskLoading, setDiskLoading] = useState(false);
  const [diskCollapsed, setDiskCollapsed] = useState(false);
  const [logContent, setLogContent] = useState<{ name: string; content: string } | null>(null);
  const [logLoading, setLogLoading] = useState(false);
  const [logCollapsed, setLogCollapsed] = useState(false);
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [clearingData, setClearingData] = useState(false);
  const [clearMsg, setClearMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const [redownloadStep, setRedownloadStep] = useState(0); // 0=hidden 1=first 2=second
  const [redownloading, setRedownloading] = useState(false);
  const [redownloadMsg, setRedownloadMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const [concurrency, setConcurrency] = useState(1);
  const [concurrencyInput, setConcurrencyInput] = useState('1');
  const [concurrencyCollapsed, setConcurrencyCollapsed] = useState(false);
  const [concurrencySaving, setConcurrencySaving] = useState(false);
  const [concurrencyMsg, setConcurrencyMsg] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    if (!backendBaseUrl) return;
    fetch(`${backendBaseUrl}/settings`)
      .then(r => r.json())
      .then(d => {
        const n = d?.local_concurrency ?? 1;
        setConcurrency(n);
        setConcurrencyInput(String(n));
      })
      .catch(() => {});
  }, [backendBaseUrl]);

  return (
    <div className="rounded-2xl border border-slate-200/80 bg-white shadow-card overflow-hidden dark:bg-slate-900 dark:border-slate-700/80">

      {/* 二次确认弹窗 */}
      {showClearConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="w-80 rounded-2xl border border-slate-200 bg-white dark:bg-slate-900 dark:border-slate-700 shadow-xl p-6 space-y-4">
            <div className="space-y-1.5">
              <h3 className="text-base font-semibold text-slate-800 dark:text-slate-100">确认清除用户数据？</h3>
              <p className="text-sm text-slate-500 dark:text-slate-400 leading-relaxed">
                将删除已下载的全部模型文件和运行库（checkpoints、python-packages），下次启动时需要重新下载。此操作不可撤销。
              </p>
            </div>
            <div className="flex gap-2 justify-end">
              <button
                className="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 px-4 py-2 text-sm font-medium text-slate-600 dark:text-slate-300 transition-colors"
                onClick={() => setShowClearConfirm(false)}>
                取消
              </button>
              <button
                className="rounded-lg bg-rose-600 hover:bg-rose-700 px-4 py-2 text-sm font-medium text-white transition-colors disabled:opacity-50"
                disabled={clearingData}
                onClick={async () => {
                  setClearingData(true);
                  const res = await window.electronAPI?.clearUserData();
                  setClearingData(false);
                  setShowClearConfirm(false);
                  if (res?.ok) {
                    setClearMsg({ ok: true, text: '已清除，重新启动应用后将引导重新下载' });
                  } else {
                    setClearMsg({ ok: false, text: `清除失败：${res?.error ?? '未知错误'}` });
                  }
                }}>
                {clearingData ? '清除中…' : '确认清除'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 重新下载模型 — 第一步确认 */}
      {redownloadStep === 1 && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="w-80 rounded-2xl border border-slate-200 bg-white dark:bg-slate-900 dark:border-slate-700 shadow-xl p-6 space-y-4">
            <div className="space-y-1.5">
              <h3 className="text-base font-semibold text-slate-800 dark:text-slate-100">重新下载全部模型？</h3>
              <p className="text-sm text-slate-500 dark:text-slate-400 leading-relaxed">
                将清除已下载的所有模型文件和运行库，并立即打开下载引导窗口重新安装。
              </p>
            </div>
            <div className="flex gap-2 justify-end">
              <button
                className="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 px-4 py-2 text-sm font-medium text-slate-600 dark:text-slate-300 transition-colors"
                onClick={() => setRedownloadStep(0)}>
                取消
              </button>
              <button
                className="rounded-lg bg-amber-500 hover:bg-amber-600 px-4 py-2 text-sm font-medium text-white transition-colors"
                onClick={() => setRedownloadStep(2)}>
                继续
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 重新下载模型 — 第二步确认 */}
      {redownloadStep === 2 && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="w-80 rounded-2xl border border-rose-200 dark:border-rose-800 bg-white dark:bg-slate-900 shadow-xl p-6 space-y-4">
            <div className="space-y-1.5">
              <h3 className="text-base font-semibold text-rose-700 dark:text-rose-400">再次确认</h3>
              <p className="text-sm text-slate-500 dark:text-slate-400 leading-relaxed">
                此操作将<span className="font-semibold text-rose-600 dark:text-rose-400">删除全部已下载的模型与运行库</span>（checkpoints、python-packages），不可撤销。确认后立即打开下载引导。
              </p>
            </div>
            <div className="flex gap-2 justify-end">
              <button
                className="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 px-4 py-2 text-sm font-medium text-slate-600 dark:text-slate-300 transition-colors"
                onClick={() => setRedownloadStep(0)}>
                取消
              </button>
              <button
                className="rounded-lg bg-rose-600 hover:bg-rose-700 px-4 py-2 text-sm font-medium text-white transition-colors disabled:opacity-50"
                disabled={redownloading}
                onClick={async () => {
                  setRedownloading(true);
                  const res = await window.electronAPI?.clearAndOpenSetup();
                  setRedownloading(false);
                  setRedownloadStep(0);
                  if (res?.ok) {
                    setRedownloadMsg({ ok: true, text: '已清除，下载引导窗口已打开' });
                  } else {
                    setRedownloadMsg({ ok: false, text: `操作失败：${res?.error ?? '未知错误'}` });
                  }
                }}>
                {redownloading ? '处理中…' : '确认执行'}
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="px-5 pb-6 space-y-6 pt-5">

        {/* 本地推理并发数 */}
        <div className="space-y-3">
          <button className="flex items-center gap-1.5 text-sm font-medium text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200 transition-colors" onClick={() => setConcurrencyCollapsed(v => !v)}>
            <svg className={`w-3.5 h-3.5 transition-transform ${concurrencyCollapsed ? '-rotate-90' : ''}`} viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z" clipRule="evenodd"/></svg>
            本地推理并发数
            <span className="ml-1 rounded-md bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 text-xs font-mono text-slate-500 dark:text-slate-400">{concurrency}</span>
          </button>
          {!concurrencyCollapsed && (
            <div className="space-y-3">
              <div className="rounded-xl border border-amber-200 bg-amber-50 dark:border-amber-800/50 dark:bg-amber-900/20 px-4 py-3 text-xs text-amber-800 dark:text-amber-300 leading-relaxed">
                <span className="font-semibold">注意：</span>并行运行多个本地推理会同时占用 GPU/CPU 内存。内存不足（如 Mac Air 8GB、核显笔记本）时可能导致崩溃或严重卡顿。<span className="font-semibold">非高配电脑请保持默认值 1。</span>
              </div>
              <div className="flex items-center gap-3">
                <div className="flex items-center gap-2">
                  {[1, 2, 3, 4].map(n => (
                    <button
                      key={n}
                      className={`w-9 h-9 rounded-lg border text-sm font-semibold transition-colors ${concurrencyInput === String(n) ? 'border-indigo-400 bg-indigo-50 dark:bg-indigo-900/40 dark:border-indigo-600 text-indigo-700 dark:text-indigo-300' : 'border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-400'}`}
                      onClick={() => setConcurrencyInput(String(n))}>
                      {n}
                    </button>
                  ))}
                </div>
                <button
                  className="rounded-lg border border-indigo-300 dark:border-indigo-700 bg-indigo-50 dark:bg-indigo-900/40 hover:bg-indigo-100 dark:hover:bg-indigo-900/60 px-3 py-1.5 text-xs font-medium text-indigo-700 dark:text-indigo-300 transition-colors disabled:opacity-50"
                  disabled={concurrencySaving || !backendBaseUrl || concurrencyInput === String(concurrency)}
                  onClick={async () => {
                    const n = Math.max(1, Math.min(4, parseInt(concurrencyInput) || 1));
                    setConcurrencySaving(true);
                    setConcurrencyMsg(null);
                    try {
                      const r = await fetch(`${backendBaseUrl}/settings`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ local_concurrency: n }),
                      });
                      if (!r.ok) throw new Error(`${r.status}`);
                      setConcurrency(n);
                      setConcurrencyInput(String(n));
                      setConcurrencyMsg({ ok: true, text: '已保存，立即生效' });
                    } catch (e: any) {
                      setConcurrencyMsg({ ok: false, text: `保存失败：${e.message}` });
                    } finally {
                      setConcurrencySaving(false);
                    }
                  }}>
                  {concurrencySaving ? '保存中…' : '保存'}
                </button>
                {concurrencyMsg && (
                  <span className={`text-xs ${concurrencyMsg.ok ? 'text-green-600 dark:text-green-400' : 'text-red-500'}`}>
                    {concurrencyMsg.text}
                  </span>
                )}
              </div>
            </div>
          )}
        </div>

        {/* 健康检查 */}
        <div className="space-y-3">
          <div className="flex items-center gap-3">
            <button className="flex items-center gap-1.5 text-sm font-medium text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200 transition-colors" onClick={() => setHealthCollapsed(v => !v)}>
              <svg className={`w-3.5 h-3.5 transition-transform ${healthCollapsed ? '-rotate-90' : ''}`} viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z" clipRule="evenodd"/></svg>
              后端健康检查
            </button>
            {!healthCollapsed && <button
              className="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 px-3 py-1 text-xs font-medium text-slate-600 dark:text-slate-300 transition-colors disabled:opacity-50"
              disabled={healthLoading || !backendBaseUrl}
              onClick={async () => {
                setHealthLoading(true); setHealthResult(null);
                try {
                  const r = await fetch(`${backendBaseUrl}/health`);
                  const j = await r.json().catch(() => null);
                  setHealthResult({ status: j?.status ?? (r.ok ? 'ok' : 'error'), raw: JSON.stringify(j, null, 2) });
                } catch (e: any) {
                  setHealthResult({ status: 'error', raw: `请求失败：${e.message}` });
                } finally { setHealthLoading(false); }
              }}>
              {healthLoading ? '请求中…' : '检查'}
            </button>}
          </div>
          {!healthCollapsed && healthResult && (() => {
            const s = healthResult.status;
            const isOk = s === 'ok';
            const badgeCls = isOk
              ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-400'
              : s === 'degraded'
              ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400'
              : 'bg-rose-100 text-rose-600 dark:bg-rose-900/40 dark:text-rose-400';
            return (
              <div className="space-y-2">
                <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold ${badgeCls}`}>
                  <span className={`w-1.5 h-1.5 rounded-full ${isOk ? 'bg-emerald-500' : s === 'degraded' ? 'bg-amber-500' : 'bg-rose-500'}`} />
                  {s}
                </span>
                <pre className="rounded-xl border border-slate-200/80 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 p-3 text-xs text-slate-700 dark:text-slate-300 overflow-x-auto whitespace-pre-wrap">{healthResult.raw}</pre>
              </div>
            );
          })()}
        </div>

        {/* 磁盘占用（仅 Electron） */}
        {isElectron && (
          <div className="space-y-3">
            <div className="flex items-center gap-3">
              <button className="flex items-center gap-1.5 text-sm font-medium text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200 transition-colors" onClick={() => setDiskCollapsed(v => !v)}>
                <svg className={`w-3.5 h-3.5 transition-transform ${diskCollapsed ? '-rotate-90' : ''}`} viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z" clipRule="evenodd"/></svg>
                磁盘占用
              </button>
              {!diskCollapsed && <button
                className="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 px-3 py-1 text-xs font-medium text-slate-600 dark:text-slate-300 transition-colors disabled:opacity-50"
                disabled={diskLoading}
                onClick={async () => {
                  setDiskLoading(true);
                  try { setDiskRows(await window.electronAPI?.getDiskUsage() ?? null); }
                  catch (e: any) { setDiskRows(null); }
                  finally { setDiskLoading(false); }
                }}>
                {diskLoading ? '计算中…' : '刷新'}
              </button>}
            </div>
            {!diskCollapsed && diskRows && (() => {
              const fmtSize = (b: number) => b <= 0 ? '0 B' : b < 1024 ? `${b} B` : b < 1048576 ? `${(b/1024).toFixed(1)} KB` : b < 1073741824 ? `${(b/1048576).toFixed(1)} MB` : `${(b/1073741824).toFixed(2)} GB`;
              const max = Math.max(1, ...diskRows.map(r => r.size));
              const total = diskRows.reduce((s, r) => s + Math.max(0, r.size), 0);
              return (
                <div className="rounded-xl border border-slate-200/80 dark:border-slate-700 overflow-hidden text-xs dark:bg-slate-800">
                  {diskRows.map(r => (
                    <button key={r.key} className="w-full flex items-center gap-3 px-4 py-2.5 border-b border-slate-100 dark:border-slate-700 last:border-0 hover:bg-indigo-50 dark:hover:bg-indigo-900/20 transition-colors text-left cursor-pointer"
                      title="点击打开目录"
                      onClick={() => r.sub && window.electronAPI?.openDir?.(r.sub)}>
                      <div className="flex-1 min-w-0">
                        <div className="text-slate-700 dark:text-slate-300 font-medium">{r.label}</div>
                        {r.sub && <div className="text-slate-400 mt-0.5 font-mono break-all leading-relaxed">{r.sub}</div>}
                      </div>
                      <div className="w-24 shrink-0">
                        <div className="h-1.5 rounded-full bg-slate-100 overflow-hidden">
                          <div className="h-full rounded-full bg-indigo-400" style={{ width: `${r.size > 0 ? Math.max(2, Math.round(r.size/max*100)) : 0}%` }} />
                        </div>
                      </div>
                      <div className="w-16 text-right text-slate-600 tabular-nums shrink-0 font-medium">{fmtSize(r.size)}</div>
                    </button>
                  ))}
                  <div className="flex justify-between px-4 py-2.5 bg-slate-50/80 dark:bg-slate-800/60 font-semibold text-slate-700 dark:text-slate-300 border-t border-slate-100 dark:border-slate-700">
                    <span>合计</span><span className="tabular-nums">{fmtSize(total)}</span>
                  </div>
                </div>
              );
            })()}
          </div>
        )}

        {/* 日志（仅 Electron） */}
        {isElectron && (
          <div className="space-y-3">
            <div className="flex items-center gap-2 flex-wrap">
              <button className="flex items-center gap-1.5 text-sm font-medium text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200 transition-colors" onClick={() => setLogCollapsed(v => !v)}>
                <svg className={`w-3.5 h-3.5 transition-transform ${logCollapsed ? '-rotate-90' : ''}`} viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z" clipRule="evenodd"/></svg>
                日志
              </button>
              {!logCollapsed && ['electron.log', 'backend.log', 'frontend.log'].map(name => (
                <button key={name}
                  className={`rounded-lg border px-3 py-1 text-xs font-medium transition-colors disabled:opacity-50 ${logContent?.name === name ? 'border-indigo-300/80 bg-indigo-50 dark:bg-indigo-900/40 dark:border-indigo-700 text-indigo-700 dark:text-indigo-300' : 'border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-400'}`}
                  disabled={logLoading}
                  onClick={async () => {
                    if (logContent?.name === name) { setLogContent(null); return; }
                    setLogLoading(true);
                    const res = await window.electronAPI?.readLogFile(name) ?? { ok: false, content: '' };
                    setLogContent({ name, content: res.content });
                    setLogLoading(false);
                  }}>
                  {name}
                </button>
              ))}
              {!logCollapsed && <button
                className="rounded-lg border border-slate-200 bg-slate-50 hover:bg-slate-100 px-3 py-1 text-xs font-medium text-slate-600 transition-colors"
                onClick={() => window.electronAPI?.openLogsDir?.()}>
                打开目录
              </button>}
            </div>
            {!logCollapsed && logContent && (
              <pre className="rounded-xl border border-slate-800 bg-slate-950 text-slate-300 p-4 text-xs overflow-x-auto whitespace-pre-wrap max-h-64 font-mono leading-relaxed">{logContent.content || '（空）'}</pre>
            )}
          </div>
        )}

        {/* 清除用户数据 / 重新下载模型（仅 Electron） */}
        {isElectron && (
          <div className="space-y-3 pt-2 border-t border-slate-100 dark:border-slate-800">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-slate-600 dark:text-slate-400">清除用户数据</p>
                <p className="text-xs text-slate-400 dark:text-slate-500 mt-0.5">删除已下载的模型和运行库，下次启动重新引导下载</p>
              </div>
              <button
                className="rounded-lg border border-rose-200 dark:border-rose-800/60 bg-rose-50 dark:bg-rose-900/20 hover:bg-rose-100 dark:hover:bg-rose-900/40 px-3 py-1.5 text-xs font-medium text-rose-600 dark:text-rose-400 transition-colors"
                onClick={() => { setClearMsg(null); setShowClearConfirm(true); }}>
                清除数据
              </button>
            </div>
            {clearMsg && (
              <p className={`text-xs ${clearMsg.ok ? 'text-green-600 dark:text-green-400' : 'text-red-500'}`}>
                {clearMsg.text}
              </p>
            )}
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-slate-600 dark:text-slate-400">重新下载模型</p>
                <p className="text-xs text-slate-400 dark:text-slate-500 mt-0.5">清除现有模型数据，立即打开下载引导重新安装</p>
              </div>
              <button
                className="rounded-lg border border-amber-200 dark:border-amber-700/60 bg-amber-50 dark:bg-amber-900/20 hover:bg-amber-100 dark:hover:bg-amber-900/40 px-3 py-1.5 text-xs font-medium text-amber-700 dark:text-amber-400 transition-colors"
                onClick={() => { setRedownloadMsg(null); setRedownloadStep(1); }}>
                重新下载
              </button>
            </div>
            {redownloadMsg && (
              <p className={`text-xs ${redownloadMsg.ok ? 'text-green-600 dark:text-green-400' : 'text-red-500'}`}>
                {redownloadMsg.text}
              </p>
            )}
          </div>
        )}

      </div>

      {/* ── 项目功能背景说明 ── */}
      <div className="border-t border-slate-100 dark:border-slate-800 p-5 space-y-6">
        <h2 className="text-sm font-semibold text-slate-700 dark:text-slate-300">项目功能背景说明</h2>

        {/* 已有功能 */}
        <div className="space-y-2">
          <h3 className="text-xs font-semibold text-emerald-600 dark:text-emerald-400 uppercase tracking-wide">已有功能（原版）</h3>
          <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-700">
            <table className="text-xs w-full">
              <thead>
                <tr className="bg-slate-50 dark:bg-slate-800 text-slate-500 dark:text-slate-400">
                  <th className="text-left px-3 py-2 font-medium whitespace-nowrap">功能</th>
                  <th className="text-left px-3 py-2 font-medium whitespace-nowrap">本地引擎</th>
                  <th className="text-left px-3 py-2 font-medium whitespace-nowrap">云端服务商</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                <tr className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                  <td className="px-3 py-2 font-medium text-slate-700 dark:text-slate-300 whitespace-nowrap">TTS 文本转语音</td>
                  <td className="px-3 py-2 text-slate-500 dark:text-slate-400 whitespace-nowrap">Fish Speech</td>
                  <td className="px-3 py-2 text-slate-500 dark:text-slate-400">OpenAI · Gemini · ElevenLabs · Cartesia · DashScope</td>
                </tr>
                <tr className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                  <td className="px-3 py-2 font-medium text-slate-700 dark:text-slate-300 whitespace-nowrap">VC 音色转换</td>
                  <td className="px-3 py-2 text-slate-500 dark:text-slate-400 whitespace-nowrap">RVC · Seed-VC</td>
                  <td className="px-3 py-2 text-slate-500 dark:text-slate-400">ElevenLabs</td>
                </tr>
                <tr className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                  <td className="px-3 py-2 font-medium text-slate-700 dark:text-slate-300 whitespace-nowrap">STT 语音转文字</td>
                  <td className="px-3 py-2 text-slate-500 dark:text-slate-400 whitespace-nowrap">Whisper</td>
                  <td className="px-3 py-2 text-slate-500 dark:text-slate-400">OpenAI · Gemini · Groq · Deepgram</td>
                </tr>
                <tr className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                  <td className="px-3 py-2 font-medium text-slate-700 dark:text-slate-300 whitespace-nowrap">LLM 聊天</td>
                  <td className="px-3 py-2 text-slate-500 dark:text-slate-400 whitespace-nowrap">Ollama</td>
                  <td className="px-3 py-2 text-slate-500 dark:text-slate-400">OpenAI · Gemini · Claude · DeepSeek · Groq · Mistral · xAI · GitHub</td>
                </tr>
                <tr className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                  <td className="px-3 py-2 font-medium text-slate-700 dark:text-slate-300 whitespace-nowrap">语音聊天</td>
                  <td className="px-3 py-2 text-slate-500 dark:text-slate-400 whitespace-nowrap">Whisper + Ollama + Fish Speech</td>
                  <td className="px-3 py-2 text-slate-500 dark:text-slate-400">OpenAI Realtime · Gemini Live</td>
                </tr>
                <tr className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                  <td className="px-3 py-2 font-medium text-slate-700 dark:text-slate-300 whitespace-nowrap">音视频格式转换</td>
                  <td className="px-3 py-2 text-slate-500 dark:text-slate-400 whitespace-nowrap">FFmpeg（内置）</td>
                  <td className="px-3 py-2 text-slate-500 dark:text-slate-400">—</td>
                </tr>
                <tr className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                  <td className="px-3 py-2 font-medium text-slate-700 dark:text-slate-300 whitespace-nowrap">文档转换 / PDF 提取</td>
                  <td className="px-3 py-2 text-slate-500 dark:text-slate-400 whitespace-nowrap">pdf2docx · pandoc · PyMuPDF（内置）</td>
                  <td className="px-3 py-2 text-slate-500 dark:text-slate-400">—</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        {/* 本次新增 */}
        <div className="space-y-2">
          <h3 className="text-xs font-semibold text-violet-600 dark:text-violet-400 uppercase tracking-wide">本次新增（扩展功能模块）</h3>
          <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-700">
            <table className="text-xs w-full">
              <thead>
                <tr className="bg-slate-50 dark:bg-slate-800 text-slate-500 dark:text-slate-400">
                  <th className="text-left px-3 py-2 font-medium whitespace-nowrap">功能</th>
                  <th className="text-left px-3 py-2 font-medium whitespace-nowrap">本地引擎</th>
                  <th className="text-left px-3 py-2 font-medium whitespace-nowrap">云端服务商</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                <tr className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                  <td className="px-3 py-2 font-medium text-slate-700 dark:text-slate-300 whitespace-nowrap">图像生成</td>
                  <td className="px-3 py-2 text-slate-500 dark:text-slate-400 whitespace-nowrap">—（纯云端）</td>
                  <td className="px-3 py-2 text-slate-500 dark:text-slate-400">OpenAI DALL-E 3 · Gemini Imagen 3 · Stability AI · DashScope 通义万象</td>
                </tr>
                <tr className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                  <td className="px-3 py-2 font-medium text-slate-700 dark:text-slate-300 whitespace-nowrap">图像理解</td>
                  <td className="px-3 py-2 text-slate-500 dark:text-slate-400 whitespace-nowrap">Ollama（LLaVA · moondream 等）</td>
                  <td className="px-3 py-2 text-slate-500 dark:text-slate-400">OpenAI GPT-4o · Gemini Vision · Claude Vision</td>
                </tr>
                <tr className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                  <td className="px-3 py-2 font-medium text-slate-700 dark:text-slate-300 whitespace-nowrap">文字翻译</td>
                  <td className="px-3 py-2 text-slate-500 dark:text-slate-400 whitespace-nowrap">Ollama（任意文本模型）</td>
                  <td className="px-3 py-2 text-slate-500 dark:text-slate-400">OpenAI · Gemini · Claude · DeepSeek · Groq · Mistral · xAI · GitHub</td>
                </tr>
                <tr className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                  <td className="px-3 py-2 font-medium text-slate-700 dark:text-slate-300 whitespace-nowrap">代码助手</td>
                  <td className="px-3 py-2 text-slate-500 dark:text-slate-400 whitespace-nowrap">Ollama（Qwen-Coder · DeepSeek-Coder 等）</td>
                  <td className="px-3 py-2 text-slate-500 dark:text-slate-400">OpenAI · Gemini · Claude · DeepSeek · Groq · Mistral · xAI · GitHub</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        {/* 暂未实现 */}
        <div className="space-y-2">
          <h3 className="text-xs font-semibold text-amber-600 dark:text-amber-400 uppercase tracking-wide">暂未实现（有开发成本）</h3>
          <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-700">
            <table className="text-xs w-full">
              <thead>
                <tr className="bg-slate-50 dark:bg-slate-800 text-slate-500 dark:text-slate-400">
                  <th className="text-left px-3 py-2 font-medium whitespace-nowrap">领域</th>
                  <th className="text-left px-3 py-2 font-medium whitespace-nowrap">推荐模型 / 服务商</th>
                  <th className="text-left px-3 py-2 font-medium whitespace-nowrap">未做原因</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                <tr className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                  <td className="px-3 py-2 font-medium text-slate-700 dark:text-slate-300 whitespace-nowrap">视频生成（云端）</td>
                  <td className="px-3 py-2 text-slate-500 dark:text-slate-400 whitespace-nowrap">Kling 2.1 · Hailuo · Veo 3 · Sora · Runway</td>
                  <td className="px-3 py-2 text-slate-400 dark:text-slate-500">各家 API 异步格式差异大，视频大文件下载存储，工程量较高</td>
                </tr>
                <tr className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                  <td className="px-3 py-2 font-medium text-slate-700 dark:text-slate-300 whitespace-nowrap">视频生成（本地）</td>
                  <td className="px-3 py-2 text-slate-500 dark:text-slate-400 whitespace-nowrap">Wan 2.1 · HunyuanVideo</td>
                  <td className="px-3 py-2 text-slate-400 dark:text-slate-500">MBP 生成 5 秒视频需 20–40 分钟，4050 跑不了 14B，实用价值低</td>
                </tr>
                <tr className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                  <td className="px-3 py-2 font-medium text-slate-700 dark:text-slate-300 whitespace-nowrap">数字人 / 口型同步</td>
                  <td className="px-3 py-2 text-slate-500 dark:text-slate-400 whitespace-nowrap">HeyGen · D-ID（云）；MuseTalk（本地）</td>
                  <td className="px-3 py-2 text-slate-400 dark:text-slate-500">云端需上传视频→异步→下载，流程复杂；本地需自建 worker</td>
                </tr>
                <tr className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                  <td className="px-3 py-2 font-medium text-slate-700 dark:text-slate-300 whitespace-nowrap">换脸（本地）</td>
                  <td className="px-3 py-2 text-slate-500 dark:text-slate-400 whitespace-nowrap">FaceFusion 3.x · LivePortrait · Deep-Live-Cam</td>
                  <td className="px-3 py-2 text-slate-400 dark:text-slate-500">依赖复杂（onnxruntime · insightface），无合规云端 API，需自建 worker</td>
                </tr>
                <tr className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                  <td className="px-3 py-2 font-medium text-slate-700 dark:text-slate-300 whitespace-nowrap">本地图像生成</td>
                  <td className="px-3 py-2 text-slate-500 dark:text-slate-400 whitespace-nowrap">Flux.1-schnell · SDXL · SD 3.5</td>
                  <td className="px-3 py-2 text-slate-400 dark:text-slate-500">需自建 diffusers worker，Mac MPS 有已知 bug 需 patch，工程量 2–3 天</td>
                </tr>
                <tr className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                  <td className="px-3 py-2 font-medium text-slate-700 dark:text-slate-300 whitespace-nowrap">字幕配音一体化</td>
                  <td className="px-3 py-2 text-slate-500 dark:text-slate-400 whitespace-nowrap">ElevenLabs Dubbing · HeyGen（云）；STT+LLM+TTS 自拼</td>
                  <td className="px-3 py-2 text-slate-400 dark:text-slate-500">STT→翻译→TTS 跨任务 pipeline，涉及视频流处理，需专门设计任务编排</td>
                </tr>
                <tr className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                  <td className="px-3 py-2 font-medium text-slate-700 dark:text-slate-300 whitespace-nowrap">OCR / 文档理解</td>
                  <td className="px-3 py-2 text-slate-500 dark:text-slate-400 whitespace-nowrap">Azure Doc Intelligence（云）；PaddleOCR · GOT-OCR2（本地）</td>
                  <td className="px-3 py-2 text-slate-400 dark:text-slate-500">云端可用图像理解代替；本地 OCR 需自建 worker，与文档工具定位重叠</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>

    </div>
  );
}
