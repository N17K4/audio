/**
 * AgentPanel — 智能体（Agent）页面
 *
 * 智能体采用 ReAct（Reasoning + Acting）模式：
 *   思考（Thought）→ 选工具行动（Action）→ 看结果（Observation）→ 再思考 …
 * 循环最多 10 轮，直到得出最终答案。
 *
 * 后端通过 SSE（Server-Sent Events）实时推送每一步，
 * 前端按顺序渲染为「步骤时间线」。
 *
 * 可用工具：
 *   web_search   — DuckDuckGo 搜索，返回前 5 条结果
 *   python_exec  — 在沙箱里执行 Python 代码，限时 10 秒
 *   file_read    — 读取 models/agent_workspace/ 下的文件
 *   file_write   — 把内容写入 models/agent_workspace/
 *   rag_retrieval — 从本地知识库检索信息（需先在知识库页建库）
 */

import { useState } from 'react';
import { AgentStep, CapabilityMap } from '../../types';
import HowToSteps from '../shared/HowToSteps';
import LlmConfigBar from '../shared/LlmConfigBar';
import ProcessFlow, { FlowStep } from '../shared/ProcessFlow';

// ─── 实际运行流程（ReAct 智能体循环）────────────────────────────────────────
const AGENT_FLOW: FlowStep[] = [
  { label: '任务描述',  tech: 'Prompt' },
  { label: 'LLM 思考',  tech: 'Thought' },
  { label: '选工具',    tech: 'Action' },
  { label: '执行工具',  tech: 'Tool Call' },
  { label: '观察结果',  tech: 'Observation' },
  { label: '循环',      tech: '≤10 轮', note: '直到有答案' },
  { label: '最终答案',  tech: 'Final Answer' },
];

// ─── 使用步骤引导 ──────────────────────────────────────────────────────────
const AGENT_STEPS = [
  {
    title: '选择模型',
    desc: '本地选 Ollama（需先运行 ollama serve），云端选 OpenAI 并填入 API Key',
  },
  {
    title: '勾选工具',
    desc: '按需勾选工具：调研任务选「网络搜索」，数据处理选「Python 执行」',
  },
  {
    title: '描述任务',
    desc: '用自然语言写清楚要做什么，点击「开始执行」，右侧实时展示推理过程',
  },
];

// ─── 工具标签（key 与后端 tools.py 中的字典 key 对应）─────────────────────
const TOOL_LABELS: Record<string, string> = {
  web_search:    '网络搜索',
  python_exec:   'Python 执行',
  file_read:     '读取文件',
  file_write:    '写入文件',
  rag_retrieval: 'RAG 检索',
};

// ─── 工具说明（悬停提示）──────────────────────────────────────────────────
const TOOL_TIPS: Record<string, string> = {
  web_search:    '使用 DuckDuckGo 搜索互联网，返回前 5 条结果（标题 + 摘要 + 链接）',
  python_exec:   '让 AI 写 Python 代码并在本机运行，限时 10 秒，适合计算、文本处理',
  file_read:     '读取 models/agent_workspace/ 目录下的文件',
  file_write:    '把内容写入 models/agent_workspace/ 目录，可供后续步骤读取',
  rag_retrieval: '从已建好的知识库中语义检索，需先在「知识库」页面上传文档建库',
};

// ─── 步骤卡片的背景色（区分不同类型的步骤）────────────────────────────────
const STEP_COLORS: Record<string, string> = {
  thought:     '#e8f4fd',  // 蓝色：思考
  action:      '#fef3cd',  // 黄色：行动（调用工具）
  observation: '#e8f5e9',  // 绿色：工具返回的观察结果
  final:       '#e8eaf6',  // 紫色：最终答案
  error:       '#fdecea',  // 红色：出错
};

