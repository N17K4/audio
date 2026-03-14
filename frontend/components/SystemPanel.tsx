import React, { useState, useEffect } from 'react';
import type { DiskRow } from '../types';

interface SystemPanelProps {
  backendBaseUrl: string;
  isElectron: boolean;
}

export default function SystemPanel({ backendBaseUrl, isElectron }: SystemPanelProps) {
  const [healthResult, setHealthResult] = useState<string | null>(null);
  const [healthLoading, setHealthLoading] = useState(false);
  const [healthCollapsed, setHealthCollapsed] = useState(false);
  const [diskRows, setDiskRows] = useState<DiskRow[] | null>(null);
  const [diskLoading, setDiskLoading] = useState(false);
  const [diskCollapsed, setDiskCollapsed] = useState(false);
  const [logContent, setLogContent] = useState<{ name: string; content: string } | null>(null);
  const [logLoading, setLogLoading] = useState(false);
  const [logCollapsed, setLogCollapsed] = useState(false);

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
                  setHealthResult(JSON.stringify(j ?? await r.text(), null, 2));
                } catch (e: any) {
                  setHealthResult(`请求失败：${e.message}`);
                } finally { setHealthLoading(false); }
              }}>
              {healthLoading ? '请求中…' : '检查'}
            </button>}
          </div>
          {!healthCollapsed && healthResult && (
            <pre className="rounded-xl border border-slate-200/80 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 p-3 text-xs text-slate-700 dark:text-slate-300 overflow-x-auto whitespace-pre-wrap">{healthResult}</pre>
          )}
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
                    <div key={r.key} className="flex items-center gap-3 px-4 py-2.5 border-b border-slate-100 dark:border-slate-700 last:border-0 hover:bg-slate-50 dark:hover:bg-slate-800/60 transition-colors">
                      <div className="flex-1 min-w-0">
                        <div className="text-slate-700 dark:text-slate-300 font-medium truncate">{r.label}</div>
                        {r.sub && <div className="text-slate-400 mt-0.5">{r.sub}</div>}
                      </div>
                      <div className="w-24 shrink-0">
                        <div className="h-1.5 rounded-full bg-slate-100 overflow-hidden">
                          <div className="h-full rounded-full bg-indigo-400" style={{ width: `${r.size > 0 ? Math.max(2, Math.round(r.size/max*100)) : 0}%` }} />
                        </div>
                      </div>
                      <div className="w-16 text-right text-slate-600 tabular-nums shrink-0 font-medium">{fmtSize(r.size)}</div>
                    </div>
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

      </div>
    </div>
  );
}
