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
import { RagCollection, CapabilityMap } from '../../types';
import HowToSteps from '../shared/HowToSteps';
import LlmConfigBar from '../shared/LlmConfigBar';
import ProcessFlow, { FlowStep } from '../shared/ProcessFlow';
import ComboSelect from '../shared/ComboSelect';
import FileDrop from '../shared/FileDrop';
import NameInput from '../shared/NameInput';

type KnowledgeBaseTab = 'select' | 'create';

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
  capabilities: CapabilityMap;
  selectedProvider: string;
  apiKey: string;
  cloudEndpoint: string;
  setProviderMap: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  setApiKey: (v: string) => void;
  setCloudEndpoint: (v: string) => void;
  addPendingJob: (type: string, label: string, provider: string, isLocal: boolean) => string;
  resolveJob: (id: string, result: { status: 'completed' | 'failed'; error?: string }) => void;
}

export default function RagPanel({
  backendUrl,
  capabilities,
  selectedProvider,
  apiKey,
  cloudEndpoint,
  setProviderMap,
  setApiKey,
  setCloudEndpoint,
  addPendingJob,
  resolveJob,
}: Props) {
  // ── 状态：知识库列表 ──────────────────────────────────────────────────────
  const [collections, setCollections] = useState<RagCollection[]>([]);
  // 当前选中的知识库名称（用于右侧问答）
  const [selectedCollection, setSelectedCollection] = useState('');
  // Tab 切换：选择现有知识库 vs 创建新知识库
  const [kbTab, setKbTab] = useState<KnowledgeBaseTab>('select');

  // ── 状态：新建知识库表单 ──────────────────────────────────────────────────
  const [buildName, setBuildName] = useState('');       // 知识库名称输入（默认 placeholder: test_kb）
  const [buildFiles, setBuildFiles] = useState<File[]>([]); // 待上传文件列表
  const [building, setBuilding] = useState(false);     // 是否正在提交构建请求
  const [buildMsg, setBuildMsg] = useState('');         // 构建结果提示信息

  // ── 状态：LLM 模型选择 ────────────────────────────────────────────────────
  // RAG 查询时需要语言模型将检索到的片段组织成自然语言回答
  const [llmModel, setLlmModel] = useState('qwen2.5:0.5b');

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
    const name = buildName.trim() || 'test_kb';
    if (buildFiles.length === 0) return;

    setBuilding(true);
    setBuildMsg('正在提交构建任务...');
    try {
      const form = new FormData();
      form.append('name', name);
      // 支持多文件：PDF、Word (.docx)、纯文本 (.txt)、Excel (.xlsx)
      buildFiles.forEach(f => form.append('files', f));

      const res = await fetch(`${backendUrl}/rag/collections`, {
        method: 'POST',
        body: form,
      });
      const data = await res.json();

      if (!data.job_id) {
        setBuildMsg('构建失败：后端未返回任务 ID');
        setBuilding(false);
        return;
      }

      // 创建待处理任务，加入 TaskList
      const jobId = addPendingJob('rag', name, 'rag_indexer', true);

      setBuildMsg(
        `已提交！任务 ID：${data.job_id?.slice(0, 8)}…\n` +
        `后台正在处理，请前往「任务列表」查看进度。`
      );
      // 清空表单，准备下一次构建
      setBuildName('');
      setBuildFiles([]);
      setBuilding(false);

      // 后台异步轮询（不阻塞 UI）
      (async () => {
        let completed = false;
        const deadline = Date.now() + 30 * 60 * 1000; // 30 分钟超时
        while (Date.now() < deadline && !completed) {
          await new Promise(r => setTimeout(r, 2000)); // 每 2 秒查询一次
          try {
            const jobRes = await fetch(`${backendUrl}/rag/collections/jobs/${data.job_id}`);
            if (!jobRes.ok) continue;
            const jobData = await jobRes.json();

            if (jobData.status === 'done') {
              resolveJob(jobId, { status: 'completed' });
              fetchCollections(); // 刷新知识库列表
              completed = true;
            } else if (jobData.status === 'error') {
              resolveJob(jobId, { status: 'failed', error: jobData.error || '知识库构建失败' });
              completed = true;
            }
          } catch (e) {
            // 继续轮询
          }
        }

        if (!completed) {
          // 超时
          resolveJob(jobId, { status: 'failed', error: '任务超时（30 分钟）' });
        }
      })();
    } catch (e: any) {
      setBuildMsg(`构建失败：${e.message}。请确认 Ollama 已启动且已安装 nomic-embed-text 模型。`);
      setBuilding(false);
    } finally {
      setBuilding(false);
    }
  };

  // ── 删除知识库 ────────────────────────────────────────────────────────────
  // DELETE /rag/collections/{name}，删除后端 user_data/rag/{name}/ 目录
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
    const q = question.trim() || 'Python 是什么？';
    if (!selectedCollection || !llmModel) return;

    setQuestion('');  // 立即清空输入框，便于连续提问
    setAnswer('');
    setLoading(true);
    try {
      const res = await fetch(`${backendUrl}/rag/query`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          collection: selectedCollection,
          question: q,
          top_k: 5,
          provider: selectedProvider,
          model: llmModel,
          api_key: apiKey,
          ollama_url: selectedProvider === 'ollama' ? (cloudEndpoint || 'http://127.0.0.1:11434') : 'http://127.0.0.1:11434',
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

      {/* ━━ 顶部配置栏（LLM 服务商和模型）━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}
      <LlmConfigBar
        task="rag"
        capabilities={capabilities}
        selectedProvider={selectedProvider}
        llmModel={llmModel}
        apiKey={apiKey}
        cloudEndpoint={cloudEndpoint}
        onProviderChange={v => setProviderMap(prev => ({ ...prev, rag: v }))}
        onModelChange={setLlmModel}
        onApiKeyChange={setApiKey}
        onCloudEndpointChange={setCloudEndpoint}
      />

      {/* ── 知识库管理区 ── */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>
          知识库管理
          <span style={{ fontSize: 11, fontWeight: 400, color: '#999', marginLeft: 8 }}>
            RAG
          </span>
        </h3>

        {/* ── Tab 栏：选择知识库 vs 创建知识库 ── */}
        <div style={{
          display: 'flex', gap: 0, borderRadius: '8px',
          border: '1px solid #ddd', overflow: 'hidden', fontSize: 13, backgroundColor: '#f5f5f5'
        }}>
          {(['select', 'create'] as const).map(tab => (
            <button
              key={tab}
              onClick={() => setKbTab(tab)}
              style={{
                flex: 1, padding: '10px 12px', fontSize: 13, fontWeight: 500,
                border: 'none', cursor: 'pointer',
                background: kbTab === tab ? '#4f46e5' : '#f5f5f5',
                color: kbTab === tab ? '#fff' : '#666',
                transition: 'all 0.2s'
              }}
            >
              {tab === 'select' ? '选择知识库' : '创建知识库'}
            </button>
          ))}
        </div>

        {/* ── 选择知识库 Tab ── */}
        {kbTab === 'select' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <label style={{ fontSize: 12, fontWeight: 600, color: '#666', textTransform: 'uppercase' }}>
                选择知识库
              </label>
              <div style={{ display: 'flex', gap: 6 }}>
                <button
                  disabled={building}
                  onClick={async () => {
                    setBuilding(true);
                    setBuildMsg('');
                    try {
                      const res = await fetch(`${backendUrl}/rag/init-sample`, { method: 'POST' });
                      const data = await res.json();
                      if (data.status === 'already_exists') {
                        setSelectedCollection('示例知识库');
                        await fetchCollections();
                      } else if (data.job_id) {
                        // 轮询等待构建完成
                        const deadline = Date.now() + 5 * 60 * 1000;
                        while (Date.now() < deadline) {
                          await new Promise(r => setTimeout(r, 1500));
                          try {
                            const jr = await fetch(`${backendUrl}/rag/collections/jobs/${data.job_id}`);
                            if (!jr.ok) continue;
                            const jd = await jr.json();
                            if (jd.status === 'done') {
                              await fetchCollections();
                              setSelectedCollection('示例知识库');
                              break;
                            }
                            if (jd.status === 'error') {
                              setBuildMsg(`示例库构建失败：${jd.error || '未知错误'}`);
                              break;
                            }
                          } catch { /* 继续轮询 */ }
                        }
                      }
                    } catch (e: any) {
                      setBuildMsg(`创建失败：${e.message}`);
                    } finally {
                      setBuilding(false);
                    }
                  }}
                  style={{
                    fontSize: 12, background: 'none',
                    border: '1px solid #0d9488', borderRadius: 4,
                    padding: '3px 8px', cursor: building ? 'wait' : 'pointer',
                    color: '#0d9488', fontWeight: 500,
                    opacity: building ? 0.5 : 1
                  }}
                >
                  {building ? '构建中…' : '示例库'}
                </button>
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
            </div>
            <ComboSelect
              value={selectedCollection}
              onChange={setSelectedCollection}
              options={collections.map(c => ({
                value: c.name,
                label: `${c.name} (${c.doc_count} 文档 · ${c.size_mb} MB)`
              }))}
              placeholder="-- 请选择知识库 --"
            />

            {selectedCollection && (
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 3 }}>
                <button
                  onClick={() => handleDelete(selectedCollection)}
                  style={{ fontSize: 12, fontWeight: 600, color: '#e53e3e', background: 'none', border: 'none', cursor: 'pointer' }}
                >
                  删除知识库
                </button>
              </div>
            )}
          </div>
        )}

        {/* ── 创建知识库 Tab ── */}
        {kbTab === 'create' && (
          <div style={{
            background: '#f5f5f5', borderRadius: 8, padding: 16,
            display: 'flex', flexDirection: 'column', gap: 10
          }}>
            <div style={{ fontSize: 13, fontWeight: 600 }}>新建知识库</div>

            {/* 大小参考提示 */}
            <div style={{
              fontSize: 11, color: '#666', background: '#fff',
              padding: 8, borderRadius: 4, borderLeft: '3px solid #0d9488',
              lineHeight: 1.5
            }}>
              <div style={{ fontWeight: 600, marginBottom: 4 }}>知识库大小参考：</div>
              <div>小（1-10 MB）：FAQ、单篇文档</div>
              <div>中（10-100 MB）：产品手册、技术文档集合</div>
              <div>大（100+ MB）：整本书、大型文档库</div>
            </div>

            {/* 名称：只用英文、数字、下划线，避免路径问题 */}
            <NameInput
              placeholder="test_kb"
              value={buildName}
              onChange={setBuildName}
            />
            {!buildName.trim() && (
              <div style={{ fontSize: 11, color: '#999' }}>
                留空将使用默认名称 test_kb
              </div>
            )}

            {/* 文件选择：支持 PDF / DOCX / TXT / XLSX */}
            <FileDrop
              files={buildFiles}
              onAdd={fs => setBuildFiles([...buildFiles, ...fs])}
              onRemove={i => setBuildFiles(buildFiles.filter((_, j) => j !== i))}
              accept=".pdf,.txt,.docx,.xlsx"
              multiple
              iconType="file"
              emptyLabel="点击或拖拽上传文件（可多选）"
              formatHint="支持 PDF、Word (.docx)、纯文本 (.txt)、Excel (.xlsx)"
            />
            <button
              onClick={() => {
                const content = 'Python 是一门广泛使用的编程语言。\nPython 支持多种编程范式。\n' +
                  'Python 拥有丰富的第三方库和活跃的社区。\n' +
                  'Python 适合数据科学、Web 开发、自动化脚本等多种场景。';
                const file = new File([content], `sample_${buildFiles.length + 1}.txt`, { type: 'text/plain' });
                setBuildFiles(prev => [...prev, file]);
              }}
              style={{
                fontSize: 12, background: 'none',
                border: '1px dashed #0d9488', borderRadius: 6,
                padding: '6px 12px', cursor: 'pointer', color: '#0d9488', fontWeight: 500,
                transition: 'all 0.2s'
              }}
            >
              + 导入样例文件
            </button>

            {/* 构建按钮 */}
            <button
              onClick={handleBuild}
              disabled={building || buildFiles.length === 0}
              style={{
                padding: '7px 14px', borderRadius: 6,
                background: '#4f46e5', color: '#fff',
                border: 'none', cursor: 'pointer', fontSize: 13,
                opacity: (building || buildFiles.length === 0) ? 0.5 : 1,
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
        )}
      </div>

      {/* ── 问答区（选择知识库 Tab 时显示）── */}
      {kbTab === 'select' && (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 16, minHeight: 0 }}>
          <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>
            知识库问答
            <span style={{ fontSize: 11, fontWeight: 400, color: '#999', marginLeft: 8 }}>
              Answer Generation
            </span>
          </h3>

          {/* 问题输入区（已选择知识库时显示）*/}
          {selectedCollection && (
            <div style={{ display: 'flex', gap: 8 }}>
              <input
                placeholder="Python 是什么？"
                value={question}
                onChange={e => setQuestion(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    handleQuery();
                  }
                }}
                disabled={loading}
                style={{
                  flex: 1, padding: '8px 12px', borderRadius: 6,
                  border: '1px solid #ddd', fontSize: 13,
                  background: loading ? '#f5f5f5' : '#fff',
                  color: loading ? '#999' : '#000',
                  cursor: loading ? 'not-allowed' : 'text'
                }}
              />
              <button
                onClick={handleQuery}
                disabled={loading}
                style={{
                  padding: '8px 16px', borderRadius: 6,
                  background: '#0d9488', color: '#fff',
                  border: 'none', cursor: (loading || !question.trim()) ? 'not-allowed' : 'pointer',
                  fontSize: 13, fontWeight: 600,
                  opacity: loading ? 0.5 : 1,
                }}
              >
                {loading ? '提问中…' : '提问'}
              </button>
            </div>
          )}

          {/* 流式回答展示区 */}
          {selectedCollection && (answer || loading) && (
            <div style={{
              flex: 1, padding: 16, background: '#f9f9f9',
              borderRadius: 8, fontSize: 13, lineHeight: 1.8,
              overflowY: 'auto', whiteSpace: 'pre-wrap',
              border: '1px solid #e8e8e8'
            }}>
              {answer || (loading && '正在检索文档并生成回答，请稍候…')}
            </div>
          )}

          {/* 未选中知识库时的空状态提示 */}
          {!selectedCollection && (
            <div style={{
              flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: '#999', flexDirection: 'column', gap: 8
            }}>
              <div style={{ fontSize: 32 }}>📚</div>
              <div style={{ fontSize: 14 }}>请先选择一个知识库</div>
              <div style={{ fontSize: 12, color: '#bbb' }}>如果还没有，请先创建一个</div>
            </div>
          )}
        </div>
      )}

      {/* ── 使用步骤引导（与 VcPanel 风格一致）── */}
      <HowToSteps steps={RAG_STEPS} />
    </div>
  );
}
