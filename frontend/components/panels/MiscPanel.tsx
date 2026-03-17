import { useRef, useEffect } from 'react';
import ComboSelect from '../shared/ComboSelect';
import ModelInput, { INPUT_CLS } from '../shared/ModelInput';
import FileDrop from '../shared/FileDrop';
import ProcessFlow, { FlowStep } from '../shared/ProcessFlow';
import type { MiscSubPage, Status, ChatMessage } from '../../types';
import {
  IMAGE_UNDERSTAND_PROVIDERS, IMAGE_UNDERSTAND_PROVIDER_LABELS, IMAGE_UNDERSTAND_MODELS,
  TRANSLATE_PROVIDERS, TRANSLATE_LANGUAGES, PROVIDER_LABELS,
  DEFAULT_MODELS,
  IMG_GEN_PROVIDERS, IMG_GEN_PROVIDER_LABELS, IMG_GEN_MODELS, IMG_GEN_SIZES,
  IMG_I2I_PROVIDERS, IMG_I2I_PROVIDER_LABELS, IMG_I2I_MODELS,
  VIDEO_GEN_PROVIDERS, VIDEO_GEN_PROVIDER_LABELS, VIDEO_GEN_MODELS, VIDEO_GEN_DURATIONS,
  OCR_PROVIDERS, OCR_PROVIDER_LABELS, OCR_MODELS,
  LIPSYNC_PROVIDERS, LIPSYNC_PROVIDER_LABELS, LIPSYNC_MODELS,
  LOCAL_PROVIDERS, UNSUPPORTED_PROVIDERS,
} from '../../constants';

interface MiscPanelProps {
  miscSubPage: MiscSubPage;
  setMiscSubPage: (p: MiscSubPage) => void;
  apiKey: string;
  setApiKey: (k: string) => void;
  cloudEndpoint: string;
  setCloudEndpoint: (e: string) => void;
  status: Status;
  // ── 第一行：原有功能 ──
  // image gen (cloud)
  imageGenProvider: string;
  onImageGenProviderChange: (p: string) => void;
  imageGenPrompt: string;
  setImageGenPrompt: (t: string) => void;
  imageGenModel: string;
  setImageGenModel: (m: string) => void;
  imageGenSize: string;
  setImageGenSize: (s: string) => void;
  onRunImageGen: () => void;
  // image understand
  imageUnderstandProvider: string;
  onImageUnderstandProviderChange: (p: string) => void;
  imageUnderstandFile: File | null;
  setImageUnderstandFile: (f: File | null) => void;
  imageUnderstandPrompt: string;
  setImageUnderstandPrompt: (t: string) => void;
  imageUnderstandModel: string;
  setImageUnderstandModel: (m: string) => void;
  onRunImageUnderstand: () => void;
  // translate
  translateProvider: string;
  setTranslateProvider: (p: string) => void;
  translateText: string;
  setTranslateText: (t: string) => void;
  translateTarget: string;
  setTranslateTarget: (l: string) => void;
  translateSource: string;
  setTranslateSource: (l: string) => void;
  translateModel: string;
  setTranslateModel: (m: string) => void;
  onRunTranslate: () => void;
  // code assist
  codeProvider: string;
  setCodeProvider: (p: string) => void;
  codeModel: string;
  setCodeModel: (m: string) => void;
  codeMessages: ChatMessage[];
  setCodeMessages: (msgs: ChatMessage[]) => void;
  codeInput: string;
  setCodeInput: (t: string) => void;
  codeLoading: boolean;
  codeLang: string;
  setCodeLang: (l: string) => void;
  onSendCodeMessage: () => void;
  // ── 第二行：新扩展功能 ──
  // img gen (本地+云)
  imgGenProvider: string;
  onImgGenProviderChange: (p: string) => void;
  imgGenPrompt: string;
  setImgGenPrompt: (t: string) => void;
  imgGenModel: string;
  setImgGenModel: (m: string) => void;
  imgGenSize: string;
  setImgGenSize: (s: string) => void;
  imgGenComfyUrl: string;
  setImgGenComfyUrl: (u: string) => void;
  onRunImgGen: () => void;
  // img i2i
  imgI2iProvider: string;
  onImgI2iProviderChange: (p: string) => void;
  imgI2iSourceFile: File | null;
  setImgI2iSourceFile: (f: File | null) => void;
  imgI2iRefFile: File | null;
  setImgI2iRefFile: (f: File | null) => void;
  imgI2iPrompt: string;
  setImgI2iPrompt: (t: string) => void;
  imgI2iModel: string;
  setImgI2iModel: (m: string) => void;
  imgI2iStrength: number;
  setImgI2iStrength: (v: number) => void;
  imgI2iComfyUrl: string;
  setImgI2iComfyUrl: (u: string) => void;
  onRunImgI2i: () => void;
  // video gen
  videoGenProvider: string;
  onVideoGenProviderChange: (p: string) => void;
  videoGenPrompt: string;
  setVideoGenPrompt: (t: string) => void;
  videoGenModel: string;
  setVideoGenModel: (m: string) => void;
  videoGenDuration: number;
  setVideoGenDuration: (d: number) => void;
  videoGenMode: 't2v' | 'i2v';
  setVideoGenMode: (m: 't2v' | 'i2v') => void;
  videoGenImageFile: File | null;
  setVideoGenImageFile: (f: File | null) => void;
  onRunVideoGen: () => void;
  // ocr
  ocrProvider: string;
  onOcrProviderChange: (p: string) => void;
  ocrFile: File | null;
  setOcrFile: (f: File | null) => void;
  ocrModel: string;
  setOcrModel: (m: string) => void;
  ocrLocalUrl: string;
  setOcrLocalUrl: (u: string) => void;
  onRunOcr: () => void;
  // lipsync
  lipsyncProvider: string;
  onLipsyncProviderChange: (p: string) => void;
  lipsyncVideoFile: File | null;
  setLipsyncVideoFile: (f: File | null) => void;
  lipsyncAudioFile: File | null;
  setLipsyncAudioFile: (f: File | null) => void;
  lipsyncModel: string;
  setLipsyncModel: (m: string) => void;
  lipsyncLocalUrl: string;
  setLipsyncLocalUrl: (u: string) => void;
  onRunLipsync: () => void;
  // style
  fieldCls: string;
  fileCls: string;
  labelCls: string;
  btnSec: string;
  // optional: restrict visible sub-pages
  allowedSubPages?: readonly MiscSubPage[];
}

type MiscTab = { key: MiscSubPage; label: string; abbr: string; bg: string };

