import React, { useState, useEffect, useRef } from 'react';
import type { DiskRow } from '../types';

interface SystemPanelProps {
  backendBaseUrl: string;
  isElectron: boolean;
}

const NAV_ITEMS = [
  { id: 'models',  label: '模型管理',   electronOnly: true,  keywords: ['模型', '磁盘', '安装', '卸载', '下载', '体积'] },
  { id: 'perf',    label: '性能设置',   electronOnly: false, keywords: ['并发', '性能', '推理', '并行'] },
  { id: 'health',  label: '健康检查',   electronOnly: false, keywords: ['健康', '状态', '连接', '后端'] },
  { id: 'logs',    label: '日志',       electronOnly: true,  keywords: ['日志', 'log', '错误', '前端'] },
  { id: 'reset',   label: '重置',       electronOnly: true,  keywords: ['清除', '重置', '重新下载', '数据'] },
  { id: 'about',   label: '功能说明',   electronOnly: false, keywords: ['功能', '说明', '关于', '引擎'] },
] as const;

type SectionId = typeof NAV_ITEMS[number]['id'];

function Spinner() {
  return (
    <svg className="animate-spin w-3 h-3" viewBox="0 0 24 24" fill="none">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
    </svg>
  );
}

function fmtSize(b: number) {
  if (b <= 0) return '0 B';
  if (b < 1024) return `${b} B`;
  if (b < 1048576) return `${(b / 1024).toFixed(1)} KB`;
  if (b < 1073741824) return `${(b / 1048576).toFixed(1)} MB`;
  return `${(b / 1073741824).toFixed(2)} GB`;
}

function fmtEstimate(mb: number) {
  if (!mb) return '';
  if (mb < 1024) return `~${mb} MB`;
  return `~${(mb / 1024).toFixed(1)} GB`;
}

function fmtTime(d: Date) {
  const mm = d.getMonth() + 1, dd = d.getDate();
  const hh = String(d.getHours()).padStart(2, '0');
  const min = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  return `${mm}/${dd} ${hh}:${min}:${ss}`;
}

