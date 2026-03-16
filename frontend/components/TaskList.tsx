import React, { useState, useRef, useEffect } from 'react';
import type { Job } from '../types';
import { PROVIDER_LABELS } from '../constants';
import TasksIcon from './icons/TasksIcon';

interface TaskListProps {
  jobs: Job[];
  backendBaseUrl: string;
  setJobs: React.Dispatch<React.SetStateAction<Job[]>>;
  onFetchJobs: () => void;
  outputDir?: string;
  downloadDir?: string;
  addInstantJobResult: (
    type: string, label: string, provider: string, isLocal: boolean,
    result: { status: 'completed' | 'failed'; result_url?: string; result_text?: string; error?: string }
  ) => void;
}

// ─── Smoke test helpers ───────────────────────────────────────────────────────

function createTestWav(): Blob {
  const sampleRate = 8000, numSamples = 8000, numChannels = 1, bitsPerSample = 16;
  const byteRate = sampleRate * numChannels * bitsPerSample / 8;
  const blockAlign = numChannels * bitsPerSample / 8;
  const dataSize = numSamples * blockAlign;
  const buf = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buf);
  const ws = (o: number, s: string) => { for (let i = 0; i < s.length; i++) view.setUint8(o + i, s.charCodeAt(i)); };
  ws(0, 'RIFF'); view.setUint32(4, 36 + dataSize, true); ws(8, 'WAVE');
  ws(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true);
  view.setUint16(22, numChannels, true); view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true); view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitsPerSample, true);
  ws(36, 'data'); view.setUint32(40, dataSize, true);
  return new Blob([buf], { type: 'audio/wav' });
}

function crc32(data: Uint8Array): number {
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < data.length; i++) {
    crc ^= data[i];
    for (let j = 0; j < 8; j++) crc = (crc >>> 1) ^ (crc & 1 ? 0xEDB88320 : 0);
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

function createTestZip(filename: string, data: Uint8Array): Uint8Array<ArrayBuffer> {
  const fn = new TextEncoder().encode(filename);
  const fnLen = fn.length, dataLen = data.length, crc = crc32(data);
  const now = new Date();
  const dosDate = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
  const dosTime = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1);
  const buf = new Uint8Array((30 + fnLen) + dataLen + (46 + fnLen) + 22);
  const view = new DataView(buf.buffer);
  let o = 0;
  view.setUint32(o, 0x04034b50, true); o += 4;
  view.setUint16(o, 20, true); o += 2; view.setUint16(o, 0, true); o += 2; view.setUint16(o, 0, true); o += 2;
  view.setUint16(o, dosTime, true); o += 2; view.setUint16(o, dosDate, true); o += 2;
  view.setUint32(o, crc, true); o += 4;
  view.setUint32(o, dataLen, true); o += 4; view.setUint32(o, dataLen, true); o += 4;
  view.setUint16(o, fnLen, true); o += 2; view.setUint16(o, 0, true); o += 2;
  fn.forEach((b, i) => { buf[o + i] = b; }); o += fnLen;
  buf.set(data, o); o += dataLen;
  const cdOffset = o;
  view.setUint32(o, 0x02014b50, true); o += 4;
  view.setUint16(o, 20, true); o += 2; view.setUint16(o, 20, true); o += 2;
  view.setUint16(o, 0, true); o += 2; view.setUint16(o, 0, true); o += 2;
  view.setUint16(o, dosTime, true); o += 2; view.setUint16(o, dosDate, true); o += 2;
  view.setUint32(o, crc, true); o += 4;
  view.setUint32(o, dataLen, true); o += 4; view.setUint32(o, dataLen, true); o += 4;
  view.setUint16(o, fnLen, true); o += 2; view.setUint16(o, 0, true); o += 2; view.setUint16(o, 0, true); o += 2;
  view.setUint16(o, 0, true); o += 2; view.setUint16(o, 0, true); o += 2;
  view.setUint32(o, 0, true); o += 4; view.setUint32(o, 0, true); o += 4;
  fn.forEach((b, i) => { buf[o + i] = b; }); o += fnLen;
  view.setUint32(o, 0x06054b50, true); o += 4;
  view.setUint16(o, 0, true); o += 2; view.setUint16(o, 0, true); o += 2;
  view.setUint16(o, 1, true); o += 2; view.setUint16(o, 1, true); o += 2;
  view.setUint32(o, 46 + fnLen, true); o += 4; view.setUint32(o, cdOffset, true); o += 4;
  view.setUint16(o, 0, true);
  return buf;
}

