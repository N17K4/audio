/**
 * RagPanel — 知识库（RAG）页面
 *
 * RAG = Retrieval-Augmented Generation，检索增强生成。
 * 工作原理：先把你的文件切成小段存到向量数据库（FAISS），
 * 提问时先在数据库里找最相关的段落，再交给语言模型组织成答案。
 *
 * 硬件要求：
 *   - 构建索引、问答均在 CPU 上完成，32 GB MBP 完全够用
 *   - Embedding 模型（nomic-embed-text）通过 Ollama 本地运行，需提前执行：
 *     ollama pull nomic-embed-text
 *
 * 页面布局：左侧管理知识库，右侧进行问答
 */

import { useState, useEffect } from 'react';
import { RagCollection } from '../../types';
import HowToSteps from '../shared/HowToSteps';
import LlmProviderConfig, { LlmConfig, DEFAULT_LLM_CONFIG } from '../shared/LlmProviderConfig';
import ProcessFlow, { FlowStep } from '../shared/ProcessFlow';

// ─── 实际运行流程（RAG 管道各步骤）──────────────────────────────────────────
// 每个节点：label=中文动作，tech=实际使用的技术/库
const RAG_FLOW: FlowStep[] = [
  { label: '上传文件',  tech: 'PDF/DOCX/TXT' },
  { label: '切片',      tech: 'SimpleDirectoryReader' },
  { label: '向量化',    tech: 'nomic-embed-text' },
  { label: '存入向量库', tech: 'FAISS' },
  { label: '检索',      tech: 'top-k 相似度' },
  { label: '生成回答',  tech: 'LLM（你选的模型）' },
];

// ─── 使用步骤（显示在页面底部的引导卡片）────────────────────────────────────
// 格式与 VcPanel 一致：{ title, desc }
const RAG_STEPS = [
  {
    title: '新建知识库',
    desc: '填写名称，上传 PDF / Word / TXT / Excel，点击「构建知识库」',
  },
  {
    title: '等待索引完成',
    desc: '后台将文件切片并生成向量索引，通常数秒至数分钟，完成后刷新列表',
  },
  {
    title: '开始提问',
    desc: '点击左侧知识库，在右侧输入问题，按回车或点击「提问」',
  },
];

interface Props {
  backendUrl: string;
}