const ROW1_TABS: MiscTab[] = [
  { key: 'image_understand', label: '图像理解', abbr: 'IU',   bg: '#7c3aed' },
  { key: 'translate',        label: '文字翻译', abbr: 'TRL',  bg: '#0284c7' },
  { key: 'code_assist',      label: '代码助手', abbr: 'CODE', bg: '#059669' },
];

const ROW2_TABS: MiscTab[] = [
  { key: 'img_gen',   label: '图像生成', abbr: 'T2I', bg: '#db2777' },
  { key: 'img_i2i',  label: '换脸换图', abbr: 'I2I', bg: '#b45309' },
  { key: 'video_gen', label: '视频生成', abbr: 'T2V', bg: '#0f766e' },
];

const ROW3_TABS: MiscTab[] = [
  { key: 'ocr',     label: 'OCR 识别', abbr: 'OCR', bg: '#0369a1' },
  { key: 'lipsync', label: '口型同步', abbr: 'LIP', bg: '#be185d' },
];

function MiscTabIcon({ abbr, bg, size = 22 }: { abbr: string; bg: string; size?: number }) {
  const fs = abbr.length >= 4 ? size * 0.32 : abbr.length >= 3 ? size * 0.36 : size * 0.42;
  return (
    <svg width={size} height={size} viewBox="0 0 22 22" style={{ flexShrink: 0 }}>
      <rect width="22" height="22" rx="5.5" fill={bg} />
      <text x="11" y="11" dominantBaseline="central" textAnchor="middle"
        fontSize={fs} fontWeight="700" fill="#fff" fontFamily="-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">
        {abbr}
      </text>
    </svg>
  );
}

const CODE_PROVIDERS = ['gemini', 'openai', 'claude', 'deepseek', 'groq', 'mistral', 'xai', 'ollama', 'github'];

// ─── 实际运行流程定义 ─────────────────────────────────────────────────────────
const TRANSLATE_FLOW: FlowStep[] = [
  { label: '源文本' },
  { label: '语言检测',     tech: '自动 / 手动' },
  { label: '构建 Prompt',  tech: 'Few-shot' },
  { label: 'LLM 翻译',    tech: 'OpenAI/Gemini...' },
  { label: '译文输出' },
];

const CODE_FLOW: FlowStep[] = [
  { label: '代码问题' },
  { label: '语言标注',     tech: 'Language Tag' },
  { label: '上下文拼接',   tech: 'Context Window' },
  { label: 'LLM 推理',    tech: 'Code LLM' },
  { label: '代码回答' },
];

// ─── 图像理解流程 ─────────────────────────────────────────────────────────────
const IMG_UNDERSTAND_FLOW: FlowStep[] = [
  { label: '图片上传' },
  { label: '图像编码',    tech: 'ViT / CLIP' },
  { label: '多模态推理',  tech: 'VLM' },
  { label: '文字回答' },
];

// ─── 文字生图（本地 / 云端）流程 ─────────────────────────────────────────────
const IMG_GEN_FLOW_LOCAL: FlowStep[] = [
  { label: '提示词' },
  { label: '文本编码',    tech: 'CLIP / T5' },
  { label: '噪声采样',    tech: 'Latent' },
  { label: '扩散去噪',    tech: 'UNet / DiT' },
  { label: 'VAE 解码' },
  { label: '图像输出' },
];
const IMG_GEN_FLOW_CLOUD: FlowStep[] = [
  { label: '提示词' },
  { label: '安全审核' },
  { label: '云端生成',    tech: 'DALL-E / Imagen' },
  { label: '图像输出' },
];

// ─── 换脸换图（FaceFusion / ComfyUI）流程 ────────────────────────────────────
const IMG_I2I_FLOW_FACEFUSION: FlowStep[] = [
  { label: '源人脸图' },
  { label: '人脸检测',    tech: 'RetinaFace' },
  { label: '目标图/视频' },
  { label: '换脸',        tech: 'FaceFusion 3.x' },
  { label: '增强',        tech: 'GFPGAN/CodeFormer' },
  { label: '输出' },
];
const IMG_I2I_FLOW_COMFYUI: FlowStep[] = [
  { label: '源图片' },
  { label: '参考图 / Prompt' },
  { label: '图像编码',    tech: 'VAE Encoder' },
  { label: '扩散推理',    tech: 'ComfyUI / SD' },
  { label: '图像解码',    tech: 'VAE Decoder' },
  { label: '输出图片' },
];

// ─── 视频生成（本地 Wan2.1 / 云端）流程 ──────────────────────────────────────
const VIDEO_GEN_FLOW_LOCAL: FlowStep[] = [
  { label: '提示词 / 图片' },
  { label: '文本编码',    tech: 'CLIP / T5' },
  { label: '时序扩散',    tech: 'Wan2.1 DiT' },
  { label: 'VAE 解码' },
  { label: '帧合成',      tech: 'FFmpeg' },
  { label: '视频输出' },
];
const VIDEO_GEN_FLOW_CLOUD: FlowStep[] = [
  { label: '提示词 / 图片' },
  { label: '云端处理',    tech: '可灵 / RunwayML' },
  { label: '异步等待',    note: '数秒至数分钟' },
  { label: '视频输出' },
];

// ─── OCR 识别（本地 GOT-OCR / 云端 VLM）流程 ─────────────────────────────────
const OCR_FLOW_LOCAL: FlowStep[] = [
  { label: '图片 / PDF' },
  { label: '图像编码',    tech: 'ViT' },
  { label: 'OCR LLM',    tech: 'GOT-OCR 2.0' },
  { label: '文字输出' },
];
const OCR_FLOW_CLOUD: FlowStep[] = [
  { label: '图片 / PDF' },
  { label: '图像压缩',    tech: 'Base64' },
  { label: '视觉大模型',  tech: 'GPT-4o / Gemini' },
  { label: '文字输出' },
];

const LIPSYNC_FLOWS: Record<string, FlowStep[]> = {
  liveportrait: [
    { label: '人物图片' },
    { label: '关键点检测',  tech: 'FaceKeypoints' },
    { label: '驱动视频' },
    { label: '运动迁移',    tech: 'LivePortrait' },
    { label: '渲染',        tech: 'OpenCV' },
    { label: '动画输出' },
  ],
  sadtalker: [
    { label: '人物图片' },
    { label: '音频文件' },
    { label: '头部建模',    tech: '3D Morphable Model' },
    { label: '口型驱动',    tech: 'SadTalker' },
    { label: '视频输出' },
  ],
  heygen: [
    { label: '人物视频' },
    { label: '音频 / 文字' },
    { label: '云端处理',    tech: 'HeyGen API' },
    { label: '口型同步视频' },
  ],
  did: [
    { label: '人物图片' },
    { label: '音频 / 文字' },
    { label: '云端处理',    tech: 'D-ID API' },
    { label: '口型同步视频' },
  ],
};

