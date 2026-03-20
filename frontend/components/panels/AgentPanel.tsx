/**
 * AgentPanel — 智能体（Agent）页面
 *
 * ReAct（Reasoning + Acting）模式：
 *   思考（Thought）→ 选工具行動（Action）→ 看结果（Observation）→ 再思考 …
 */

import { useState } from 'react';
import { AgentStep, CapabilityMap } from '../../types';
import HowToSteps from '../shared/HowToSteps';
import LlmConfigBar from '../shared/LlmConfigBar';
import ProcessFlow, { FlowStep } from '../shared/ProcessFlow';
import LoadingDots from '../shared/LoadingDots';
import { fieldCls, labelCls } from '../../constants/styles';

const AGENT_FLOW: FlowStep[] = [
  { label: '任务描述',  tech: 'Prompt' },
  { label: 'LLM 思考',  tech: 'Thought' },
  { label: '选工具',    tech: 'Action' },
  { label: '执行工具',  tech: 'Tool Call' },
  { label: '观察结果',  tech: 'Observation' },
  { label: '循环',      tech: '≤10 轮', note: '直到有答案' },
  { label: '最终答案',  tech: 'Final Answer' },
];

const AGENT_STEPS = [
  { title: '选择模型', desc: '本地选 Ollama（需先运行 ollama serve），云端选 OpenAI 并填入 API Key' },
  { title: '勾选工具', desc: '按需勾选工具：调研任务选「网络搜索」，数据处理选「Python 执行」' },
  { title: '描述任务', desc: '用自然语言写清楚要做什么，点击「开始执行」，右侧实时展示推理过程' },
];

const TOOL_LABELS: Record<string, string> = {
  web_search:    '网络搜索',
  python_exec:   'Python 执行',
  file_read:     '读取文件',
  file_write:    '写入文件',
  rag_retrieval: 'RAG 检索',
};

const TOOL_TIPS: Record<string, string> = {
  web_search:    '使用 DuckDuckGo 搜索互联网，返回前 5 条结果（标题 + 摘要 + 链接）',
  python_exec:   '让 AI 写 Python 代码并在本机运行，限时 10 秒，适合计算、文本处理',
  file_read:     '读取 user_data/agent/ 目录下的文件',
  file_write:    '把内容写入 user_data/agent/ 目录，可供后续步骤读取',
  rag_retrieval: '从已建好的知识库中语义检索，需先在「知识库」页面上传文档建库',
};

const STEP_BG: Record<string, string> = {
  thought:     'bg-sky-50 border-sky-200 dark:bg-sky-900/20 dark:border-sky-800/50',
  action:      'bg-amber-50 border-amber-200 dark:bg-amber-900/20 dark:border-amber-800/50',
  observation: 'bg-emerald-50 border-emerald-200 dark:bg-emerald-900/20 dark:border-emerald-800/50',
  final:       'bg-indigo-50 border-indigo-200 dark:bg-indigo-900/20 dark:border-indigo-800/50',
  error:       'bg-red-50 border-red-200 dark:bg-red-900/20 dark:border-red-800/50',
};

const STEP_LABELS: Record<string, string> = {
  thought:     '思考',
  action:      '行动',
  observation: '观察',
  final:       '最终答案',
  error:       '错误',
};

interface Props {
  backendUrl: string;
  capabilities: CapabilityMap;
  selectedProvider: string;
  apiKey: string;
  cloudEndpoint: string;
  setProviderMap: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  setApiKey: (v: string) => void;
  setCloudEndpoint: (v: string) => void;
}

