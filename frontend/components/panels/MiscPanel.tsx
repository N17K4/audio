import { useRef, useEffect } from 'react';
import type { MiscSubPage, Status, ChatMessage } from '../../types';
import {
  IMAGE_GEN_PROVIDERS, IMAGE_GEN_PROVIDER_LABELS, IMAGE_GEN_MODELS, IMAGE_GEN_SIZES,
  IMAGE_UNDERSTAND_PROVIDERS, IMAGE_UNDERSTAND_PROVIDER_LABELS, IMAGE_UNDERSTAND_MODELS,
  TRANSLATE_PROVIDERS, TRANSLATE_LANGUAGES, PROVIDER_LABELS,
  DEFAULT_MODELS,
  IMG_GEN_PROVIDERS, IMG_GEN_PROVIDER_LABELS, IMG_GEN_MODELS, IMG_GEN_SIZES,
  IMG_I2I_PROVIDERS, IMG_I2I_PROVIDER_LABELS, IMG_I2I_MODELS,
  VIDEO_GEN_PROVIDERS, VIDEO_GEN_PROVIDER_LABELS, VIDEO_GEN_MODELS, VIDEO_GEN_DURATIONS,
  OCR_PROVIDERS, OCR_PROVIDER_LABELS, OCR_MODELS,
  LIPSYNC_PROVIDERS, LIPSYNC_PROVIDER_LABELS, LIPSYNC_MODELS,
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
}

const ROW1_TABS: { key: MiscSubPage; label: string; icon: string }[] = [
  { key: 'image_gen',        label: '图像生成',  icon: '🖼️' },
  { key: 'image_understand', label: '图像理解',  icon: '🔍' },
  { key: 'translate',        label: '文字翻译',  icon: '🌐' },
  { key: 'code_assist',      label: '代码助手',  icon: '💻' },
];

const ROW2_TABS: { key: MiscSubPage; label: string; icon: string }[] = [
  { key: 'img_gen',   label: '图像生成',  icon: '✨' },
  { key: 'img_i2i',  label: '换脸换图',  icon: '🔄' },
  { key: 'video_gen', label: '视频生成',  icon: '🎬' },
];

const ROW3_TABS: { key: MiscSubPage; label: string; icon: string }[] = [
  { key: 'ocr',     label: 'OCR 文档',  icon: '📄' },
  { key: 'lipsync', label: '口型同步',  icon: '💋' },
];

const CODE_PROVIDERS = ['gemini', 'openai', 'claude', 'deepseek', 'groq', 'mistral', 'xai', 'ollama', 'github'];

