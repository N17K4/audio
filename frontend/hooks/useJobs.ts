import { useState, useEffect } from 'react';
import type { Job } from '../types';

export function useJobs(
  backendBaseUrl: string,
  backendReady: boolean,
  onNavigateTasks: () => void,
) {
  const [jobs, setJobs] = useState<Job[]>([]);

  // 轮询进行中的任务
  useEffect(() => {
    if (!backendReady || !backendBaseUrl) return;
    const hasActive = jobs.some(j => j.status === 'queued' || j.status === 'running');
    if (!hasActive) return;
    const timer = setTimeout(async () => {
      try {
        const r = await fetch(`${backendBaseUrl}/jobs`);
        if (!r.ok) return;
        const d = await r.json();
        setJobs(d.jobs || []);
      } catch { /**/ }
    }, 2000);
    return () => clearTimeout(timer);
  }, [jobs, backendReady, backendBaseUrl]);

  async function fetchJobs() {
    if (!backendBaseUrl) return;
    try {
      const r = await fetch(`${backendBaseUrl}/jobs`);
      if (!r.ok) return;
      const d = await r.json();
      setJobs(d.jobs || []);
    } catch { /**/ }
  }

  function addInstantJobResult(
    type: string, label: string, provider: string, isLocal: boolean,
    result: { status: 'completed' | 'failed'; result_url?: string; result_text?: string; error?: string },
  ) {
    const now = Date.now() / 1000;
    const job: Job = {
      id: `instant_${Date.now()}`,
      type, label, provider, is_local: isLocal,
      status: result.status,
      created_at: now, started_at: now, completed_at: now,
      result_url: result.result_url || null,
      result_text: result.result_text || null,
      error: result.error || null,
    };
    setJobs(prev => [job, ...prev]);
    // 直接切到任务列表，不调 fetchJobs（fetchJobs 会覆盖掉本地刚加的即时任务）
    onNavigateTasks();
  }

  async function pollJobResult(jobId: string, timeoutMs = 180000): Promise<Job> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      await new Promise(r => setTimeout(r, 1500));
      try {
        const r = await fetch(`${backendBaseUrl}/jobs/${jobId}`);
        if (!r.ok) continue;
        const d: Job = await r.json();
        setJobs(prev => {
          const idx = prev.findIndex(j => j.id === jobId);
          if (idx >= 0) { const next = [...prev]; next[idx] = d; return next; }
          return [d, ...prev];
        });
        if (d.status === 'completed') return d;
        if (d.status === 'failed') throw new Error(d.error || '任务失败');
      } catch (e) {
        if (e instanceof Error && e.message !== 'NetworkError') throw e;
      }
    }
    throw new Error('等待任务超时（3 分钟）');
  }

  return { jobs, setJobs, fetchJobs, addInstantJobResult, pollJobResult };
}