export default function AgentPanel({
  backendUrl, capabilities, selectedProvider, apiKey, cloudEndpoint,
  setProviderMap, setApiKey, setCloudEndpoint,
}: Props) {
  const [llmModel, setLlmModel] = useState('qwen2.5:0.5b');
  const [selectedTools, setSelectedTools] = useState<string[]>(['web_search']);
  const [task, setTask] = useState('');
  const [steps, setSteps] = useState<AgentStep[]>([]);
  const [running, setRunning] = useState(false);

  const toggleTool = (name: string) => {
    setSelectedTools(prev => prev.includes(name) ? prev.filter(t => t !== name) : [...prev, name]);
  };

  const runAgent = async () => {
    const taskToRun = task.trim() || '计算 10 + 5 的结果';
    if (selectedTools.length === 0 || !llmModel) return;
    setSteps([]);
    setRunning(true);
    try {
      const res = await fetch(`${backendUrl}/agent/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          task: taskToRun, tools: selectedTools, provider: selectedProvider,
          model: llmModel, api_key: apiKey,
          ollama_url: selectedProvider === 'ollama' ? (cloudEndpoint || 'http://127.0.0.1:11434') : 'http://127.0.0.1:11434',
        }),
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
          if (!line.startsWith('data: ')) continue;
          try {
            const step: AgentStep = JSON.parse(line.slice(6));
            setSteps(prev => [...prev, step]);
          } catch { /* skip */ }
        }
      }
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="flex flex-col gap-6 p-6 h-full">
      <ProcessFlow steps={AGENT_FLOW} color="#7c3aed" />

      <div className="flex flex-col gap-6 flex-1 min-h-0">
        <LlmConfigBar
          task="agent"
          capabilities={capabilities}
          selectedProvider={selectedProvider}
          llmModel={llmModel}
          apiKey={apiKey}
          cloudEndpoint={cloudEndpoint}
          onProviderChange={v => setProviderMap(prev => ({ ...prev, agent: v }))}
          onModelChange={setLlmModel}
          onApiKeyChange={setApiKey}
          onCloudEndpointChange={setCloudEndpoint}
        />

        <div className="flex flex-col gap-4 overflow-y-auto">
          <h3 className="text-base font-bold text-slate-800 dark:text-slate-100">
            智能体
            <span className="text-[11px] font-normal text-slate-400 ml-2">Agent</span>
          </h3>

          {/* 工具选择 */}
          <div className="flex flex-col gap-2">
            <span className={labelCls}>赋予智能体的工具（至少选一个）</span>
            <div className="grid grid-cols-2 gap-3 p-2.5 rounded-lg bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700">
              {Object.entries(TOOL_LABELS).map(([key, label]) => (
                <div key={key} className="flex flex-col gap-1">
                  <button
                    onClick={() => toggleTool(key)}
                    className={`px-3 py-2.5 rounded-lg text-sm font-medium transition-all text-center ${
                      selectedTools.includes(key)
                        ? 'border-2 border-indigo-500 bg-indigo-50 text-indigo-700 dark:bg-indigo-900/30 dark:border-indigo-400 dark:text-indigo-300'
                        : 'border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800 hover:border-slate-300 dark:hover:border-slate-500'
                    }`}>
                    {label}
                  </button>
                  <p className="text-[11px] text-slate-400 dark:text-slate-500 leading-snug line-clamp-2">
                    {TOOL_TIPS[key]}
                  </p>
                </div>
              ))}
            </div>
          </div>

          {/* 任务描述 */}
          <div className="flex flex-col gap-1.5">
            <label className={labelCls}>
              任务描述
              <span className="text-[11px] text-slate-400 font-normal normal-case tracking-normal ml-1.5">留空则使用 placeholder 默认任务</span>
            </label>
            <textarea
              rows={5}
              value={task}
              onChange={e => setTask(e.target.value)}
              placeholder="计算 10 + 5 的结果"
              className={fieldCls + ' resize-y'}
            />
          </div>

          {/* 执行按钮 */}
          <button
            onClick={runAgent}
            disabled={running || selectedTools.length === 0 || !llmModel}
            className="w-full rounded-xl bg-indigo-600 hover:bg-indigo-700 py-2.5 text-sm font-semibold text-white shadow-sm transition-all active:scale-[0.99] disabled:opacity-50 disabled:cursor-not-allowed">
            {running ? '执行中…（最多 10 轮）' : '开始执行'}
          </button>
        </div>

        {/* 执行过程时间线 */}
        <div className="flex-1 flex flex-col gap-3 overflow-y-auto min-w-0">
          <h3 className="text-base font-bold text-slate-800 dark:text-slate-100">
            执行过程
            <span className="text-[11px] font-normal text-slate-400 ml-2">Trace · ReAct Loop</span>
          </h3>

          {steps.length === 0 && !running && (
            <div className="flex-1 flex flex-col items-center justify-center text-slate-400 dark:text-slate-500 gap-2">
              <span className="text-3xl">🤖</span>
              <span className="text-sm">配置完成后点击「开始执行」</span>
              <span className="text-xs text-slate-300 dark:text-slate-600">每个推理步骤将在这里实时展示</span>
            </div>
          )}

          {steps.map((step, i) => (
            <div key={i} className={`p-3.5 rounded-lg border ${STEP_BG[step.type] || 'bg-slate-50 border-slate-200 dark:bg-slate-800 dark:border-slate-700'}`}>
              <div className="text-[11px] font-bold text-slate-500 dark:text-slate-400 mb-1.5 uppercase tracking-wider">
                {STEP_LABELS[step.type] || step.type}
                {step.tool && ` — ${TOOL_LABELS[step.tool] || step.tool}`}
              </div>
              {step.content && (
                <div className="text-sm leading-relaxed whitespace-pre-wrap text-slate-700 dark:text-slate-200">
                  {step.content}
                </div>
              )}
              {step.args && Object.keys(step.args).length > 0 && (
                <div className="mt-2 px-2.5 py-1.5 bg-black/5 dark:bg-white/5 rounded text-xs font-mono whitespace-pre-wrap text-slate-600 dark:text-slate-300">
                  {JSON.stringify(step.args, null, 2)}
                </div>
              )}
            </div>
          ))}

          {running && (
            <div className="p-3.5 rounded-lg border border-dashed border-slate-300 dark:border-slate-600 bg-slate-50 dark:bg-slate-800 text-slate-400 text-sm flex items-center gap-2">
              <LoadingDots />
              <span>AI 正在思考，请稍候…</span>
            </div>
          )}
        </div>
      </div>

      <HowToSteps steps={AGENT_STEPS} />
    </div>
  );
}
