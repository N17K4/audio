/**
 * FinetunePanel — LoRA 微调页面
 *
 * LoRA（Low-Rank Adaptation）：只训练模型的一小部分参数（约 1%），
 * 就能让通用大模型学会特定风格或专业知识，显存需求远低于全量微调。
 *
 * QLoRA：在 LoRA 基础上额外做 4-bit 量化，进一步降低显存占用。
 *
 * 训练数据格式（JSONL，每行一条）：
 *   {"instruction": "问题", "output": "期望的回答"}
 *   也支持：{"prompt": "...", "completion": "..."}
 *
 * 导出格式：
 *   adapter — 只保存 LoRA 权重（几 MB），需配合基座模型使用
 *   merged  — 合并后的完整模型，可独立加载，体积与基座相同
 */

import { useState, useEffect, useCallback } from 'react';
import { FinetuneJob } from '../../types';
import HowToSteps from '../shared/HowToSteps';
import ProcessFlow, { FlowStep } from '../shared/ProcessFlow';

// ─── 实际运行流程（QLoRA 微调管道）──────────────────────────────────────────
const FINETUNE_FLOW: FlowStep[] = [
  { label: '下载基座模型', tech: 'HuggingFace Hub' },
  { label: '4-bit 量化',   tech: 'bitsandbytes' },
  { label: '挂载 LoRA 层', tech: 'peft.LoraConfig' },
  { label: '读取数据集',   tech: 'JSONL / datasets' },
  { label: '本地训练',     tech: 'trl.SFTTrainer' },
  { label: '保存权重',     tech: 'adapter / merged' },
];

// ─── 使用步骤引导 ──────────────────────────────────────────────────────────
const FINETUNE_STEPS = [
  {
    title: '准备数据',
    desc: '准备 JSONL 文件，每行一条问答对：{"instruction":"...","output":"..."}',
  },
  {
    title: '配置并启动',
    desc: '选择基座模型，上传数据集，超参数保持默认即可，点击「开始微调」',
  },
  {
    title: '查看进度',
    desc: '右侧任务卡片实时展示训练进度、Loss 曲线和日志，Loss 下降说明在学习',
  },
];

// ─── 预设基座模型 ──────────────────────────────────────────────────────────
// 按参数量从小到大排列，参数越少训练越快但能力越弱
const PRESET_MODELS = [
  { id: 'Qwen/Qwen2.5-0.5B', label: 'Qwen2.5-0.5B（最小，训练最快）' },
  { id: 'Qwen/Qwen2.5-1.5B', label: 'Qwen2.5-1.5B（均衡）' },
  { id: 'Qwen/Qwen2.5-3B',   label: 'Qwen2.5-3B（效果更好）' },
  { id: 'meta-llama/Llama-3.2-1B', label: 'Llama-3.2-1B（英文为主）' },
];

// ─── 超参数说明（显示在输入框下方，帮助外行理解）──────────────────────────
const PARAM_TIPS: Record<string, string> = {
  lora_r:
    'LoRA 秩：控制新增参数的数量，越大学得越细但越慢。外行用默认值 16 即可',
  lora_alpha:
    '缩放系数：一般设为 lora_r 的 2 倍。不需要改动',
  num_epochs:
    '训练轮次：整个数据集被过几遍。数据少用 5～10 轮，数据多用 3 轮',
  batch_size:
    '每步喂多少条数据：越大越快，但占内存越多。内存紧张时改为 1',
  learning_rate:
    '学习率：每步调整多大幅度。过大会不稳定，过小收敛慢。2e-4 是常见起点',
  max_seq_length:
    '最大序列长度：每条样本最多处理多少个 token。超过会被截断。512 适合大多数场景',
};

// ─── 任务状态颜色与标签 ────────────────────────────────────────────────────
const STATUS_COLORS: Record<string, string> = {
  running:   '#3182ce',  // 蓝色：训练中
  done:      '#38a169',  // 绿色：已完成
  error:     '#e53e3e',  // 红色：失败
  cancelled: '#718096',  // 灰色：已取消
};

