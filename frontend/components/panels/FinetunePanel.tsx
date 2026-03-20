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

import { useState, useEffect, useRef } from 'react';
import { FinetuneJob } from '../../types';
import { fieldCls, labelCls } from '../../constants/styles';
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
    'LoRA 秩：控制新增参数的数量，越大学得越细但越慢。默认 4 适合快速验证',
  lora_alpha:
    '缩放系数：一般设为 lora_r 的 2 倍。不需要改动',
  num_epochs:
    '训练轮次：整个数据集被过几遍。默认 1 轮快速验证，正式训练可调到 3～10',
  batch_size:
    '每步喂多少条数据：越大越快，但占内存越多。内存紧张时改为 1',
  learning_rate:
    '学习率：每步调整多大幅度。过大会不稳定，过小收敛慢。2e-4 是常见起点',
  max_seq_length:
    '最大序列长度：每条样本最多处理多少个 token。超过会被截断。默认 64 快速验证，正式训练可调到 256～512',
};

// ─── 任务状态颜色（Tailwind bg classes）────────────────────────────────────
const STATUS_BG: Record<string, string> = {
  running:   'bg-blue-600',
  done:      'bg-emerald-600',
  error:     'bg-red-600',
  cancelled: 'bg-slate-500',
};

const STATUS_LABELS: Record<string, string> = {
  running:   '训练中',
  done:      '已完成',
  error:     '训练失败',
  cancelled: '已取消',
};

interface Props {
  backendUrl: string;
  outputDir: string;
  setOutputDir: (v: string) => void;
  addPendingJob?: (type: string, label: string, provider: string, isLocal: boolean) => string;
  resolveJob?: (id: string, result: { status: 'completed' | 'failed'; error?: string }) => void;
}