export default function SystemPanel({ backendBaseUrl, isElectron }: SystemPanelProps) {
  // ── layout ─────────────────────────────────────────────────────────────────
  const [activeSection, setActiveSection] = useState<SectionId>(isElectron ? 'models' : 'health');
  const [searchQuery, setSearchQuery] = useState('');

  // ── 并发数 ─────────────────────────────────────────────────────────────────
  const [concurrency, setConcurrency] = useState(1);
  const [concurrencyInput, setConcurrencyInput] = useState('1');
  const [concurrencySaving, setConcurrencySaving] = useState(false);
  const [concurrencyMsg, setConcurrencyMsg] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    if (!backendBaseUrl) return;
    fetch(`${backendBaseUrl}/settings`)
      .then(r => r.json())
      .then(d => { const n = d?.local_concurrency ?? 1; setConcurrency(n); setConcurrencyInput(String(n)); })
      .catch(() => {});
  }, [backendBaseUrl]);

  // ── 健康检查 ────────────────────────────────────────────────────────────────
  const [healthResult, setHealthResult] = useState<{ status: string; raw: string } | null>(null);
  const [healthLoading, setHealthLoading] = useState(false);
  const [healthRefreshedAt, setHealthRefreshedAt] = useState<Date | null>(null);

  // ── 磁盘占用 ────────────────────────────────────────────────────────────────
  const [diskRows, setDiskRows] = useState<DiskRow[] | null>(null);
  const [diskLoading, setDiskLoading] = useState(false);
  const [diskRefreshedAt, setDiskRefreshedAt] = useState<Date | null>(null);
  const [engineStatus, setEngineStatus] = useState<Record<string, 'idle' | 'installing' | 'deleting'>>({});
  const [clearingRow, setClearingRow] = useState<Record<string, boolean>>({});
  const [installLog, setInstallLog] = useState<string[]>([]);
  const [installLogKey, setInstallLogKey] = useState<string>('');
  const installLogRef = useRef<HTMLPreElement>(null);

  // 安装日志自动滚到底
  useEffect(() => {
    const el = installLogRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [installLog]);

  // ── 日志 ────────────────────────────────────────────────────────────────────
  const [logContent, setLogContent] = useState<{ name: string; content: string } | null>(null);
  const [logLoading, setLogLoading] = useState(false);

  // ── 重置 ────────────────────────────────────────────────────────────────────
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [clearingData, setClearingData] = useState(false);
  const [clearMsg, setClearMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [redownloadStep, setRedownloadStep] = useState(0);
  const [redownloading, setRedownloading] = useState(false);
  const [redownloadMsg, setRedownloadMsg] = useState<{ ok: boolean; text: string } | null>(null);

  // ── nav 过滤 ────────────────────────────────────────────────────────────────
  const filteredNav = NAV_ITEMS.filter(item => {
    if (item.electronOnly && !isElectron) return false;
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    return item.label.includes(q) || item.keywords.some(k => k.includes(q));
  });

  useEffect(() => {
    if (searchQuery && filteredNav.length > 0 && !filteredNav.find(i => i.id === activeSection)) {
      setActiveSection(filteredNav[0].id);
    }
  }, [searchQuery]);

  // ── 切换 section 时自动刷新 ──────────────────────────────────────────────────
  useEffect(() => {
    if (activeSection === 'models' && isElectron) { doRefreshDisk(); }
    if (activeSection === 'health') { doCheckHealth(); }
  }, [activeSection]);

  // ── 磁盘操作 helpers ─────────────────────────────────────────────────────────
  async function doRefreshDisk() {
    setDiskLoading(true);
    try { setDiskRows(await window.electronAPI?.getDiskUsage() ?? null); } catch { /**/ }
    setDiskRefreshedAt(new Date());
    setDiskLoading(false);
  }

  async function doCheckHealth() {
    if (!backendBaseUrl) return;
    setHealthLoading(true); setHealthResult(null);
    try {
      const r = await fetch(`${backendBaseUrl}/health`);
      const j = await r.json().catch(() => null);
      setHealthResult({ status: j?.status ?? (r.ok ? 'ok' : 'error'), raw: JSON.stringify(j, null, 2) });
    } catch (e: any) {
      setHealthResult({ status: 'error', raw: `请求失败：${e.message}` });
    }
    setHealthRefreshedAt(new Date());
    setHealthLoading(false);
  }

  async function installEngine(engineKey: string) {
    setEngineStatus(s => ({ ...s, [engineKey]: 'installing' }));
    setInstallLog([`▶ 开始安装: ${engineKey}`]);
    setInstallLogKey(engineKey);

    const handleProgress = (msg: Record<string, unknown>) => {
      let text: string | null = null;
      const t = msg.type as string;
      if (t === 'log') {
        text = String(msg.message ?? '').trimEnd();
      } else if (t === 'file_start') {
        const sizePart = msg.size_mb ? `  (~${msg.size_mb} MB)` : '';
        text = `⬇ 开始下载: ${msg.file}${sizePart}`;
      } else if (t === 'file_done') {
        text = msg.ok
          ? `  ✓ 完成: ${msg.file}`
          : `  ✗ 失败: ${msg.file}${msg.error ? '  ' + msg.error : ''}`;
      } else if (t === 'progress') {
        text = `  ${msg.file}: ${msg.pct}%  (${msg.mb} / ${msg.total_mb} MB)`;
      } else if (t === 'engine_start') {
        text = `▶ 引擎: ${msg.engine}`;
      } else if (t === 'all_done') {
        text = msg.ok ? '✓ 全部完成' : '✗ 安装结束，存在失败项，请查看上方日志';
      }
      if (text !== null && text !== '') {
        setInstallLog(prev => {
          const next = [...prev, text as string];
          return next.length > 500 ? next.slice(-500) : next;
        });
      }
    };

    window.electronAPI?.onEngineDownloadProgress?.(handleProgress);
    const result = await window.electronAPI?.downloadEngine?.(engineKey);
    window.electronAPI?.offEngineDownloadProgress?.(handleProgress);

    if (result) {
      const summary = result.ok
        ? `✓ 安装脚本退出（成功）`
        : `✗ 安装脚本退出（失败，exit code: ${result.exitCode ?? result.error ?? '?'}）`;
      setInstallLog(prev => [...prev, summary]);
    }

    try { setDiskRows(await window.electronAPI?.getDiskUsage() ?? null); } catch { /**/ }
    setEngineStatus(s => ({ ...s, [engineKey]: 'idle' }));
  }

  async function deleteEngine(engineKey: string) {
    setEngineStatus(s => ({ ...s, [engineKey]: 'deleting' }));
    await window.electronAPI?.deleteEngine?.(engineKey);
    try { setDiskRows(await window.electronAPI?.getDiskUsage() ?? null); } catch { /**/ }
    setEngineStatus(s => ({ ...s, [engineKey]: 'idle' }));
  }

  // ────────────────────────────────────────────────────────────────────────────
  // Sections
  // ────────────────────────────────────────────────────────────────────────────

  function SectionPerf() {
    return (
      <div className="space-y-5">
        <div className="rounded-xl border border-amber-200 bg-amber-50 dark:border-amber-800/50 dark:bg-amber-900/20 px-4 py-3 text-xs text-amber-800 dark:text-amber-300 leading-relaxed">
          <span className="font-semibold">注意：</span>并行运行多个本地推理会同时占用 GPU/CPU 内存。内存不足（如 Mac Air 8GB、核显笔记本）时可能导致崩溃或严重卡顿。<span className="font-semibold">非高配电脑请保持默认值 1。</span>
        </div>
        <div className="space-y-2">
          <p className="text-xs text-slate-500 dark:text-slate-400">本地推理并发数</p>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2">
              {[1, 2, 3, 4].map(n => (
                <button key={n}
                  className={`w-9 h-9 rounded-lg border text-sm font-semibold transition-colors ${
                    concurrencyInput === String(n)
                      ? 'border-indigo-400 bg-indigo-50 dark:bg-indigo-900/40 dark:border-indigo-600 text-indigo-700 dark:text-indigo-300'
                      : 'border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-400'
                  }`}
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
                setConcurrencySaving(true); setConcurrencyMsg(null);
                try {
                  const r = await fetch(`${backendBaseUrl}/settings`, {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ local_concurrency: n }),
                  });
                  if (!r.ok) throw new Error(`${r.status}`);
                  setConcurrency(n); setConcurrencyInput(String(n));
                  setConcurrencyMsg({ ok: true, text: '已保存，立即生效' });
                } catch (e: any) {
                  setConcurrencyMsg({ ok: false, text: `保存失败：${e.message}` });
                } finally { setConcurrencySaving(false); }
              }}>
              {concurrencySaving ? '保存中…' : '保存'}
            </button>
            {concurrencyMsg && (
              <span className={`text-xs ${concurrencyMsg.ok ? 'text-green-600 dark:text-green-400' : 'text-red-500'}`}>
                {concurrencyMsg.text}
              </span>
            )}
          </div>
          <p className="text-xs text-slate-400 dark:text-slate-500">当前生效值：{concurrency}</p>
        </div>
      </div>
    );
  }

  function SectionHealth() {
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-2 text-xs text-slate-400 dark:text-slate-500">
          {healthLoading
            ? <><Spinner /><span>检查中…</span></>
            : healthRefreshedAt
            ? <span>刷新时间：{fmtTime(healthRefreshedAt)}</span>
            : <span>加载中…</span>
          }
        </div>
        {healthResult && (() => {
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
    );
  }

  function SectionModels() {
    const refreshLabel = diskLoading
      ? <><Spinner /><span>计算中…</span></>
      : diskRefreshedAt
      ? <span>刷新时间：{fmtTime(diskRefreshedAt)}</span>
      : <span>加载中…</span>;

    if (!diskRows) {
      return (
        <div className="space-y-4">
          <div className="flex items-center gap-2 text-xs text-slate-400 dark:text-slate-500">{refreshLabel}</div>
        </div>
      );
    }

    const max = Math.max(1, ...diskRows.map(r => r.size));
    const total = diskRows.reduce((s, r) => s + Math.max(0, r.size), 0);

    return (
      <div className="space-y-4">
        <div className="flex items-center gap-2 text-xs text-slate-400 dark:text-slate-500">{refreshLabel}</div>

        <div className="text-xs">
          {diskRows.map(r => {
            const estatus = r.engineKey ? (engineStatus[r.engineKey] ?? 'idle') : 'idle';
            const isBusy = estatus !== 'idle';
            // ready===true 时直接认为已安装（如 FaceFusion 只有源码几 MB，Flux GGUF 已验证存在）
            // 否则：实际大小 < 预估的 5% 视为未完成安装（残留元数据）
            const isInstalled = r.ready === true
              || (r.size > 0 && r.estimatedSizeMb != null && r.size >= r.estimatedSizeMb * 1024 * 1024 * 0.05);
            const isPartialInstall = r.engineKey && !isInstalled && r.size > 0 && r.estimatedSizeMb != null;
            const showInstallBtn = r.engineKey && !isInstalled;
            const estimate = r.estimatedSizeMb ? fmtEstimate(r.estimatedSizeMb) : '';

            return (
              <div key={r.key} className="flex items-center gap-3 px-4 py-2.5 border-b border-slate-100 dark:border-slate-700/60 last:border-0 hover:bg-slate-50/60 dark:hover:bg-slate-800/40 transition-colors">
                {/* 标签 + 路径 */}
                <button className="flex-1 min-w-0 text-left" title="点击打开目录"
                  onClick={() => r.sub && window.electronAPI?.openDir?.(r.sub)}>
                  <div className="flex items-center gap-2 text-slate-700 dark:text-slate-300 font-medium">
                    {r.label}
                    {estimate && (
                      <span className="text-slate-400 dark:text-slate-500 font-normal">{estimate}</span>
                    )}
                  </div>
                  {r.sub && <div className="text-slate-400 dark:text-slate-500 mt-0.5 font-mono break-all leading-relaxed">{r.sub}</div>}
                </button>

                {/* 进度条 */}
                <div className="w-20 shrink-0">
                  <div className="h-1.5 rounded-full bg-slate-100 dark:bg-slate-700 overflow-hidden">
                    <div className="h-full rounded-full bg-indigo-400 dark:bg-indigo-500"
                      style={{ width: `${r.size > 0 ? Math.max(2, Math.round(r.size / max * 100)) : 0}%` }} />
                  </div>
                </div>

                {/* 大小 */}
                <div className="w-16 text-right text-slate-600 dark:text-slate-400 tabular-nums shrink-0 font-medium">
                  {fmtSize(r.size)}
                </div>

                {/* 操作按钮 */}
                {r.engineKey && (
                  showInstallBtn ? (
                    <div className="flex flex-col items-end gap-1 shrink-0">
                      <button
                        className="rounded-lg border border-indigo-300 dark:border-indigo-700 bg-indigo-50 dark:bg-indigo-900/40 hover:bg-indigo-100 dark:hover:bg-indigo-900/60 px-2.5 py-1 text-xs font-medium text-indigo-700 dark:text-indigo-300 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1 min-w-[60px] justify-center"
                        disabled={isBusy}
                        onClick={() => installEngine(r.engineKey!)}>
                        {estatus === 'installing'
                          ? <><Spinner />安装中</>
                          : isPartialInstall ? '重新安装' : '安装'}
                      </button>
                      {isPartialInstall && (
                        <button
                          className="rounded-lg border border-rose-200 dark:border-rose-800/60 bg-rose-50 dark:bg-rose-900/20 hover:bg-rose-100 dark:hover:bg-rose-900/40 px-2.5 py-1 text-xs font-medium text-rose-600 dark:text-rose-400 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1 min-w-[60px] justify-center"
                          disabled={isBusy}
                          onClick={() => deleteEngine(r.engineKey!)}>
                          {estatus === 'deleting' ? <><Spinner />卸载中</> : '清除残留'}
                        </button>
                      )}
                    </div>
                  ) : r.size > 0 ? (
                    <button
                      className="shrink-0 rounded-lg border border-rose-200 dark:border-rose-800/60 bg-rose-50 dark:bg-rose-900/20 hover:bg-rose-100 dark:hover:bg-rose-900/40 px-2.5 py-1 text-xs font-medium text-rose-600 dark:text-rose-400 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1 min-w-[52px] justify-center"
                      disabled={isBusy}
                      onClick={() => deleteEngine(r.engineKey!)}>
                      {estatus === 'deleting' ? <><Spinner />卸载中</> : '卸载'}
                    </button>
                  ) : null
                )}
                {!r.engineKey && r.clearable && (
                  <button
                    className="shrink-0 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 px-2.5 py-1 text-xs font-medium text-slate-600 dark:text-slate-400 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1 min-w-[52px] justify-center"
                    disabled={clearingRow[r.key] || r.size === 0}
                    onClick={async () => {
                      setClearingRow(s => ({ ...s, [r.key]: true }));
                      await window.electronAPI?.clearDiskRow?.(r.key);
                      try { setDiskRows(await window.electronAPI?.getDiskUsage() ?? null); } catch { /**/ }
                      setClearingRow(s => ({ ...s, [r.key]: false }));
                    }}>
                    {clearingRow[r.key] ? <><Spinner />清空中</> : '清空'}
                  </button>
                )}
                {!r.engineKey && !r.clearable && <div className="shrink-0 w-[52px]" />}
              </div>
            );
          })}

          {/* 合计 */}
          <div className="flex justify-between px-4 py-2.5 font-semibold text-slate-700 dark:text-slate-300 border-t border-slate-200 dark:border-slate-700 text-xs">
            <span>合计</span><span className="tabular-nums">{fmtSize(total)}</span>
          </div>
        </div>

        {/* 安装日志 */}
        {installLog.length > 0 && (
          <div className="mt-4 space-y-1.5">
            <div className="flex items-center justify-between">
              <p className="text-xs font-semibold text-slate-500 dark:text-slate-400">
                安装日志{installLogKey ? ` · ${installLogKey}` : ''}
              </p>
              <button
                className="text-xs text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 transition-colors"
                onClick={() => { setInstallLog([]); setInstallLogKey(''); }}>
                清除
              </button>
            </div>
            <pre
              ref={installLogRef}
              className="rounded-xl border border-slate-800 bg-slate-950 text-slate-300 p-3 text-xs font-mono leading-relaxed overflow-y-auto whitespace-pre-wrap break-all"
              style={{ maxHeight: '14rem' }}>
              {installLog.join('\n')}
            </pre>
          </div>
        )}
      </div>
    );
  }

  function SectionLogs() {
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-2 flex-wrap">
          {['electron.log', 'backend.log', 'frontend.log'].map(name => (
            <button key={name}
              className={`rounded-lg border px-3 py-1 text-xs font-medium transition-colors disabled:opacity-50 ${
                logContent?.name === name
                  ? 'border-indigo-300/80 bg-indigo-50 dark:bg-indigo-900/40 dark:border-indigo-700 text-indigo-700 dark:text-indigo-300'
                  : 'border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-400'
              }`}
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
          <button
            className="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 px-3 py-1 text-xs font-medium text-slate-600 dark:text-slate-400 transition-colors"
            onClick={() => window.electronAPI?.openLogsDir?.()}>
            打开目录
          </button>
        </div>
        {logContent && (
          <pre className="rounded-xl border border-slate-800 bg-slate-950 text-slate-300 p-4 text-xs overflow-x-auto whitespace-pre-wrap max-h-96 font-mono leading-relaxed">
            {logContent.content || '（空）'}
          </pre>
        )}
      </div>
    );
  }

  function SectionReset() {
    return (
      <div className="space-y-5">

        <div className="divide-y divide-slate-200 dark:divide-slate-700">
          {/* 清除用户数据 */}
          <div className="flex items-center justify-between py-3.5">
            <div>
              <p className="text-sm font-medium text-slate-700 dark:text-slate-300">清除用户数据</p>
              <p className="text-xs text-slate-400 dark:text-slate-500 mt-0.5">删除已下载的模型和运行库，下次启动重新引导下载</p>
            </div>
            <button
              className="rounded-lg border border-rose-200 dark:border-rose-800/60 bg-rose-50 dark:bg-rose-900/20 hover:bg-rose-100 dark:hover:bg-rose-900/40 px-3 py-1.5 text-xs font-medium text-rose-600 dark:text-rose-400 transition-colors"
              onClick={() => { setClearMsg(null); setShowClearConfirm(true); }}>
              清除数据
            </button>
          </div>
          {clearMsg && (
            <p className={`text-xs py-2 ${clearMsg.ok ? 'text-green-600 dark:text-green-400' : 'text-red-500'}`}>{clearMsg.text}</p>
          )}

          {/* 重新下载模型 */}
          <div className="flex items-center justify-between py-3.5">
            <div>
              <p className="text-sm font-medium text-slate-700 dark:text-slate-300">重新下载模型</p>
              <p className="text-xs text-slate-400 dark:text-slate-500 mt-0.5">清除现有模型数据，立即打开下载引导重新安装</p>
            </div>
            <button
              className="rounded-lg border border-amber-200 dark:border-amber-700/60 bg-amber-50 dark:bg-amber-900/20 hover:bg-amber-100 dark:hover:bg-amber-900/40 px-3 py-1.5 text-xs font-medium text-amber-700 dark:text-amber-400 transition-colors"
              onClick={() => { setRedownloadMsg(null); setRedownloadStep(1); }}>
              重新下载
            </button>
          </div>
          {redownloadMsg && (
            <p className={`text-xs py-2 ${redownloadMsg.ok ? 'text-green-600 dark:text-green-400' : 'text-red-500'}`}>{redownloadMsg.text}</p>
          )}
        </div>
      </div>
    );
  }

  function SectionAbout() {
    return (
      <div className="space-y-6">

        {(() => {
          const TheadRow = () => (
            <thead>
              <tr className="bg-slate-50 dark:bg-slate-800 text-slate-500 dark:text-slate-400">
                <th className="text-left px-3 py-2 font-medium w-[28%]">功能</th>
                <th className="text-left px-3 py-2 font-medium w-[28%]">本地引擎</th>
                <th className="text-left px-3 py-2 font-medium w-[44%]">云端服务商</th>
              </tr>
            </thead>
          );
          const Row = ({ row, dim }: { row: string[]; dim?: boolean }) => (
            <tr className={`hover:bg-slate-50 dark:hover:bg-slate-800/50 ${dim ? 'text-slate-400 dark:text-slate-500' : ''}`}>
              <td className={`px-3 py-2 font-medium ${dim ? '' : 'text-slate-700 dark:text-slate-300'}`}>{row[0]}</td>
              <td className={`px-3 py-2 ${dim ? '' : 'text-slate-500 dark:text-slate-400'}`}>{row[1]}</td>
              <td className={`px-3 py-2 ${dim ? '' : 'text-slate-500 dark:text-slate-400'}`}>{row[2]}</td>
            </tr>
          );
          const Table = ({ children }: { children: React.ReactNode }) => (
            <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-700">
              <table className="text-xs w-full table-fixed">{children}</table>
            </div>
          );
          return (
            <>
              {/* 已有功能 */}
              <div className="space-y-2">
                <h3 className="text-xs font-semibold text-emerald-600 dark:text-emerald-400 uppercase tracking-wide">已有功能</h3>
                <Table>
                  <TheadRow />
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {[
                      ['TTS 文本转语音', 'Fish Speech', 'OpenAI · Gemini · ElevenLabs · Cartesia · DashScope'],
                      ['VC 音色转换', 'RVC · Seed-VC', 'ElevenLabs'],
                      ['STT 语音转文字', 'Whisper', 'OpenAI · Gemini · Groq · Deepgram'],
                      ['LLM 聊天', 'Ollama', 'OpenAI · Gemini · Claude · DeepSeek · Groq · Mistral · xAI · GitHub'],
                      ['语音聊天', 'Whisper + Ollama + Fish Speech', 'OpenAI Realtime · Gemini Live'],
                      ['音视频格式转换', 'FFmpeg（内置）', '—'],
                      ['文档转换 / PDF', 'pdf2docx · pandoc · PyMuPDF', '—'],
                    ].map(row => <Row key={row[0]} row={row} />)}
                  </tbody>
                </Table>
              </div>

              {/* 扩展功能 */}
              <div className="space-y-2">
                <h3 className="text-xs font-semibold text-violet-600 dark:text-violet-400 uppercase tracking-wide">扩展功能</h3>
                <Table>
                  <TheadRow />
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {[
                      ['图像生成', 'Flux.1-Schnell GGUF', 'OpenAI DALL-E 3 · Gemini Imagen 3 · Stability AI · DashScope'],
                      ['图像理解', 'Ollama（LLaVA · moondream）', 'OpenAI GPT-4o · Gemini Vision · Claude Vision'],
                      ['文字翻译', 'Ollama', 'OpenAI · Gemini · Claude · DeepSeek · Groq · Mistral · xAI · GitHub'],
                      ['代码助手', 'Ollama（Qwen-Coder · DeepSeek-Coder）', 'OpenAI · Gemini · Claude · DeepSeek · Groq · Mistral · xAI · GitHub'],
                      ['OCR / 文档理解', 'GOT-OCR2.0', 'Azure Doc Intelligence'],
                      ['口型同步 · 动作驱动', 'LivePortrait FP16', 'HeyGen · D-ID'],
                      ['换脸', 'FaceFusion 3.x', '—'],
                      ['视频生成', 'Wan 2.1 1.3B', 'Kling · Hailuo · Veo · Sora · Runway'],
                    ].map(row => <Row key={row[0]} row={row} />)}
                  </tbody>
                </Table>
              </div>

              {/* 后端待接入 */}
              <div className="space-y-2">
                <h3 className="text-xs font-semibold text-slate-400 dark:text-slate-500 uppercase tracking-wide">后端待接入</h3>
                <Table>
                  <TheadRow />
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {[
                      ['图生图（img2img）', 'Flux / ComfyUI', '—'],
                      ['口型同步（后端）', 'LivePortrait FP16', '—'],
                      ['换脸（后端）', 'FaceFusion 3.x', '—'],
                      ['视频生成（后端）', 'Wan 2.1', '—'],
                      ['图像生成（本地）', 'Flux.1-Schnell GGUF', '—'],
                      ['OCR（后端）', 'GOT-OCR2.0', '—'],
                    ].map(row => <Row key={row[0]} row={row} dim />)}
                  </tbody>
                </Table>
              </div>
            </>
          );
        })()}
      </div>
    );
  }

  const SECTION_TITLES: Record<SectionId, string> = {
    models: '模型管理',
    perf:   '性能设置',
    health: '健康检查',
    logs:   '日志',
    reset:  '重置',
    about:  '功能说明',
  };

  // ────────────────────────────────────────────────────────────────────────────
  // Render
  // ────────────────────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col h-full overflow-hidden bg-slate-50 dark:bg-slate-950">

      {/* ── 清除确认弹窗 ─────────────────────────────────────────────────────── */}
      {showClearConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="w-80 rounded-2xl border border-slate-200 bg-white dark:bg-slate-900 dark:border-slate-700 shadow-xl p-6 space-y-4">
            <div className="space-y-1.5">
              <h3 className="text-base font-semibold text-slate-800 dark:text-slate-100">确认清除用户数据？</h3>
              <p className="text-sm text-slate-500 dark:text-slate-400 leading-relaxed">将删除已下载的全部模型文件和运行库，下次启动时需要重新下载。此操作不可撤销。</p>
            </div>
            <div className="flex gap-2 justify-end">
              <button className="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 px-4 py-2 text-sm font-medium text-slate-600 dark:text-slate-300 transition-colors"
                onClick={() => setShowClearConfirm(false)}>取消</button>
              <button className="rounded-lg bg-rose-600 hover:bg-rose-700 px-4 py-2 text-sm font-medium text-white transition-colors disabled:opacity-50"
                disabled={clearingData}
                onClick={async () => {
                  setClearingData(true);
                  const res = await window.electronAPI?.clearUserData();
                  setClearingData(false); setShowClearConfirm(false);
                  setClearMsg(res?.ok
                    ? { ok: true, text: '已清除，重新启动应用后将引导重新下载' }
                    : { ok: false, text: `清除失败：${res?.error ?? '未知错误'}` });
                }}>
                {clearingData ? '清除中…' : '确认清除'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── 重新下载第一步 ───────────────────────────────────────────────────── */}
      {redownloadStep === 1 && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="w-80 rounded-2xl border border-slate-200 bg-white dark:bg-slate-900 dark:border-slate-700 shadow-xl p-6 space-y-4">
            <div className="space-y-1.5">
              <h3 className="text-base font-semibold text-slate-800 dark:text-slate-100">重新下载全部模型？</h3>
              <p className="text-sm text-slate-500 dark:text-slate-400 leading-relaxed">将清除已下载的所有模型文件和运行库，并立即打开下载引导窗口重新安装。</p>
            </div>
            <div className="flex gap-2 justify-end">
              <button className="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 px-4 py-2 text-sm font-medium text-slate-600 dark:text-slate-300 transition-colors"
                onClick={() => setRedownloadStep(0)}>取消</button>
              <button className="rounded-lg bg-amber-500 hover:bg-amber-600 px-4 py-2 text-sm font-medium text-white transition-colors"
                onClick={() => setRedownloadStep(2)}>继续</button>
            </div>
          </div>
        </div>
      )}

      {/* ── 重新下载第二步 ───────────────────────────────────────────────────── */}
      {redownloadStep === 2 && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="w-80 rounded-2xl border border-rose-200 dark:border-rose-800 bg-white dark:bg-slate-900 shadow-xl p-6 space-y-4">
            <div className="space-y-1.5">
              <h3 className="text-base font-semibold text-rose-700 dark:text-rose-400">再次确认</h3>
              <p className="text-sm text-slate-500 dark:text-slate-400 leading-relaxed">此操作将<span className="font-semibold text-rose-600 dark:text-rose-400">删除全部已下载的模型与运行库</span>，不可撤销。确认后立即打开下载引导。</p>
            </div>
            <div className="flex gap-2 justify-end">
              <button className="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 px-4 py-2 text-sm font-medium text-slate-600 dark:text-slate-300 transition-colors"
                onClick={() => setRedownloadStep(0)}>取消</button>
              <button className="rounded-lg bg-rose-600 hover:bg-rose-700 px-4 py-2 text-sm font-medium text-white transition-colors disabled:opacity-50"
                disabled={redownloading}
                onClick={async () => {
                  setRedownloading(true);
                  const res = await window.electronAPI?.clearAndOpenSetup();
                  setRedownloading(false); setRedownloadStep(0);
                  setRedownloadMsg(res?.ok
                    ? { ok: true, text: '已清除，下载引导窗口已打开' }
                    : { ok: false, text: `操作失败：${res?.error ?? '未知错误'}` });
                }}>
                {redownloading ? '处理中…' : '确认执行'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── 主体：侧边栏 + 内容 ──────────────────────────────────────────────── */}
      <div className="flex flex-1 overflow-hidden">

        {/* 侧边栏 — 对齐主侧边栏蓝色风格 */}
        <nav className="w-36 shrink-0 bg-gradient-to-b from-blue-50 to-blue-100 dark:from-slate-900 dark:to-slate-900 border-r border-blue-100 dark:border-slate-800 py-3 px-2 space-y-0.5 overflow-hidden">
          {/* 搜索框 */}
          <div className="flex items-center gap-1.5 px-2 py-1.5 mb-2 rounded-xl bg-white dark:bg-slate-800 border border-blue-100 dark:border-slate-700">
            <svg className="w-3 h-3 text-blue-400 shrink-0" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M9 3.5a5.5 5.5 0 100 11 5.5 5.5 0 000-11zM2 9a7 7 0 1112.452 4.391l3.328 3.329a.75.75 0 11-1.06 1.06l-3.329-3.328A7 7 0 012 9z" clipRule="evenodd"/>
            </svg>
            <input
              className="flex-1 min-w-0 bg-transparent text-xs outline-none placeholder:text-blue-300 dark:placeholder:text-slate-500 text-slate-700 dark:text-slate-300"
              placeholder="搜索…"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
            />
            {searchQuery && (
              <button className="text-blue-300 hover:text-blue-500 transition-colors" onClick={() => setSearchQuery('')}>
                <svg className="w-3 h-3" viewBox="0 0 20 20" fill="currentColor">
                  <path d="M6.28 5.22a.75.75 0 00-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 101.06 1.06L10 11.06l3.72 3.72a.75.75 0 101.06-1.06L11.06 10l3.72-3.72a.75.75 0 00-1.06-1.06L10 8.94 6.28 5.22z"/>
                </svg>
              </button>
            )}
          </div>

          {filteredNav.map(item => (
            <button key={item.id}
              onClick={() => setActiveSection(item.id)}
              className={`w-full flex items-center px-2.5 py-2 rounded-xl text-sm font-semibold transition-all duration-150 ${
                activeSection === item.id
                  ? 'bg-blue-500 text-white shadow-sm dark:bg-blue-600 dark:text-white'
                  : 'text-blue-700 hover:bg-blue-100 hover:text-blue-800 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-200'
              }`}>
              {item.label}
            </button>
          ))}
          {filteredNav.length === 0 && (
            <p className="px-2.5 py-2 text-xs text-blue-400 dark:text-slate-500">无匹配项</p>
          )}
        </nav>

        {/* 右侧：固定标题 + 可滚内容 */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* 固定标题栏 */}
          <div className="shrink-0 px-6 py-4 border-b border-blue-100 dark:border-slate-800">
            <div className="flex items-center gap-3">
              <h2 className="text-sm font-semibold text-blue-700 dark:text-slate-200 tracking-tight flex-1">
                {SECTION_TITLES[activeSection]}
              </h2>
              {/* 全局安装状态指示器（不依赖内联子组件，避免频繁 unmount 导致闪烁） */}
              {Object.entries(engineStatus).map(([key, st]) => st !== 'idle' && (
                <span key={key} className="flex items-center gap-1.5 text-xs text-indigo-600 dark:text-indigo-400 font-medium">
                  <Spinner />
                  {st === 'installing' ? `正在安装 ${key}…` : `正在卸载 ${key}…`}
                </span>
              ))}
            </div>
          </div>
          {/* 可滚动内容区 */}
          <div className="flex-1 overflow-y-auto px-6 py-5">
            {activeSection === 'perf'   && <SectionPerf />}
            {activeSection === 'health' && <SectionHealth />}
            {activeSection === 'models' && isElectron && <SectionModels />}
            {activeSection === 'logs'   && isElectron && <SectionLogs />}
            {activeSection === 'reset'  && isElectron && <SectionReset />}
            {activeSection === 'about'  && <SectionAbout />}
          </div>
        </div>
      </div>
    </div>
  );
}
