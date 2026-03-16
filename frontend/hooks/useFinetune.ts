import { useState, useCallback, useRef } from 'react';
import { FinetuneJob } from '../types';

export function useFinetune(backendUrl: string) {
  const [jobs, setJobs] = useState<FinetuneJob[]>([]);
  const [currentJobId, setCurrentJobId] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const startFinetune = useCallback(async (params: {
    model: string;
    dataset: File;
    lora_r: number;
    lora_alpha: number;
    num_epochs: number;
    batch_size: number;
    learning_rate: number;
    max_seq_length: number;
    export_format: string;
  }) => {
    const form = new FormData();
    form.append('model', params.model);
    form.append('dataset', params.dataset);
    form.append('lora_r', String(params.lora_r));
    form.append('lora_alpha', String(params.lora_alpha));
    form.append('num_epochs', String(params.num_epochs));
    form.append('batch_size', String(params.batch_size));
    form.append('learning_rate', String(params.learning_rate));
    form.append('max_seq_length', String(params.max_seq_length));
    form.append('export_format', params.export_format);

    const res = await fetch(`${backendUrl}/finetune/start`, { method: 'POST', body: form });
    const data = await res.json();
    setCurrentJobId(data.job_id);
    return data.job_id;
  }, [backendUrl]);

  const pollJob = useCallback((jobId: string) => {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(async () => {
      const res = await fetch(`${backendUrl}/finetune/jobs/${jobId}`);
      if (res.ok) {
        const job: FinetuneJob = await res.json();
        setJobs(prev => {
          const idx = prev.findIndex(j => j.job_id === jobId);
          if (idx >= 0) {
            const next = [...prev];
            next[idx] = job;
            return next;
          }
          return [...prev, job];
        });
        if (job.status !== 'running') {
          clearInterval(pollRef.current!);
        }
      }
    }, 2000);
  }, [backendUrl]);

  const fetchJobs = useCallback(async () => {
    const res = await fetch(`${backendUrl}/finetune/jobs`);
    if (res.ok) setJobs(await res.json());
  }, [backendUrl]);

  const cancelJob = useCallback(async (jobId: string) => {
    await fetch(`${backendUrl}/finetune/jobs/${jobId}`, { method: 'DELETE' });
    setJobs(prev => prev.filter(j => j.job_id !== jobId));
  }, [backendUrl]);

  return { jobs, currentJobId, startFinetune, pollJob, fetchJobs, cancelJob };
}
