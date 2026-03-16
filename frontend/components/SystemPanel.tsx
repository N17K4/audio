import React, { useState, useEffect, useRef } from 'react';
import type { DiskRow } from '../types';

interface SystemPanelProps {
  backendBaseUrl: string;
  isElectron: boolean;
}

const NAV_ITEMS = [
  { id: 'about',   label: '功能说明',   electronOnly: false, keywords: ['功能', '说明', '关于', '引擎'] },
  { id: 'models',  label: '模型管理',   electronOnly: true,  keywords: ['模型', '磁盘', '安装', '卸载', '下载', '体积'] },
  { id: 'perf',    label: '性能',       electronOnly: false, keywords: ['并发', '性能', '推理', '并行'] },
  { id: 'health',  label: '健康检查',   electronOnly: false, keywords: ['健康', '状态', '连接', '后端'] },
  { id: 'logs',    label: '日志',       electronOnly: true,  keywords: ['日志', 'log', '错误', '前端'] },
  { id: 'reset',   label: '重置',       electronOnly: true,  keywords: ['清除', '重置', '重新下载', '数据'] },
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

function fmtTime(d: Date) {
  const mm = d.getMonth() + 1, dd = d.getDate();
  const hh = String(d.getHours()).padStart(2, '0');
  const min = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  return `${mm}/${dd} ${hh}:${min}:${ss}`;
}

const SPRING_GREEN = '#6db33f';
const SPRING_GREEN_DARK = '#4d8027';

// ── Card component ────────────────────────────────────────────────────────────
function Card({
  title,
  desc,
  action,
  accent = false,
  accentColor = SPRING_GREEN,
  children,
}: {
  title: string;
  desc?: string;
  action?: React.ReactNode;
  accent?: boolean;
  accentColor?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden shadow-sm">
      <div className="px-5 py-4 border-b border-slate-100 dark:border-slate-800 flex items-start gap-3">
        {accent && (
          <div className="w-1 self-stretch rounded-full shrink-0 mt-0.5" style={{ backgroundColor: accentColor }} />
        )}
        <div className="flex-1 min-w-0">
          <h3 className="text-sm font-bold text-slate-800 dark:text-slate-200">{title}</h3>
          {desc && <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 leading-relaxed">{desc}</p>}
        </div>
        {action && <div className="shrink-0">{action}</div>}
      </div>
      <div className="px-5 py-4">{children}</div>
    </div>
  );
}

export default function SystemPanel({ backendBaseUrl, isElectron }: SystemPanelProps) {
  const [activeSection, setActiveSection] = useState<SectionId>('about');

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

  // ── 网络依赖 ────────────────────────────────────────────────────────────────
  const [networkDeps, setNetworkDeps] = useState<Array<{
    name: string; category: string; user_facing: boolean;
    url: string; size_display: string; phase: string;
    mirror_support: boolean; note: string;
  }>>([]);

  // ── 磁盘占用 ────────────────────────────────────────────────────────────────
  const [diskRows, setDiskRows] = useState<DiskRow[] | null>(null);
  const [diskLoading, setDiskLoading] = useState(false);
  const [diskRefreshedAt, setDiskRefreshedAt] = useState<Date | null>(null);
  const [engineStatus, setEngineStatus] = useState<Record<string, 'idle' | 'installing' | 'deleting'>>({});
  const [clearingRow, setClearingRow] = useState<Record<string, boolean>>({});
  const [installLog, setInstallLog] = useState<string[]>([]);
  const [installLogKey, setInstallLogKey] = useState<string>('');
  const installLogRef = useRef<HTMLPreElement>(null);

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

  const visibleNav = NAV_ITEMS.filter(item => !item.electronOnly || isElectron);

  // ── 切换 section 时自动刷新 ──────────────────────────────────────────────────
  useEffect(() => {
    if (activeSection === 'models' && isElectron) { doRefreshDisk(); }
    if (activeSection === 'health') { doCheckHealth(); }
  }, [activeSection]);

  async function doRefreshDisk() {
    setDiskLoading(true);
    try { setDiskRows(await window.electronAPI?.getDiskUsage() ?? null); } catch { /**/ }
    setDiskRefreshedAt(new Date());
    setDiskLoading(false);
    if (backendBaseUrl && networkDeps.length === 0) {
      try {
        const r = await fetch(`${backendBaseUrl}/runtime/info`);
        if (r.ok) {
          const d = await r.json();
          if (Array.isArray(d.network_deps)) setNetworkDeps(d.network_deps);
        }
      } catch { /**/ }
    }
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

  // ── sections ─────────────────────────────────────────────────────────────────

  function SectionPerf() {
    return (
      <Card title="本地推理并发数" desc="控制同时运行的本地推理任务数量，请根据硬件配置合理设置。">
        <div className="space-y-4">
          <div className="rounded border-l-4 bg-amber-50 dark:bg-amber-900/20 px-4 py-3 text-sm text-amber-800 dark:text-amber-300 leading-relaxed border-amber-400">
            <span className="font-semibold">注意：</span>并行运行多个本地推理会同时占用 GPU/CPU 内存。内存不足（如 Mac Air 8GB、核显笔记本）时可能导致崩溃或严重卡顿。<span className="font-semibold">非高配电脑请保持默认值 1。</span>
          </div>
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              {[1, 2, 3, 4].map(n => (
                <button key={n}
                  className="w-10 h-10 rounded border text-sm font-bold transition-all"
                  style={concurrencyInput === String(n)
                    ? { backgroundColor: SPRING_GREEN, borderColor: SPRING_GREEN, color: '#fff' }
                    : { backgroundColor: '#fff', borderColor: '#e2e8f0', color: '#475569' }}
                  onClick={() => setConcurrencyInput(String(n))}>
                  {n}
                </button>
              ))}
            </div>
            <button
              className="rounded border px-4 py-2 text-sm font-medium transition-all disabled:opacity-40"
              style={{ borderColor: SPRING_GREEN, color: SPRING_GREEN }}
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
              <span className={`text-sm ${concurrencyMsg.ok ? 'text-green-600 dark:text-green-400' : 'text-red-500'}`}>
                {concurrencyMsg.text}
              </span>
            )}
          </div>
          <p className="text-xs text-slate-400">当前生效值：{concurrency}</p>
        </div>
      </Card>
    );
  }

  function SectionHealth() {
    return (
      <Card title="后端状态" desc="检查后端服务的运行状态与组件健康度。">
        <div className="space-y-4">
          <div className="flex items-center gap-3">
            <button
              className="rounded px-4 py-2 text-sm font-medium text-white transition-all hover:opacity-90 disabled:opacity-50 flex items-center gap-2"
              style={{ backgroundColor: SPRING_GREEN }}
              disabled={healthLoading}
              onClick={doCheckHealth}>
              {healthLoading ? <><Spinner />检查中…</> : '重新检查'}
            </button>
            {healthRefreshedAt && !healthLoading && (
              <span className="text-xs text-slate-400">更新于 {fmtTime(healthRefreshedAt)}</span>
            )}
          </div>
          {healthResult && (() => {
            const s = healthResult.status;
            const isOk = s === 'ok';
            return (
              <div className="space-y-3">
                <div className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-sm font-semibold ${
                  isOk ? 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-400'
                  : s === 'degraded' ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400'
                  : 'bg-red-100 text-red-600 dark:bg-red-900/40 dark:text-red-400'
                }`}>
                  <span className={`w-2 h-2 rounded-full ${isOk ? 'bg-green-500' : s === 'degraded' ? 'bg-amber-500' : 'bg-red-500'}`} />
                  {isOk ? '运行正常' : s === 'degraded' ? '部分降级' : '异常'}
                </div>
                <pre className="rounded border border-slate-800 bg-slate-950 text-green-400 p-4 text-xs font-mono overflow-x-auto whitespace-pre-wrap leading-relaxed">{healthResult.raw}</pre>
              </div>
            );
          })()}
        </div>
      </Card>
    );
  }

  function SectionModels() {
    if (!diskRows) {
      return (
        <Card title="引擎与模型" desc="管理本地已安装的推理引擎和模型文件。">
          <div className="flex items-center gap-2 text-sm text-slate-400 py-4">
            <Spinner /><span>正在加载…</span>
          </div>
        </Card>
      );
    }

    const max = Math.max(1, ...diskRows.map(r => r.size));
    const total = diskRows.reduce((s, r) => s + Math.max(0, r.size), 0);

    return (
      <div className="space-y-5">
        <Card
          title="引擎与模型"
          desc="管理本地已安装的推理引擎和模型文件。点击名称可打开目录。"
          action={
            <div className="flex items-center gap-3">
              {Object.entries(engineStatus).map(([key, st]) => st !== 'idle' && (
                <span key={key} className="flex items-center gap-1.5 text-xs font-medium" style={{ color: SPRING_GREEN }}>
                  <Spinner />{st === 'installing' ? `正在安装 ${key}…` : `正在卸载 ${key}…`}
                </span>
              ))}
              {diskRefreshedAt && (
                <span className="text-xs text-slate-400">
                  {diskLoading ? <span className="flex items-center gap-1"><Spinner />计算中</span> : `更新于 ${fmtTime(diskRefreshedAt)}`}
                </span>
              )}
              <button
                className="rounded border px-3 py-1 text-xs font-medium transition-all disabled:opacity-50"
                style={{ borderColor: SPRING_GREEN, color: SPRING_GREEN }}
                disabled={diskLoading}
                onClick={doRefreshDisk}>
                刷新
              </button>
            </div>
          }
        >
          <div className="divide-y divide-slate-100 dark:divide-slate-800 -mx-5 -mb-4">
            {diskRows.map(r => {
              const estatus = r.engineKey ? (engineStatus[r.engineKey] ?? 'idle') : 'idle';
              const isBusy = estatus !== 'idle';
              const isInstalled = r.ready === true
                || (r.size > 0 && r.estimatedSizeMb != null && r.size >= r.estimatedSizeMb * 1024 * 1024 * 0.05);
              const isPartialInstall = r.engineKey && !isInstalled && r.size > 0 && r.estimatedSizeMb != null;
              const showInstallBtn = r.engineKey && !isInstalled;

              return (
                <div key={r.key} className="flex items-center gap-4 px-5 py-3 hover:bg-slate-50/80 dark:hover:bg-slate-800/30 transition-colors">
                  {/* 标签 */}
                  <button className="flex-1 min-w-0 text-left group" title="点击打开目录"
                    onClick={() => r.sub && window.electronAPI?.openDir?.(r.sub)}>
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-medium text-slate-700 dark:text-slate-300 group-hover:underline decoration-dotted underline-offset-2">
                        {r.label}
                      </span>
                      {r.version && (
                        <span className="inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-mono leading-none bg-indigo-50 dark:bg-indigo-900/30 text-indigo-500 dark:text-indigo-400">
                          {r.version}
                        </span>
                      )}
                      {r.engineKey && r.default_install === true && (
                        <span className="inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-bold leading-none"
                          style={{ backgroundColor: '#d4edda', color: SPRING_GREEN_DARK }}>默认安装</span>
                      )}
                      {r.engineKey && r.default_install === false && (
                        <span className="inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-bold leading-none bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400">手动安装</span>
                      )}
                    </div>
                    {r.sub && (
                      <div className="text-xs text-slate-400 dark:text-slate-500 mt-0.5 font-mono break-all">{r.sub}</div>
                    )}
                  </button>

                  {/* 进度条 */}
                  <div className="w-20 shrink-0">
                    <div className="h-1.5 rounded-full bg-slate-100 dark:bg-slate-700 overflow-hidden">
                      <div className="h-full rounded-full transition-all"
                        style={{
                          width: `${r.size > 0 ? Math.max(2, Math.round(r.size / max * 100)) : 0}%`,
                          backgroundColor: SPRING_GREEN,
                        }} />
                    </div>
                  </div>

                  {/* 大小 */}
                  <div className="w-16 text-right text-sm text-slate-600 dark:text-slate-400 tabular-nums shrink-0 font-medium">
                    {fmtSize(r.size)}
                  </div>

                  {/* 操作 */}
                  <div className="shrink-0 w-20 flex flex-col items-end gap-1">
                    {r.engineKey && showInstallBtn && (
                      <>
                        <button
                          className="rounded px-2.5 py-1 text-xs font-medium transition-all disabled:opacity-50 flex items-center gap-1 w-full justify-center text-white"
                          style={{ backgroundColor: SPRING_GREEN }}
                          disabled={isBusy}
                          onClick={() => installEngine(r.engineKey!)}>
                          {estatus === 'installing' ? <><Spinner />安装中</> : isPartialInstall ? '重新安装' : '安装'}
                        </button>
                        {isPartialInstall && (
                          <button
                            className="rounded border border-red-200 dark:border-red-800/60 bg-red-50 dark:bg-red-900/20 hover:bg-red-100 px-2.5 py-1 text-xs font-medium text-red-600 dark:text-red-400 transition-all disabled:opacity-50 flex items-center gap-1 w-full justify-center"
                            disabled={isBusy}
                            onClick={() => deleteEngine(r.engineKey!)}>
                            {estatus === 'deleting' ? <><Spinner />卸载中</> : '清除残留'}
                          </button>
                        )}
                      </>
                    )}
                    {r.engineKey && !showInstallBtn && r.size > 0 && (
                      <button
                        className="rounded border border-red-200 dark:border-red-800/60 bg-red-50 dark:bg-red-900/20 hover:bg-red-100 px-2.5 py-1 text-xs font-medium text-red-600 dark:text-red-400 transition-all disabled:opacity-50 flex items-center gap-1 w-full justify-center"
                        disabled={isBusy}
                        onClick={() => deleteEngine(r.engineKey!)}>
                        {estatus === 'deleting' ? <><Spinner />卸载中</> : '卸载'}
                      </button>
                    )}
                    {!r.engineKey && r.clearable && (
                      <button
                        className="rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-50 px-2.5 py-1 text-xs font-medium text-slate-600 dark:text-slate-400 transition-all disabled:opacity-50 flex items-center gap-1 w-full justify-center"
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
                    {!r.engineKey && !r.clearable && <div className="w-full" />}
                  </div>
                </div>
              );
            })}

            {/* 合计 */}
            <div className="flex justify-between px-5 py-3 text-sm font-bold text-slate-700 dark:text-slate-300 bg-slate-50 dark:bg-slate-800/50">
              <span>合计</span>
              <span className="tabular-nums">{fmtSize(total)}</span>
            </div>
          </div>
        </Card>

        {/* 安装日志 */}
        {installLog.length > 0 && (
          <Card
            title={`安装日志${installLogKey ? ` · ${installLogKey}` : ''}`}
            action={
              <button className="text-xs text-slate-400 hover:text-slate-600 transition-colors"
                onClick={() => { setInstallLog([]); setInstallLogKey(''); }}>清除</button>
            }
          >
            <pre
              ref={installLogRef}
              className="rounded border border-slate-800 bg-slate-950 text-green-400 p-4 text-xs font-mono leading-relaxed overflow-y-auto whitespace-pre-wrap break-all"
              style={{ maxHeight: '14rem' }}>
              {installLog.join('\n')}
            </pre>
          </Card>
        )}

        {/* 网络依赖 */}
        {networkDeps.length > 0 && (() => {
          const catColors: Record<string, { bg: string; text: string }> = {
            github_clone:    { bg: '#ede9fe', text: '#7c3aed' },
            huggingface:     { bg: '#fef3c7', text: '#b45309' },
            pypi:            { bg: '#e0f2fe', text: '#0369a1' },
            evermeet:        { bg: '#cffafe', text: '#0e7490' },
            github_releases: { bg: '#d1fae5', text: SPRING_GREEN_DARK },
          };
          const catLabel: Record<string, string> = {
            github_clone:    'GitHub Clone',
            huggingface:     'HuggingFace',
            pypi:            'PyPI',
            evermeet:        'evermeet.cx',
            github_releases: 'GitHub Releases',
          };
          const DepList = ({ deps }: { deps: typeof networkDeps }) => (
            <div className="divide-y divide-slate-100 dark:divide-slate-800 -mx-5 -mb-4">
              {deps.map((dep, i) => {
                const clr = catColors[dep.category] ?? { bg: '#f1f5f9', text: '#64748b' };
                return (
                  <div key={i} className="px-5 py-3 space-y-1.5 text-xs hover:bg-slate-50/60 dark:hover:bg-slate-800/30 transition-colors">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-slate-700 dark:text-slate-300">{dep.name}</span>
                      <span className="inline-flex items-center rounded px-2 py-0.5 text-[10px] font-bold leading-none"
                        style={{ backgroundColor: clr.bg, color: clr.text }}>
                        {catLabel[dep.category] ?? dep.category}
                      </span>
                      {dep.mirror_support && (
                        <span className="inline-flex items-center rounded px-2 py-0.5 text-[10px] font-bold leading-none bg-teal-50 text-teal-700 dark:bg-teal-900/30 dark:text-teal-400">支持镜像</span>
                      )}
                      <span className="text-slate-400">{dep.size_display}</span>
                      <span className="ml-auto rounded bg-slate-100 dark:bg-slate-700 px-2 py-0.5 text-[10px] font-medium text-slate-500 leading-none shrink-0">{dep.phase}</span>
                    </div>
                    <div className="font-mono text-slate-400 dark:text-slate-500 break-all">{dep.url}</div>
                    <div className="text-slate-500 dark:text-slate-400 leading-relaxed">{dep.note}</div>
                  </div>
                );
              })}
            </div>
          );
          const userDeps = networkDeps.filter(d => d.user_facing);
          const devDeps  = networkDeps.filter(d => !d.user_facing);
          return (
            <>
              {userDeps.length > 0 && (
                <Card title="用户侧网络依赖" desc="首次启动或安装引擎时访问。引导页可配置 PyPI 镜像和 HuggingFace 镜像，中国大陆用户建议使用镜像。">
                  <DepList deps={userDeps} />
                </Card>
              )}
              {devDeps.length > 0 && (
                <Card title="开发者构建期依赖" desc="仅在 pnpm run setup / pnpm run checkpoints 阶段访问，已打包进成品。终端用户无感知，无需处理。">
                  <DepList deps={devDeps} />
                </Card>
              )}
            </>
          );
        })()}
      </div>
    );
  }

  function SectionLogs() {
    return (
      <Card title="运行日志" desc="查看各进程的运行日志，用于排查问题。">
        <div className="space-y-4">
          <div className="flex items-center gap-2 flex-wrap">
            {['electron.log', 'backend.log', 'frontend.log'].map(name => (
              <button key={name}
                className="rounded border px-3 py-1.5 text-xs font-medium transition-all disabled:opacity-50"
                style={logContent?.name === name
                  ? { backgroundColor: SPRING_GREEN, borderColor: SPRING_GREEN, color: '#fff' }
                  : { backgroundColor: '#fff', borderColor: '#e2e8f0', color: '#475569' }}
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
              className="rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-50 px-3 py-1.5 text-xs font-medium text-slate-600 dark:text-slate-400 transition-all"
              onClick={() => window.electronAPI?.openLogsDir?.()}>
              打开目录
            </button>
          </div>
          {logContent && (
            <pre className="rounded border border-slate-800 bg-slate-950 text-green-400 p-4 text-xs font-mono overflow-x-auto whitespace-pre-wrap max-h-96 leading-relaxed">
              {logContent.content || '（空）'}
            </pre>
          )}
        </div>
      </Card>
    );
  }

  function SectionReset() {
    return (
      <Card title="重置与恢复" desc="清除本地数据或重新引导安装流程。此操作不可撤销，请谨慎操作。">
        <div className="divide-y divide-slate-100 dark:divide-slate-800 -mx-5 -mb-4">
          <div className="flex items-start justify-between px-5 py-4 gap-4">
            <div className="space-y-1">
              <p className="text-sm font-semibold text-slate-700 dark:text-slate-300">清除用户数据</p>
              <p className="text-xs text-slate-500 dark:text-slate-400">删除已下载的模型和运行库，下次启动重新引导下载</p>
              {clearMsg && (
                <p className={`text-xs mt-1 ${clearMsg.ok ? 'text-green-600 dark:text-green-400' : 'text-red-500'}`}>{clearMsg.text}</p>
              )}
            </div>
            <button
              className="shrink-0 rounded border border-red-300 bg-red-50 dark:bg-red-900/20 hover:bg-red-100 px-4 py-2 text-sm font-medium text-red-600 dark:text-red-400 transition-all"
              onClick={() => { setClearMsg(null); setShowClearConfirm(true); }}>
              清除数据
            </button>
          </div>

          <div className="flex items-start justify-between px-5 py-4 gap-4">
            <div className="space-y-1">
              <p className="text-sm font-semibold text-slate-700 dark:text-slate-300">重新下载模型</p>
              <p className="text-xs text-slate-500 dark:text-slate-400">清除现有模型数据，立即打开下载引导重新安装</p>
              {redownloadMsg && (
                <p className={`text-xs mt-1 ${redownloadMsg.ok ? 'text-green-600 dark:text-green-400' : 'text-red-500'}`}>{redownloadMsg.text}</p>
              )}
            </div>
            <button
              className="shrink-0 rounded border border-amber-300 bg-amber-50 dark:bg-amber-900/20 hover:bg-amber-100 px-4 py-2 text-sm font-medium text-amber-700 dark:text-amber-400 transition-all"
              onClick={() => { setRedownloadMsg(null); setRedownloadStep(1); }}>
              重新下载
            </button>
          </div>
        </div>
      </Card>
    );
  }

  function SectionAbout() {
    const Table = ({ children }: { children: React.ReactNode }) => (
      <div className="overflow-x-auto rounded border border-slate-200 dark:border-slate-700">
        <table className="text-xs w-full table-fixed">{children}</table>
      </div>
    );
    const Thead = ({ cols, color = SPRING_GREEN }: { cols: { label: string; w: string }[]; color?: string }) => (
      <thead>
        <tr className="text-xs font-bold text-white" style={{ backgroundColor: color }}>
          {cols.map(c => <th key={c.label} className={`text-left px-3 py-2.5 ${c.w}`}>{c.label}</th>)}
        </tr>
      </thead>
    );
    const Row3 = ({ row }: { row: string[] }) => (
      <tr className="hover:bg-slate-50 dark:hover:bg-slate-800/50 border-b border-slate-100 dark:border-slate-800 last:border-0">
        <td className="px-3 py-2.5 font-medium text-slate-700 dark:text-slate-300">{row[0]}</td>
        <td className="px-3 py-2.5 text-slate-500 dark:text-slate-400">{row[1]}</td>
        <td className="px-3 py-2.5 text-slate-500 dark:text-slate-400">{row[2]}</td>
      </tr>
    );
    const Row5 = ({ row }: { row: string[] }) => (
      <tr className="hover:bg-slate-50 dark:hover:bg-slate-800/50 border-b border-slate-100 dark:border-slate-800 last:border-0">
        <td className="px-3 py-2.5 font-medium text-slate-700 dark:text-slate-300">{row[0]}</td>
        <td className="px-3 py-2.5 text-slate-500 dark:text-slate-400">{row[1]}</td>
        <td className="px-3 py-2.5 text-slate-500 dark:text-slate-400">{row[2]}</td>
        <td className="px-3 py-2.5 text-slate-400 dark:text-slate-500">{row[3]}</td>
        <td className="px-3 py-2.5 text-slate-400 dark:text-slate-500">{row[4]}</td>
      </tr>
    );

    return (
      <div className="space-y-5">
        <Card title="基本功能" accent accentColor={SPRING_GREEN}>
          <Table>
            <Thead cols={[{ label: '功能', w: 'w-[28%]' }, { label: '本地引擎', w: 'w-[28%]' }, { label: '云端服务商', w: 'w-[44%]' }]} />
            <tbody>
              {[
                ['TTS 文本转语音', 'Fish Speech', 'OpenAI · Gemini · ElevenLabs · Cartesia · DashScope'],
                ['VC 音色转换', 'RVC · Seed-VC', 'ElevenLabs'],
                ['STT 语音转文字', 'Whisper', 'OpenAI · Gemini · Groq · Deepgram'],
                ['LLM 聊天', 'Ollama', 'OpenAI · Gemini · Claude · DeepSeek · Groq · Mistral · xAI · GitHub'],
                ['语音聊天', 'Whisper + Ollama + Fish Speech', 'OpenAI Realtime · Gemini Live'],
                ['音视频格式转换', 'FFmpeg（内置）', '—'],
                ['文档转换 / PDF', 'pdf2docx · pandoc · PyMuPDF', '—'],
              ].map(row => <Row3 key={row[0]} row={row} />)}
            </tbody>
          </Table>
        </Card>

        <Card title="扩展功能" accent accentColor="#8b5cf6">
          <Table>
            <Thead cols={[{ label: '功能', w: 'w-[28%]' }, { label: '本地引擎', w: 'w-[28%]' }, { label: '云端服务商', w: 'w-[44%]' }]} color="#8b5cf6" />
            <tbody>
              {[
                ['图像生成', 'SD-Turbo · Flux.1-Schnell GGUF · ComfyUI', 'OpenAI DALL-E 3 · Gemini Imagen 3 · Stability AI · DashScope'],
                ['图像理解', 'Ollama（LLaVA · moondream）', 'OpenAI GPT-4o · Gemini Vision · Claude Vision'],
                ['文字翻译', 'Ollama', 'OpenAI · Gemini · Claude · DeepSeek · Groq · Mistral · xAI · GitHub'],
                ['代码助手', 'Ollama（Qwen-Coder · DeepSeek-Coder）', 'OpenAI · Gemini · Claude · DeepSeek · Groq · Mistral · xAI · GitHub'],
              ].map(row => <Row3 key={row[0]} row={row} />)}
            </tbody>
          </Table>
        </Card>

        <Card title="进阶功能参考" accent accentColor="#d97706">
          <Table>
            <Thead cols={[
              { label: '功能领域',              w: 'w-[14%]' },
              { label: '推荐本地（4050 6GB）',   w: 'w-[20%]' },
              { label: '推荐云端（生产环境）',   w: 'w-[18%]' },
              { label: '4050 优化方向',          w: 'w-[28%]' },
              { label: 'MBP 32GB 表现',          w: 'w-[20%]' },
            ]} color="#d97706" />
            <tbody>
              {[
                ['图像生成',  'Flux.1-Schnell GGUF Q4', 'Midjourney',                  'Schnell 是 6GB 显存下的速度之王',          '优（可跑 Dev 版 FP8 高质模型）'],
                ['换脸/动作', 'FaceFusion 3.x',         'Replicate（InsightFace）',    '4050 跑实时推理极稳，无需云端',            '良（MPS 加速下兼容性较好）'],
                ['视频生成',  'Wan 2.1（1.3B）',        'Kling（可灵）/ Runway',       '本地仅能做 2-3 秒预览，成品必须云端',      '差（内存交换频繁，不建议）'],
                ['OCR / 文档','GOT-OCR2.0',             'Azure Doc Intelligence',       '本地运行轻量级，满足日常识别',             '极优（大内存处理高密文档）'],
                ['口型同步',  'LivePortrait FP16',       'HeyGen',                      '4050 跑 LivePortrait 对延迟优化极好',      '中（仅能处理轻量级任务）'],
              ].map(row => <Row5 key={row[0]} row={row} />)}
            </tbody>
          </Table>
        </Card>
      </div>
    );
  }

  // ── render ────────────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col h-full overflow-hidden">

      {/* 确认弹窗 */}
      {showClearConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="w-[360px] rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-2xl overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-100 dark:border-slate-800">
              <h3 className="text-base font-bold text-slate-800 dark:text-slate-100">确认清除用户数据？</h3>
            </div>
            <div className="px-6 py-4">
              <p className="text-sm text-slate-500 dark:text-slate-400 leading-relaxed">将删除已下载的全部模型文件和运行库，下次启动时需要重新下载。此操作不可撤销。</p>
            </div>
            <div className="flex gap-2 justify-end px-6 py-3 bg-slate-50 dark:bg-slate-800/50 border-t border-slate-100 dark:border-slate-800">
              <button className="rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-50 px-4 py-2 text-sm font-medium text-slate-600 dark:text-slate-300 transition-colors"
                onClick={() => setShowClearConfirm(false)}>取消</button>
              <button className="rounded bg-red-600 hover:bg-red-700 px-4 py-2 text-sm font-medium text-white transition-colors disabled:opacity-50"
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

      {redownloadStep === 1 && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="w-[360px] rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-2xl overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-100 dark:border-slate-800">
              <h3 className="text-base font-bold text-slate-800 dark:text-slate-100">重新下载全部模型？</h3>
            </div>
            <div className="px-6 py-4">
              <p className="text-sm text-slate-500 dark:text-slate-400 leading-relaxed">将清除已下载的所有模型文件和运行库，并立即打开下载引导窗口重新安装。</p>
            </div>
            <div className="flex gap-2 justify-end px-6 py-3 bg-slate-50 dark:bg-slate-800/50 border-t border-slate-100 dark:border-slate-800">
              <button className="rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-50 px-4 py-2 text-sm font-medium text-slate-600 dark:text-slate-300 transition-colors"
                onClick={() => setRedownloadStep(0)}>取消</button>
              <button className="rounded bg-amber-500 hover:bg-amber-600 px-4 py-2 text-sm font-medium text-white transition-colors"
                onClick={() => setRedownloadStep(2)}>继续</button>
            </div>
          </div>
        </div>
      )}

      {redownloadStep === 2 && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="w-[360px] rounded-lg border border-red-200 dark:border-red-800 bg-white dark:bg-slate-900 shadow-2xl overflow-hidden">
            <div className="px-6 py-4 border-b border-red-100 dark:border-red-900 bg-red-50 dark:bg-red-900/20">
              <h3 className="text-base font-bold text-red-700 dark:text-red-400">再次确认</h3>
            </div>
            <div className="px-6 py-4">
              <p className="text-sm text-slate-500 dark:text-slate-400 leading-relaxed">此操作将<span className="font-bold text-red-600 dark:text-red-400">删除全部已下载的模型与运行库</span>，不可撤销。确认后立即打开下载引导。</p>
            </div>
            <div className="flex gap-2 justify-end px-6 py-3 bg-slate-50 dark:bg-slate-800/50 border-t border-slate-100 dark:border-slate-800">
              <button className="rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-50 px-4 py-2 text-sm font-medium text-slate-600 dark:text-slate-300 transition-colors"
                onClick={() => setRedownloadStep(0)}>取消</button>
              <button className="rounded bg-red-600 hover:bg-red-700 px-4 py-2 text-sm font-medium text-white transition-colors disabled:opacity-50"
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

      {/* Hero header — Spring Boot dark style */}
      <div className="shrink-0" style={{ backgroundColor: '#1d1d1d' }}>
        <div className="px-8 pt-6 pb-0">
          <div className="flex items-center gap-3 mb-1">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
              <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2z" fill={SPRING_GREEN} opacity="0.15"/>
              <path d="M16 7c-2 0-4 1.2-5.2 2.8S9 14 9 14s2-.8 3.6-2.4S15.2 8.2 16 7c.24-.4.16-.8-.4-.4C15.2 7 16 7 16 7z" fill={SPRING_GREEN}/>
              <path d="M9 14s.8 2.4 3.6 3.2" stroke={SPRING_GREEN} strokeWidth="1.2" strokeLinecap="round"/>
            </svg>
            <h1 className="text-lg font-bold tracking-tight" style={{ color: '#f9fafb' }}>设置</h1>
          </div>
          <p className="text-xs mb-4 leading-relaxed" style={{ color: '#6b7280' }}>
            管理引擎模型、系统配置与诊断工具
          </p>

          {/* Tab bar */}
          <nav className="flex">
            {visibleNav.map(item => {
              const isActive = activeSection === item.id;
              return (
                <button
                  key={item.id}
                  onClick={() => setActiveSection(item.id)}
                  className="px-4 py-2.5 text-sm font-medium border-b-2 transition-colors"
                  style={{
                    color: isActive ? SPRING_GREEN : '#9ca3af',
                    borderBottomColor: isActive ? SPRING_GREEN : 'transparent',
                    backgroundColor: 'transparent',
                  }}>
                  {item.label}
                </button>
              );
            })}
          </nav>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto bg-slate-50 dark:bg-[#111]">
        <div className="max-w-4xl px-8 py-6">
          {activeSection === 'perf'   && <SectionPerf />}
          {activeSection === 'health' && <SectionHealth />}
          {activeSection === 'models' && isElectron && <SectionModels />}
          {activeSection === 'logs'   && isElectron && <SectionLogs />}
          {activeSection === 'reset'  && isElectron && <SectionReset />}
          {activeSection === 'about'  && <SectionAbout />}
        </div>
      </div>
    </div>
  );
}
