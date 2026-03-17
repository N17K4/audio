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
import ComboSelect from '../shared/ComboSelect';
import ProcessFlow, { FlowStep } from '../shared/ProcessFlow';
import OutputDirRow from '../shared/OutputDirRow';
import FileDrop from '../shared/FileDrop';

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
  addPendingJob?: (type: string, label: string, provider: string, isLocal: boolean) => string;
  resolveJob?: (id: string, result: { status: 'completed' | 'failed'; error?: string }) => void;
}

export default function FinetunePanel({ backendUrl, addPendingJob, resolveJob }: Props) {
  // ── 表单状态 ──────────────────────────────────────────────────────────────
  const [model, setModel] = useState(PRESET_MODELS[0].id);  // 选中的预设模型
  const [customModel, setCustomModel] = useState('');         // 自定义模型 ID（覆盖预设）
  const [dataset, setDataset] = useState<File | null>(null);  // 训练数据文件

  // ── 输出目录（为空时后端自动生成临时目录）─────────────────────────────────
  const [outputDir, setOutputDir] = useState('/tmp/finetune_output');

  // ── HuggingFace 配置（下载基座模型用）─────────────────────────────────────
  // 中国大陆无法直接访问 huggingface.co，需要设置镜像
  const [hfToken, setHfToken] = useState('');                        // HF Token（私有模型需要）
  const [hfMirror, setHfMirror] = useState('https://hf-mirror.com'); // 镜像地址

  // ── 超参数状态（默认值对大多数场景适用）────────────────────────────────────
  const [loraR, setLoraR] = useState(16);         // LoRA 秩（smoke_test2）
  const [loraAlpha, setLoraAlpha] = useState(32); // LoRA 缩放系数（smoke_test2）
  const [numEpochs, setNumEpochs] = useState(3);  // 训练轮次
  const [batchSize, setBatchSize] = useState(2);  // 批大小
  const [lr, setLr] = useState(0.0002);            // 学习率
  const [maxSeqLen, setMaxSeqLen] = useState(512); // 最大序列长度
  const [exportFmt, setExportFmt] = useState<'adapter' | 'merged'>('adapter'); // 导出格式

  // ── 任务状态 ──────────────────────────────────────────────────────────────
  const [submitting, setSubmitting] = useState(false);        // 是否正在提交
  const [datasets, setDatasets] = useState<File[]>([]);      // 支持多文件
  const [quickStart, setQuickStart] = useState(false);        // 是否启用快速开始
  const [submitMsg, setSubmitMsg] = useState('');              // 提交反馈消息

  // 注：任务监控已移至 TaskList 页面，此处仅负责提交任务

  // ── 提交微调任务 ──────────────────────────────────────────────────────────
  // POST /finetune/start（multipart/form-data）
  // 支持多个数据集文件，后端会合并处理
  const handleStart = async () => {
    setSubmitting(true);
    setSubmitMsg('');
    try {
      // 如果启用快速开始且未上传数据，生成示例数据
      let datasetsToSubmit = datasets;
      if (quickStart && datasets.length === 0) {
        const sampleData = [
          { instruction: "什么是 AI？", output: "AI 是人工智能，指由人制造出来的机器所表现出来的智能。" },
          { instruction: "Python 是什么？", output: "Python 是一种高级编程语言，以其简洁易读的语法著称。" },
          { instruction: "如何学习编程？", output: "学习编程的最好方法是通过大量的实践和项目开发。" },
          { instruction: "云计算有什么优势？", output: "云计算提供弹性扩展、成本优化和高可用性。" },
          { instruction: "深度学习是什么？", output: "深度学习是机器学习的一个分支，使用多层神经网络。" },
          { instruction: "数据库的作用是什么？", output: "数据库用于存储、管理和检索大量的结构化数据。" },
          { instruction: "前端和后端的区别？", output: "前端处理用户界面，后端处理业务逻辑和数据。" },
          { instruction: "什么是 API？", output: "API 是应用程序编程接口，允许不同应用间通信。" },
        ];
        const jsonlContent = sampleData.map(d => JSON.stringify(d)).join('\n');
        const blob = new Blob([jsonlContent], { type: 'application/jsonl' });
        const file = new File([blob], 'sample_train_data.jsonl', { type: 'application/jsonl' });
        datasetsToSubmit = [file];
      }

      if (datasetsToSubmit.length === 0) return;

      const form = new FormData();
      const modelId = customModel.trim() || model;
      form.append('model', modelId);
      datasetsToSubmit.forEach(f => form.append('datasets', f));
      form.append('lora_r',        String(loraR));
      form.append('lora_alpha',    String(loraAlpha));
      form.append('num_epochs',    String(numEpochs));
      form.append('batch_size',    String(batchSize));
      form.append('learning_rate', String(lr));
      form.append('max_seq_length', String(maxSeqLen));
      form.append('export_format', exportFmt);
      if (outputDir) form.append('output_dir', outputDir);
      if (hfToken) form.append('hf_token', hfToken);
      if (hfMirror) form.append('hf_mirror', hfMirror);

      const res = await fetch(`${backendUrl}/finetune/start`, {
        method: 'POST',
        body: form,
      });
      const data = await res.json();

      // 添加到 TaskList（如果有 addPendingJob）
      if (addPendingJob) {
        addPendingJob(
          'finetune',
          `LoRA 微调 - ${modelId.split('/').pop()}`,
          modelId,
          false  // 云端任务
        );
        setSubmitMsg(`已提交！任务 ID：${data.job_id?.slice(0, 8)}…\n请前往「任务列表」查看进度。`);
      } else {
        setSubmitMsg(`已提交！任务 ID：${data.job_id?.slice(0, 8)}…`);
      }
    } catch (e: any) {
      setSubmitMsg(`提交失败：${e.message}`);
    } finally {
      setSubmitting(false);
    }
  };

  // ─────────────────────────────────────────────────────────────────────────
  return (
    <div style={{ display: 'flex', gap: 24, padding: 24, height: '100%', flexDirection: 'column' }}>

      {/* ── 实际运行流程可视化 ── */}
      <ProcessFlow steps={FINETUNE_FLOW} color="#d97706" />

      {/* ── 主体：配置 → 任务监控（纵向） ── */}
      <div style={{ display: 'flex', gap: 24, flex: 1, minHeight: 0, flexDirection: 'column' }}>

        {/* ━━ 配置区 ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}
        <div style={{
          display: 'flex', flexDirection: 'column',
          gap: 14, overflowY: 'auto', paddingRight: 4
        }}>
          <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>
            LoRA 微调
            <span style={{ fontSize: 11, fontWeight: 400, color: '#999', marginLeft: 8 }}>
              QLoRA · Fine-tuning
            </span>
          </h3>

          {/* ── HuggingFace 配置（一行三列） ── */}
          <div className="p-4 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg flex flex-col gap-4">
            <div className="text-sm font-bold text-slate-700 dark:text-slate-300">
              HuggingFace 配置
            </div>

            {/* 三列并排：镜像 / Token / 基座模型 */}
            <div className="flex gap-3">
              {/* 镜像地址 */}
              <label className="flex flex-col gap-1 flex-1">
                <span className="text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wide">镜像</span>
                <ComboSelect
                  value={hfMirror}
                  onChange={setHfMirror}
                  options={[
                    { value: 'https://hf-mirror.com', label: 'hf-mirror.com' },
                    { value: 'https://huggingface.co', label: 'huggingface.co' },
                    { value: '', label: '不设置' },
                  ]}
                  placeholder="选择镜像"
                  compact={true}
                />
              </label>

              {/* HF Token */}
              <label className="flex flex-col gap-1 flex-1">
                <span className="text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wide">Token</span>
                <input
                  type="password"
                  value={hfToken}
                  onChange={e => setHfToken(e.target.value)}
                  placeholder="hf_..."
                  className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm text-slate-800 dark:text-slate-200 focus:border-[#1A8FE3] focus:ring-2 focus:ring-[#1A8FE3]/15 transition-all outline-none placeholder:text-slate-400"
                />
              </label>

              {/* 基座模型 */}
              <label className="flex flex-col gap-1 flex-1">
                <span className="text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wide">基座模型</span>
                <ComboSelect
                  value={customModel || model}
                  onChange={v => {
                    const preset = PRESET_MODELS.find(m => m.id === v);
                    if (preset) {
                      setModel(v);
                      setCustomModel('');
                    } else {
                      setCustomModel(v);
                    }
                  }}
                  options={[
                    ...PRESET_MODELS.map(m => ({ value: m.id, label: m.label })),
                    { value: 'custom', label: '─ 自定义 ID ─' },
                  ]}
                  placeholder="选择模型"
                  allowCustom={true}
                  compact={true}
                />
              </label>
            </div>

            {/* 提示 */}
            <div className="text-xs text-slate-500 dark:text-slate-400 mt-1">
              💡 自定义格式：<code className="text-slate-700 dark:text-slate-300">Qwen/Qwen2.5-7B</code> | Token：<code className="text-slate-700 dark:text-slate-300">huggingface.co/settings/tokens</code>
            </div>
          </div>

          {/* ── 快速开始开关 ── */}
          <div style={{
            display: 'flex', alignItems: 'center', gap: 10,
            padding: '10px 12px', background: '#e8f4f8', borderRadius: 8
          }}>
            <input
              type="checkbox"
              id="quickStart"
              checked={quickStart}
              onChange={e => setQuickStart(e.target.checked)}
              style={{ cursor: 'pointer' }}
            />
            <label htmlFor="quickStart" style={{ fontSize: 13, fontWeight: 500, cursor: 'pointer' }}>
              🚀 快速开始（使用示例数据直接训练，无需上传）
            </label>
          </div>

          {/* ── 训练数据上传（快速开始时隐藏）── */}
          {!quickStart && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <label style={{ fontSize: 12, fontWeight: 600, color: '#555' }}>
                训练数据（JSONL 格式，支持多文件）
              </label>
              <FileDrop
                files={datasets}
                onAdd={fs => setDatasets([...datasets, ...fs])}
                onRemove={i => setDatasets(datasets.filter((_, j) => j !== i))}
                accept=".jsonl,.json"
                multiple
                iconType="file"
                emptyLabel="点击或拖拽上传训练数据（可多选）"
                formatHint='JSONL 格式：每行一条 {"instruction":"问题","output":"答案"}'
              />
              {/* 数据格式说明 */}
              <div style={{
                fontSize: 11, color: '#888', background: '#f9f9f9',
                borderRadius: 4, padding: '6px 8px', lineHeight: 1.6
              }}>
                至少准备 50～200 条，数据质量比数量更重要
              </div>
            </div>
          )}

          {/* ── 常用参数网格：训练轮次 + Batch Size ── */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            {[
              { key: 'num_epochs', label: '训练轮次',   val: numEpochs,  set: setNumEpochs,  step: 1  },
              { key: 'batch_size', label: 'Batch Size', val: batchSize,   set: setBatchSize,  step: 1  },
            ].map(({ key, label, val, set, step }) => (
              <div key={key} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <label
                  title={PARAM_TIPS[key]}
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

          {/* ── 高级设置（可折叠） ── */}
          <details style={{
            border: '1px solid #ddd', borderRadius: 8, overflow: 'hidden'
          }}>
            <summary style={{
              fontSize: 12, fontWeight: 600, color: '#555',
              padding: '10px 12px', cursor: 'pointer',
              background: '#fafafa', userSelect: 'none',
              display: 'flex', justifyContent: 'space-between', alignItems: 'center'
            }}>
              <span>高级设置</span>
              <svg style={{ width: 16, height: 16 }} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </summary>

            <div style={{ padding: 12, background: '#fff', borderTop: '1px solid #ddd', display: 'flex', flexDirection: 'column', gap: 12 }}>
              {/* LoRA Rank 和 Alpha */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                {[
                  { key: 'lora_r',     label: 'LoRA Rank', val: loraR,      set: setLoraR,      step: 4  },
                  { key: 'lora_alpha', label: 'LoRA Alpha', val: loraAlpha,  set: setLoraAlpha,  step: 8  },
                ].map(({ key, label, val, set, step }) => (
                  <div key={key} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    <label
                      title={PARAM_TIPS[key]}
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

              {/* 学习率 */}
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

              {/* 最大序列长度 */}
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

              {/* 导出格式 */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <label style={{ fontSize: 12, fontWeight: 600, color: '#555' }}>导出格式</label>
                <ComboSelect
                  value={exportFmt}
                  onChange={v => setExportFmt(v as 'adapter' | 'merged')}
                  options={[
                    { value: 'adapter', label: '仅 LoRA Adapter（体积小，几 MB）' },
                    { value: 'merged', label: '合并为完整模型（可直接部署）' },
                  ]}
                  placeholder="选择导出格式"
                />
              </div>
            </div>
          </details>

          {/* ── 输出目录（必填）── */}
          <OutputDirRow
            required={true}
            outputDir={outputDir}
            setOutputDir={setOutputDir}
            fieldCls="block text-xs font-medium text-slate-700"
            labelCls="text-xs font-semibold text-slate-700 block mb-2"
            btnSec="shrink-0"
          />

          {/* ── 提交按钮 ── */}
          <button
            onClick={handleStart}
            disabled={submitting || (!quickStart && datasets.length === 0) || !outputDir.trim()}
            style={{
              padding: '10px', borderRadius: 8,
              background: '#4f46e5', color: '#fff',
              border: 'none', cursor: 'pointer',
              fontSize: 14, fontWeight: 600,
              opacity: (submitting || (!quickStart && datasets.length === 0) || !outputDir.trim()) ? 0.5 : 1,
            }}
          >
            {submitting ? '提交中...' : quickStart ? '🚀 开始快速训练' : '开始微调'}
          </button>

          {/* ── 提交反馈消息 ── */}
          {submitMsg && (
            <div style={{
              fontSize: 12, color: submitMsg.includes('失败') ? '#e53e3e' : '#38a169',
              background: submitMsg.includes('失败') ? '#fff5f5' : '#f0fff4',
              padding: '10px 12px', borderRadius: 6,
              border: `1px solid ${submitMsg.includes('失败') ? '#feb2b2' : '#9ae6b4'}`,
              whiteSpace: 'pre-line', lineHeight: 1.5
            }}>
              {submitMsg}
            </div>
          )}
        </div>
      </div>

      {/* ── 使用步骤引导（与 VcPanel 风格一致）── */}
      <HowToSteps steps={FINETUNE_STEPS} />
    </div>
  );
}
