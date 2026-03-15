import { useState, useEffect } from 'react';
import type { Job } from '../types';

const STORAGE_KEY = 'ai_tool_jobs';
const MAX_STORED = 200;

function loadStoredJobs(): Job[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as Job[];
  } catch { return []; }
}

function saveJobs(jobs: Job[]) {
  try {
    // 只持久化已完成/失败的任务，进行中的重启后无意义
    const toStore = jobs
      .filter(j => j.status === 'completed' || j.status === 'failed')
      .slice(0, MAX_STORED);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(toStore));
  } catch { /**/ }
}

/**
 * 将后端返回的任务列表与本地状态合并：
 * - 后端有的任务以后端数据为准（状态更新）
 * - 本地 instant_* 任务不在后端，保留
 * - 按 created_at 降序排列
 */
function mergeJobs(prev: Job[], backendJobs: Job[]): Job[] {
  const backendMap = new Map(backendJobs.map(j => [j.id, j]));
  const localOnly = prev.filter(j => !backendMap.has(j.id));
  const merged = [...backendJobs, ...localOnly];
  merged.sort((a, b) => (b.created_at || 0) - (a.created_at || 0));
  return merged;
}

export function useJobs(
  backendBaseUrl: string,
  backendReady: boolean,
  onNavigateTasks: () => void,
) {
  const [jobs, setJobsRaw] = useState<Job[]>(() => loadStoredJobs());

  function setJobs(updater: Job[] | ((prev: Job[]) => Job[])) {
    setJobsRaw(prev => {
      const next = typeof updater === 'function' ? updater(prev) : updater;
      saveJobs(next);
      return next;
    });
  }

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
        setJobs(prev => mergeJobs(prev, d.jobs || []));
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
      setJobs(prev => mergeJobs(prev, d.jobs || []));
    } catch { /**/ }
  }

  function addPendingJob(type: string, label: string, provider: string, isLocal: boolean): string {
    const id = `instant_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const now = Date.now() / 1000;
    const job: Job = {
      id, type, label, provider, is_local: isLocal,
      status: 'running',
      created_at: now, started_at: now, completed_at: null,
      result_url: null, result_text: null, error: null,
    };
    setJobs(prev => [job, ...prev]);
    return id;
  }

  function resolveJob(
    id: string,
    result: { status: 'completed' | 'failed'; result_url?: string; result_text?: string; error?: string },
  ) {
    const now = Date.now() / 1000;
    setJobs(prev => prev.map(j => j.id !== id ? j : {
      ...j, status: result.status, completed_at: now,
      result_url: result.result_url ?? null,
      result_text: result.result_text ?? null,
      error: result.error ?? null,
    }));
  }

  function addInstantJobResult(
    type: string, label: string, provider: string, isLocal: boolean,
    result: { status: 'completed' | 'failed'; result_url?: string; result_text?: string; error?: string },
  ) {
    const id = addPendingJob(type, label, provider, isLocal);
    resolveJob(id, result);
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

  return { jobs, setJobs, fetchJobs, addInstantJobResult, addPendingJob, resolveJob, pollJobResult };
}