function createTestImage(): Blob {
  const b64 = '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAARCAABAAEDASIAAhEBAxEB/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/xAAUAQEAAAAAAAAAAAAAAAAAAAAA/8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAwDAQACEQMRAD8AJQAB/9k=';
  const bin = atob(b64);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return new Blob([arr], { type: 'image/jpeg' });
}

const SPRING_GREEN = '#6db33f';

function Spinner() {
  return (
    <svg className="animate-spin w-3 h-3" viewBox="0 0 24 24" fill="none">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
    </svg>
  );
}

// ─── 各引擎阶段定义 ──────────────────────────────────────────────────────────

const PROVIDER_STAGES: Record<string, string[]> = {
  fish_speech: ['Worker 连接', '语言建模', '声码合成', '保存文件'],
  local_rvc:   ['加载模型', 'F0 提取', '特征转换', '声音合成', '保存文件'],
  seed_vc:     ['加载音频', '扩散推理', '后处理', '保存文件'],
  whisper:     ['加载模型', '音频预处理', '转写识别', '输出文本'],
};

const TRAIN_STAGES = ['预处理', '提取特征', '构建索引', '转换模型', '写出配置'];

const TRAIN_STEP_IDX: Record<string, number> = {
  start: 0, preprocessing: 0, features: 1, index: 2, model: 3, meta: 4, done: 5,
};

/** 返回阶段列表和当前阶段索引（-1=全部待定，stages.length=全部完成） */
function getJobStages(job: Job): { stages: string[]; currentIdx: number; isTrain: boolean } | null {
  if (job.type === 'train') {
    let currentIdx = -1;
    if (job.status === 'completed') currentIdx = TRAIN_STAGES.length;
    else if (job.status === 'running') currentIdx = (job.step ? TRAIN_STEP_IDX[job.step] ?? 0 : 0);
    else if (job.status === 'failed') currentIdx = (job.step ? TRAIN_STEP_IDX[job.step] ?? 0 : 0);
    return { stages: TRAIN_STAGES, currentIdx, isTrain: true };
  }
  const stages = PROVIDER_STAGES[job.provider];
  if (!stages) return null;
  let currentIdx = -1;
  if (job.status === 'running') currentIdx = 0;
  else if (job.status === 'completed') currentIdx = stages.length;
  else if (job.status === 'failed') currentIdx = 0;
  return { stages, currentIdx, isTrain: false };
}

type StageState = 'done' | 'active' | 'failed' | 'pending';

function getStagePillCls(state: StageState, isTrain: boolean): string {
  if (state === 'done')
    return 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-400';
  if (state === 'active')
    return isTrain
      ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400 animate-pulse'
      : 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-400 animate-pulse';
  if (state === 'failed')
    return 'bg-rose-100 text-rose-600 dark:bg-rose-900/40 dark:text-rose-400';
  return 'bg-slate-100 text-slate-400 dark:bg-slate-800 dark:text-slate-500';
}

// ─── 组件 ────────────────────────────────────────────────────────────────────

function fmtTime(ts: number): string {
  const d = new Date(ts * 1000);
  const h = d.getHours().toString().padStart(2, '0');
  const m = d.getMinutes().toString().padStart(2, '0');
  return `${h}:${m}`;
}

function fmtDateTime(ts: number): string {
  const d = new Date(ts * 1000);
  const mo = d.getMonth() + 1;
  const da = d.getDate();
  const h = d.getHours().toString().padStart(2, '0');
  const mi = d.getMinutes().toString().padStart(2, '0');
  return `${mo}月${da}日 ${h}:${mi}`;
}

