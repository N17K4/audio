import React, { useState, useEffect, useRef } from 'react';
import type { DiskRow } from '../types';

interface SystemPanelProps {
  backendBaseUrl: string;
  isElectron: boolean;
  /** 外部控制要显示的 section（嵌入模式：隐藏 hero header + tab bar） */
  externalSection?: string;
}

const NAV_ITEMS = [
  { id: 'about',   label: '功能说明',   electronOnly: false, keywords: ['功能', '说明', '关于', '引擎'] },
  { id: 'models',  label: '模型管理',   electronOnly: true,  keywords: ['模型', '磁盘', '安装', '卸载', '下载', '体积', '清除', '重置', '重新下载', '数据'] },
  { id: 'perf',    label: '性能',       electronOnly: false, keywords: ['并发', '性能', '推理', '并行'] },
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

export default function SystemPanel({ backendBaseUrl, isElectron, externalSection }: SystemPanelProps) {
  const [activeSection, setActiveSection] = useState<SectionId>('about');
  const effectiveSection = (externalSection as SectionId) || activeSection;
  const isEmbedded = !!externalSection;

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

  // ── 磁盘占用 ────────────────────────────────────────────────────────────────
  const [diskRows, setDiskRows] = useState<DiskRow[] | null>(null);
  const [diskLoading, setDiskLoading] = useState(false);
  const [diskRefreshedAt, setDiskRefreshedAt] = useState<Date | null>(null);
  const [clearingRow, setClearingRow] = useState<Record<string, boolean>>({});
  const [installLog, setInstallLog] = useState<string[]>([]);
  const [installLogKey, setInstallLogKey] = useState<string>('');
  const installLogRef = useRef<HTMLPreElement>(null);
  const [stageStatus, setStageStatus] = useState<Record<string, 'idle' | 'reinstalling' | 'deleting'>>({});

  useEffect(() => {
    const el = installLogRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [installLog]);

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
    if (effectiveSection === 'models' && isElectron) { doRefreshDisk(); }
  }, [effectiveSection]);

  async function doRefreshDisk() {
    setDiskLoading(true);
    try { setDiskRows(await window.electronAPI?.getDiskUsage() ?? null); } catch { /**/ }
    setDiskRefreshedAt(new Date());
    setDiskLoading(false);
  }

  // ── 重新安装确认弹窗 ──────────────────────────────────────────────────────
  const [reinstallConfirmStage, setReinstallConfirmStage] = useState<string | null>(null);

  function confirmReinstallStage(stage: string) {
    setReinstallConfirmStage(stage);
  }

  async function doConfirmedReinstall() {
    const stage = reinstallConfirmStage;
    if (!stage) return;
    setReinstallConfirmStage(null);

    // 清除该阶段数据后打开引导页（用户可在引导页选择镜像源）
    setStageStatus(s => ({ ...s, [stage]: 'reinstalling' }));
    const res = await window.electronAPI?.clearStageAndOpenSetup?.(stage);
    if (res && !res.ok) {
      setInstallLog(prev => [...prev, `✗ 操作失败：${res.error ?? '未知错误'}`]);
    }
    try { setDiskRows(await window.electronAPI?.getDiskUsage() ?? null); } catch { /**/ }
    setStageStatus(s => ({ ...s, [stage]: 'idle' }));
  }

  // ── 折叠状态 ─────────────────────────────────────────────────────────────────
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const toggleCollapse = (key: string) => setCollapsed(s => ({ ...s, [key]: !s[key] }));

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

  function SectionModels() {
    const STAGE_META: Record<string, { label: string; cmd: string; desc: string; estimatedSize: string }> = {
      setup:             { label: '运行环境',         cmd: 'pnpm run setup',             desc: '嵌入式 Python + 后端依赖 + 全部引擎 pip 包与源码 + FFmpeg + Pandoc',                estimatedSize: '~600 MB' },
      ml_base:           { label: 'ML 基础依赖',      cmd: 'pnpm run ml',                desc: 'torch · torchaudio · transformers 等基础引擎 ML 运行库',                           estimatedSize: '~2–4 GB' },
      ml_extra:          { label: 'ML 扩展依赖',      cmd: 'pnpm run ml:extra',          desc: 'RAG（llama-index · faiss）· Agent（langgraph）· LoRA（peft · trl）',                estimatedSize: '~500 MB–1 GB' },
      checkpoints_base:  { label: '基础模型权重',     cmd: 'pnpm run checkpoints',       desc: 'Fish Speech · GPT-SoVITS · Seed-VC · RVC · Whisper · FaceFusion 模型 + 内置音色',   estimatedSize: '~8–10 GB' },
      checkpoints_extra: { label: '扩展模型权重',     cmd: 'pnpm run checkpoints:extra', desc: 'Flux · SD-Turbo · Wan · GOT-OCR · LivePortrait 模型（按需安装，体积较大）',          estimatedSize: '~20–40 GB' },
    };
    const STAGE_ORDER = ['setup', 'ml_base', 'ml_extra', 'checkpoints_base', 'checkpoints_extra'] as const;

    if (!diskRows) {
      return (
        <Card title="模型管理" desc="按安装阶段管理本地引擎、依赖与模型。">
          <div className="flex items-center gap-2 text-sm text-slate-400 py-4">
            <Spinner /><span>正在加载…</span>
          </div>
        </Card>
      );
    }

    // 按 stage 分组
    const stageMap = new Map<string, typeof diskRows>();
    const cacheRows: typeof diskRows = [];
    for (const r of diskRows) {
      if (r.stage) {
        if (!stageMap.has(r.stage)) stageMap.set(r.stage, []);
        stageMap.get(r.stage)!.push(r);
      } else if (r.clearable) {
        cacheRows.push(r);
      }
    }

    const total = diskRows.reduce((s, r) => s + Math.max(0, r.size), 0);
    const anyBusy = Object.values(stageStatus).some(s => s !== 'idle');

    // 折叠辅助
    const ChevronIcon = ({ open }: { open: boolean }) => (
      <svg className={`w-4 h-4 transition-transform ${open ? 'rotate-90' : ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M9 18l6-6-6-6" />
      </svg>
    );

    return (
      <div className="space-y-4">
        {/* 全量重置卡片（置顶） */}
        <div className="rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden shadow-sm">
          <button className="w-full px-5 py-3 flex items-center gap-3 hover:bg-slate-50/80 dark:hover:bg-slate-800/30 transition-colors"
            onClick={() => toggleCollapse('global')}>
            <span className="text-slate-400"><ChevronIcon open={!collapsed['global']} /></span>
            <h3 className="text-sm font-bold text-slate-800 dark:text-slate-200 flex-1 text-left">全量重置</h3>
            <span className="text-sm font-bold text-slate-600 dark:text-slate-300 tabular-nums">{fmtSize(total)}</span>
          </button>
          {!collapsed['global'] && (
            <div className="border-t border-slate-100 dark:border-slate-800">
              <div className="divide-y divide-slate-100 dark:divide-slate-800">
                <div className="flex items-start justify-between px-5 py-4 gap-4">
                  <div className="space-y-1">
                    <p className="text-sm font-semibold text-slate-700 dark:text-slate-300">清除全部数据</p>
                    <p className="text-xs text-slate-500 dark:text-slate-400">删除全部模型、引擎、缓存和运行库，下次启动重新引导下载</p>
                    {clearMsg && (
                      <p className={`text-xs mt-1 ${clearMsg.ok ? 'text-green-600 dark:text-green-400' : 'text-red-500'}`}>{clearMsg.text}</p>
                    )}
                  </div>
                  <button
                    className="shrink-0 rounded border border-red-300 bg-red-50 dark:bg-red-900/20 hover:bg-red-100 px-4 py-2 text-sm font-medium text-red-600 dark:text-red-400 transition-all disabled:opacity-50"
                    disabled={anyBusy}
                    onClick={() => { setClearMsg(null); setShowClearConfirm(true); }}>
                    清除全部
                  </button>
                </div>
                <div className="flex items-start justify-between px-5 py-4 gap-4">
                  <div className="space-y-1">
                    <p className="text-sm font-semibold text-slate-700 dark:text-slate-300">重新下载全部</p>
                    <p className="text-xs text-slate-500 dark:text-slate-400">清除全部数据后立即打开下载引导重新安装</p>
                    {redownloadMsg && (
                      <p className={`text-xs mt-1 ${redownloadMsg.ok ? 'text-green-600 dark:text-green-400' : 'text-red-500'}`}>{redownloadMsg.text}</p>
                    )}
                  </div>
                  <button
                    className="shrink-0 rounded border border-amber-300 bg-amber-50 dark:bg-amber-900/20 hover:bg-amber-100 px-4 py-2 text-sm font-medium text-amber-700 dark:text-amber-400 transition-all disabled:opacity-50"
                    disabled={anyBusy}
                    onClick={() => { setRedownloadMsg(null); setRedownloadStep(1); }}>
                    重新下载
                  </button>
                </div>
              </div>
              {/* 状态栏 */}
              <div className="flex items-center justify-end gap-2 px-5 py-2 bg-slate-50/60 dark:bg-slate-800/30 border-t border-slate-100 dark:border-slate-800">
                {Object.entries(stageStatus).map(([stage, st]) => st !== 'idle' && (
                  <span key={stage} className="flex items-center gap-1.5 text-xs font-medium" style={{ color: SPRING_GREEN }}>
                    <Spinner />{st === 'reinstalling' ? `正在安装 ${STAGE_META[stage]?.label ?? stage}…` : `正在删除…`}
                  </span>
                ))}
                {diskRefreshedAt && !diskLoading && (
                  <span className="text-xs text-slate-400">更新于 {fmtTime(diskRefreshedAt)}</span>
                )}
                <button
                  className="rounded border px-3 py-1 text-xs font-medium transition-all disabled:opacity-50"
                  style={{ borderColor: SPRING_GREEN, color: SPRING_GREEN }}
                  disabled={diskLoading}
                  onClick={doRefreshDisk}>
                  {diskLoading ? <><Spinner /> 刷新中</> : '刷新'}
                </button>
              </div>
            </div>
          )}
        </div>

        {/* 5 个安装阶段卡片（可折叠） */}
        {STAGE_ORDER.map(stage => {
          const meta = STAGE_META[stage];
          const rows = stageMap.get(stage) ?? [];
          const stageSize = rows.reduce((s, r) => s + Math.max(0, r.size), 0);
          const isBusy = (stageStatus[stage] ?? 'idle') !== 'idle';
          const isOpen = !collapsed[stage];

          return (
            <div key={stage} className="rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden shadow-sm">
              {/* 可折叠标题栏 */}
              <div className="flex items-center gap-2 px-5 py-3">
                <button className="flex items-center gap-2 flex-1 min-w-0 text-left" onClick={() => toggleCollapse(stage)}>
                  <span className="text-slate-400"><ChevronIcon open={isOpen} /></span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <h3 className="text-sm font-bold text-slate-800 dark:text-slate-200">{meta.label}</h3>
                      <span className="inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-mono leading-none bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400">
                        {meta.cmd}
                      </span>
                      <span className="text-xs text-slate-400">预计 {meta.estimatedSize}</span>
                    </div>
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 leading-relaxed">{meta.desc}</p>
                  </div>
                </button>
                <span className="text-sm font-bold text-slate-600 dark:text-slate-300 tabular-nums shrink-0">{fmtSize(stageSize)}</span>
                <button
                  className="shrink-0 rounded border px-2.5 py-1 text-xs font-medium transition-all disabled:opacity-50 flex items-center gap-1"
                  style={{ borderColor: SPRING_GREEN, color: SPRING_GREEN }}
                  disabled={isBusy || anyBusy}
                  onClick={() => confirmReinstallStage(stage)}>
                  {isBusy && stageStatus[stage] === 'reinstalling' ? <><Spinner />重新安装中</> : '重新安装'}
                </button>
              </div>

              {/* 展开内容：子项列表 */}
              {isOpen && rows.length > 0 && (
                <div className="border-t border-slate-100 dark:border-slate-800 divide-y divide-slate-100 dark:divide-slate-800">
                  {rows.map(r => (
                    <div key={r.key} className="flex items-center gap-4 px-5 py-2.5 pl-12 hover:bg-slate-50/80 dark:hover:bg-slate-800/30 transition-colors">
                      <button className="flex-1 min-w-0 text-left group" title="点击打开目录"
                        onClick={() => r.sub && window.electronAPI?.openDir?.(r.sub)}>
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-xs font-medium text-slate-600 dark:text-slate-300 group-hover:underline decoration-dotted underline-offset-2">
                            {r.label}
                          </span>
                          {r.estimatedSizeMb != null && r.estimatedSizeMb > 0 && (
                            <span className="inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-mono leading-none bg-slate-100 dark:bg-slate-700 text-slate-400">
                              ~{r.estimatedSizeMb >= 1024 ? `${(r.estimatedSizeMb / 1024).toFixed(1)} GB` : `${r.estimatedSizeMb} MB`}
                            </span>
                          )}
                        </div>
                        {r.sub && (
                          <div className="text-[11px] text-slate-400 dark:text-slate-500 mt-0.5 font-mono break-all leading-tight">{r.sub}</div>
                        )}
                        {r.desc && (
                          <div className="text-[11px] text-slate-400 dark:text-slate-500 mt-1 leading-relaxed">{r.desc}</div>
                        )}
                      </button>
                      <span className="w-16 text-right text-xs text-slate-500 dark:text-slate-400 tabular-nums shrink-0">
                        {fmtSize(r.size)}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}

        {/* 缓存（可折叠 + 可单独清空） */}
        {cacheRows.length > 0 && (
          <div className="rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden shadow-sm">
            <button className="w-full px-5 py-3 flex items-center gap-3 hover:bg-slate-50/80 dark:hover:bg-slate-800/30 transition-colors"
              onClick={() => toggleCollapse('cache')}>
              <span className="text-slate-400"><ChevronIcon open={!collapsed['cache']} /></span>
              <div className="flex-1 text-left">
                <h3 className="text-sm font-bold text-slate-800 dark:text-slate-200">缓存</h3>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">临时文件与缓存数据，可安全清空</p>
              </div>
              <span className="text-sm font-bold text-slate-600 dark:text-slate-300 tabular-nums shrink-0">
                {fmtSize(cacheRows.reduce((s, r) => s + Math.max(0, r.size), 0))}
              </span>
            </button>
            {!collapsed['cache'] && (
              <div className="border-t border-slate-100 dark:border-slate-800 divide-y divide-slate-100 dark:divide-slate-800">
                {cacheRows.map(r => (
                  <div key={r.key} className="flex items-center justify-between px-5 py-3 gap-4">
                    <button className="flex-1 min-w-0 text-left group" title="点击打开目录"
                      onClick={() => r.sub && window.electronAPI?.openDir?.(r.sub)}>
                      <p className="text-xs font-medium text-slate-600 dark:text-slate-400 group-hover:underline decoration-dotted underline-offset-2">{r.label}</p>
                      {r.sub && <p className="text-[11px] text-slate-400 font-mono mt-0.5 break-all">{r.sub}</p>}
                    </button>
                    <span className="text-xs text-slate-500 tabular-nums shrink-0">{fmtSize(r.size)}</span>
                    <button
                      className="shrink-0 rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-50 px-2.5 py-1 text-xs font-medium text-slate-600 dark:text-slate-400 transition-all disabled:opacity-50 flex items-center gap-1"
                      disabled={clearingRow[r.key] || r.size === 0}
                      onClick={async () => {
                        setClearingRow(s => ({ ...s, [r.key]: true }));
                        await window.electronAPI?.clearDiskRow?.(r.key);
                        try { setDiskRows(await window.electronAPI?.getDiskUsage() ?? null); } catch { /**/ }
                        setClearingRow(s => ({ ...s, [r.key]: false }));
                      }}>
                      {clearingRow[r.key] ? <><Spinner />清空中</> : '清空'}
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

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

      </div>
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
    <div className={isEmbedded ? '' : 'flex flex-col h-full overflow-hidden'}>

      {/* 确认弹窗 */}
      {/* 重新安装确认弹窗 */}
      {reinstallConfirmStage && (() => {
        const meta: Record<string, string> = {
          setup: '运行环境', ml_base: 'ML 基础依赖', ml_extra: 'ML 扩展依赖',
          checkpoints_base: '基础模型权重', checkpoints_extra: '扩展模型权重',
        };
        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
            <div className="w-[400px] rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-2xl overflow-hidden">
              <div className="px-6 py-4 border-b border-slate-100 dark:border-slate-800">
                <h3 className="text-base font-bold text-slate-800 dark:text-slate-100">
                  确认重新安装「{meta[reinstallConfirmStage] ?? reinstallConfirmStage}」？
                </h3>
              </div>
              <div className="px-6 py-4 space-y-3">
                <p className="text-sm text-slate-500 dark:text-slate-400 leading-relaxed">
                  将清除该阶段的已有数据，并打开下载引导窗口。你可以在引导页中选择 PyPI / HuggingFace 镜像源后再开始下载。
                </p>
              </div>
              <div className="flex gap-2 justify-end px-6 py-3 bg-slate-50 dark:bg-slate-800/50 border-t border-slate-100 dark:border-slate-800">
                <button className="rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-50 px-4 py-2 text-sm font-medium text-slate-600 dark:text-slate-300 transition-colors"
                  onClick={() => setReinstallConfirmStage(null)}>取消</button>
                <button className="rounded px-4 py-2 text-sm font-medium text-white transition-colors hover:opacity-90"
                  style={{ backgroundColor: SPRING_GREEN }}
                  onClick={doConfirmedReinstall}>
                  确认继续
                </button>
              </div>
            </div>
          </div>
        );
      })()}

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

      {/* Hero header + Tab bar（仅独立模式显示） */}
      {!isEmbedded && (
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
      )}

      {/* Content */}
      <div className={isEmbedded ? '' : 'flex-1 overflow-y-auto bg-slate-50 dark:bg-[#111]'}>
        <div className={isEmbedded ? '' : 'max-w-4xl px-8 py-6'}>
          {effectiveSection === 'perf'   && <SectionPerf />}
          {effectiveSection === 'models' && isElectron && <SectionModels />}
          {effectiveSection === 'about'  && <SectionAbout />}
        </div>
      </div>
    </div>
  );
}