const STATUS_LABELS: Record<string, string> = {
  running:   '训练中',
  done:      '已完成',
  error:     '训练失败',
  cancelled: '已取消',
};

interface Props {
  backendUrl: string;
}

export default function FinetunePanel({ backendUrl }: Props) {
  // ── 表单状态 ──────────────────────────────────────────────────────────────
  const [model, setModel] = useState(PRESET_MODELS[0].id);  // 选中的预设模型
  const [customModel, setCustomModel] = useState('');         // 自定义模型 ID（覆盖预设）
  const [dataset, setDataset] = useState<File | null>(null);  // 训练数据文件

  // ── HuggingFace 配置（下载基座模型用）─────────────────────────────────────
  // 中国大陆无法直接访问 huggingface.co，需要设置镜像
  const [hfToken, setHfToken] = useState('');                        // HF Token（私有模型需要）
  const [hfMirror, setHfMirror] = useState('https://hf-mirror.com'); // 镜像地址

  // ── 超参数状态（默认值对大多数场景适用）────────────────────────────────────
  const [loraR, setLoraR] = useState(16);         // LoRA 秩
  const [loraAlpha, setLoraAlpha] = useState(32); // LoRA 缩放系数
  const [numEpochs, setNumEpochs] = useState(3);  // 训练轮次
  const [batchSize, setBatchSize] = useState(2);  // 批大小
  const [lr, setLr] = useState(0.0002);            // 学习率
  const [maxSeqLen, setMaxSeqLen] = useState(512); // 最大序列长度
  const [exportFmt, setExportFmt] = useState<'adapter' | 'merged'>('adapter'); // 导出格式

  // ── 任务状态 ──────────────────────────────────────────────────────────────
  const [jobs, setJobs] = useState<FinetuneJob[]>([]);       // 全部任务列表
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null); // 当前查看的任务
  const [submitting, setSubmitting] = useState(false);        // 是否正在提交

  // ── 拉取任务列表 ─────────────────────────────────────────────────────────
  // 调用 GET /finetune/jobs，返回当前进程内所有微调任务（重启后清空）
  const fetchJobs = useCallback(async () => {
    try {
      const res = await fetch(`${backendUrl}/finetune/jobs`);
      if (res.ok) setJobs(await res.json());
    } catch {
      // 后端未就绪时静默失败
    }
  }, [backendUrl]);

  // 页面加载时拉取一次
  useEffect(() => { fetchJobs(); }, [fetchJobs]);

  // ── 自动轮询运行中的任务（每 2 秒刷新一次进度）────────────────────────────
  // 只有选中的任务处于 running 状态时才启动轮询
  useEffect(() => {
    const selected = jobs.find(j => j.job_id === selectedJobId);
    if (selected?.status !== 'running') return;

    const timer = setInterval(async () => {
      const res = await fetch(`${backendUrl}/finetune/jobs/${selectedJobId}`);
      if (!res.ok) return;
      const job: FinetuneJob = await res.json();
      // 用新数据替换列表中的对应条目
      setJobs(prev => prev.map(j => j.job_id === selectedJobId ? job : j));
      // 训练结束时停止轮询
      if (job.status !== 'running') clearInterval(timer);
    }, 2000);

    return () => clearInterval(timer);
  }, [selectedJobId, jobs, backendUrl]);

  // ── 提交微调任务 ──────────────────────────────────────────────────────────
  // POST /finetune/start（multipart/form-data）
  const handleStart = async () => {
    if (!dataset) return;
    setSubmitting(true);
    try {
      const form = new FormData();
      // 自定义模型 ID 优先；否则用预设
      form.append('model', customModel.trim() || model);
      form.append('dataset', dataset);
      form.append('lora_r',        String(loraR));
      form.append('lora_alpha',    String(loraAlpha));
      form.append('num_epochs',    String(numEpochs));
      form.append('batch_size',    String(batchSize));
      form.append('learning_rate', String(lr));
      form.append('max_seq_length', String(maxSeqLen));
      form.append('export_format', exportFmt);
      if (hfToken) form.append('hf_token', hfToken);
      if (hfMirror) form.append('hf_mirror', hfMirror);

      const res = await fetch(`${backendUrl}/finetune/start`, {
        method: 'POST',
        body: form,
      });
      const data = await res.json();
      setSelectedJobId(data.job_id);  // 自动切换到新任务
      await fetchJobs();               // 刷新列表
    } finally {
      setSubmitting(false);
    }
  };

  // ── 终止并删除任务 ────────────────────────────────────────────────────────
  // DELETE /finetune/jobs/{job_id}：终止子进程 + 删除输出目录
  const handleCancel = async (jobId: string) => {
    await fetch(`${backendUrl}/finetune/jobs/${jobId}`, { method: 'DELETE' });
    setJobs(prev => prev.filter(j => j.job_id !== jobId));
    if (selectedJobId === jobId) setSelectedJobId(null);
  };

  // 当前查看的任务详情
  const selectedJob = jobs.find(j => j.job_id === selectedJobId) || null;

  // ─────────────────────────────────────────────────────────────────────────
  return (
    <div style={{ display: 'flex', gap: 24, padding: 24, height: '100%', flexDirection: 'column' }}>

      {/* ── 实际运行流程可视化 ── */}
      <ProcessFlow steps={FINETUNE_FLOW} color="#d97706" />

      {/* ── 主体：左右两栏 ── */}
      <div style={{ display: 'flex', gap: 24, flex: 1, minHeight: 0 }}>

        {/* ━━ 左栏：配置区 ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}
        <div style={{
          width: 300, display: 'flex', flexDirection: 'column',
          gap: 14, overflowY: 'auto', paddingRight: 4
        }}>
          <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>
            LoRA 微调
            <span style={{ fontSize: 11, fontWeight: 400, color: '#999', marginLeft: 8 }}>
              QLoRA · Fine-tuning
            </span>
          </h3>

          {/* ── HuggingFace 配置 ── */}
          {/* 基座模型从 HuggingFace 下载，中国用户需配置镜像，私有模型需要 Token */}
          <div style={{
            padding: 12, background: '#f9f9f9', borderRadius: 8,
            border: '1px solid #e8e8e8', display: 'flex', flexDirection: 'column', gap: 10,
          }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: '#555' }}>
              HuggingFace 配置
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <label style={{ fontSize: 11, fontWeight: 600, color: '#555' }}>
                镜像地址
                <span style={{ fontWeight: 400, color: '#999', marginLeft: 6 }}>（中国大陆推荐）</span>
              </label>
              <select
                value={hfMirror}
                onChange={e => setHfMirror(e.target.value)}
                style={{ padding: '5px 8px', borderRadius: 6, border: '1px solid #ddd', fontSize: 12 }}
              >
                <option value="https://hf-mirror.com">hf-mirror.com（国内镜像，推荐）</option>
                <option value="https://huggingface.co">huggingface.co（官方）</option>
                <option value="">不设置（使用系统环境变量）</option>
              </select>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <label style={{ fontSize: 11, fontWeight: 600, color: '#555' }}>
                HF Token
                <span style={{ fontWeight: 400, color: '#999', marginLeft: 6 }}>（可选，私有模型需要）</span>
              </label>
              <input
                type="password"
                value={hfToken}
                onChange={e => setHfToken(e.target.value)}
                placeholder="hf_..."
                style={{ padding: '5px 8px', borderRadius: 6, border: '1px solid #ddd', fontSize: 12 }}
              />
              <div style={{ fontSize: 11, color: '#999' }}>
                在 huggingface.co/settings/tokens 获取，公开模型无需填写
              </div>
            </div>
          </div>

          {/* ── 基座模型选择 ── */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <label style={{ fontSize: 12, fontWeight: 600, color: '#555' }}>
              基座模型
            </label>
            <select
              value={model}
              onChange={e => setModel(e.target.value)}
              style={{ padding: '6px 10px', borderRadius: 6, border: '1px solid #ddd', fontSize: 13 }}
            >
              {PRESET_MODELS.map(m => (
                <option key={m.id} value={m.id}>{m.label}</option>
              ))}
            </select>
            {/* 自定义 HuggingFace 模型 ID，填写后覆盖上方下拉框 */}
            <input
              placeholder="或输入 HuggingFace 模型 ID，如 Qwen/Qwen2.5-7B"
              value={customModel}
              onChange={e => setCustomModel(e.target.value)}
              style={{
                padding: '6px 10px', borderRadius: 6,
                border: '1px solid #ddd', fontSize: 12, color: '#666'
              }}
            />
          </div>

          {/* ── 训练数据上传 ── */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <label style={{ fontSize: 12, fontWeight: 600, color: '#555' }}>
              训练数据（JSONL 格式）
            </label>
            <input
              type="file"
              accept=".jsonl,.json"
              onChange={e => setDataset(e.target.files?.[0] || null)}
              style={{ fontSize: 12 }}
            />
            {/* 数据格式说明 */}
            <div style={{
              fontSize: 11, color: '#888', background: '#f9f9f9',
              borderRadius: 4, padding: '6px 8px', lineHeight: 1.6
            }}>
              每行一条：<code>{"{"}"instruction": "问题", "output": "答案"{"}"}</code>
              <br />至少准备 50～200 条，数据质量比数量更重要
            </div>
          </div>

          {/* ── 超参数网格：4 个常用参数 2×2 排列 ── */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            {[
              { key: 'lora_r',     label: 'LoRA Rank', val: loraR,      set: setLoraR,      step: 4  },
              { key: 'lora_alpha', label: 'LoRA Alpha', val: loraAlpha,  set: setLoraAlpha,  step: 8  },
              { key: 'num_epochs', label: '训练轮次',   val: numEpochs,  set: setNumEpochs,  step: 1  },
              { key: 'batch_size', label: 'Batch Size', val: batchSize,   set: setBatchSize,  step: 1  },
            ].map(({ key, label, val, set, step }) => (
              <div key={key} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <label
                  title={PARAM_TIPS[key]}  // 悬停显示详细说明
                  style={{ fontSize: 11, fontWeight: 600, color: '#555', cursor: 'help' }}
                >
                  {label} ❓
                </label>
                <input
                  type="number"
                  value={val}
                  step={step}
                  min={1}
                  onChange={e => set(Number(e.target.value))}
                  style={{ padding: '5px 8px', borderRadius: 6, border: '1px solid #ddd', fontSize: 13 }}
                />
              </div>
            ))}
          </div>

          {/* ── 学习率 ── */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <label
              title={PARAM_TIPS['learning_rate']}
              style={{ fontSize: 12, fontWeight: 600, color: '#555', cursor: 'help' }}
            >
              学习率 ❓
            </label>
            <input
              type="number"
              value={lr}
              step={0.00001}
              min={0.000001}
              onChange={e => setLr(Number(e.target.value))}
              style={{ padding: '6px 10px', borderRadius: 6, border: '1px solid #ddd', fontSize: 13 }}
            />
          </div>

          {/* ── 最大序列长度 ── */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <label
              title={PARAM_TIPS['max_seq_length']}
              style={{ fontSize: 12, fontWeight: 600, color: '#555', cursor: 'help' }}
            >
              最大序列长度 ❓
            </label>
            <input
              type="number"
              value={maxSeqLen}
              step={64}
              min={128}
              onChange={e => setMaxSeqLen(Number(e.target.value))}
              style={{ padding: '6px 10px', borderRadius: 6, border: '1px solid #ddd', fontSize: 13 }}
            />
          </div>

          {/* ── 导出格式 ── */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <label style={{ fontSize: 12, fontWeight: 600, color: '#555' }}>导出格式</label>
            <select
              value={exportFmt}
              onChange={e => setExportFmt(e.target.value as 'adapter' | 'merged')}
              style={{ padding: '6px 10px', borderRadius: 6, border: '1px solid #ddd', fontSize: 13 }}
            >
              {/* adapter：只存 LoRA 层，体积小（几 MB），但每次推理需要加载基座+adapter */}
              <option value="adapter">仅 LoRA Adapter（体积小，几 MB）</option>
              {/* merged：把 LoRA 合并进基座，得到完整模型，可直接用 Ollama 加载 */}
              <option value="merged">合并为完整模型（可直接部署）</option>
            </select>
          </div>

          {/* ── 提交按钮 ── */}
          <button
            onClick={handleStart}
            disabled={submitting || !dataset}
            style={{
              padding: '10px', borderRadius: 8,
              background: '#4f46e5', color: '#fff',
              border: 'none', cursor: 'pointer',
              fontSize: 14, fontWeight: 600,
              opacity: (submitting || !dataset) ? 0.5 : 1,
            }}
          >
            {submitting ? '提交中...' : '开始微调'}
          </button>
        </div>

        {/* ━━ 右栏：任务监控 ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 16, minWidth: 0 }}>

          {/* 标题 + 刷新按钮 */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>
              微调任务
              <span style={{ fontSize: 11, fontWeight: 400, color: '#999', marginLeft: 8 }}>
                Jobs · Training Monitor
              </span>
            </h3>
            <button
              onClick={fetchJobs}
              style={{
                fontSize: 12, background: 'none',
                border: '1px solid #ddd', borderRadius: 4,
                padding: '3px 8px', cursor: 'pointer'
              }}
            >
              刷新
            </button>
          </div>

          {/* 任务卡片列表（横向排列，可多选查看）*/}
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {jobs.length === 0 && (
              <div style={{ color: '#999', fontSize: 13, padding: 8 }}>
                暂无微调任务，点击左侧「开始微调」创建第一个
              </div>
            )}
            {jobs.map(job => (
              <div
                key={job.job_id}
                onClick={() => setSelectedJobId(job.job_id)}
                style={{
                  padding: '10px 14px', borderRadius: 8,
                  border: `2px solid ${selectedJobId === job.job_id ? '#4f46e5' : '#e0e0e0'}`,
                  cursor: 'pointer',
                  background: selectedJobId === job.job_id ? '#f0f0ff' : '#fff',
                  minWidth: 180,
                }}
              >
                {/* 任务 ID（前 8 位）*/}
                <div style={{ fontSize: 11, color: '#999', fontFamily: 'monospace' }}>
                  {job.job_id.slice(0, 8)}…
                </div>
                {/* 模型名（取最后一段，如 Qwen2.5-0.5B）*/}
                <div style={{ fontSize: 13, fontWeight: 600, margin: '4px 0' }}>
                  {job.model.split('/').pop()}
                </div>
                {/* 状态文字 */}
                <div style={{ fontSize: 12, color: STATUS_COLORS[job.status] || '#666' }}>
                  {STATUS_LABELS[job.status] || job.status}
                </div>
                {/* 训练中时显示进度条 */}
                {job.status === 'running' && (
                  <div style={{ marginTop: 6, background: '#e0e0e0', borderRadius: 4, height: 6 }}>
                    <div style={{
                      width: `${Math.round(job.progress * 100)}%`,
                      background: '#4f46e5', height: '100%', borderRadius: 4,
                      transition: 'width 0.5s ease',
                    }} />
                  </div>
                )}
              </div>
            ))}
          </div>

          {/* ── 选中任务的详情面板 ── */}
          {selectedJob && (
            <div style={{
              flex: 1, padding: 16, background: '#f9f9f9',
              borderRadius: 8, display: 'flex', flexDirection: 'column', gap: 16,
              overflowY: 'auto', border: '1px solid #e8e8e8'
            }}>
              {/* 任务头：模型名 + 进度 + 终止按钮 */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div>
                  <div style={{ fontSize: 14, fontWeight: 700 }}>{selectedJob.model}</div>
                  <div style={{ fontSize: 12, color: '#666', marginTop: 2 }}>
                    进度：{Math.round(selectedJob.progress * 100)}%
                    &nbsp;·&nbsp;导出格式：{selectedJob.export_format === 'merged' ? '完整模型' : 'Adapter'}
                  </div>
                </div>
                {selectedJob.status === 'running' && (
                  <button
                    onClick={() => handleCancel(selectedJob.job_id)}
                    style={{
                      padding: '6px 12px', borderRadius: 6,
                      background: '#e53e3e', color: '#fff',
                      border: 'none', cursor: 'pointer', fontSize: 13
                    }}
                  >
                    终止训练
                  </button>
                )}
              </div>

              {/* ── Loss 曲线（简易柱状图）── */}
              {/* Loss 是衡量模型学习效果的指标，曲线持续下降说明训练正常 */}
              {selectedJob.loss_curve.length > 0 && (
                <div>
                  <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 8 }}>
                    Loss 曲线
                    <span style={{ fontSize: 11, fontWeight: 400, color: '#888', marginLeft: 8 }}>
                      （持续下降为正常，最终趋于平稳）
                    </span>
                  </div>
                  {/* 柱状图：每根柱子高度 = loss 值 / 最大 loss * 70px */}
                  <div style={{
                    height: 80, display: 'flex',
                    alignItems: 'flex-end', gap: 2, padding: '0 4px'
                  }}>
                    {selectedJob.loss_curve.map((loss, i) => {
                      const maxLoss = Math.max(...selectedJob.loss_curve);
                      const h = maxLoss > 0 ? (loss / maxLoss) * 70 : 0;
                      return (
                        <div
                          key={i}
                          title={`Step ${i + 1}：loss = ${loss}`}
                          style={{
                            flex: 1, maxWidth: 20, minWidth: 4,
                            height: `${h}px`,
                            // 颜色渐变：早期橙色（高 loss）→ 后期蓝色（低 loss）
                            background: i < selectedJob.loss_curve.length * 0.3
                              ? '#f6ad55'  // 前 30% 橙色
                              : '#4f46e5', // 后 70% 蓝色
                            borderRadius: '2px 2px 0 0',
                          }}
                        />
                      );
                    })}
                  </div>
                  <div style={{ fontSize: 11, color: '#666', marginTop: 6 }}>
                    初始 loss：{selectedJob.loss_curve[0]?.toFixed(4)}
                    &nbsp;→&nbsp;
                    当前 loss：{selectedJob.loss_curve[selectedJob.loss_curve.length - 1]?.toFixed(4)}
                    &nbsp;（共 {selectedJob.loss_curve.length} 步）
                  </div>
                </div>
              )}

              {/* ── 最新日志（最后 20 行）── */}
              {selectedJob.log_tail.length > 0 && (
                <div>
                  <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 6 }}>训练日志</div>
                  <div style={{
                    background: '#1a1a1a', color: '#e0e0e0',
                    padding: '10px 12px', borderRadius: 6,
                    fontSize: 11, fontFamily: 'monospace',
                    maxHeight: 200, overflowY: 'auto', lineHeight: 1.6
                  }}>
                    {selectedJob.log_tail.slice(-20).map((line, i) => (
                      <div key={i}>{line}</div>
                    ))}
                  </div>
                </div>
              )}

              {/* 完成提示 */}
              {selectedJob.status === 'done' && (
                <div style={{
                  padding: '10px 14px', background: '#f0fff4',
                  borderRadius: 8, border: '1px solid #9ae6b4',
                  fontSize: 13, color: '#276749'
                }}>
                  ✅ 训练完成！模型已保存至：
                  <code style={{ fontSize: 11, display: 'block', marginTop: 4, color: '#555' }}>
                    {selectedJob.output_dir}
                  </code>
                </div>
              )}

              {/* 失败提示 */}
              {selectedJob.status === 'error' && (
                <div style={{
                  padding: '10px 14px', background: '#fff5f5',
                  borderRadius: 8, border: '1px solid #feb2b2',
                  fontSize: 13, color: '#9b2c2c'
                }}>
                  ❌ 训练失败，请查看上方日志了解原因。
                  <br />常见问题：数据格式不对、内存不足（降低 Batch Size 或换更小的模型）。
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* ── 使用步骤引导（与 VcPanel 风格一致）── */}
      <HowToSteps steps={FINETUNE_STEPS} />
    </div>
  );
}