const btnPrimary = 'w-full rounded-xl bg-violet-600 hover:bg-violet-700 disabled:opacity-50 px-4 py-2.5 text-sm font-semibold text-white transition-colors';

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
}: MiscPanelProps) {
  const busy = status === 'processing';
  const codeScrollRef = useRef<HTMLDivElement>(null);

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
      {/* 子页签 - 第一行 */}
      <div className="space-y-1.5">
        <div className="flex gap-1.5 rounded-2xl bg-slate-100 dark:bg-slate-800 p-1">
          {ROW1_TABS.map(tab => (
            <button
              key={tab.key}
              onClick={() => setMiscSubPage(tab.key)}
              className={`flex-1 flex items-center justify-center gap-1.5 rounded-xl py-2 text-sm font-medium transition-all ${
                miscSubPage === tab.key
                  ? 'bg-white dark:bg-slate-700 text-violet-600 dark:text-violet-400 shadow-sm'
                  : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'
              }`}>
              <span>{tab.icon}</span>
              <span>{tab.label}</span>
            </button>
          ))}
        </div>
        {/* 第二行：本地/云端图像视频生成 */}
        <div className="flex gap-1.5 rounded-2xl bg-slate-100/70 dark:bg-slate-800/70 p-1">
          {ROW2_TABS.map(tab => (
            <button
              key={tab.key}
              onClick={() => setMiscSubPage(tab.key)}
              className={`flex-1 flex items-center justify-center gap-1.5 rounded-xl py-2 text-sm font-medium transition-all ${
                miscSubPage === tab.key
                  ? 'bg-white dark:bg-slate-700 text-pink-600 dark:text-pink-400 shadow-sm'
                  : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'
              }`}>
              <span>{tab.icon}</span>
              <span>{tab.label}</span>
            </button>
          ))}
        </div>
        {/* 第三行：OCR & 口型同步 */}
        <div className="flex gap-1.5 rounded-2xl bg-slate-100/50 dark:bg-slate-800/50 p-1">
          {ROW3_TABS.map(tab => (
            <button
              key={tab.key}
              onClick={() => setMiscSubPage(tab.key)}
              className={`flex-1 flex items-center justify-center gap-1.5 rounded-xl py-2 text-sm font-medium transition-all ${
                miscSubPage === tab.key
                  ? 'bg-white dark:bg-slate-700 text-teal-600 dark:text-teal-400 shadow-sm'
                  : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'
              }`}>
              <span>{tab.icon}</span>
              <span>{tab.label}</span>
            </button>
          ))}
        </div>
      </div>

      {/* ── 图像生成 ── */}
      {miscSubPage === 'image_gen' && (
        <div className="rounded-2xl border border-slate-200/80 dark:border-slate-700/80 bg-white dark:bg-slate-900 shadow-panel p-5 space-y-4">
          <div>
            <label className={labelCls}>服务商</label>
            <div className="grid grid-cols-2 gap-2">
              {IMAGE_GEN_PROVIDERS.map(p => (
                <button key={p}
                  onClick={() => onImageGenProviderChange(p)}
                  className={`rounded-xl border px-3 py-2 text-sm font-medium transition-all text-left ${
                    imageGenProvider === p
                      ? 'border-violet-400 bg-violet-50 text-violet-700 dark:bg-violet-900/30 dark:text-violet-300'
                      : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400 hover:border-slate-300 dark:hover:border-slate-600'
                  }`}>
                  {IMAGE_GEN_PROVIDER_LABELS[p] || p}
                </button>
              ))}
            </div>
          </div>

          <ApiKeyRow />

          <div>
            <label className={labelCls}>模型</label>
            <input list="image-gen-model-list" className={fieldCls}
              value={imageGenModel} onChange={e => setImageGenModel(e.target.value)}
              placeholder="dall-e-3" />
            <datalist id="image-gen-model-list">
              {(IMAGE_GEN_MODELS[imageGenProvider] || []).map(m => <option key={m} value={m} />)}
            </datalist>
          </div>

          <div>
            <label className={labelCls}>{imageGenProvider === 'openai' || imageGenProvider === 'dashscope' ? '尺寸' : '比例'}</label>
            <select className={fieldCls} value={imageGenSize} onChange={e => setImageGenSize(e.target.value)}>
              {(IMAGE_GEN_SIZES[imageGenProvider] || []).map(s => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </div>

          <div>
            <label className={labelCls}>图像描述（提示词）</label>
            <textarea rows={4} className={fieldCls}
              value={imageGenPrompt} onChange={e => setImageGenPrompt(e.target.value)}
              placeholder="描述你想生成的图像内容，越详细越好..." />
          </div>

          <button className={btnPrimary} disabled={busy} onClick={onRunImageGen}>
            {busy ? '生成中...' : '生成图像'}
          </button>
        </div>
      )}

      {/* ── 图像理解 ── */}
      {miscSubPage === 'image_understand' && (
        <div className="rounded-2xl border border-slate-200/80 dark:border-slate-700/80 bg-white dark:bg-slate-900 shadow-panel p-5 space-y-4">
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
            <input list="image-understand-model-list" className={fieldCls}
              value={imageUnderstandModel} onChange={e => setImageUnderstandModel(e.target.value)}
              placeholder="gpt-4o-mini" />
            <datalist id="image-understand-model-list">
              {(IMAGE_UNDERSTAND_MODELS[imageUnderstandProvider] || []).map(m => <option key={m} value={m} />)}
            </datalist>
          </div>

          <div>
            <label className={labelCls}>上传图片</label>
            <input type="file" accept="image/*" className={fileCls}
              onChange={e => setImageUnderstandFile(e.target.files?.[0] ?? null)} />
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
          <div>
            <label className={labelCls}>服务商</label>
            <div className="grid grid-cols-3 gap-2">
              {TRANSLATE_PROVIDERS.map(p => (
                <button key={p}
                  onClick={() => {
                    setTranslateProvider(p);
                    setTranslateModel((DEFAULT_MODELS.llm?.[p]) || '');
                  }}
                  className={`rounded-xl border px-2 py-2 text-xs font-medium transition-all text-center ${
                    translateProvider === p
                      ? 'border-violet-400 bg-violet-50 text-violet-700 dark:bg-violet-900/30 dark:text-violet-300'
                      : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400 hover:border-slate-300 dark:hover:border-slate-600'
                  }`}>
                  {PROVIDER_LABELS[p] || p}
                </button>
              ))}
            </div>
          </div>

          <ApiKeyRow forOllama={isOllamaTranslate} />

          <div>
            <label className={labelCls}>模型</label>
            <input className={fieldCls}
              value={translateModel} onChange={e => setTranslateModel(e.target.value)}
              placeholder={DEFAULT_MODELS.llm?.[translateProvider] || ''} />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>源语言</label>
              <select className={fieldCls} value={translateSource} onChange={e => setTranslateSource(e.target.value)}>
                <option value="自动检测">自动检测</option>
                {TRANSLATE_LANGUAGES.map(l => <option key={l} value={l}>{l}</option>)}
              </select>
            </div>
            <div>
              <label className={labelCls}>目标语言</label>
              <select className={fieldCls} value={translateTarget} onChange={e => setTranslateTarget(e.target.value)}>
                {TRANSLATE_LANGUAGES.map(l => <option key={l} value={l}>{l}</option>)}
              </select>
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
          {/* 配置栏 */}
          <div className="p-4 border-b border-slate-100 dark:border-slate-800 space-y-3">
            <div>
              <label className={labelCls}>服务商</label>
              <div className="grid grid-cols-3 gap-1.5">
                {CODE_PROVIDERS.map(p => (
                  <button key={p}
                    onClick={() => {
                      setCodeProvider(p);
                      setCodeModel(DEFAULT_MODELS.llm?.[p] || '');
                    }}
                    className={`rounded-xl border px-2 py-1.5 text-xs font-medium transition-all text-center ${
                      codeProvider === p
                        ? 'border-violet-400 bg-violet-50 text-violet-700 dark:bg-violet-900/30 dark:text-violet-300'
                        : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400 hover:border-slate-300 dark:hover:border-slate-600'
                    }`}>
                    {PROVIDER_LABELS[p] || p}
                  </button>
                ))}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={labelCls}>API Key / 服务地址</label>
                {codeProvider === 'ollama'
                  ? <input className={fieldCls} value={cloudEndpoint} onChange={e => setCloudEndpoint(e.target.value)} placeholder="http://localhost:11434" />
                  : <input className={fieldCls} type="password" value={apiKey} onChange={e => setApiKey(e.target.value)} placeholder="sk-..." />
                }
              </div>
              <div>
                <label className={labelCls}>模型</label>
                <input className={fieldCls} value={codeModel} onChange={e => setCodeModel(e.target.value)}
                  placeholder={DEFAULT_MODELS.llm?.[codeProvider] || ''} />
              </div>
            </div>
            <div>
              <label className={labelCls}>语言/框架（可选）</label>
              <input className={fieldCls} value={codeLang} onChange={e => setCodeLang(e.target.value)}
                placeholder="Python / TypeScript / React / SQL ..." />
            </div>
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
        const isLocal = imgGenProvider === 'comfyui';
        const models = IMG_GEN_MODELS[imgGenProvider] || [];
        const sizes = IMG_GEN_SIZES[imgGenProvider] || [];
        const sizeLabel = imgGenProvider === 'openai' || imgGenProvider === 'dashscope' ? '尺寸' : '比例';
        return (
          <div className="rounded-2xl border border-slate-200/80 dark:border-slate-700/80 bg-white dark:bg-slate-900 shadow-panel p-5 space-y-4">
            <div>
              <label className={labelCls}>服务商</label>
              <select className={fieldCls} value={imgGenProvider} onChange={e => onImgGenProviderChange(e.target.value)}>
                {IMG_GEN_PROVIDERS.map(p => <option key={p} value={p}>{IMG_GEN_PROVIDER_LABELS[p] || p}</option>)}
              </select>
            </div>
            {isLocal ? (
              <div>
                <label className={labelCls}>ComfyUI 服务地址</label>
                <input className={fieldCls} value={imgGenComfyUrl} onChange={e => setImgGenComfyUrl(e.target.value)} placeholder="http://127.0.0.1:8188" />
              </div>
            ) : (
              <div>
                <label className={labelCls}>API Key</label>
                <input className={fieldCls} type="password" value={apiKey} onChange={e => setApiKey(e.target.value)} placeholder="sk-... / AIza... / Bearer ..." />
              </div>
            )}
            {models.length > 0 && (
              <div>
                <label className={labelCls}>模型</label>
                <select className={fieldCls} value={imgGenModel} onChange={e => setImgGenModel(e.target.value)}>
                  {models.map(m => <option key={m} value={m}>{m}</option>)}
                </select>
              </div>
            )}
            {sizes.length > 0 && (
              <div>
                <label className={labelCls}>{sizeLabel}</label>
                <select className={fieldCls} value={imgGenSize} onChange={e => setImgGenSize(e.target.value)}>
                  {sizes.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
            )}
            <div>
              <label className={labelCls}>图像描述（提示词）</label>
              <textarea rows={4} className={fieldCls} value={imgGenPrompt} onChange={e => setImgGenPrompt(e.target.value)} placeholder="描述你想生成的图像内容，越详细越好..." />
            </div>
            <button className={`${btnPrimary} !bg-pink-600 hover:!bg-pink-700`} disabled={busy || !imgGenPrompt.trim()} onClick={onRunImgGen}>
              {busy ? '生成中...' : '生成图像'}
            </button>
          </div>
        );
      })()}

      {/* ── 换脸换图 ── */}
      {miscSubPage === 'img_i2i' && (() => {
        const isLocal = imgI2iProvider === 'comfyui';
        const models = IMG_I2I_MODELS[imgI2iProvider] || [];
        return (
          <div className="rounded-2xl border border-slate-200/80 dark:border-slate-700/80 bg-white dark:bg-slate-900 shadow-panel p-5 space-y-4">
            <div>
              <label className={labelCls}>服务商</label>
              <select className={fieldCls} value={imgI2iProvider} onChange={e => onImgI2iProviderChange(e.target.value)}>
                {IMG_I2I_PROVIDERS.map(p => <option key={p} value={p}>{IMG_I2I_PROVIDER_LABELS[p] || p}</option>)}
              </select>
              {isLocal && (
                <p className="mt-1.5 text-xs text-amber-600 dark:text-amber-400">⚠️ Mac 用户：换脸功能建议使用云端服务商（ComfyUI 换脸节点在 Apple Silicon 上仅支持 CPU 模式，速度较慢）</p>
              )}
            </div>
            {isLocal ? (
              <div>
                <label className={labelCls}>ComfyUI 服务地址</label>
                <input className={fieldCls} value={imgI2iComfyUrl} onChange={e => setImgI2iComfyUrl(e.target.value)} placeholder="http://127.0.0.1:8188" />
              </div>
            ) : (
              <div>
                <label className={labelCls}>API Key</label>
                <input className={fieldCls} type="password" value={apiKey} onChange={e => setApiKey(e.target.value)} placeholder="sk-... / Bearer ..." />
              </div>
            )}
            {models.length > 0 && (
              <div>
                <label className={labelCls}>模型</label>
                <select className={fieldCls} value={imgI2iModel} onChange={e => setImgI2iModel(e.target.value)}>
                  {models.map(m => <option key={m} value={m}>{m}</option>)}
                </select>
              </div>
            )}
            <div>
              <label className={labelCls}>源图片（待处理）</label>
              <input type="file" accept="image/*" className={fileCls} onChange={e => setImgI2iSourceFile(e.target.files?.[0] ?? null)} />
            </div>
            <div>
              <label className={labelCls}>参考图片（换脸 / 风格参考，可选）</label>
              <input type="file" accept="image/*" className={fileCls} onChange={e => setImgI2iRefFile(e.target.files?.[0] ?? null)} />
            </div>
            <div>
              <label className={labelCls}>提示词（描述目标效果，可选）</label>
              <textarea rows={3} className={fieldCls} value={imgI2iPrompt} onChange={e => setImgI2iPrompt(e.target.value)} placeholder="如：保持原来姿势，换成水墨画风格..." />
            </div>
            <div>
              <label className={labelCls}>变化强度 {imgI2iStrength.toFixed(2)}（0 = 几乎不变，1 = 完全重绘）</label>
              <input type="range" min={0} max={1} step={0.05} value={imgI2iStrength} onChange={e => setImgI2iStrength(Number(e.target.value))} className="w-full accent-rose-500" />
            </div>
            <button className={`${btnPrimary} !bg-rose-600 hover:!bg-rose-700`} disabled={busy || !imgI2iSourceFile} onClick={onRunImgI2i}>
              {busy ? '处理中...' : '开始换脸换图'}
            </button>
          </div>
        );
      })()}

      {/* ── 视频生成 ── */}
      {miscSubPage === 'video_gen' && (() => {
        const models = VIDEO_GEN_MODELS[videoGenProvider] || [];
        const durations = VIDEO_GEN_DURATIONS[videoGenProvider] || [5];
        const supportsI2v = videoGenProvider === 'kling' || videoGenProvider === 'wan_video' || videoGenProvider === 'runway';
        return (
          <div className="rounded-2xl border border-slate-200/80 dark:border-slate-700/80 bg-white dark:bg-slate-900 shadow-panel p-5 space-y-4">
            <div>
              <label className={labelCls}>服务商</label>
              <select className={fieldCls} value={videoGenProvider} onChange={e => onVideoGenProviderChange(e.target.value)}>
                {VIDEO_GEN_PROVIDERS.map(p => <option key={p} value={p}>{VIDEO_GEN_PROVIDER_LABELS[p] || p}</option>)}
              </select>
            </div>
            <div>
              <label className={labelCls}>API Key</label>
              <input className={fieldCls} type="password" value={apiKey} onChange={e => setApiKey(e.target.value)} placeholder="sk-... / Bearer ..." />
            </div>
            {models.length > 0 && (
              <div>
                <label className={labelCls}>模型</label>
                <select className={fieldCls} value={videoGenModel} onChange={e => setVideoGenModel(e.target.value)}>
                  {models.map(m => <option key={m} value={m}>{m}</option>)}
                </select>
              </div>
            )}
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
                <input type="file" accept="image/*" className={fileCls} onChange={e => setVideoGenImageFile(e.target.files?.[0] ?? null)} />
              </div>
            )}
            <div>
              <label className={labelCls}>时长（秒）</label>
              <select className={fieldCls} value={videoGenDuration} onChange={e => setVideoGenDuration(Number(e.target.value))}>
                {durations.map(d => <option key={d} value={d}>{d} 秒</option>)}
              </select>
            </div>
            <div>
              <label className={labelCls}>视频描述（提示词）</label>
              <textarea rows={4} className={fieldCls} value={videoGenPrompt} onChange={e => setVideoGenPrompt(e.target.value)} placeholder="描述视频内容和动作，越详细越好..." />
            </div>
            <button
              className={btnPrimary}
              disabled={busy || (!videoGenPrompt.trim() && videoGenMode === 't2v') || (!videoGenImageFile && videoGenMode === 'i2v')}
              onClick={onRunVideoGen}>
              {busy ? '生成中...' : '生成视频'}
            </button>
          </div>
        );
      })()}

      {/* ── OCR 文档识别 ── */}
      {miscSubPage === 'ocr' && (() => {
        const isLocal = ocrProvider === 'got_ocr';
        const models = OCR_MODELS[ocrProvider] || [];
        return (
          <div className="rounded-2xl border border-slate-200/80 dark:border-slate-700/80 bg-white dark:bg-slate-900 shadow-panel p-5 space-y-4">
            <div>
              <label className={labelCls}>服务商</label>
              <select className={fieldCls} value={ocrProvider} onChange={e => onOcrProviderChange(e.target.value)}>
                {OCR_PROVIDERS.map(p => <option key={p} value={p}>{OCR_PROVIDER_LABELS[p] || p}</option>)}
              </select>
              {isLocal && (
                <p className="mt-1.5 text-xs text-sky-600 dark:text-sky-400">GOT-OCR2.0：支持复杂图表、数学公式、扫描文档，两台机器均可本地运行</p>
              )}
            </div>
            {isLocal ? (
              <div>
                <label className={labelCls}>本地服务地址</label>
                <input className={fieldCls} value={ocrLocalUrl} onChange={e => setOcrLocalUrl(e.target.value)} placeholder="http://127.0.0.1:8890" />
              </div>
            ) : (
              <div>
                <label className={labelCls}>API Key</label>
                <input className={fieldCls} type="password" value={apiKey} onChange={e => setApiKey(e.target.value)} placeholder="sk-... / AIza... / Bearer ..." />
              </div>
            )}
            {models.length > 0 && (
              <div>
                <label className={labelCls}>模型</label>
                <select className={fieldCls} value={ocrModel} onChange={e => setOcrModel(e.target.value)}>
                  {models.map(m => <option key={m} value={m}>{m}</option>)}
                </select>
              </div>
            )}
            <div>
              <label className={labelCls}>上传图片 / 文档（PDF、PNG、JPG 等）</label>
              <input type="file" accept="image/*,.pdf" className={fileCls} onChange={e => setOcrFile(e.target.files?.[0] ?? null)} />
            </div>
            <button className={`${btnPrimary} !bg-teal-600 hover:!bg-teal-700`} disabled={busy || !ocrFile} onClick={onRunOcr}>
              {busy ? '识别中...' : '开始 OCR 识别'}
            </button>
          </div>
        );
      })()}

      {/* ── 口型同步 ── */}
      {miscSubPage === 'lipsync' && (() => {
        const isLocal = lipsyncProvider === 'liveportrait' || lipsyncProvider === 'sadtalker';
        const models = LIPSYNC_MODELS[lipsyncProvider] || [];
        return (
          <div className="rounded-2xl border border-slate-200/80 dark:border-slate-700/80 bg-white dark:bg-slate-900 shadow-panel p-5 space-y-4">
            <div>
              <label className={labelCls}>服务商</label>
              <select className={fieldCls} value={lipsyncProvider} onChange={e => onLipsyncProviderChange(e.target.value)}>
                {LIPSYNC_PROVIDERS.map(p => <option key={p} value={p}>{LIPSYNC_PROVIDER_LABELS[p] || p}</option>)}
              </select>
              {isLocal && (
                <p className="mt-1.5 text-xs text-sky-600 dark:text-sky-400">LivePortrait：物理拟真度最高，~4GB VRAM，两台机器均支持（4050 CUDA / MBP MPS）</p>
              )}
            </div>
            {isLocal ? (
              <div>
                <label className={labelCls}>本地服务地址（Gradio / API）</label>
                <input className={fieldCls} value={lipsyncLocalUrl} onChange={e => setLipsyncLocalUrl(e.target.value)} placeholder="http://127.0.0.1:7860" />
              </div>
            ) : (
              <div>
                <label className={labelCls}>API Key</label>
                <input className={fieldCls} type="password" value={apiKey} onChange={e => setApiKey(e.target.value)} placeholder="sk-... / Bearer ..." />
              </div>
            )}
            {models.length > 0 && (
              <div>
                <label className={labelCls}>模型</label>
                <select className={fieldCls} value={lipsyncModel} onChange={e => setLipsyncModel(e.target.value)}>
                  {models.map(m => <option key={m} value={m}>{m}</option>)}
                </select>
              </div>
            )}
            <div>
              <label className={labelCls}>视频 / 人物图片（驱动源）</label>
              <input type="file" accept="video/*,image/*" className={fileCls} onChange={e => setLipsyncVideoFile(e.target.files?.[0] ?? null)} />
            </div>
            <div>
              <label className={labelCls}>音频文件（目标口型音频）</label>
              <input type="file" accept="audio/*" className={fileCls} onChange={e => setLipsyncAudioFile(e.target.files?.[0] ?? null)} />
            </div>
            <button className={`${btnPrimary} !bg-teal-600 hover:!bg-teal-700`} disabled={busy || !lipsyncVideoFile || !lipsyncAudioFile} onClick={onRunLipsync}>
              {busy ? '处理中...' : '开始口型同步'}
            </button>
          </div>
        );
      })()}
    </div>
  );
}
