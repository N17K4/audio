import { useState, useEffect } from 'react';
import type { CapabilityMap, VoiceInfo } from '../types';
import { DEFAULT_CAPS } from '../constants';
import { waitForBackend, rlog } from '../utils';

export function useBackend() {
  const [backendBaseUrl, setBackendBaseUrl] = useState('');
  const [backendReady, setBackendReady] = useState(false);
  const [capabilities, setCapabilities] = useState<CapabilityMap>(DEFAULT_CAPS);
  const [voices, setVoices] = useState<VoiceInfo[]>([]);
  const [engineVersions, setEngineVersions] = useState<Record<string, { version: string; ready: boolean }>>({});
  const [error, setError] = useState('');
  const [downloadDir, setDownloadDir] = useState('');
  const [selectedVoiceId, setSelectedVoiceId] = useState('');
  const [vchatVoiceId, setVchatVoiceId] = useState('');
  const [isDocker, setIsDocker] = useState(false);

  useEffect(() => {
    // 优先级：URL 参数（Electron 注入）→ 同源探测（Docker nginx）→ 直连 127.0.0.1:8000
    if (typeof window === 'undefined') { setBackendBaseUrl('http://127.0.0.1:8000'); return; }
    const params = new URLSearchParams(window.location.search);
    const fromParam = params.get('backendUrl');
    if (fromParam) {
      setBackendBaseUrl(fromParam);
      rlog('INFO', '后端地址(参数):', fromParam);
      return;
    }
    const origin = window.location.origin;
    fetch(`${origin}/health`).then(r => {
      if (r.ok) { setBackendBaseUrl(origin); setIsDocker(true); rlog('INFO', '后端地址(同源):', origin); }
      else setBackendBaseUrl('http://127.0.0.1:8000');
    }).catch(() => setBackendBaseUrl('http://127.0.0.1:8000'));
  }, []);

  useEffect(() => {
    if (!backendBaseUrl) return;
    let cancelled = false;
    (async () => {
      const ok = await waitForBackend(backendBaseUrl);
      if (cancelled) return;
      setBackendReady(ok);
      if (!ok) { setError(`后端无法访问：${backendBaseUrl}`); return; }
      setError('');
      await Promise.all([fetchCapabilities(backendBaseUrl), fetchVoices(backendBaseUrl), fetchEngineVersions(backendBaseUrl), fetchHealth(backendBaseUrl)]);
    })();
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [backendBaseUrl]);

  async function fetchHealth(baseUrl: string) {
    try {
      const r = await fetch(`${baseUrl}/health`);
      if (!r.ok) return;
      const d = await r.json();
      if (d?.download_dir) setDownloadDir(d.download_dir);
    } catch { /**/ }
  }

  async function fetchEngineVersions(baseUrl: string) {
    try {
      const r = await fetch(`${baseUrl}/runtime/info`);
      if (!r.ok) return;
      const d = await r.json();
      const versions: Record<string, { version: string; ready: boolean }> = {};
      for (const [k, v] of Object.entries(d.engines || {})) {
        const e = v as any;
        versions[k] = { version: e.version || 'unknown', ready: e.ready ?? false };
      }
      setEngineVersions(versions);
    } catch { /**/ }
  }

  async function fetchCapabilities(baseUrl: string) {
    try {
      const r = await fetch(`${baseUrl}/capabilities`);
      if (!r.ok) return;
      const d = await r.json();
      if (d?.tasks) setCapabilities(d.tasks);
    } catch { /**/ }
  }

  async function fetchVoices(baseUrl?: string) {
    const url = baseUrl || backendBaseUrl;
    try {
      const r = await fetch(`${url}/voices`);
      if (!r.ok) throw new Error(`加载音色失败（${r.status}）`);
      const d = await r.json();
      const list: VoiceInfo[] = d.voices || [];
      setVoices(list);
      if (list.length > 0) {
        setSelectedVoiceId(v => v || list[0].voice_id);
        setVchatVoiceId(v => v || list[0].voice_id);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : '获取音色列表失败');
    }
  }

  return {
    backendBaseUrl,
    backendReady,
    isDocker,
    capabilities,
    voices,
    engineVersions,
    downloadDir,
    error,
    setError,
    selectedVoiceId,
    setSelectedVoiceId,
    vchatVoiceId,
    setVchatVoiceId,
    fetchVoices: () => fetchVoices(),
    fetchCapabilities: () => fetchCapabilities(backendBaseUrl),
    fetchEngineVersions: () => fetchEngineVersions(backendBaseUrl),
  };
}