export default function FinetunePanel({ backendUrl, outputDir, setOutputDir, addPendingJob, resolveJob }: Props) {
  // ── 表单状态 ──────────────────────────────────────────────────────────────
  const [model, setModel] = useState(PRESET_MODELS[0].id);  // 选中的预设模型
  const [customModel, setCustomModel] = useState('');         // 自定义模型 ID（覆盖预设）
  const [dataset, setDataset] = useState<File | null>(null);  // 训练数据文件

  // ── HuggingFace 配置（下载基座模型用）─────────────────────────────────────
  // 中国大陆无法直接访问 huggingface.co，需要设置镜像
  const [hfToken, setHfToken] = useState('');                        // HF Token（私有模型需要）
  const [hfMirror, setHfMirror] = useState('https://hf-mirror.com'); // 镜像地址

  // ── 超参数状态（默认值对大多数场景适用）────────────────────────────────────
  const [loraR, setLoraR] = useState(4);           // LoRA 秩（与 smoke_test2 同步）
  const [loraAlpha, setLoraAlpha] = useState(8);  // LoRA 缩放系数（与 smoke_test2 同步）
  const [numEpochs, setNumEpochs] = useState(1);  // 训练轮次（与 smoke_test2 同步）
  const [batchSize, setBatchSize] = useState(2);  // 批大小
  const [lr, setLr] = useState(0.0002);            // 学习率
  const [maxSeqLen, setMaxSeqLen] = useState(64);  // 最大序列长度（与 smoke_test2 同步）
  const [exportFmt, setExportFmt] = useState<'adapter' | 'merged'>('adapter'); // 导出格式

  // ── 任务状态 ──────────────────────────────────────────────────────────────
  const [submitting, setSubmitting] = useState(false);        // 是否正在提交
  const [datasets, setDatasets] = useState<File[]>([]);      // 支持多文件
  const [submitMsg, setSubmitMsg] = useState('');              // 提交反馈消息

  // ── 任务监控 ────────────────────────────────────────────────────────────
  const [activeJobId, setActiveJobId] = useState('');
  const [pendingJobId, setPendingJobId] = useState('');  // TaskList 中的 job id
  const [jobStatus, setJobStatus] = useState<FinetuneJob | null>(null);
  const logEndRef = useRef<HTMLDivElement>(null);

  // 轮询当前任务状态
  useEffect(() => {
    if (!activeJobId) return;
    let cancelled = false;
    const poll = async () => {
      while (!cancelled) {
        try {
          const res = await fetch(`${backendUrl}/finetune/jobs/${activeJobId}`);
          if (res.ok) {
            const data: FinetuneJob = await res.json();
            if (!cancelled) {
              setJobStatus(data);
              if (data.status === 'done' || data.status === 'error' || data.status === 'cancelled') {
                // 同步更新 TaskList 状态
                if (pendingJobId && resolveJob) {
                  resolveJob(pendingJobId, {
                    status: data.status === 'done' ? 'completed' : 'failed',
                    error: data.status === 'error' ? (data.log_tail?.slice(-1)[0] || '训练失败') : undefined,
                  });
                }
                break;
              }
            }
          }
        } catch { /* 静默 */ }
        await new Promise(r => setTimeout(r, 2000));
      }
    };
    poll();
    return () => { cancelled = true; };
  }, [activeJobId, backendUrl, pendingJobId, resolveJob]);

  // 日志自动滚动到底部
  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [jobStatus?.log_tail]);

  // ── 提交微调任务 ──────────────────────────────────────────────────────────
  // POST /finetune/start（multipart/form-data）
  // 支持多个数据集文件，后端会合并处理
  const handleStart = async () => {
    setSubmitting(true);
    setSubmitMsg('');
    try {
      if (datasets.length === 0) return;
      const datasetsToSubmit = datasets;

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

      // 开始轮询任务进度
      if (data.job_id) {
        setActiveJobId(data.job_id);
        setJobStatus(null);
        setSubmitMsg(`已提交！任务 ID：${data.job_id?.slice(0, 8)}…`);
      }

      // 添加到 TaskList
      if (addPendingJob) {
        const pId = addPendingJob(
          'finetune',
          `LoRA 微调 - ${modelId.split('/').pop()}`,
          modelId,
          false
        );
        setPendingJobId(pId);
      }
    } catch (e: any) {
      setSubmitMsg(`提交失败：${e.message}`);
    } finally {
      setSubmitting(false);
    }
  };

  const isDisabled = submitting || datasets.length === 0 || !outputDir.trim();
  const isFailed = submitMsg.includes('失败');

  // ─────────────────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col gap-6 p-6 h-full">

      {/* ── 实际运行流程可视化 ── */}
      <ProcessFlow steps={FINETUNE_FLOW} color="#d97706" />

      {/* ── 主体：配置 → 任务监控（纵向） ── */}
      <div className="flex flex-col gap-6 flex-1 min-h-0">

        {/* ━━ 配置区 ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}
        <div className="flex flex-col gap-3.5 overflow-y-auto pr-1">
          <h3 className="m-0 text-base font-bold">
            LoRA 微调
            <span className="text-[11px] font-normal text-slate-400 ml-2">
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
                  placeholder="公开模型无需填写"
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

          {/* ── 训练数据上传 ── */}
          {(
            <div className="flex flex-col gap-1.5">
              <label className={labelCls}>
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
              <button
                onClick={() => {
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
                  const jsonlContent = sampleData.map(d => JSON.stringify(d, undefined, undefined)).join('\n');
                  const blob = new Blob([jsonlContent], { type: 'application/jsonl' });
                  const file = new File([blob], `sample_train_${datasets.length + 1}.jsonl`, { type: 'application/jsonl' });
                  setDatasets(prev => [...prev, file]);
                }}
                className="text-xs bg-transparent border border-dashed border-amber-600 rounded-md px-3 py-1.5 cursor-pointer text-amber-600 font-medium transition-all hover:bg-amber-50 dark:hover:bg-amber-900/20"
              >
                + 导入样例数据
              </button>
              {/* 数据格式说明 */}
              <div className="text-[11px] text-slate-400 bg-slate-50 dark:bg-slate-800 rounded px-2 py-1.5 leading-relaxed">
                至少准备 50～200 条，数据质量比数量更重要
              </div>
            </div>
          )}

          {/* ── 常用参数网格：训练轮次 + Batch Size ── */}
          <div className="grid grid-cols-2 gap-2.5">
            {[
              { key: 'num_epochs', label: '训练轮次',   val: numEpochs,  set: setNumEpochs,  step: 1  },
              { key: 'batch_size', label: 'Batch Size', val: batchSize,   set: setBatchSize,  step: 1  },
            ].map(({ key, label, val, set, step }) => (
              <div key={key} className="flex flex-col gap-1">
                <label
                  title={PARAM_TIPS[key]}
                  className={`${labelCls} cursor-help`}
                >
                  {label}
                  <span className="ml-1" title={PARAM_TIPS[key]}>?</span>
                </label>
                <input
                  type="number"
                  value={val}
                  step={step}
                  min={1}
                  onChange={e => set(Number(e.target.value))}
                  className={fieldCls}
                />
              </div>
            ))}
          </div>

          {/* ── 高级设置（可折叠） ── */}
          <details className="border border-slate-200 dark:border-slate-700 rounded-lg overflow-hidden">
            <summary className="text-xs font-semibold text-slate-500 dark:text-slate-400 px-3 py-2.5 cursor-pointer bg-slate-50 dark:bg-slate-800 select-none flex justify-between items-center">
              <span>高级设置</span>
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </summary>

            <div className="p-3 bg-white dark:bg-slate-900 border-t border-slate-200 dark:border-slate-700 flex flex-col gap-3">
              {/* LoRA Rank 和 Alpha */}
              <div className="grid grid-cols-2 gap-2.5">
                {[
                  { key: 'lora_r',     label: 'LoRA Rank', val: loraR,      set: setLoraR,      step: 4  },
                  { key: 'lora_alpha', label: 'LoRA Alpha', val: loraAlpha,  set: setLoraAlpha,  step: 8  },
                ].map(({ key, label, val, set, step }) => (
                  <div key={key} className="flex flex-col gap-1">
                    <label
                      title={PARAM_TIPS[key]}
                      className={`${labelCls} cursor-help`}
                    >
                      {label}
                      <span className="ml-1" title={PARAM_TIPS[key]}>?</span>
                    </label>
                    <input
                      type="number"
                      value={val}
                      step={step}
                      min={1}
                      onChange={e => set(Number(e.target.value))}
                      className={fieldCls}
                    />
                  </div>
                ))}
              </div>

              {/* 学习率 */}
              <div className="flex flex-col gap-1">
                <label
                  title={PARAM_TIPS['learning_rate']}
                  className={`${labelCls} cursor-help`}
                >
                  学习率
                  <span className="ml-1" title={PARAM_TIPS['learning_rate']}>?</span>
                </label>
                <input
                  type="number"
                  value={lr}
                  step={0.00001}
                  min={0.000001}
                  onChange={e => setLr(Number(e.target.value))}
                  className={fieldCls}
                />
              </div>

              {/* 最大序列长度 */}
              <div className="flex flex-col gap-1">
                <label
                  title={PARAM_TIPS['max_seq_length']}
                  className={`${labelCls} cursor-help`}
                >
                  最大序列长度
                  <span className="ml-1" title={PARAM_TIPS['max_seq_length']}>?</span>
                </label>
                <input
                  type="number"
                  value={maxSeqLen}
                  step={64}
                  min={128}
                  onChange={e => setMaxSeqLen(Number(e.target.value))}
                  className={fieldCls}
                />
              </div>

              {/* 导出格式 */}
              <div className="flex flex-col gap-1.5">
                <label className={labelCls}>导出格式</label>
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
            required
            outputDir={outputDir}
            setOutputDir={setOutputDir}
            fieldCls="block text-xs font-medium text-slate-700"
            labelCls="text-xs font-semibold text-slate-700 block mb-2"
            btnSec="shrink-0"
          />

          {/* ── 提交按钮 ── */}
          <button
            onClick={handleStart}
            disabled={isDisabled}
            className={`py-2.5 rounded-lg bg-indigo-600 text-white border-none cursor-pointer text-sm font-semibold transition-all hover:bg-indigo-700 ${isDisabled ? 'opacity-50 cursor-not-allowed' : ''}`}
          >
            {submitting ? '提交中...' : '开始微调'}
          </button>

          {/* ── 提交反馈消息 ── */}
          {submitMsg && (
            <div className={`text-xs whitespace-pre-line leading-normal px-3 py-2.5 rounded-md border ${
              isFailed
                ? 'text-red-600 bg-red-50 border-red-300 dark:text-red-400 dark:bg-red-900/20 dark:border-red-700'
                : 'text-emerald-600 bg-emerald-50 border-emerald-300 dark:text-emerald-400 dark:bg-emerald-900/20 dark:border-emerald-700'
            }`}>
              {submitMsg}
            </div>
          )}
        </div>
      </div>

      {/* ━━ 任务监控区 ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}
      {jobStatus && (
        <div className="flex flex-col gap-3 border border-slate-200 dark:border-slate-700 rounded-lg p-4 bg-slate-50 dark:bg-slate-800/50">
          {/* 标题 + 状态 */}
          <div className="flex justify-between items-center">
            <h4 className="m-0 text-sm font-bold">
              训练监控
              <span className="text-[11px] font-normal text-slate-400 ml-2">
                {jobStatus.model}
              </span>
            </h4>
            <span className={`text-xs font-semibold px-2 py-0.5 rounded text-white ${STATUS_BG[jobStatus.status] || 'bg-slate-500'}`}>
              {STATUS_LABELS[jobStatus.status] || jobStatus.status}
            </span>
          </div>

          {/* 进度条 */}
          <div className="flex items-center gap-2">
            <div className="flex-1 h-2 bg-slate-200 dark:bg-slate-700 rounded overflow-hidden">
              <div
                className={`h-full rounded transition-[width] duration-300 ${STATUS_BG[jobStatus.status] || 'bg-blue-600'}`}
                style={{ width: `${Math.round(jobStatus.progress * 100)}%` }}
              />
            </div>
            <span className="text-xs font-semibold text-slate-500 dark:text-slate-400 min-w-[40px]">
              {Math.round(jobStatus.progress * 100)}%
            </span>
          </div>

          {/* Loss 曲线（简易文本图表） */}
          {jobStatus.loss_curve && jobStatus.loss_curve.length > 0 && (
            <div className="flex flex-col gap-1">
              <label className={labelCls}>Loss 曲线</label>
              <div className="flex items-end gap-px h-[60px] bg-white dark:bg-slate-900 rounded border border-slate-200 dark:border-slate-700 px-1.5 py-1">
                {(() => {
                  const curve = jobStatus.loss_curve;
                  const max = Math.max(...curve);
                  const min = Math.min(...curve);
                  const range = max - min || 1;
                  // 最多显示 80 个点
                  const step = Math.max(1, Math.floor(curve.length / 80));
                  const sampled = curve.filter((_, i) => i % step === 0 || i === curve.length - 1);
                  return sampled.map((v, i) => (
                    <div
                      key={i}
                      title={`step ${i * step}: loss=${v.toFixed(4)}`}
                      className="flex-1 min-w-[2px] max-w-[6px] bg-amber-600 rounded-sm transition-[height] duration-200"
                      style={{
                        height: `${Math.max(4, ((v - min) / range) * 100)}%`,
                      }}
                    />
                  ));
                })()}
              </div>
              <div className="flex justify-between text-[10px] text-slate-400">
                <span>loss: {jobStatus.loss_curve[jobStatus.loss_curve.length - 1]?.toFixed(4)}</span>
                <span>{jobStatus.loss_curve.length} steps</span>
              </div>
            </div>
          )}

          {/* 日志 */}
          {jobStatus.log_tail && jobStatus.log_tail.length > 0 && (
            <div className="flex flex-col gap-1">
              <label className={labelCls}>日志（最近 {jobStatus.log_tail.length} 行）</label>
              <div className="max-h-[150px] overflow-y-auto bg-[#1e1e1e] text-[#d4d4d4] rounded-md px-2.5 py-2 text-[11px] font-mono leading-relaxed whitespace-pre-wrap">
                {jobStatus.log_tail.map((line, i) => (
                  <div key={i}>{line}</div>
                ))}
                <div ref={logEndRef} />
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── 使用步骤引导（与 VcPanel 风格一致）── */}
      <HowToSteps steps={FINETUNE_STEPS} />
    </div>
  );
}