export default function RagPanel({ backendUrl }: Props) {
  // ── 状态：知识库列表 ──────────────────────────────────────────────────────
  const [collections, setCollections] = useState<RagCollection[]>([]);
  // 当前选中的知识库名称（用于右侧问答）
  const [selectedCollection, setSelectedCollection] = useState('');

  // ── 状态：新建知识库表单 ──────────────────────────────────────────────────
  const [buildName, setBuildName] = useState('');       // 知识库名称输入
  const [buildFiles, setBuildFiles] = useState<File[]>([]); // 待上传文件列表
  const [building, setBuilding] = useState(false);     // 是否正在提交构建请求
  const [buildMsg, setBuildMsg] = useState('');         // 构建结果提示信息

  // ── 状态：LLM 配置（provider / model / apiKey / ollamaUrl）──────────────
  // RAG 查询时需要语言模型将检索到的片段组织成自然语言回答
  const [llmConfig, setLlmConfig] = useState<LlmConfig>(DEFAULT_LLM_CONFIG);

  // ── 状态：问答区 ─────────────────────────────────────────────────────────
  const [question, setQuestion] = useState('');         // 用户输入的问题
  const [answer, setAnswer] = useState('');             // 流式接收的回答内容
  const [loading, setLoading] = useState(false);        // 是否正在等待回答

  // ── 拉取知识库列表 ────────────────────────────────────────────────────────
  // 调用 GET /rag/collections，返回 [{name, doc_count, size_mb, created_at}]
  const fetchCollections = async () => {
    try {
      const res = await fetch(`${backendUrl}/rag/collections`);
      if (res.ok) setCollections(await res.json());
    } catch {
      // 后端未就绪时静默失败，不弹错误
    }
  };

  // 页面加载时及 backendUrl 变化时自动拉取列表
  useEffect(() => { fetchCollections(); }, [backendUrl]);

  // ── 构建知识库 ────────────────────────────────────────────────────────────
  // POST /rag/collections（multipart/form-data）
  // 后端返回 job_id，实际索引在后台异步执行（可能需要数分钟）
  const handleBuild = async () => {
    if (!buildName.trim() || buildFiles.length === 0) return;

    setBuilding(true);
    setBuildMsg('正在提交构建任务...');
    try {
      const form = new FormData();
      form.append('name', buildName.trim());
      // 支持多文件：PDF、Word (.docx)、纯文本 (.txt)、Excel (.xlsx)
      buildFiles.forEach(f => form.append('files', f));

      const res = await fetch(`${backendUrl}/rag/collections`, {
        method: 'POST',
        body: form,
      });
      const data = await res.json();

      setBuildMsg(
        `已提交！任务 ID：${data.job_id?.slice(0, 8)}…\n` +
        `后台正在处理，请等待 10～60 秒后点击「刷新」查看结果。`
      );
      // 清空表单，准备下一次构建
      setBuildName('');
      setBuildFiles([]);
      // 3 秒后自动刷新一次列表（小文件通常这时已完成）
      setTimeout(fetchCollections, 3000);
    } catch (e: any) {
      setBuildMsg(`构建失败：${e.message}。请确认 Ollama 已启动且已安装 nomic-embed-text 模型。`);
    } finally {
      setBuilding(false);
    }
  };

  // ── 删除知识库 ────────────────────────────────────────────────────────────
  // DELETE /rag/collections/{name}，删除后端 models/rag/{name}/ 目录
  const handleDelete = async (name: string) => {
    if (!confirm(`确认删除知识库「${name}」？此操作不可撤销。`)) return;
    await fetch(
      `${backendUrl}/rag/collections/${encodeURIComponent(name)}`,
      { method: 'DELETE' }
    );
    // 如果删除的是当前选中的，清空选中状态
    if (selectedCollection === name) setSelectedCollection('');
    fetchCollections();
  };

  // ── 知识库问答 ────────────────────────────────────────────────────────────
  // POST /rag/query，后端用 SSE（Server-Sent Events）流式返回答案
  // SSE 格式：每行 "data: <文本片段>\n\n"
  const handleQuery = async () => {
    if (!selectedCollection || !question.trim()) return;

    setAnswer('');
    setLoading(true);
    try {
      const res = await fetch(`${backendUrl}/rag/query`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          collection: selectedCollection,
          question,
          top_k: 5,
          provider: llmConfig.provider,
          model: llmConfig.model,
          api_key: llmConfig.apiKey,
          ollama_url: llmConfig.ollamaUrl,
        }),
      });

      // 逐块读取流式响应，拼接到 answer 状态
      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let buf = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        // SSE 事件以 "\n\n" 分隔
        const lines = buf.split('\n\n');
        buf = lines.pop() || '';
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            // 去掉 "data: " 前缀，追加到回答
            setAnswer(prev => prev + line.slice(6));
          }
        }
      }
    } finally {
      setLoading(false);
    }
  };

  // ─────────────────────────────────────────────────────────────────────────
  return (
    <div style={{ display: 'flex', gap: 24, padding: 24, height: '100%', flexDirection: 'column' }}>

      {/* ── 实际运行流程可视化 ── */}
      <ProcessFlow steps={RAG_FLOW} color="#0d9488" />

      {/* ── 主体：左右两栏布局 ── */}
      <div style={{ display: 'flex', gap: 24, flex: 1, minHeight: 0 }}>

        {/* ━━ 左栏：知识库管理 ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}
        <div style={{ width: 320, display: 'flex', flexDirection: 'column', gap: 16, overflowY: 'auto' }}>
          <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>
            知识库管理
            <span style={{ fontSize: 11, fontWeight: 400, color: '#999', marginLeft: 8 }}>
              RAG · Retrieval-Augmented Generation
            </span>
          </h3>

          {/* ── 新建知识库表单 ── */}
          <div style={{
            background: '#f5f5f5', borderRadius: 8, padding: 16,
            display: 'flex', flexDirection: 'column', gap: 10
          }}>
            <div style={{ fontSize: 13, fontWeight: 600 }}>新建知识库</div>

            {/* 名称：只用英文、数字、下划线，避免路径问题 */}
            <input
              placeholder="知识库名称（如 company_docs）"
              value={buildName}
              onChange={e => setBuildName(e.target.value)}
              style={{ padding: '6px 10px', borderRadius: 6, border: '1px solid #ddd', fontSize: 13 }}
            />

            {/* 文件选择：支持 PDF / DOCX / TXT / XLSX */}
            <div style={{ fontSize: 11, color: '#888', marginBottom: 2 }}>
              支持格式：PDF、Word (.docx)、纯文本 (.txt)、Excel (.xlsx)
            </div>
            <input
              type="file"
              multiple
              accept=".pdf,.txt,.docx,.xlsx"
              onChange={e => setBuildFiles(Array.from(e.target.files || []))}
              style={{ fontSize: 12 }}
            />
            {buildFiles.length > 0 && (
              <div style={{ fontSize: 12, color: '#555' }}>
                已选 {buildFiles.length} 个文件：{buildFiles.map(f => f.name).join('、')}
              </div>
            )}

            {/* 构建按钮：两个条件都满足才可点击 */}
            <button
              onClick={handleBuild}
              disabled={building || !buildName.trim() || buildFiles.length === 0}
              style={{
                padding: '7px 14px', borderRadius: 6,
                background: '#4f46e5', color: '#fff',
                border: 'none', cursor: 'pointer', fontSize: 13,
                opacity: (building || !buildName.trim() || buildFiles.length === 0) ? 0.5 : 1,
              }}
            >
              {building ? '提交中...' : '构建知识库'}
            </button>

            {/* 构建状态提示 */}
            {buildMsg && (
              <div style={{ fontSize: 12, color: '#555', whiteSpace: 'pre-line', lineHeight: 1.5 }}>
                {buildMsg}
              </div>
            )}
          </div>

          {/* ── 语言模型配置（始终可见，问答时使用）── */}
          {/* Embedding 固定用 Ollama nomic-embed-text；此处配置的是"生成回答"的模型 */}
          <div style={{ padding: 14, background: '#f9f9f9', borderRadius: 8, border: '1px solid #e8e8e8' }}>
            <LlmProviderConfig config={llmConfig} onChange={setLlmConfig} title="回答语言模型" />
          </div>

          {/* ── 已有知识库列表 ── */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={{ fontSize: 13, fontWeight: 600 }}>已有知识库</div>
            <button
              onClick={fetchCollections}
              style={{
                fontSize: 12, background: 'none',
                border: '1px solid #ddd', borderRadius: 4,
                padding: '3px 8px', cursor: 'pointer'
              }}
            >
              刷新
            </button>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {collections.length === 0 && (
              <div style={{ fontSize: 13, color: '#999', textAlign: 'center', padding: 16 }}>
                暂无知识库，请先新建
              </div>
            )}
            {collections.map(c => (
              /* 点击卡片 → 选中该知识库，用于右侧问答 */
              <div
                key={c.name}
                onClick={() => setSelectedCollection(c.name)}
                style={{
                  padding: '10px 12px', borderRadius: 8,
                  border: `2px solid ${selectedCollection === c.name ? '#4f46e5' : '#e0e0e0'}`,
                  cursor: 'pointer',
                  background: selectedCollection === c.name ? '#f0f0ff' : '#fff',
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                }}
              >
                <div>
                  <div style={{ fontSize: 13, fontWeight: 600 }}>{c.name}</div>
                  <div style={{ fontSize: 11, color: '#666' }}>
                    {c.doc_count} 个文档 · {c.size_mb} MB
                  </div>
                </div>
                {/* 删除按钮：stopPropagation 防止触发选中 */}
                <button
                  onClick={e => { e.stopPropagation(); handleDelete(c.name); }}
                  title="删除此知识库"
                  style={{
                    background: 'none', border: 'none',
                    color: '#e53e3e', cursor: 'pointer', fontSize: 18, lineHeight: 1
                  }}
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        </div>

        {/* ━━ 右栏：问答区 ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 16, minWidth: 0 }}>
          <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>
            知识库问答
            <span style={{ fontSize: 11, fontWeight: 400, color: '#999', marginLeft: 8 }}>
              Query · Answer Generation
            </span>
          </h3>

          {/* 未选中知识库时的空状态提示 */}
          {!selectedCollection ? (
            <div style={{
              flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: '#999', flexDirection: 'column', gap: 8
            }}>
              <div style={{ fontSize: 32 }}>📚</div>
              <div style={{ fontSize: 14 }}>请先在左侧选择一个知识库</div>
              <div style={{ fontSize: 12, color: '#bbb' }}>如果还没有，先新建一个</div>
            </div>
          ) : (
            <>
              {/* 当前知识库标识 */}
              <div style={{
                fontSize: 13, color: '#4f46e5', fontWeight: 600,
                padding: '4px 10px', background: '#f0f0ff', borderRadius: 6, display: 'inline-block'
              }}>
                📖 {selectedCollection}
              </div>

              {/* 问题输入框 + 提问按钮 */}
              <div style={{ display: 'flex', gap: 8 }}>
                <input
                  placeholder="输入问题，按回车提交…"
                  value={question}
                  onChange={e => setQuestion(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && !e.shiftKey && handleQuery()}
                  style={{
                    flex: 1, padding: '8px 12px',
                    borderRadius: 8, border: '1px solid #ddd', fontSize: 13
                  }}
                />
                <button
                  onClick={handleQuery}
                  disabled={loading || !question.trim()}
                  style={{
                    padding: '8px 20px', borderRadius: 8,
                    background: '#4f46e5', color: '#fff',
                    border: 'none', cursor: 'pointer', fontSize: 13,
                    opacity: (loading || !question.trim()) ? 0.5 : 1,
                  }}
                >
                  {loading ? '查询中…' : '提问'}
                </button>
              </div>

              {/* 流式回答展示区 */}
              {answer && (
                <div style={{
                  flex: 1, padding: 16, background: '#f9f9f9',
                  borderRadius: 8, fontSize: 13, lineHeight: 1.8,
                  overflowY: 'auto', whiteSpace: 'pre-wrap',
                  border: '1px solid #e8e8e8'
                }}>
                  {answer}
                </div>
              )}

              {/* 等待回答时的骨架提示 */}
              {loading && !answer && (
                <div style={{ color: '#999', fontSize: 13, padding: 16 }}>
                  正在检索文档并生成回答，请稍候…
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* ── 使用步骤引导（与 VcPanel 风格一致）── */}
      <HowToSteps steps={RAG_STEPS} />
    </div>
  );
}
