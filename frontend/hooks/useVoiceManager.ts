import { useState } from 'react';
import type { VoiceInfo, Job } from '../types';

interface UseVoiceManagerParams {
  backendBaseUrl: string;
  voices: VoiceInfo[];
  fetchVoices: () => Promise<void>;
  setSelectedVoiceId: (id: string) => void;
  setError: (msg: string) => void;
  setSuccessMsg: (msg: string) => void;
  setJobs: React.Dispatch<React.SetStateAction<Job[]>>;
}

export function useVoiceManager({
  backendBaseUrl,
  voices,
  fetchVoices,
  setSelectedVoiceId,
  setError,
  setSuccessMsg,
  setJobs,
}: UseVoiceManagerParams) {
  // ─── 新建音色扩展状态 ─────────────────────────────────────────────────────
  const [showCreateVoice, setShowCreateVoice] = useState(false);
  const [newVoiceName, setNewVoiceName] = useState('');
  const [newVoiceEngine, setNewVoiceEngine] = useState('rvc');
  const [newVoiceModel, setNewVoiceModel] = useState<File | null>(null);
  const [newVoiceIndex, setNewVoiceIndex] = useState<File | null>(null);
  const [newVoiceRef, setNewVoiceRef] = useState<File | null>(null);
  const [newVoiceGptModel, setNewVoiceGptModel] = useState<File | null>(null);
  const [newVoiceSovitsModel, setNewVoiceSovitsModel] = useState<File | null>(null);
  const [newVoiceRefText, setNewVoiceRefText] = useState('');
  const [creatingVoice, setCreatingVoice] = useState(false);

  // ─── 训练状态 ─────────────────────────────────────────────────────────────
  const [trainVoiceName, setTrainVoiceName] = useState('');
  const [trainFiles, setTrainFiles] = useState<File[]>([]);
  const [trainEpochs, setTrainEpochs] = useState(0);
  const [trainF0Method, setTrainF0Method] = useState('harvest');
  const [trainSampleRate, setTrainSampleRate] = useState(40000);

  // ─── 新建音色 ─────────────────────────────────────────────────────────────
  async function createVoice() {
    const trimmedName = newVoiceName.trim();
    if (!trimmedName) { setError('请填写音色名称'); return; }
    const duplicate = voices.some(v => v.name.toLowerCase() === trimmedName.toLowerCase());
    if (duplicate) { setError(`音色名称「${trimmedName}」已存在，请使用其他名称`); return; }
    setCreatingVoice(true); setError(''); setSuccessMsg('');
    try {
      const fd = new FormData();
      fd.append('voice_name', newVoiceName.trim());
      fd.append('engine', newVoiceEngine);
      if (newVoiceModel) fd.append('model_file', newVoiceModel);
      if (newVoiceIndex) fd.append('index_file', newVoiceIndex);
      if (newVoiceRef) fd.append('reference_audio', newVoiceRef);
      if (newVoiceGptModel) fd.append('gpt_model_file', newVoiceGptModel);
      if (newVoiceSovitsModel) fd.append('sovits_model_file', newVoiceSovitsModel);
      if (newVoiceRefText.trim()) fd.append('ref_text', newVoiceRefText.trim());
      const res = await fetch(`${backendBaseUrl}/voices/create`, { method: 'POST', body: fd });
      let data: any = null;
      try { data = await res.json(); } catch { /**/ }
      if (!res.ok) throw new Error(`创建失败（${res.status}）${data?.detail ? `：${data.detail}` : ''}`);
      setSuccessMsg(`音色已创建：${data.voice_name}（ID: ${data.voice_id}）`);
      setShowCreateVoice(false);
      setNewVoiceName(''); setNewVoiceModel(null); setNewVoiceIndex(null); setNewVoiceRef(null);
      setNewVoiceGptModel(null); setNewVoiceSovitsModel(null); setNewVoiceRefText('');
      await fetchVoices();
      setSelectedVoiceId(data.voice_id);
    } catch (e) {
      setError(e instanceof Error ? e.message : '创建音色失败');
    } finally {
      setCreatingVoice(false);
    }
  }

  // ─── 重命名音色 ───────────────────────────────────────────────────────────
  async function renameVoice(voiceId: string, newName: string) {
    try {
      const fd = new FormData();
      fd.append('voice_name', newName);
      const res = await fetch(`${backendBaseUrl}/voices/${voiceId}`, { method: 'PATCH', body: fd });
      if (!res.ok) {
        let data: any = null;
        try { data = await res.json(); } catch { /**/ }
        throw new Error(`重命名失败（${res.status}）${data?.detail ? `：${data.detail}` : ''}`);
      }
      await fetchVoices();
    } catch (e) {
      setError(e instanceof Error ? e.message : '重命名音色失败');
    }
  }

  // ─── 删除音色 ─────────────────────────────────────────────────────────────
  async function deleteVoice(voiceId: string) {
    const voice = voices.find(v => v.voice_id === voiceId);
    const name = voice?.name || voiceId;
    if (!window.confirm(`确定要删除音色「${name}」吗？此操作不可撤销。`)) return;
    try {
      const res = await fetch(`${backendBaseUrl}/voices/${voiceId}`, { method: 'DELETE' });
      if (!res.ok) {
        let data: any = null;
        try { data = await res.json(); } catch { /**/ }
        throw new Error(`删除失败（${res.status}）${data?.detail ? `：${data.detail}` : ''}`);
      }
      await fetchVoices();
    } catch (e) {
      setError(e instanceof Error ? e.message : '删除音色失败');
    }
  }

  // ─── 训练 ─────────────────────────────────────────────────────────────────
  async function startTraining() {
    const trimmedName = trainVoiceName.trim();
    if (!trainFiles || trainFiles.length === 0) { setError('请先选择训练数据集'); return; }
    if (!trimmedName) { setError('请输入音色名称'); return; }
    const duplicate = voices.some(v => v.name.toLowerCase() === trimmedName.toLowerCase());
    if (duplicate) { setError(`音色名称「${trimmedName}」已存在，请使用其他名称`); return; }
    setError(''); setSuccessMsg('');
    const normalized = trimmedName.toLowerCase().replace(/[^a-z0-9_-]+/g, '_').replace(/^_+|_+$/g, '');
    const autoVoiceId = `${normalized || 'voice'}_${Date.now().toString().slice(-6)}`;
    const fd = new FormData();
    const isZipOnly = trainFiles.length === 1 && trainFiles[0].name.toLowerCase().endsWith('.zip');
    if (isZipOnly) {
      fd.append('dataset', trainFiles[0]);
    } else {
      const { packFilesToZip } = await import('../utils');
      const zipBlob = await packFilesToZip(trainFiles);
      fd.append('dataset', zipBlob, 'dataset.zip');
    }
    fd.append('voice_id', autoVoiceId);
    fd.append('voice_name', trimmedName);
    fd.append('epochs', String(trainEpochs));
    fd.append('f0_method', trainF0Method);
    fd.append('sample_rate', String(trainSampleRate));
    try {
      const res = await fetch(`${backendBaseUrl}/train`, { method: 'POST', body: fd });
      let data: any = null;
      try { data = await res.json(); } catch { /**/ }
      if (!res.ok) throw new Error(`训练失败（${res.status}）${data?.detail ? `：${data.detail}` : ''}`);
      const pending: Job = {
        id: data.job_id,
        type: 'train',
        label: `训练 · ${trimmedName}`,
        provider: 'local_rvc',
        is_local: true,
        status: 'queued',
        created_at: Date.now() / 1000,
        started_at: null,
        completed_at: null,
        result_url: null,
        result_text: null,
        error: null,
      };
      setJobs(prev => [pending, ...prev]);
    } catch (e) {
      setError(e instanceof Error ? e.message : '训练失败');
    }
  }

  return {
    showCreateVoice, setShowCreateVoice,
    newVoiceName, setNewVoiceName,
    newVoiceEngine, setNewVoiceEngine,
    newVoiceModel, setNewVoiceModel,
    newVoiceIndex, setNewVoiceIndex,
    newVoiceRef, setNewVoiceRef,
    newVoiceGptModel, setNewVoiceGptModel,
    newVoiceSovitsModel, setNewVoiceSovitsModel,
    newVoiceRefText, setNewVoiceRefText,
    creatingVoice,
    trainVoiceName, setTrainVoiceName,
    trainFiles, setTrainFiles,
    trainEpochs, setTrainEpochs,
    trainF0Method, setTrainF0Method,
    trainSampleRate, setTrainSampleRate,
    createVoice, renameVoice, deleteVoice, startTraining,
  };
}
