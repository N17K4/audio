import { useState, useRef, useCallback } from 'react';
import type { Status } from '../types';

interface UseAudioRecorderParams {
  setStatus: (s: Status) => void;
  setError: (e: string) => void;
}

export function useAudioRecorder({ setStatus, setError }: UseAudioRecorderParams) {
  const [recordedFile, setRecordedFile] = useState<File | null>(null);
  const [recordedObjectUrl, setRecordedObjectUrl] = useState<string | null>(null);
  const [recordingDir, setRecordingDir] = useState<string | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  const startRecording = useCallback(async () => {
    setError('');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      chunksRef.current = [];
      const recorder = new MediaRecorder(stream);
      recorder.ondataavailable = e => { if (e.data.size > 0) chunksRef.current.push(e.data); };
      recorder.onstop = () => {
        stream.getTracks().forEach(t => t.stop());
        const blob = new Blob(chunksRef.current, { type: 'audio/webm' });
        setRecordedObjectUrl(prev => { if (prev) URL.revokeObjectURL(prev); return URL.createObjectURL(blob); });
        setRecordedFile(new File([blob], 'recording.webm', { type: 'audio/webm' }));
        setRecordingDir('recording');
        setStatus('idle');
      };
      recorder.start();
      recorderRef.current = recorder;
      setStatus('recording');
    } catch (e) {
      setError(e instanceof Error ? e.message : '启动录音失败');
      setStatus('idle');
    }
  }, [setError, setStatus]);

  const stopRecording = useCallback(() => {
    recorderRef.current?.stop();
  }, []);

  const clearRecording = useCallback(() => {
    if (recordedObjectUrl) URL.revokeObjectURL(recordedObjectUrl);
    setRecordedFile(null);
    setRecordedObjectUrl(null);
    setRecordingDir(null);
  }, [recordedObjectUrl]);

  return {
    recordedFile,
    recordedObjectUrl,
    recordingDir,
    startRecording,
    stopRecording,
    clearRecording,
    /** Allow parent hooks to set file directly (e.g. from useTTS ref audio) */
    setRecordedFile,
  };
}