// ─── 步骤标签（中文显示）──────────────────────────────────────────────────
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
  backendUrl,
  capabilities,
  selectedProvider,
  apiKey,
  cloudEndpoint,
  setProviderMap,
  setApiKey,
  setCloudEndpoint,
}: Props) {
  // ── 配置状态（LLM 模型选择） ──────────────────────────────────────────────
  const [llmModel, setLlmModel] = useState('qwen2.5:0.5b');

  // ── 工具选择 ──────────────────────────────────────────────────────────────
  // 初始默认勾选「网络搜索」，最常用
  const [selectedTools, setSelectedTools] = useState<string[]>(['web_search']);

  // ── 任务与执行状态 ────────────────────────────────────────────────────────
  const [task, setTask] = useState('');                // 用户输入的任务描述
  const [steps, setSteps] = useState<AgentStep[]>([]); // SSE 推送过来的步骤列表
  const [running, setRunning] = useState(false);        // 是否正在执行中

  // ── 工具勾选切换 ─────────────────────────────────────────────────────────
  const toggleTool = (name: string) => {
    setSelectedTools(prev =>
      prev.includes(name)
        ? prev.filter(t => t !== name)
        : [...prev, name]
    );
  };

  // ── 执行智能体任务 ────────────────────────────────────────────────────────
  // POST /agent/run → SSE 流，每条 data 是一个 JSON 步骤对象
  const runAgent = async () => {
    const taskToRun = task.trim() || '计算 10 + 5 的结果';

    if (selectedTools.length === 0 || !llmModel) return;

    setSteps([]);   // 清空上次的执行记录
    setRunning(true);
    try {
      const res = await fetch(`${backendUrl}/agent/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          task: taskToRun,
          tools: selectedTools,
          provider: selectedProvider,
          model: llmModel,
          api_key: apiKey,
          ollama_url: selectedProvider === 'ollama' ? (cloudEndpoint || 'http://127.0.0.1:11434') : 'http://127.0.0.1:11434',
        }),
      });

      // 逐块读取 SSE 流，解析每个步骤并追加到列表
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
          } catch {
            // JSON 解析失败（可能是不完整的块）跳过
          }
        }
      }
    } finally {
      setRunning(false);
    }
  };

  // ─────────────────────────────────────────────────────────────────────────
  return (
    <div style={{ display: 'flex', gap: 24, padding: 24, height: '100%', flexDirection: 'column' }}>

      {/* ── 实际运行流程可视化 ── */}
      <ProcessFlow steps={AGENT_FLOW} color="#7c3aed" />

      {/* ── 主体：配置区 + 执行过程时间线 ── */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 24, flex: 1, minHeight: 0 }}>

        {/* ━━ 顶部配置栏（并排） ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}
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

        {/* ━━ 配置区（工具、任务、按钮） ━━━━━━━━━━━━━━━━━━━━━━━━━ */}
        <div style={{
          display: 'flex', flexDirection: 'column',
          gap: 16, overflowY: 'auto'
        }}>
          <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>
            智能体
            <span style={{ fontSize: 11, fontWeight: 400, color: '#999', marginLeft: 8 }}>
              Agent
            </span>
          </h3>

          {/* ── 工具选择（网格多选 + 副标题说明）── */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <label style={{ fontSize: 12, fontWeight: 600, color: '#555' }}>
              赋予智能体的工具（至少选一个）
            </label>
            <div style={{
              display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 12,
              padding: '10px', borderRadius: 8,
              background: '#f9f9f9', border: '1px solid #e0e0e0'
            }}>
              {Object.entries(TOOL_LABELS).map(([key, label]) => (
                <div key={key} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <button
                    onClick={() => toggleTool(key)}
                    style={{
                      padding: '10px 12px', borderRadius: 6,
                      border: selectedTools.includes(key)
                        ? '2px solid #4f46e5'
                        : '1px solid #d0d0d0',
                      background: selectedTools.includes(key)
                        ? '#eef2ff'
                        : '#fff',
                      color: selectedTools.includes(key) ? '#4f46e5' : '#666',
                      fontSize: 13, fontWeight: 500,
                      cursor: 'pointer', transition: 'all 0.2s',
                      textAlign: 'center'
                    }}
                    onMouseEnter={(e) => {
                      if (!selectedTools.includes(key)) {
                        e.currentTarget.style.background = '#f5f5f5';
                        e.currentTarget.style.borderColor = '#999';
                      }
                    }}
                    onMouseLeave={(e) => {
                      if (!selectedTools.includes(key)) {
                        e.currentTarget.style.background = '#fff';
                        e.currentTarget.style.borderColor = '#d0d0d0';
                      }
                    }}
                  >
                    {label}
                  </button>
                  {/* 副标题说明 */}
                  <div style={{
                    fontSize: 11, color: '#999', lineHeight: 1.4,
                    maxHeight: '2.4em', overflow: 'hidden', textOverflow: 'ellipsis',
                    display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical'
                  }}>
                    {TOOL_TIPS[key]}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* ── 任务描述（留空则使用默认示例）── */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <label style={{ fontSize: 12, fontWeight: 600, color: '#555' }}>
              任务描述
              <span style={{ fontSize: 11, color: '#999', fontWeight: 400, marginLeft: 6 }}>留空则使用 placeholder 默认任务</span>
            </label>
            <textarea
              rows={5}
              value={task}
              onChange={e => setTask(e.target.value)}
              placeholder="计算 10 + 5 的结果"
              style={{
                padding: '8px 10px', borderRadius: 6,
                border: '1px solid #ddd', fontSize: 13, resize: 'vertical',
                lineHeight: 1.5
              }}
            />
          </div>

          {/* ── 执行按钮 ── */}
          <button
            onClick={runAgent}
            disabled={running || selectedTools.length === 0 || !llmModel}
            style={{
              padding: '10px', borderRadius: 8,
              background: '#4f46e5', color: '#fff',
              border: 'none', cursor: 'pointer',
              fontSize: 14, fontWeight: 600,
              opacity: (running || selectedTools.length === 0 || !llmModel) ? 0.5 : 1,
            }}
          >
            {running ? '执行中…（最多 10 轮）' : '开始执行'}
          </button>
        </div>

        {/* ━━ 执行过程时间线 ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}
        <div style={{
          flex: 1, display: 'flex', flexDirection: 'column',
          gap: 12, overflowY: 'auto', minWidth: 0
        }}>
          <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>
            执行过程
            <span style={{ fontSize: 11, fontWeight: 400, color: '#999', marginLeft: 8 }}>
              Trace · ReAct Loop
            </span>
          </h3>

          {/* 空状态提示 */}
          {steps.length === 0 && !running && (
            <div style={{
              flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: '#999', flexDirection: 'column', gap: 8
            }}>
              <div style={{ fontSize: 32 }}>🤖</div>
              <div style={{ fontSize: 14 }}>配置完成后点击「开始执行」</div>
              <div style={{ fontSize: 12, color: '#bbb' }}>
                每个推理步骤将在这里实时展示
              </div>
            </div>
          )}

          {/* 步骤卡片列表 */}
          {steps.map((step, i) => (
            <div
              key={i}
              style={{
                padding: 14, borderRadius: 8,
                background: STEP_COLORS[step.type] || '#f5f5f5',
                border: '1px solid #e0e0e0',
              }}
            >
              {/* 步骤类型标签（思考 / 行动 / 观察 / 最终答案 / 错误）*/}
              <div style={{
                fontSize: 11, fontWeight: 700, color: '#555',
                marginBottom: 6, textTransform: 'uppercase', letterSpacing: 1
              }}>
                {STEP_LABELS[step.type] || step.type}
                {/* 行动步骤额外显示调用的工具名 */}
                {step.tool && ` — ${TOOL_LABELS[step.tool] || step.tool}`}
              </div>

              {/* 步骤正文内容 */}
              {step.content && (
                <div style={{ fontSize: 13, lineHeight: 1.7, whiteSpace: 'pre-wrap' }}>
                  {step.content}
                </div>
              )}

              {/* 行动步骤：显示传给工具的参数（JSON 格式方便调试）*/}
              {step.args && Object.keys(step.args).length > 0 && (
                <div style={{
                  marginTop: 8, padding: '6px 10px',
                  background: 'rgba(0,0,0,0.05)', borderRadius: 4,
                  fontSize: 12, fontFamily: 'monospace', whiteSpace: 'pre-wrap'
                }}>
                  {JSON.stringify(step.args, null, 2)}
                </div>
              )}
            </div>
          ))}

          {/* 正在思考的动态提示 */}
          {running && (
            <div style={{
              padding: 14, borderRadius: 8,
              background: '#f5f5f5', border: '1px dashed #bbb',
              color: '#999', fontSize: 13,
              display: 'flex', alignItems: 'center', gap: 8
            }}>
              <span>🔄</span>
              <span>AI 正在思考，请稍候…</span>
            </div>
          )}
        </div>
      </div>

      {/* ── 使用步骤引导（与 VcPanel 风格一致）── */}
      <HowToSteps steps={AGENT_STEPS} />
    </div>
  );
}