export default function TaskList({ jobs, backendBaseUrl, setJobs, onFetchJobs, outputDir, downloadDir, addInstantJobResult }: TaskListProps) {
  const activeJobs = jobs.filter(j => j.status === 'queued' || j.status === 'running');

  // ── 烟雾测试 ────────────────────────────────────────────────────────────────
  const [smokeRunning, setSmokeRunning] = useState(false);
  const [smokeLog, setSmokeLog] = useState<string[]>([]);
  const [smokeSummary, setSmokeSummary] = useState<Array<{ name: string; status: 'passed' | 'failed' | 'skipped' }>>([]);
  const smokeLogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = smokeLogRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [smokeLog]);

  async function runSmokeTests() {
    setSmokeRunning(true);
    setSmokeLog([]);
    setSmokeSummary([]);

    const log = (msg: string) => setSmokeLog(prev => [...prev, msg]);
    const results: Array<{ name: string; status: 'passed' | 'failed' | 'skipped' }> = [];

    async function postForm(url: string, fd: FormData): Promise<{ ok: true; data: any } | { ok: false; errMsg: string }> {
      const r = await fetch(url, { method: 'POST', body: fd });
      let body: any;
      try { body = await r.json(); } catch { body = null; }
      if (!r.ok) {
        const detail = body?.detail ?? body?.error ?? (body ? JSON.stringify(body) : '');
        return { ok: false, errMsg: `HTTP ${r.status}${detail ? ': ' + String(detail).slice(0, 120) : ''}` };
      }
      return { ok: true, data: body };
    }

    const testWav = createTestWav();
    let rvcVoiceId: string | null = null;
    try {
      const r = await fetch(`${backendBaseUrl}/voices`);
      if (r.ok) {
        const data = await r.json();
        const voices: Array<{ voice_id: string; engine?: string }> = Array.isArray(data) ? data : (data.voices ?? []);
        rvcVoiceId = voices.find(v => v.engine === 'rvc')?.voice_id ?? null;
      }
    } catch { /**/ }

    // 1. Fish Speech TTS
    try {
      const fd = new FormData();
      fd.append('text', '烟雾测试文本合成');
      fd.append('provider', 'fish_speech');

      const res = await postForm(`${backendBaseUrl}/tasks/tts`, fd);
      if (res.ok === false) { log(`✗ Fish Speech TTS 失败: ${res.errMsg}`); results.push({ name: 'Fish Speech TTS', status: 'failed' }); }
      else if (res.data?.job_id) { log(`✓ Fish Speech TTS 已排队 [${String(res.data.job_id).slice(0, 8)}]`); results.push({ name: 'Fish Speech TTS', status: 'passed' }); }
      else { log(`✗ Fish Speech TTS 响应异常: ${JSON.stringify(res.data)}`); results.push({ name: 'Fish Speech TTS', status: 'failed' }); }
    } catch (e: any) { log(`✗ Fish Speech TTS 异常: ${e.message}`); results.push({ name: 'Fish Speech TTS', status: 'failed' }); }

    // 2. Faster Whisper STT
    try {
      const fd = new FormData();
      fd.append('file', testWav, 'test.wav');
      fd.append('provider', 'faster_whisper');
      fd.append('model', 'base');

      const res = await postForm(`${backendBaseUrl}/tasks/stt`, fd);
      if (res.ok === false) {
        log(`✗ Faster Whisper STT 失败: ${res.errMsg}`); results.push({ name: 'Faster Whisper STT', status: 'failed' });
      } else if (res.data?.job_id) {
        log(`✓ Faster Whisper STT 已排队 [${String(res.data.job_id).slice(0, 8)}]`); results.push({ name: 'Faster Whisper STT', status: 'passed' });
      } else {
        const d = res.data ?? {};
        const status: 'completed' | 'failed' = (d.status === 'completed' || d.status === 'success') ? 'completed' : 'failed';
        addInstantJobResult('stt', 'STT', 'faster_whisper', true, { status, result_text: d.text ?? d.result_text, error: d.error });
        if (status === 'completed') { log(`✓ Faster Whisper STT 完成，识别文本: "${d.text ?? d.result_text ?? '(空)'}"`); results.push({ name: 'Faster Whisper STT', status: 'passed' }); }
        else { log(`✗ Faster Whisper STT 失败: ${d.error ?? d.detail ?? JSON.stringify(d)}`); results.push({ name: 'Faster Whisper STT', status: 'failed' }); }
      }
    } catch (e: any) { log(`✗ Faster Whisper STT 异常: ${e.message}`); results.push({ name: 'Faster Whisper STT', status: 'failed' }); }

    // 3. Seed-VC 换声（provider=seed_vc + reference_audio，无需专属模型）
    try {
      const fd = new FormData();
      fd.append('file', testWav, 'test.wav');
      fd.append('provider', 'seed_vc');
      fd.append('mode', 'local');
      fd.append('reference_audio', testWav, 'ref.wav');

      const res = await postForm(`${backendBaseUrl}/convert`, fd);
      if (res.ok === false) { log(`✗ Seed-VC 换声失败: ${res.errMsg}`); results.push({ name: 'Seed-VC 换声', status: 'failed' }); }
      else if (res.data?.job_id) { log(`✓ Seed-VC 换声已排队 [${String(res.data.job_id).slice(0, 8)}]`); results.push({ name: 'Seed-VC 换声', status: 'passed' }); }
      else { log(`✗ Seed-VC 换声响应异常: ${JSON.stringify(res.data)}`); results.push({ name: 'Seed-VC 换声', status: 'failed' }); }
    } catch (e: any) { log(`✗ Seed-VC 换声异常: ${e.message}`); results.push({ name: 'Seed-VC 换声', status: 'failed' }); }

    // 4. RVC 换声
    if (rvcVoiceId) {
      try {
        const fd = new FormData();
        fd.append('file', testWav, 'test.wav');
        fd.append('voice_id', rvcVoiceId);
        fd.append('mode', 'local');
  
        const res = await postForm(`${backendBaseUrl}/convert`, fd);
        if (res.ok === false) { log(`✗ RVC 换声失败: ${res.errMsg}`); results.push({ name: 'RVC 换声', status: 'failed' }); }
        else if (res.data?.job_id) { log(`✓ RVC 换声已排队 [${String(res.data.job_id).slice(0, 8)}]`); results.push({ name: 'RVC 换声', status: 'passed' }); }
        else { log(`✗ RVC 换声响应异常: ${JSON.stringify(res.data)}`); results.push({ name: 'RVC 换声', status: 'failed' }); }
      } catch (e: any) { log(`✗ RVC 换声异常: ${e.message}`); results.push({ name: 'RVC 换声', status: 'failed' }); }
    } else {
      log(`⚠ RVC 换声 — 未找到 rvc 引擎音色，跳过`);
      results.push({ name: 'RVC 换声', status: 'skipped' });
    }

    // 5. RVC 训练
    try {
      const wavBytes = new Uint8Array(await testWav.arrayBuffer() as ArrayBuffer);
      const zipBlob = new Blob([createTestZip('smoke_test.wav', wavBytes)], { type: 'application/zip' });
      const fd = new FormData();
      fd.append('dataset', zipBlob, 'smoke_dataset.zip');
      fd.append('voice_id', 'smoke_test_voice');
      fd.append('voice_name', '烟雾测试音色');
      fd.append('voice_subdir', 'user');
      fd.append('epochs', '1');
      const res = await postForm(`${backendBaseUrl}/train`, fd);
      if (res.ok === false) { log(`✗ RVC 训练失败: ${res.errMsg}`); results.push({ name: 'RVC 训练', status: 'failed' }); }
      else if (res.data?.job_id) { log(`✓ RVC 训练音色已排队 [${String(res.data.job_id).slice(0, 8)}]`); results.push({ name: 'RVC 训练音色', status: 'passed' }); }
      else { log(`✗ RVC 训练音色响应异常: ${JSON.stringify(res.data)}`); results.push({ name: 'RVC 训练音色', status: 'failed' }); }
    } catch (e: any) { log(`✗ RVC 训练音色异常: ${e.message}`); results.push({ name: 'RVC 训练音色', status: 'failed' }); }

    // 6. FaceFusion（合成图无人脸，任务预期失败，但验证接口/引擎可达）
    try {
      const imgBlob = createTestImage();
      const fd = new FormData();
      fd.append('source_image', imgBlob, 'source.jpg');
      fd.append('reference_image', imgBlob, 'reference.jpg');
      fd.append('provider', 'facefusion');

      const res = await postForm(`${backendBaseUrl}/tasks/image-i2i`, fd);
      if (res.ok === false) { log(`✗ FaceFusion 换脸接口失败: ${res.errMsg}`); results.push({ name: 'FaceFusion 换脸', status: 'failed' }); }
      else if (res.data?.job_id) { log(`✓ FaceFusion 换脸已排队 [${String(res.data.job_id).slice(0, 8)}]（⚠ 合成图无人脸，任务预期失败）`); results.push({ name: 'FaceFusion 换脸', status: 'passed' }); }
      else { log(`✗ FaceFusion 换脸响应异常: ${JSON.stringify(res.data)}`); results.push({ name: 'FaceFusion 换脸', status: 'failed' }); }
    } catch (e: any) { log(`✗ FaceFusion 换脸异常: ${e.message}`); results.push({ name: 'FaceFusion 换脸', status: 'failed' }); }

    // 7. FFmpeg 音频转换（同步直接返回）
    try {
      const fd = new FormData();
      fd.append('file', testWav, 'test.wav');
      fd.append('action', 'convert');
      fd.append('output_format', 'mp3');

      const res = await postForm(`${backendBaseUrl}/tasks/media-convert`, fd);
      if (res.ok === false) {
        log(`✗ FFmpeg 音视频转换失败: ${res.errMsg}`); results.push({ name: 'FFmpeg 音视频转换', status: 'failed' });
      } else if (res.data?.job_id) {
        log(`✓ FFmpeg 音视频转换已排队 [${String(res.data.job_id).slice(0, 8)}]`); results.push({ name: 'FFmpeg 音视频转换', status: 'passed' });
      } else if (res.data?.status === 'success' || res.data?.result_url) {
        addInstantJobResult('media_convert', 'FFmpeg 音视频转换', 'ffmpeg', true, { status: 'completed', result_url: res.data.result_url });
        log(`✓ FFmpeg 音视频转换完成 → ${res.data.result_url}`); results.push({ name: 'FFmpeg 音视频转换', status: 'passed' });
      } else {
        log(`✗ FFmpeg 音视频转换响应异常: ${JSON.stringify(res.data)}`); results.push({ name: 'FFmpeg 音视频转换', status: 'failed' });
      }
    } catch (e: any) { log(`✗ FFmpeg 音视频转换异常: ${e.message}`); results.push({ name: 'FFmpeg 音视频转换', status: 'failed' }); }

    const passed = results.filter(r => r.status === 'passed').length;
    const failed = results.filter(r => r.status === 'failed').length;
    const skipped = results.filter(r => r.status === 'skipped').length;
    log(`─── 全部测试已提交  ✓ ${passed} 通过  ✗ ${failed} 失败${skipped ? `  ⚠ ${skipped} 跳过` : ''}`);
    setSmokeSummary(results);
    onFetchJobs();
    setSmokeRunning(false);
  }
  const doneJobs = jobs.filter(j => j.status === 'completed' || j.status === 'failed');
  const now = Date.now() / 1000;

  function fmtElapsed(j: Job) {
    const base = j.status === 'completed' || j.status === 'failed'
      ? (j.completed_at || now) - (j.started_at || j.created_at)
      : now - (j.started_at || j.created_at);
    const s = Math.max(0, Math.round(base));
    return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m${s % 60}s`;
  }

  function StatusBadge({ job }: { job: Job }) {
    if (job.status === 'queued')
      return <span className="rounded-full bg-slate-100 dark:bg-slate-700 px-2.5 py-0.5 text-[11px] font-semibold text-slate-500 dark:text-slate-400">排队中</span>;
    if (job.status === 'running')
      return <span className="rounded-full bg-indigo-100 dark:bg-indigo-900/50 px-2.5 py-0.5 text-[11px] font-semibold text-indigo-600 dark:text-indigo-400 animate-pulse">处理中</span>;
    if (job.status === 'completed')
      return <span className="rounded-full bg-emerald-100 dark:bg-emerald-900/50 px-2.5 py-0.5 text-[11px] font-semibold text-emerald-600 dark:text-emerald-400">完成</span>;
    return <span className="rounded-full bg-rose-100 dark:bg-rose-900/50 px-2.5 py-0.5 text-[11px] font-semibold text-rose-600 dark:text-rose-400">失败</span>;
  }

  function TypeBadge({ job }: { job: Job }) {
    const color =
      job.type === 'tts'              ? 'bg-indigo-600' :
      job.type === 'vc'               ? 'bg-violet-600' :
      job.type === 'asr'              ? 'bg-sky-600'    :
      job.type === 'media'            ? 'bg-teal-600'   :
      job.type === 'doc'              ? 'bg-amber-700'  :
      job.type === 'toolbox'          ? 'bg-amber-700'  :
      job.type === 'train'            ? 'bg-amber-600'  :
      job.type === 'image_gen'        ? 'bg-purple-600' :
      job.type === 'image_understand' ? 'bg-fuchsia-600' :
      job.type === 'translate'        ? 'bg-emerald-600' : 'bg-slate-600';
    const abbr =
      job.type === 'tts'              ? 'TTS' :
      job.type === 'vc'               ? 'VC'  :
      job.type === 'asr'              ? 'STT' :
      job.type === 'media'            ? 'FMT' :
      job.type === 'doc'              ? 'DOC' :
      job.type === 'toolbox'          ? 'DOC' :
      job.type === 'train'            ? 'TRN' :
      job.type === 'image_gen'        ? 'IMG' :
      job.type === 'image_understand' ? 'VIS' :
      job.type === 'translate'        ? 'TRL' : job.type.toUpperCase().slice(0, 3);
    return <span className={`rounded-lg ${color} px-2 py-0.5 text-[10px] font-bold text-white uppercase tracking-wide`}>{abbr}</span>;
  }

  function StageRail({ job }: { job: Job }) {
    const info = getJobStages(job);
    if (!info) return null;
    const { stages, currentIdx, isTrain } = info;

    return (
      <div className="pt-1.5 space-y-1.5">
        {/* 进度条 */}
        {(job.status === 'running' || job.status === 'queued') && (
          isTrain && typeof job.progress === 'number' ? (
            <div className="space-y-1">
              {job.step_msg && (
                <p className="text-[11px] text-slate-400 truncate">{job.step_msg}</p>
              )}
              <div className="flex items-center gap-2">
                <div className="flex-1 bg-slate-100 dark:bg-slate-700 rounded-full h-1.5 overflow-hidden">
                  <div className="bg-amber-500 h-full rounded-full transition-all duration-500"
                    style={{ width: `${job.progress}%` }} />
                </div>
                <span className="text-[11px] tabular-nums font-mono text-slate-400 shrink-0">{job.progress}%</span>
              </div>
            </div>
          ) : (
            <div className="bg-slate-100 dark:bg-slate-700 rounded-full h-1 overflow-hidden">
              <div className="h-full w-2/5 bg-indigo-400 dark:bg-indigo-500 rounded-full"
                style={{ animation: 'progress-indeterminate 1.5s ease-in-out infinite' }} />
            </div>
          )
        )}

        {/* 阶段 pills */}
        <div className="flex items-center gap-1 flex-wrap">
          {stages.map((stage, i) => {
            let state: StageState;
            if (i < currentIdx) state = 'done';
            else if (i === currentIdx) state = job.status === 'failed' ? 'failed' : 'active';
            else state = 'pending';

            return (
              <div key={stage} className="flex items-center gap-1">
                <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium whitespace-nowrap transition-colors ${getStagePillCls(state, isTrain)}`}>
                  {stage}
                </span>
                {i < stages.length - 1 && (
                  <svg className="w-2.5 h-2.5 text-slate-300 dark:text-slate-600 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                )}
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  function JobRow({ job }: { job: Job }) {
    return (
      <div className="flex items-start gap-3 px-5 py-3.5 border-b border-slate-100 dark:border-slate-800 last:border-0 hover:bg-slate-50 dark:hover:bg-slate-800/40 transition-colors">
        <div className="mt-0.5"><TypeBadge job={job} /></div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-medium text-slate-800 dark:text-slate-200 truncate max-w-[280px]">{job.label}</span>
            <StatusBadge job={job} />
          </div>
          <div className="flex items-center gap-3 text-xs text-slate-400 mt-0.5">
            <span>{PROVIDER_LABELS[job.provider] || job.provider}</span>
            {(job.status === 'running' || job.status === 'completed' || job.status === 'failed') && (
              <span className="tabular-nums font-mono">{fmtElapsed(job)}</span>
            )}
          </div>

          {/* 进度条 + 阶段 */}
          <StageRail job={job} />

          {/* 结果 / 错误 */}
          {job.status === 'completed' && job.result_url && (() => {
            const ext = job.result_url.split('.').pop()?.toLowerCase() ?? '';
            const isAudio = ['mp3', 'wav', 'flac', 'm4a', 'aac', 'ogg', 'opus'].includes(ext);
            const isVideo = ['mp4', 'webm', 'mov', 'mkv'].includes(ext);
            const isImage = ['png', 'jpg', 'jpeg', 'webp', 'bmp', 'gif'].includes(ext);
            return (
              <div className="pt-2 space-y-1.5">
                {isAudio && <audio controls src={job.result_url} className="w-full h-8" />}
                {isVideo && <video controls src={job.result_url} className="w-full rounded-lg max-h-48" />}
                {isImage && <img src={job.result_url} alt="result" className="max-w-full rounded-lg max-h-48 object-contain" />}
                <div className="flex items-center gap-2 flex-wrap">
                  <a href={job.result_url} target="_blank" rel="noreferrer"
                    className="text-[11px] text-indigo-500 hover:text-indigo-700 underline break-all">{job.result_url}</a>
                  {outputDir && window.electronAPI?.openDir && (
                    <button
                      onClick={() => window.electronAPI!.openDir!(outputDir)}
                      className="shrink-0 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 px-2 py-0.5 text-[11px] text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 transition-colors whitespace-nowrap">
                      打开目录
                    </button>
                  )}
                </div>
              </div>
            );
          })()}
          {job.status === 'completed' && job.result_text && (
            <pre className="whitespace-pre-wrap text-xs text-slate-700 dark:text-slate-300 bg-slate-50 dark:bg-slate-800 rounded-lg px-3 py-2 leading-relaxed mt-1.5">{job.result_text}</pre>
          )}
          {job.status === 'failed' && job.error && (
            <p className="text-xs text-rose-500 break-all pt-1">{job.error}</p>
          )}
        </div>
        <div className="shrink-0 flex flex-col items-end gap-1.5">
          <span className="text-[10px] tabular-nums text-slate-400 dark:text-slate-500 whitespace-nowrap">
            {fmtDateTime(job.created_at)}
          </span>
          {(job.status === 'queued' || job.status === 'running') ? (
            <button
              className="rounded-lg border border-orange-200 dark:border-orange-800 bg-orange-50 dark:bg-orange-900/30 hover:bg-orange-100 dark:hover:bg-orange-800/50 px-2.5 py-1 text-xs text-orange-500 dark:text-orange-400 hover:text-orange-700 dark:hover:text-orange-300 transition-colors"
              onClick={async () => {
                await fetch(`${backendBaseUrl}/jobs/${job.id}`, { method: 'DELETE' }).catch(() => {});
                setJobs(prev => prev.filter(j => j.id !== job.id));
              }}>
              中断
            </button>
          ) : (
            <button
              className="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 px-2.5 py-1 text-xs text-slate-400 hover:text-rose-500 transition-colors"
              onClick={async () => {
                await fetch(`${backendBaseUrl}/jobs/${job.id}`, { method: 'DELETE' }).catch(() => {});
                setJobs(prev => prev.filter(j => j.id !== job.id));
              }}>
              删除
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <header className="flex items-center gap-3.5 pb-1">
        <TasksIcon size={36} badge={activeJobs.length} />
        <div className="flex-1">
          <h1 className="text-xl font-bold tracking-tight text-slate-900 dark:text-slate-100">任务列表</h1>
          <p className="text-xs text-slate-400 font-medium mt-0.5">TTS · VC · STT · 图像生成 · 图像处理 · 视频生成 · OCR · 口型同步 · 文档转换 · 媒体转换</p>
        </div>
        <button className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 hover:bg-slate-50 px-3 py-1.5 text-xs font-medium text-slate-500 transition-colors" onClick={onFetchJobs}>刷新</button>
        {doneJobs.length > 0 && (
          <button className="rounded-xl border border-rose-200 dark:border-rose-900 bg-white dark:bg-slate-900 hover:bg-rose-50 px-3 py-1.5 text-xs font-medium text-rose-500 transition-colors"
            onClick={async () => {
              await fetch(`${backendBaseUrl}/jobs?status=done`, { method: 'DELETE' }).catch(() => {});
              setJobs(prev => prev.filter(j => j.status === 'queued' || j.status === 'running'));
            }}>清空已完成</button>
        )}
      </header>

      {jobs.length === 0 ? (
        <div className="rounded-2xl border border-slate-200/80 bg-white dark:bg-slate-900 dark:border-slate-700/80 p-12 text-center text-sm text-slate-400">
          暂无任务
        </div>
      ) : (
        <>
          {activeJobs.length > 0 && (
            <section className="rounded-2xl border border-indigo-200/80 dark:border-indigo-800/60 bg-white dark:bg-slate-900 shadow-panel overflow-hidden">
              <div className="px-5 py-3 border-b border-indigo-100 dark:border-indigo-900/60 flex items-center gap-2">
                <svg className="w-3.5 h-3.5 text-indigo-500 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
                </svg>
                <span className="text-xs font-semibold text-indigo-600 dark:text-indigo-400">进行中（{activeJobs.length}）</span>
              </div>
              {activeJobs.map(j => <JobRow key={j.id} job={j} />)}
            </section>
          )}
          {doneJobs.length > 0 && (
            <section className="rounded-2xl border border-slate-200/80 bg-white dark:bg-slate-900 dark:border-slate-700/80 shadow-panel overflow-hidden">
              <div className="px-5 py-3 border-b border-slate-100 dark:border-slate-800">
                <span className="text-xs font-semibold text-slate-400">历史记录（{doneJobs.length}）</span>
              </div>
              {doneJobs.map(j => <JobRow key={j.id} job={j} />)}
            </section>
          )}
        </>
      )}
      {/* 烟雾测试 */}
      <section className="rounded-2xl border border-slate-200/80 bg-white dark:bg-slate-900 dark:border-slate-700/80 shadow-panel overflow-hidden">
        <div className="px-5 py-3 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs font-semibold text-slate-500 dark:text-slate-400">烟雾测试</span>
              {downloadDir && (typeof window !== 'undefined') && (window as any).electronAPI?.openDir && (
                <button
                  onClick={() => (window as any).electronAPI.openDir(downloadDir)}
                  className="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 px-2 py-0.5 text-[11px] text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 transition-colors"
                  title={downloadDir}
                >
                  打开音频缓存目录
                </button>
              )}
            </div>
            <p className="text-[11px] text-slate-400 dark:text-slate-500 mt-0.5">自动提交 7 项任务验证本地引擎（TTS · STT · Seed-VC · RVC · 训练 · FaceFusion · FFmpeg）</p>
          </div>
          <button
            className="rounded-lg px-3 py-1.5 text-xs font-medium text-white flex items-center gap-1.5 transition-all hover:opacity-90 disabled:opacity-50 shrink-0"
            style={{ backgroundColor: SPRING_GREEN }}
            disabled={smokeRunning || !backendBaseUrl}
            onClick={runSmokeTests}
          >
            {smokeRunning ? <><Spinner />运行中…</> : '运行烟雾测试'}
          </button>
        </div>
        {smokeLog.length > 0 && (
          <div
            ref={smokeLogRef}
            className="px-5 py-3 bg-slate-950 text-green-400 text-xs font-mono leading-relaxed overflow-y-auto whitespace-pre-wrap"
            style={{ maxHeight: '10rem' }}
          >
            {smokeLog.join('\n')}
          </div>
        )}
        {smokeSummary.length > 0 && (
          <div className="px-5 py-3 border-t border-slate-100 dark:border-slate-800">
            <p className="text-[11px] font-semibold text-slate-400 dark:text-slate-500 mb-2">测试结果汇总</p>
            <div className="grid grid-cols-2 gap-x-4 gap-y-1">
              {smokeSummary.map(r => (
                <div key={r.name} className="flex items-center gap-1.5 text-xs">
                  {r.status === 'passed'  && <span className="text-emerald-500 font-bold shrink-0">✓</span>}
                  {r.status === 'failed'  && <span className="text-rose-500 font-bold shrink-0">✗</span>}
                  {r.status === 'skipped' && <span className="text-amber-500 font-bold shrink-0">⚠</span>}
                  <span className={
                    r.status === 'passed'  ? 'text-emerald-700 dark:text-emerald-400' :
                    r.status === 'failed'  ? 'text-rose-600 dark:text-rose-400' :
                    'text-amber-600 dark:text-amber-400'
                  }>{r.name}</span>
                  {r.status === 'skipped' && <span className="text-slate-400 text-[10px]">跳过</span>}
                </div>
              ))}
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
