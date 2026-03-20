/**
 * RagPanel — 知识库（RAG）页面
 */

import { useState, useEffect } from 'react';
import { RagCollection, CapabilityMap } from '../../types';
import HowToSteps from '../shared/HowToSteps';
import LlmConfigBar from '../shared/LlmConfigBar';
import ProcessFlow, { FlowStep } from '../shared/ProcessFlow';
import ComboSelect from '../shared/ComboSelect';
import FileDrop from '../shared/FileDrop';
import NameInput from '../shared/NameInput';
import TabBar from '../shared/TabBar';
import { fieldCls, labelCls } from '../../constants/styles';

type KnowledgeBaseTab = 'select' | 'create';

const RAG_FLOW: FlowStep[] = [
  { label: '上传文件',  tech: 'PDF/DOCX/TXT' },
  { label: '切片',      tech: 'SimpleDirectoryReader' },
  { label: '向量化',    tech: 'nomic-embed-text' },
  { label: '存入向量库', tech: 'FAISS' },
  { label: '检索',      tech: 'top-k 相似度' },
  { label: '生成回答',  tech: 'LLM（你选的模型）' },
];

const RAG_STEPS = [
  { title: '新建知识库', desc: '填写名称，上传 PDF / Word / TXT / Excel，点击「构建知识库」' },
  { title: '等待索引完成', desc: '后台将文件切片并生成向量索引，通常数秒至数分钟，完成后刷新列表' },
  { title: '开始提问', desc: '点击左侧知识库，在右侧输入问题，按回车或点击「提问」' },
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
  backendUrl, capabilities, selectedProvider, apiKey, cloudEndpoint,
  setProviderMap, setApiKey, setCloudEndpoint, addPendingJob, resolveJob,
}: Props) {
  const [collections, setCollections] = useState<RagCollection[]>([]);
  const [selectedCollection, setSelectedCollection] = useState('');
  const [kbTab, setKbTab] = useState<KnowledgeBaseTab>('select');
  const [buildName, setBuildName] = useState('');
  const [buildFiles, setBuildFiles] = useState<File[]>([]);
  const [building, setBuilding] = useState(false);
  const [buildMsg, setBuildMsg] = useState('');
  const [llmModel, setLlmModel] = useState('qwen2.5:0.5b');
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState('');
  const [loading, setLoading] = useState(false);

  const fetchCollections = async () => {
    try {
      const res = await fetch(`${backendUrl}/rag/collections`);
      if (res.ok) setCollections(await res.json());
    } catch { /* silent */ }
  };

  useEffect(() => { fetchCollections(); }, [backendUrl]);

  const handleBuild = async () => {
    const name = buildName.trim() || 'test_kb';
    if (buildFiles.length === 0) return;
    setBuilding(true);
    setBuildMsg('正在提交构建任务...');
    try {
      const form = new FormData();
      form.append('name', name);
      buildFiles.forEach(f => form.append('files', f));
      const res = await fetch(`${backendUrl}/rag/collections`, { method: 'POST', body: form });
      const data = await res.json();
      if (!data.job_id) { setBuildMsg('构建失败：后端未返回任务 ID'); setBuilding(false); return; }
      const jobId = addPendingJob('rag', name, 'rag_indexer', true);
      setBuildMsg(`已提交！任务 ID：${data.job_id?.slice(0, 8)}…\n后台正在处理，请前往「任务列表」查看进度。`);
      setBuildName(''); setBuildFiles([]); setBuilding(false);
      (async () => {
        let completed = false;
        const deadline = Date.now() + 30 * 60 * 1000;
        while (Date.now() < deadline && !completed) {
          await new Promise(r => setTimeout(r, 2000));
          try {
            const jobRes = await fetch(`${backendUrl}/rag/collections/jobs/${data.job_id}`);
            if (!jobRes.ok) continue;
            const jobData = await jobRes.json();
            if (jobData.status === 'done') { resolveJob(jobId, { status: 'completed' }); fetchCollections(); completed = true; }
            else if (jobData.status === 'error') { resolveJob(jobId, { status: 'failed', error: jobData.error || '知识库构建失败' }); completed = true; }
          } catch { /* continue */ }
        }
        if (!completed) resolveJob(jobId, { status: 'failed', error: '任务超时（30 分钟）' });
      })();
    } catch (e: any) {
      setBuildMsg(`构建失败：${e.message}。请确认 Ollama 已启动且已安装 nomic-embed-text 模型。`);
      setBuilding(false);
    } finally {
      setBuilding(false);
    }
  };

  const handleDelete = async (name: string) => {
    if (!confirm(`确认删除知识库「${name}」？此操作不可撤销。`)) return;
    await fetch(`${backendUrl}/rag/collections/${encodeURIComponent(name)}`, { method: 'DELETE' });
    if (selectedCollection === name) setSelectedCollection('');
    fetchCollections();
  };

  const handleQuery = async () => {
    const q = question.trim() || 'Python 是什么？';
    if (!selectedCollection || !llmModel) return;
    setQuestion(''); setAnswer(''); setLoading(true);
    try {
      const res = await fetch(`${backendUrl}/rag/query`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          collection: selectedCollection, question: q, top_k: 5,
          provider: selectedProvider, model: llmModel, api_key: apiKey,
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
          if (line.startsWith('data: ')) setAnswer(prev => prev + line.slice(6));
        }
      }
    } finally { setLoading(false); }
  };

  return (
    <div className="flex flex-col gap-6 p-6 h-full">
      <ProcessFlow steps={RAG_FLOW} color="#0d9488" />

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

      {/* 知识库管理 */}
      <div className="flex flex-col gap-4">
        <h3 className="text-base font-bold text-slate-800 dark:text-slate-100">
          知识库管理
          <span className="text-[11px] font-normal text-slate-400 ml-2">RAG</span>
        </h3>

        <TabBar
          tabs={[{ value: 'select' as const, label: '选择知识库' }, { value: 'create' as const, label: '创建知识库' }]}
          value={kbTab}
          onChange={setKbTab}
        />

        {/* 选择知识库 */}
        {kbTab === 'select' && (
          <div className="flex flex-col gap-2.5">
            <div className="flex justify-between items-center">
              <span className={labelCls}>选择知识库</span>
              <div className="flex gap-1.5">
                <button
                  disabled={building}
                  onClick={async () => {
                    setBuilding(true); setBuildMsg('');
                    try {
                      const res = await fetch(`${backendUrl}/rag/init-sample`, { method: 'POST' });
                      const data = await res.json();
                      if (data.status === 'already_exists') {
                        setSelectedCollection('示例知识库'); await fetchCollections();
                      } else if (data.job_id) {
                        const deadline = Date.now() + 5 * 60 * 1000;
                        while (Date.now() < deadline) {
                          await new Promise(r => setTimeout(r, 1500));
                          try {
                            const jr = await fetch(`${backendUrl}/rag/collections/jobs/${data.job_id}`);
                            if (!jr.ok) continue;
                            const jd = await jr.json();
                            if (jd.status === 'done') { await fetchCollections(); setSelectedCollection('示例知识库'); break; }
                            if (jd.status === 'error') { setBuildMsg(`示例库构建失败：${jd.error || '未知错误'}`); break; }
                          } catch { /* continue */ }
                        }
                      }
                    } catch (e: any) { setBuildMsg(`创建失败：${e.message}`); }
                    finally { setBuilding(false); }
                  }}
                  className="text-xs px-2 py-1 rounded border border-teal-500 text-teal-600 dark:text-teal-400 font-medium hover:bg-teal-50 dark:hover:bg-teal-900/20 transition-colors disabled:opacity-50">
                  {building ? '构建中…' : '示例库'}
                </button>
                <button onClick={fetchCollections}
                  className="text-xs px-2 py-1 rounded border border-slate-200 dark:border-slate-600 text-slate-500 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors">
                  刷新
                </button>
              </div>
            </div>
            <ComboSelect
              value={selectedCollection}
              onChange={setSelectedCollection}
              options={collections.map(c => ({ value: c.name, label: `${c.name} (${c.doc_count} 文档 · ${c.size_mb} MB)` }))}
              placeholder="-- 请选择知识库 --"
            />
            {selectedCollection && (
              <div className="flex justify-end">
                <button onClick={() => handleDelete(selectedCollection)}
                  className="text-xs font-semibold text-red-500 hover:text-red-700 dark:hover:text-red-400 transition-colors">
                  删除知识库
                </button>
              </div>
            )}
          </div>
        )}

        {/* 创建知识库 */}
        {kbTab === 'create' && (
          <div className="bg-slate-50 dark:bg-slate-800 rounded-lg p-4 flex flex-col gap-2.5 border border-slate-200 dark:border-slate-700">
            <span className="text-sm font-semibold text-slate-700 dark:text-slate-200">新建知识库</span>

            <div className="text-[11px] text-slate-500 dark:text-slate-400 bg-white dark:bg-slate-900 p-2 rounded border-l-[3px] border-teal-500 leading-relaxed">
              <div className="font-semibold mb-1">知识库大小参考：</div>
              <div>小（1-10 MB）：FAQ、单篇文档</div>
              <div>中（10-100 MB）：产品手册、技术文档集合</div>
              <div>大（100+ MB）：整本书、大型文档库</div>
            </div>

            <NameInput placeholder="test_kb" value={buildName} onChange={setBuildName} />
            {!buildName.trim() && (
              <p className="text-[11px] text-slate-400">留空将使用默认名称 test_kb</p>
            )}

            <FileDrop
              files={buildFiles}
              onAdd={fs => setBuildFiles([...buildFiles, ...fs])}
              onRemove={i => setBuildFiles(buildFiles.filter((_, j) => j !== i))}
              accept=".pdf,.txt,.docx,.xlsx" multiple iconType="file"
              emptyLabel="点击或拖拽上传文件（可多选）"
              formatHint="支持 PDF、Word (.docx)、纯文本 (.txt)、Excel (.xlsx)"
            />
            <button
              onClick={() => {
                const content = 'Python 是一门广泛使用的编程语言。\nPython 支持多种编程范式。\nPython 拥有丰富的第三方库和活跃的社区。\nPython 适合数据科学、Web 开发、自动化脚本等多种场景。';
                const file = new File([content], `sample_${buildFiles.length + 1}.txt`, { type: 'text/plain' });
                setBuildFiles(prev => [...prev, file]);
              }}
              className="text-xs border border-dashed border-teal-500 rounded-lg px-3 py-1.5 text-teal-600 dark:text-teal-400 font-medium hover:bg-teal-50 dark:hover:bg-teal-900/20 transition-colors">
              + 导入样例文件
            </button>

            <button onClick={handleBuild} disabled={building || buildFiles.length === 0}
              className="w-full rounded-xl bg-indigo-600 hover:bg-indigo-700 py-2 text-sm font-semibold text-white shadow-sm transition-all disabled:opacity-50 disabled:cursor-not-allowed">
              {building ? '提交中...' : '构建知识库'}
            </button>

            {buildMsg && (
              <p className="text-xs text-slate-500 dark:text-slate-400 whitespace-pre-line leading-relaxed">{buildMsg}</p>
            )}
          </div>
        )}
      </div>

      {/* 问答区 */}
      {kbTab === 'select' && (
        <div className="flex-1 flex flex-col gap-4 min-h-0">
          <h3 className="text-base font-bold text-slate-800 dark:text-slate-100">
            知识库问答
            <span className="text-[11px] font-normal text-slate-400 ml-2">Answer Generation</span>
          </h3>

          {selectedCollection && (
            <div className="flex gap-2">
              <input
                placeholder="Python 是什么？"
                value={question}
                onChange={e => setQuestion(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleQuery(); } }}
                disabled={loading}
                className={fieldCls + ' flex-1 disabled:opacity-60 disabled:cursor-not-allowed'}
              />
              <button onClick={handleQuery} disabled={loading}
                className="rounded-xl bg-teal-600 hover:bg-teal-700 px-4 py-2 text-sm font-semibold text-white shadow-sm transition-all disabled:opacity-50 disabled:cursor-not-allowed">
                {loading ? '提问中…' : '提问'}
              </button>
            </div>
          )}

          {selectedCollection && (answer || loading) && (
            <div className="flex-1 p-4 bg-slate-50 dark:bg-slate-800 rounded-lg text-sm leading-relaxed overflow-y-auto whitespace-pre-wrap border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200">
              {answer || (loading && '正在检索文档并生成回答，请稍候…')}
            </div>
          )}

          {!selectedCollection && (
            <div className="flex-1 flex flex-col items-center justify-center text-slate-400 dark:text-slate-500 gap-2">
              <span className="text-3xl">📚</span>
              <span className="text-sm">请先选择一个知识库</span>
              <span className="text-xs text-slate-300 dark:text-slate-600">如果还没有，请先创建一个</span>
            </div>
          )}
        </div>
      )}

      <HowToSteps steps={RAG_STEPS} />
    </div>
  );
}
