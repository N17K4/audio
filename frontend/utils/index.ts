// ─── 工具函数 ───────────────────────────────────────────────────────────────
export async function safeJson(res: Response): Promise<any> {
  try { return await res.json(); } catch { return null; }
}

export async function waitForBackend(baseUrl: string): Promise<boolean> {
  for (let i = 0; i < 20; i++) {
    try { const r = await fetch(`${baseUrl}/health`); if (r.ok) return true; } catch { /**/ }
    await new Promise(r => setTimeout(r, 500));
  }
  return false;
}

// ─── 前端日志（写入 logs/frontend.log，仅 production）───────────────────────
export function rlog(level: 'INFO' | 'WARN' | 'ERROR', ...args: unknown[]): void {
  const msg = args.map(a => (typeof a === 'object' ? JSON.stringify(a) : String(a))).join(' ');
  try { (window as any).electronAPI?.logRenderer?.(level, msg); } catch {}
}
