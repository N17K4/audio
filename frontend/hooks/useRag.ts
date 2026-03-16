import { useState, useCallback } from 'react';
import { RagCollection } from '../types';

export function useRag(backendUrl: string) {
  const [collections, setCollections] = useState<RagCollection[]>([]);
  const [ragAnswer, setRagAnswer] = useState('');
  const [loading, setLoading] = useState(false);

  const fetchCollections = useCallback(async () => {
    const res = await fetch(`${backendUrl}/rag/collections`);
    if (res.ok) setCollections(await res.json());
  }, [backendUrl]);

  const buildCollection = useCallback(async (name: string, files: File[]) => {
    const form = new FormData();
    form.append('name', name);
    files.forEach(f => form.append('files', f));
    const res = await fetch(`${backendUrl}/rag/collections`, { method: 'POST', body: form });
    return await res.json();
  }, [backendUrl]);

  const deleteCollection = useCallback(async (name: string) => {
    await fetch(`${backendUrl}/rag/collections/${encodeURIComponent(name)}`, { method: 'DELETE' });
    await fetchCollections();
  }, [backendUrl, fetchCollections]);

  const queryRag = useCallback(async (collection: string, question: string) => {
    setRagAnswer('');
    setLoading(true);
    try {
      const res = await fetch(`${backendUrl}/rag/query`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ collection, question }),
      });
      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let buf = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split('\n\n');
        buf = lines.pop() || '';
        for (const line of lines) {
          if (line.startsWith('data: ')) setRagAnswer(prev => prev + line.slice(6));
        }
      }
    } finally {
      setLoading(false);
    }
  }, [backendUrl]);

  return { collections, ragAnswer, loading, fetchCollections, buildCollection, deleteCollection, queryRag };
}