const btnPrimary = 'w-full rounded-xl bg-violet-600 hover:bg-violet-700 disabled:opacity-50 px-4 py-2.5 text-sm font-semibold text-white transition-colors';

function shortProv(label: string): string {
  return label.replace(/（[^）]*）/g, '').replace(/【[^】]*】/g, '').trim();
}

const PILL_BASE = 'rounded-xl border px-2 py-2 text-xs font-medium transition-all text-center leading-tight';
const PILL_ON  = 'border-violet-400 bg-violet-50 text-violet-700 dark:bg-violet-900/30 dark:border-violet-500 dark:text-violet-300';
const PILL_OFF = 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400 hover:border-slate-300 dark:hover:border-slate-600 hover:bg-slate-50 dark:hover:bg-slate-800/50';

export default function MiscPanel({
  miscSubPage, setMiscSubPage,
  apiKey, setApiKey, cloudEndpoint, setCloudEndpoint,
  status,
  imageGenProvider, onImageGenProviderChange,
  imageGenPrompt, setImageGenPrompt,
  imageGenModel, setImageGenModel,
  imageGenSize, setImageGenSize,
  onRunImageGen,
  imageUnderstandProvider, onImageUnderstandProviderChange,
  imageUnderstandFile, setImageUnderstandFile,
  imageUnderstandPrompt, setImageUnderstandPrompt,
  imageUnderstandModel, setImageUnderstandModel,
  onRunImageUnderstand,
  translateProvider, setTranslateProvider,
  translateText, setTranslateText,
  translateTarget, setTranslateTarget,
  translateSource, setTranslateSource,
  translateModel, setTranslateModel,
  onRunTranslate,
  codeProvider, setCodeProvider,
  codeModel, setCodeModel,
  codeMessages, setCodeMessages,
  codeInput, setCodeInput,
  codeLoading,
  codeLang, setCodeLang,
  onSendCodeMessage,
  imgGenProvider, onImgGenProviderChange,
  imgGenPrompt, setImgGenPrompt,
  imgGenModel, setImgGenModel,
  imgGenSize, setImgGenSize,
  imgGenComfyUrl, setImgGenComfyUrl,
  onRunImgGen,
  imgI2iProvider, onImgI2iProviderChange,
  imgI2iSourceFile, setImgI2iSourceFile,
  imgI2iRefFile, setImgI2iRefFile,
  imgI2iPrompt, setImgI2iPrompt,
  imgI2iModel, setImgI2iModel,
  imgI2iStrength, setImgI2iStrength,
  imgI2iComfyUrl, setImgI2iComfyUrl,
  onRunImgI2i,
  videoGenProvider, onVideoGenProviderChange,
  videoGenPrompt, setVideoGenPrompt,
  videoGenModel, setVideoGenModel,
  videoGenDuration, setVideoGenDuration,
  videoGenMode, setVideoGenMode,
  videoGenImageFile, setVideoGenImageFile,
  onRunVideoGen,
  ocrProvider, onOcrProviderChange,
  ocrFile, setOcrFile,
  ocrModel, setOcrModel,
  ocrLocalUrl, setOcrLocalUrl,
  onRunOcr,
  lipsyncProvider, onLipsyncProviderChange,
  lipsyncVideoFile, setLipsyncVideoFile,
  lipsyncAudioFile, setLipsyncAudioFile,
  lipsyncModel, setLipsyncModel,
  lipsyncLocalUrl, setLipsyncLocalUrl,
  onRunLipsync,
  fieldCls, fileCls, labelCls, btnSec,
  allowedSubPages,
}: MiscPanelProps) {
  const busy = status === 'processing';
  const codeScrollRef = useRef<HTMLDivElement>(null);

  const ALL_ROWS: MiscTab[][] = [ROW1_TABS, ROW2_TABS, ROW3_TABS];
  const visibleRows = allowedSubPages
    ? ALL_ROWS.map(row => row.filter(tab => allowedSubPages.includes(tab.key))).filter(row => row.length > 0)
    : ALL_ROWS;

  useEffect(() => {
    if (codeScrollRef.current) {
      codeScrollRef.current.scrollTop = codeScrollRef.current.scrollHeight;
    }
  }, [codeMessages]);

  const isOllamaImageUnderstand = imageUnderstandProvider === 'ollama';
  const isOllamaTranslate = translateProvider === 'ollama';
  const needsEndpoint = isOllamaImageUnderstand || isOllamaTranslate;

  function ApiKeyRow({ forOllama }: { forOllama?: boolean }) {
    if (forOllama) {
      return (
        <div>
          <label className={labelCls}>Ollama 服务地址</label>
          <input className={fieldCls} value={cloudEndpoint} onChange={e => setCloudEndpoint(e.target.value)}
            placeholder="http://localhost:11434" />
        </div>
      );
    }
    return (
      <div>
        <label className={labelCls}>API Key</label>
        <input className={fieldCls} type="password" value={apiKey} onChange={e => setApiKey(e.target.value)}
          placeholder="sk-... / AIza... / sk-ant-..." />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* 子页签（单子页时隐藏，由外部页面负责导航） */}
      {visibleRows.flat().length > 1 && (
        <div className="space-y-1.5">
          {visibleRows.map((row, i) => (
            <div key={i} className="flex gap-1 rounded-2xl bg-slate-100 dark:bg-slate-800 p-1">
              {row.map(tab => (
                <button
                  key={tab.key}
                  onClick={() => setMiscSubPage(tab.key)}
                  className={`flex-1 flex items-center justify-center gap-1.5 rounded-xl py-2 text-sm font-medium transition-all ${
                    miscSubPage === tab.key
                      ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100 shadow-sm'
                      : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'
                  }`}>
                  <MiscTabIcon abbr={tab.abbr} bg={tab.bg} />
                  <span>{tab.label}</span>
                </button>
              ))}
            </div>
          ))}
        </div>
      )}

      {/* ── 图像理解 ── */}
      {miscSubPage === 'image_understand' && (
        <div className="rounded-2xl border border-slate-200/80 dark:border-slate-700/80 bg-white dark:bg-slate-900 shadow-panel p-5 space-y-4">
          <ProcessFlow steps={IMG_UNDERSTAND_FLOW} color="#7c3aed" />
          <div>
            <label className={labelCls}>服务商</label>
            <div className="grid grid-cols-2 gap-2">
              {IMAGE_UNDERSTAND_PROVIDERS.map(p => (
                <button key={p}
                  onClick={() => onImageUnderstandProviderChange(p)}
                  className={`rounded-xl border px-3 py-2 text-sm font-medium transition-all text-left ${
                    imageUnderstandProvider === p
                      ? 'border-violet-400 bg-violet-50 text-violet-700 dark:bg-violet-900/30 dark:text-violet-300'
                      : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400 hover:border-slate-300 dark:hover:border-slate-600'
                  }`}>
                  {IMAGE_UNDERSTAND_PROVIDER_LABELS[p] || p}
                </button>
              ))}
            </div>
          </div>

          <ApiKeyRow forOllama={isOllamaImageUnderstand} />

          <div>
            <label className={labelCls}>模型</label>
            <ComboSelect
              value={imageUnderstandModel}
              onChange={setImageUnderstandModel}
              options={(IMAGE_UNDERSTAND_MODELS[imageUnderstandProvider] || []).map(m => ({ value: m, label: m }))}
              placeholder="留空用默认"
              allowCustom
            />
          </div>

          <div>
            <label className={labelCls}>上传图片</label>
            <FileDrop
              files={imageUnderstandFile ? [imageUnderstandFile] : []}
              onAdd={fs => setImageUnderstandFile(fs[0])}
              onRemove={() => setImageUnderstandFile(null)}
              accept="image/*"
              compact
              iconType="image"
              emptyLabel="点击或拖拽图片"
            />
          </div>

          <div>
            <label className={labelCls}>提示词</label>
            <textarea rows={3} className={fieldCls}
              value={imageUnderstandPrompt} onChange={e => setImageUnderstandPrompt(e.target.value)}
              placeholder="请详细描述这张图片" />
          </div>

          <button className={btnPrimary} disabled={busy || !imageUnderstandFile} onClick={onRunImageUnderstand}>
            {busy ? '分析中...' : '分析图片'}
          </button>
        </div>
      )}

      {/* ── 文字翻译 ── */}
      {miscSubPage === 'translate' && (
        <div className="rounded-2xl border border-slate-200/80 dark:border-slate-700/80 bg-white dark:bg-slate-900 shadow-panel p-5 space-y-4">
          <ProcessFlow steps={TRANSLATE_FLOW} color="#0284c7" />
          <div className="flex flex-wrap gap-3 items-end">
            <label className="flex flex-col gap-1 min-w-[140px] flex-1">
              <span className={labelCls}>服务商</span>
              <ComboSelect
                value={translateProvider}
                onChange={v => { setTranslateProvider(v); setTranslateModel(DEFAULT_MODELS.llm?.[v] || ''); }}
                options={TRANSLATE_PROVIDERS.map(p => ({ value: p, label: PROVIDER_LABELS[p] || p }))}
                placeholder="选择服务商"
              />
            </label>
            <label className="flex flex-col gap-1 min-w-[160px] flex-1">
              <span className={labelCls}>模型（可选）</span>
              <ModelInput value={translateModel} onChange={setTranslateModel} task="llm" provider={translateProvider} />
            </label>
            {isOllamaTranslate ? (
              <label className="flex flex-col gap-1 min-w-[160px] flex-1">
                <span className={labelCls}>服务地址</span>
                <input className={INPUT_CLS} value={cloudEndpoint} onChange={e => setCloudEndpoint(e.target.value)} placeholder="http://localhost:11434" />
              </label>
            ) : (
              <label className="flex flex-col gap-1 min-w-[160px] flex-1">
                <span className={labelCls}>API 密钥</span>
                <input className={INPUT_CLS} type="password" value={apiKey} onChange={e => setApiKey(e.target.value)} placeholder="sk-... / AIza..." />
              </label>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>源语言</label>
              <ComboSelect
                value={translateSource}
                onChange={setTranslateSource}
                options={[{ value: '自动检测', label: '自动检测' }, ...TRANSLATE_LANGUAGES.map(l => ({ value: l, label: l }))]}
                placeholder="选择语言"
              />
            </div>
            <div>
              <label className={labelCls}>目标语言</label>
              <ComboSelect
                value={translateTarget}
                onChange={setTranslateTarget}
                options={TRANSLATE_LANGUAGES.map(l => ({ value: l, label: l }))}
                placeholder="目标语言"
              />
            </div>
          </div>

          <div>
            <label className={labelCls}>待翻译文本</label>
            <textarea rows={6} className={fieldCls}
              value={translateText} onChange={e => setTranslateText(e.target.value)}
              placeholder="在此输入要翻译的文本..." />
          </div>

          <button className={btnPrimary} disabled={busy || !translateText.trim()} onClick={onRunTranslate}>
            {busy ? '翻译中...' : '开始翻译'}
          </button>
        </div>
      )}

      {/* ── 代码助手 ── */}
      {miscSubPage === 'code_assist' && (
        <div className="rounded-2xl border border-slate-200/80 dark:border-slate-700/80 bg-white dark:bg-slate-900 shadow-panel overflow-hidden flex flex-col" style={{ minHeight: '520px' }}>
          <div className="px-5 pt-4">
            <ProcessFlow steps={CODE_FLOW} color="#059669" />
          </div>
          {/* 配置栏 */}
          <div className="p-4 border-b border-slate-100 dark:border-slate-800 flex flex-wrap gap-3 items-end">
            <label className="flex flex-col gap-1 min-w-[140px] flex-1">
              <span className={labelCls}>服务商</span>
              <ComboSelect
                value={codeProvider}
                onChange={v => { setCodeProvider(v); setCodeModel(DEFAULT_MODELS.llm?.[v] || ''); }}
                options={CODE_PROVIDERS.map(p => ({ value: p, label: PROVIDER_LABELS[p] || p }))}
                placeholder="选择服务商"
              />
            </label>
            <label className="flex flex-col gap-1 min-w-[160px] flex-1">
              <span className={labelCls}>模型（可选）</span>
              <ModelInput value={codeModel} onChange={setCodeModel} task="llm" provider={codeProvider} />
            </label>
            {codeProvider === 'ollama' ? (
              <label className="flex flex-col gap-1 min-w-[160px] flex-1">
                <span className={labelCls}>服务地址</span>
                <input className={INPUT_CLS} value={cloudEndpoint} onChange={e => setCloudEndpoint(e.target.value)} placeholder="http://localhost:11434" />
              </label>
            ) : (
              <label className="flex flex-col gap-1 min-w-[160px] flex-1">
                <span className={labelCls}>API 密钥</span>
                <input className={INPUT_CLS} type="password" value={apiKey} onChange={e => setApiKey(e.target.value)} placeholder="sk-..." />
              </label>
            )}
          </div>
          <div className="px-4 pb-3">
            <label className={labelCls}>语言/框架（可选）</label>
            <input className={INPUT_CLS} value={codeLang} onChange={e => setCodeLang(e.target.value)}
              placeholder="Python / TypeScript / React / SQL ..." />
          </div>

          {/* 消息区 */}
          <div ref={codeScrollRef} className="flex-1 overflow-y-auto p-4 space-y-3" style={{ maxHeight: '400px' }}>
            {codeMessages.length === 0 && (
              <div className="text-center text-sm text-slate-400 dark:text-slate-600 py-8">
                向代码助手提问，例如：<br />
                <span className="text-slate-300 dark:text-slate-700">"用 Python 写一个快速排序" · "解释这段代码" · "如何优化这个 SQL 查询"</span>
              </div>
            )}
            {codeMessages.map((msg, i) => (
              <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div className={`rounded-2xl px-4 py-2.5 text-sm max-w-[90%] whitespace-pre-wrap ${
                  msg.role === 'user'
                    ? 'bg-violet-600 text-white'
                    : 'bg-slate-100 dark:bg-slate-800 text-slate-800 dark:text-slate-200'
                }`}>
                  {msg.content}
                </div>
              </div>
            ))}
            {codeLoading && (
              <div className="flex justify-start">
                <div className="rounded-2xl px-4 py-2.5 bg-slate-100 dark:bg-slate-800">
                  <span className="flex gap-1">
                    <span className="w-1.5 h-1.5 bg-slate-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                    <span className="w-1.5 h-1.5 bg-slate-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                    <span className="w-1.5 h-1.5 bg-slate-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                  </span>
                </div>
              </div>
            )}
          </div>

          {/* 输入栏 */}
          <div className="border-t border-slate-100 dark:border-slate-800 p-3 flex gap-2">
            <textarea
              rows={2}
              className={`${fieldCls} flex-1 resize-none`}
              value={codeInput}
              onChange={e => setCodeInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); onSendCodeMessage(); } }}
              placeholder="输入你的问题... (Enter 发送，Shift+Enter 换行)"
            />
            <button
              onClick={onSendCodeMessage}
              disabled={codeLoading || !codeInput.trim()}
              className="shrink-0 rounded-xl bg-violet-600 hover:bg-violet-700 disabled:opacity-50 px-4 py-2 text-sm font-semibold text-white transition-colors self-end">
              发送
            </button>
            {codeMessages.length > 0 && (
              <button
                onClick={() => setCodeMessages([])}
                className={`shrink-0 ${btnSec} self-end`}>
                清空
              </button>
            )}
          </div>
        </div>
      )}

      {/* ── 图像生成（本地+云） ── */}
      {miscSubPage === 'img_gen' && (() => {
        const isComfyUI = imgGenProvider === 'comfyui';
        const isLocal = LOCAL_PROVIDERS.has(imgGenProvider);
        const isUnsupported = UNSUPPORTED_PROVIDERS.has(imgGenProvider);
        const models = IMG_GEN_MODELS[imgGenProvider] || [];
        const sizes = IMG_GEN_SIZES[imgGenProvider] || [];
        const sizeLabel = imgGenProvider === 'openai' || imgGenProvider === 'dashscope' || imgGenProvider === 'sd_local' ? '尺寸' : '比例';
        return (
          <div className="rounded-2xl border border-slate-200/80 dark:border-slate-700/80 bg-white dark:bg-slate-900 shadow-panel p-5 space-y-4">
            {isLocal
              ? <ProcessFlow steps={IMG_GEN_FLOW_LOCAL} color="#db2777" />
              : <ProcessFlow steps={IMG_GEN_FLOW_CLOUD} color="#db2777" />}
            <div>
              <label className={labelCls}>服务商</label>
              <div className="grid grid-cols-3 gap-2">
                {IMG_GEN_PROVIDERS.map(p => (
                  <button key={p} onClick={() => onImgGenProviderChange(p)} className={`${PILL_BASE} ${imgGenProvider === p ? PILL_ON : PILL_OFF}`}>
                    {shortProv(IMG_GEN_PROVIDER_LABELS[p] || p)}
                  </button>
                ))}
              </div>
              {imgGenProvider === 'sd_local' && <p className="mt-1.5 text-xs text-sky-600 dark:text-sky-400">本地运行，无需 API Key，首次需安装模型（约 2.3 GB，运行 pnpm run checkpoints --engine sd）</p>}
              {imgGenProvider === 'flux' && <p className="mt-1.5 text-xs text-amber-600 dark:text-amber-400">⚠ Flux 已被 SD-Turbo 替代（Flux 需 ~30 GB + HF 账号）。如需使用，手动运行 pnpm run checkpoints --engine flux</p>}
              {imgGenProvider === 'comfyui' && <p className="mt-1.5 text-xs text-sky-600 dark:text-sky-400">需提前在本地启动 ComfyUI 服务（默认端口 8188）</p>}
              {imgGenProvider === 'openai' && <p className="mt-1.5 text-xs text-slate-400 dark:text-slate-500">DALL-E 3 支持自然语言描述，效果出色</p>}
              {imgGenProvider === 'gemini' && <p className="mt-1.5 text-xs text-slate-400 dark:text-slate-500">Imagen 3，支持多种宽高比，需要 Google AI API Key</p>}
              {imgGenProvider === 'stability' && <p className="mt-1.5 text-xs text-slate-400 dark:text-slate-500">Stability AI SD3，风格多样，需要 API Key</p>}
              {imgGenProvider === 'dashscope' && <p className="mt-1.5 text-xs text-slate-400 dark:text-slate-500">通义万象，需要阿里云百炼 API Key</p>}
            </div>
            {isComfyUI ? (
              <div>
                <label className={labelCls}>ComfyUI 服务地址</label>
                <input className={fieldCls} value={imgGenComfyUrl} onChange={e => setImgGenComfyUrl(e.target.value)} placeholder="http://127.0.0.1:8188" />
              </div>
            ) : !isLocal ? (
              <div>
                <label className={labelCls}>API Key</label>
                <input className={fieldCls} type="password" value={apiKey} onChange={e => setApiKey(e.target.value)} placeholder="sk-... / AIza... / Bearer ..." />
              </div>
            ) : null}
            <div>
              <label className={labelCls}>模型</label>
              <ComboSelect
                value={imgGenModel}
                onChange={setImgGenModel}
                options={models.map(m => ({ value: m, label: m }))}
                placeholder={models[0] ? `默认：${models[0]}` : '输入模型名称'}
                allowCustom
              />
              {imgGenModel === 'dall-e-3' && <p className="mt-1.5 text-xs text-slate-400 dark:text-slate-500">质量最高，支持详细文字提示词</p>}
              {imgGenModel === 'dall-e-2' && <p className="mt-1.5 text-xs text-slate-400 dark:text-slate-500">速度较快，价格更低</p>}
              {imgGenModel === 'sd3-large-turbo' && <p className="mt-1.5 text-xs text-slate-400 dark:text-slate-500">Turbo 版，速度最快</p>}
              {imgGenModel === 'sd3-large' && <p className="mt-1.5 text-xs text-slate-400 dark:text-slate-500">标准版，质量最高</p>}
              {imgGenModel === 'imagen-3.0-fast-generate-001' && <p className="mt-1.5 text-xs text-slate-400 dark:text-slate-500">快速版，速度更快</p>}
            </div>
            {sizes.length > 0 && (
              <div>
                <label className={labelCls}>{sizeLabel}</label>
                <ComboSelect
                  value={imgGenSize}
                  onChange={setImgGenSize}
                  options={sizes.map(s => ({ value: s, label: s }))}
                  placeholder="选择尺寸"
                />
              </div>
            )}
            <div>
              <label className={labelCls}>图像描述（提示词）</label>
              <textarea rows={4} className={fieldCls} value={imgGenPrompt} onChange={e => setImgGenPrompt(e.target.value)} placeholder="描述你想生成的图像内容，越详细越好..." />
            </div>
            <button className={`${btnPrimary} !bg-pink-600 hover:!bg-pink-700`} disabled={busy || !imgGenPrompt.trim() || isUnsupported} onClick={onRunImgGen}>
              {busy ? '生成中...' : isUnsupported ? '暂不支持' : '生成图像'}
            </button>
          </div>
        );
      })()}

      {/* ── 换脸换图 ── */}
      {miscSubPage === 'img_i2i' && (() => {
        const isComfyUI = imgI2iProvider === 'comfyui';
        const isLocal = LOCAL_PROVIDERS.has(imgI2iProvider);
        const isUnsupported = UNSUPPORTED_PROVIDERS.has(imgI2iProvider);
        const models = IMG_I2I_MODELS[imgI2iProvider] || [];
        return (
          <div className="rounded-2xl border border-slate-200/80 dark:border-slate-700/80 bg-white dark:bg-slate-900 shadow-panel p-5 space-y-4">
            <div>
              <label className={labelCls}>服务商</label>
              <div className="grid grid-cols-3 gap-2">
                {IMG_I2I_PROVIDERS.map(p => (
                  <button key={p} onClick={() => onImgI2iProviderChange(p)} className={`${PILL_BASE} ${imgI2iProvider === p ? PILL_ON : PILL_OFF}`}>
                    {shortProv(IMG_I2I_PROVIDER_LABELS[p] || p)}
                  </button>
                ))}
              </div>
              {imgI2iProvider === 'facefusion' && <p className="mt-1.5 text-xs text-amber-600 dark:text-amber-400">⚠️ Mac 用户：FaceFusion 在 Apple Silicon 上回退 CPU 模式，速度较慢</p>}
              {imgI2iProvider === 'comfyui' && <p className="mt-1.5 text-xs text-sky-600 dark:text-sky-400">需提前在本地启动 ComfyUI 服务，适合风格迁移</p>}
              {(imgI2iProvider === 'replicate' || imgI2iProvider === 'dashscope') && <p className="mt-1.5 text-xs text-amber-500">暂不支持，敬请期待</p>}
            </div>
            {imgI2iProvider === 'facefusion'
              ? <ProcessFlow steps={IMG_I2I_FLOW_FACEFUSION} color="#b45309" />
              : imgI2iProvider === 'comfyui'
                ? <ProcessFlow steps={IMG_I2I_FLOW_COMFYUI} color="#7c3aed" />
                : null}
            {isComfyUI ? (
              <div>
                <label className={labelCls}>ComfyUI 服务地址</label>
                <input className={fieldCls} value={imgI2iComfyUrl} onChange={e => setImgI2iComfyUrl(e.target.value)} placeholder="http://127.0.0.1:8188" />
              </div>
            ) : !isLocal ? (
              <div>
                <label className={labelCls}>API Key</label>
                <input className={fieldCls} type="password" value={apiKey} onChange={e => setApiKey(e.target.value)} placeholder="sk-... / Bearer ..." />
              </div>
            ) : null}
            {models.length > 0 && (
              <div>
                <label className={labelCls}>模型</label>
                <ComboSelect
                  value={imgI2iModel}
                  onChange={setImgI2iModel}
                  options={models.map(m => ({ value: m, label: m }))}
                  allowCustom
                  placeholder="选择模型"
                />
              </div>
            )}
            <div>
              <label className={labelCls}>源图片（待处理）</label>
              <FileDrop
                files={imgI2iSourceFile ? [imgI2iSourceFile] : []}
                onAdd={fs => setImgI2iSourceFile(fs[0])}
                onRemove={() => setImgI2iSourceFile(null)}
                accept="image/*"
                compact
                iconType="image"
                emptyLabel="点击或拖拽源图片"
              />
            </div>
            <div>
              <label className={labelCls}>参考图片（换脸 / 风格参考，可选）</label>
              <FileDrop
                files={imgI2iRefFile ? [imgI2iRefFile] : []}
                onAdd={fs => setImgI2iRefFile(fs[0])}
                onRemove={() => setImgI2iRefFile(null)}
                accept="image/*"
                compact
                iconType="image"
                emptyLabel="点击或拖拽参考图片（可选）"
              />
            </div>
            <div>
              <label className={labelCls}>提示词（描述目标效果，可选）</label>
              <textarea rows={3} className={fieldCls} value={imgI2iPrompt} onChange={e => setImgI2iPrompt(e.target.value)} placeholder="如：保持原来姿势，换成水墨画风格..." />
            </div>
            <div>
              <label className={labelCls}>变化强度 {imgI2iStrength.toFixed(2)}（0 = 几乎不变，1 = 完全重绘）</label>
              <input type="range" min={0} max={1} step={0.05} value={imgI2iStrength} onChange={e => setImgI2iStrength(Number(e.target.value))} className="w-full accent-rose-500" />
            </div>
            <button className={`${btnPrimary} !bg-rose-600 hover:!bg-rose-700`} disabled={busy || !imgI2iSourceFile || isUnsupported} onClick={onRunImgI2i}>
              {busy ? '处理中...' : isUnsupported ? '暂不支持' : '开始换脸换图'}
            </button>
          </div>
        );
      })()}

      {/* ── 视频生成 ── */}
      {miscSubPage === 'video_gen' && (() => {
        const isLocal = LOCAL_PROVIDERS.has(videoGenProvider);
        const isUnsupported = UNSUPPORTED_PROVIDERS.has(videoGenProvider);
        const models = VIDEO_GEN_MODELS[videoGenProvider] || [];
        const durations = VIDEO_GEN_DURATIONS[videoGenProvider] || [5];
        const supportsI2v = videoGenProvider === 'kling' || videoGenProvider === 'wan_local' || videoGenProvider === 'wan_video' || videoGenProvider === 'runway';
        return (
          <div className="rounded-2xl border border-slate-200/80 dark:border-slate-700/80 bg-white dark:bg-slate-900 shadow-panel p-5 space-y-4">
            {isLocal
              ? <ProcessFlow steps={VIDEO_GEN_FLOW_LOCAL} color="#0f766e" />
              : <ProcessFlow steps={VIDEO_GEN_FLOW_CLOUD} color="#0f766e" />}
            <div>
              <label className={labelCls}>服务商</label>
              <div className="grid grid-cols-3 gap-2">
                {VIDEO_GEN_PROVIDERS.map(p => (
                  <button key={p} onClick={() => onVideoGenProviderChange(p)} className={`${PILL_BASE} ${videoGenProvider === p ? PILL_ON : PILL_OFF}`}>
                    {shortProv(VIDEO_GEN_PROVIDER_LABELS[p] || p)}
                  </button>
                ))}
              </div>
              {videoGenProvider === 'wan_local' && <p className="mt-1.5 text-xs text-sky-600 dark:text-sky-400">本地运行，无需 API Key，首次需下载模型（约 6 GB）</p>}
              {videoGenProvider === 'kling' && <p className="mt-1.5 text-xs text-slate-400 dark:text-slate-500">快手可灵（klingai.com）。API Key 直接粘贴官方格式：Access Key: xxx Secret Key: xxx</p>}
              {(videoGenProvider === 'wan_video' || videoGenProvider === 'runway' || videoGenProvider === 'pika' || videoGenProvider === 'sora') && <p className="mt-1.5 text-xs text-amber-500">暂不支持，敬请期待</p>}
            </div>
            {!isLocal && (
              <div>
                <label className={labelCls}>API Key</label>
                <input className={fieldCls} type="password" value={apiKey} onChange={e => setApiKey(e.target.value)}
                  placeholder={videoGenProvider === 'kling' ? '粘贴：Access Key: xxx Secret Key: xxx' : 'sk-... / Bearer ...'} />
              </div>
            )}
            <div>
              <label className={labelCls}>模型</label>
              <ComboSelect
                value={videoGenModel}
                onChange={setVideoGenModel}
                options={models.map(m => ({ value: m, label: m }))}
                placeholder={models[0] ? `默认：${models[0]}` : '输入模型名称'}
                allowCustom
              />
              {videoGenModel === 'Wan2.1-T2V-1.3B' && <p className="mt-1.5 text-xs text-slate-400 dark:text-slate-500">文生视频（T2V），1.3B 轻量本地版</p>}
              {videoGenModel === 'Wan2.1-I2V-1.3B' && <p className="mt-1.5 text-xs text-slate-400 dark:text-slate-500">图生视频（I2V），需配合上方参考图片使用</p>}
              {videoGenModel === 'kling-v2' && <p className="mt-1.5 text-xs text-slate-400 dark:text-slate-500">可灵最新版，画质最佳</p>}
              {videoGenModel === 'kling-v1-5' && <p className="mt-1.5 text-xs text-slate-400 dark:text-slate-500">可灵 v1.5，速度与质量平衡</p>}
            </div>
            {supportsI2v && (
              <div>
                <label className={labelCls}>生成模式</label>
                <div className="flex gap-2">
                  {(['t2v', 'i2v'] as const).map(mode => (
                    <button key={mode} onClick={() => setVideoGenMode(mode)}
                      className={`flex-1 rounded-xl border py-2 text-sm font-medium transition-all ${
                        videoGenMode === mode
                          ? 'border-violet-400 bg-violet-50 text-violet-700 dark:bg-violet-900/30 dark:text-violet-300'
                          : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400'
                      }`}>
                      {mode === 't2v' ? '文字生视频' : '图片生视频'}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {videoGenMode === 'i2v' && (
              <div>
                <label className={labelCls}>参考图片</label>
                <FileDrop
                  files={videoGenImageFile ? [videoGenImageFile] : []}
                  onAdd={fs => setVideoGenImageFile(fs[0])}
                  onRemove={() => setVideoGenImageFile(null)}
                  accept="image/*"
                  compact
                  iconType="image"
                  emptyLabel="点击或拖拽参考图片"
                />
              </div>
            )}
            <div>
              <label className={labelCls}>时长（秒）</label>
              <ComboSelect
                value={String(videoGenDuration)}
                onChange={v => setVideoGenDuration(Number(v))}
                options={durations.map(d => ({ value: String(d), label: `${d} 秒` }))}
                placeholder="选择时长"
              />
            </div>
            <div>
              <label className={labelCls}>视频描述（提示词）</label>
              <textarea rows={4} className={fieldCls} value={videoGenPrompt} onChange={e => setVideoGenPrompt(e.target.value)} placeholder="描述视频内容和动作，越详细越好..." />
            </div>
            <button
              className={btnPrimary}
              disabled={busy || isUnsupported || (!videoGenPrompt.trim() && videoGenMode === 't2v') || (!videoGenImageFile && videoGenMode === 'i2v')}
              onClick={onRunVideoGen}>
              {busy ? '生成中...' : isUnsupported ? '暂不支持' : '生成视频'}
            </button>
          </div>
        );
      })()}

      {/* ── OCR 文档识别 ── */}
      {miscSubPage === 'ocr' && (() => {
        const isLocal = LOCAL_PROVIDERS.has(ocrProvider);
        const isUnsupported = UNSUPPORTED_PROVIDERS.has(ocrProvider);
        const models = OCR_MODELS[ocrProvider] || [];
        return (
          <div className="rounded-2xl border border-slate-200/80 dark:border-slate-700/80 bg-white dark:bg-slate-900 shadow-panel p-5 space-y-4">
            {isLocal
              ? <ProcessFlow steps={OCR_FLOW_LOCAL} color="#0369a1" />
              : <ProcessFlow steps={OCR_FLOW_CLOUD} color="#0369a1" />}
            <div>
              <label className={labelCls}>服务商</label>
              <div className="grid grid-cols-2 gap-2">
                {OCR_PROVIDERS.map(p => (
                  <button key={p} onClick={() => onOcrProviderChange(p)} className={`${PILL_BASE} ${ocrProvider === p ? PILL_ON : PILL_OFF}`}>
                    {shortProv(OCR_PROVIDER_LABELS[p] || p)}
                  </button>
                ))}
              </div>
              {ocrProvider === 'got_ocr' && <p className="mt-1.5 text-xs text-sky-600 dark:text-sky-400">支持复杂图表、数学公式、扫描文档，首次需下载模型（约 1 GB）</p>}
              {ocrProvider === 'azure_doc' && <p className="mt-1.5 text-xs text-amber-500">暂不支持，敬请期待</p>}
              {ocrProvider === 'openai' && <p className="mt-1.5 text-xs text-slate-400 dark:text-slate-500">基于 GPT-4o 视觉能力，适合通用文字与排版识别</p>}
              {ocrProvider === 'gemini' && <p className="mt-1.5 text-xs text-slate-400 dark:text-slate-500">基于 Gemini 视觉能力，免费额度充足，适合批量识别</p>}
            </div>
            {!isLocal && (
              <div>
                <label className={labelCls}>API Key</label>
                <input className={fieldCls} type="password" value={apiKey} onChange={e => setApiKey(e.target.value)} placeholder="sk-... / AIza... / Bearer ..." />
              </div>
            )}
            <div>
              <label className={labelCls}>模型</label>
              <ComboSelect
                value={ocrModel}
                onChange={setOcrModel}
                options={models.map(m => ({ value: m, label: m }))}
                placeholder={models[0] ? `默认：${models[0]}` : '输入模型名称'}
                allowCustom
              />
              {ocrModel === 'gpt-4o' && <p className="mt-1.5 text-xs text-slate-400 dark:text-slate-500">识别精度最高，价格较贵</p>}
              {ocrModel === 'gpt-4o-mini' && <p className="mt-1.5 text-xs text-slate-400 dark:text-slate-500">速度快、价格低，适合简单文档</p>}
              {ocrModel === 'gemini-2.5-flash' && <p className="mt-1.5 text-xs text-slate-400 dark:text-slate-500">速度快，免费额度充足</p>}
              {ocrModel === 'gemini-2.5-pro' && <p className="mt-1.5 text-xs text-slate-400 dark:text-slate-500">精度更高，适合复杂版面</p>}
            </div>
            <div>
              <label className={labelCls}>上传图片 / 文档（PDF、PNG、JPG 等）</label>
              <FileDrop
                files={ocrFile ? [ocrFile] : []}
                onAdd={fs => setOcrFile(fs[0])}
                onRemove={() => setOcrFile(null)}
                accept="image/*,.pdf"
                compact
                iconType="image"
                emptyLabel="点击或拖拽图片/PDF"
              />
            </div>
            <button className={`${btnPrimary} !bg-teal-600 hover:!bg-teal-700`} disabled={busy || !ocrFile || isUnsupported} onClick={onRunOcr}>
              {busy ? '识别中...' : isUnsupported ? '暂不支持' : '开始 OCR 识别'}
            </button>
          </div>
        );
      })()}

      {/* ── 口型同步 ── */}
      {miscSubPage === 'lipsync' && (() => {
        const isLocal = LOCAL_PROVIDERS.has(lipsyncProvider);
        const isUnsupported = UNSUPPORTED_PROVIDERS.has(lipsyncProvider);
        const models = LIPSYNC_MODELS[lipsyncProvider] || [];
        return (
          <div className="rounded-2xl border border-slate-200/80 dark:border-slate-700/80 bg-white dark:bg-slate-900 shadow-panel p-5 space-y-4">
            <div>
              <label className={labelCls}>服务商</label>
              <div className="grid grid-cols-2 gap-2">
                {LIPSYNC_PROVIDERS.map(p => (
                  <button key={p} onClick={() => onLipsyncProviderChange(p)} className={`${PILL_BASE} ${lipsyncProvider === p ? PILL_ON : PILL_OFF}`}>
                    {shortProv(LIPSYNC_PROVIDER_LABELS[p] || p)}
                  </button>
                ))}
              </div>
              {lipsyncProvider === 'liveportrait' && <p className="mt-1.5 text-xs text-sky-600 dark:text-sky-400">本地运行，用驱动视频的表情/动作生成人物动画，无需 API Key</p>}
              {(lipsyncProvider === 'sadtalker' || lipsyncProvider === 'heygen' || lipsyncProvider === 'did') && <p className="mt-1.5 text-xs text-amber-500">暂不支持，敬请期待</p>}
            </div>
            {/* 实际运行流程 */}
            <ProcessFlow steps={LIPSYNC_FLOWS[lipsyncProvider] || LIPSYNC_FLOWS['liveportrait']} color="#be185d" />
            {!isLocal && (
              <div>
                <label className={labelCls}>API Key</label>
                <input className={fieldCls} type="password" value={apiKey} onChange={e => setApiKey(e.target.value)} placeholder="sk-... / Bearer ..." />
              </div>
            )}
            {models.length > 0 && (
              <div>
                <label className={labelCls}>模型</label>
                <ComboSelect
                  value={lipsyncModel}
                  onChange={setLipsyncModel}
                  options={models.map(m => ({ value: m, label: m }))}
                  allowCustom
                  placeholder="选择模型"
                />
              </div>
            )}
            <div>
              <label className={labelCls}>
                {lipsyncProvider === 'liveportrait' ? '人物图片（源人脸）' : '视频 / 人物图片（驱动源）'}
              </label>
              <FileDrop
                files={lipsyncVideoFile ? [lipsyncVideoFile] : []}
                onAdd={fs => setLipsyncVideoFile(fs[0])}
                onRemove={() => setLipsyncVideoFile(null)}
                accept={lipsyncProvider === 'liveportrait' ? 'image/*' : 'video/*,image/*'}
                compact
                iconType={lipsyncProvider === 'liveportrait' ? 'image' : 'file'}
                emptyLabel={lipsyncProvider === 'liveportrait' ? '点击或拖拽人物图片' : '点击或拖拽视频/图片'}
              />
            </div>
            <div>
              <label className={labelCls}>
                {lipsyncProvider === 'liveportrait' ? '驱动视频（提供动作/表情）' : '音频文件（目标口型音频）'}
              </label>
              <FileDrop
                files={lipsyncAudioFile ? [lipsyncAudioFile] : []}
                onAdd={fs => setLipsyncAudioFile(fs[0])}
                onRemove={() => setLipsyncAudioFile(null)}
                accept={lipsyncProvider === 'liveportrait' ? 'video/*' : 'audio/*'}
                compact
                iconType={lipsyncProvider === 'liveportrait' ? 'file' : 'audio'}
                emptyLabel={lipsyncProvider === 'liveportrait' ? '点击或拖拽驱动视频' : '点击或拖拽音频文件'}
              />
            </div>
            <button className={`${btnPrimary} !bg-teal-600 hover:!bg-teal-700`} disabled={busy || !lipsyncVideoFile || !lipsyncAudioFile || isUnsupported} onClick={onRunLipsync}>
              {busy ? '处理中...' : isUnsupported ? '暂不支持' : '开始口型同步'}
            </button>
          </div>
        );
      })()}
    </div>
  );
}
