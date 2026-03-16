import { useState, useCallback } from 'react';
import { AgentStep } from '../types';

export function useAgent(backendUrl: string) {
  const [agentSteps, setAgentSteps] = useState<AgentStep[]>([]);
  const [running, setRunning] = useState(false);
  const [availableTools, setAvailableTools] = useState<{ name: string; desc: string }[]>([]);

  const fetchTools = useCallback(async () => {
    const res = await fetch(`${backendUrl}/agent/tools`);
    if (res.ok) setAvailableTools(await res.json());
  }, [backendUrl]);

  const runAgent = useCallback(async (
    task: string,
    tools: string[],
    provider: string,
    model: string,
    apiKey: string,
  ) => {
    setAgentSteps([]);
    setRunning(true);
    try {
      const res = await fetch(`${backendUrl}/agent/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ task, tools, provider, model, api_key: apiKey }),
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
          if (line.startsWith('data: ')) {
            try {
              const step = JSON.parse(line.slice(6));
              setAgentSteps(prev => [...prev, step]);
            } catch { /* ignore parse errors */ }
          }
        }
      }
    } finally {
      setRunning(false);
    }
  }, [backendUrl]);

  return { agentSteps, running, availableTools, fetchTools, runAgent };
}
