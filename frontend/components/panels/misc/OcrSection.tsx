'use client';

import ComboSelect from '../../shared/ComboSelect';
import FileDrop from '../../shared/FileDrop';
import ProcessFlow from '../../shared/ProcessFlow';
import type { Status } from '../../../types';
import {
  OCR_PROVIDERS, OCR_PROVIDER_LABELS, OCR_MODELS,
  LOCAL_PROVIDERS, UNSUPPORTED_PROVIDERS,
} from '../../../constants';
import { OCR_FLOW_LOCAL, OCR_FLOW_CLOUD } from '../../../constants/flows';

const PILL_BASE = 'rounded-xl border px-2 py-2 text-xs font-medium transition-all text-center leading-tight';
const PILL_ON  = 'border-violet-400 bg-violet-50 text-violet-700 dark:bg-violet-900/30 dark:border-violet-500 dark:text-violet-300';
const PILL_OFF = 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400 hover:border-slate-300 dark:hover:border-slate-600 hover:bg-slate-50 dark:hover:bg-slate-800/50';
const btnPrimary = 'w-full rounded-xl bg-violet-600 hover:bg-violet-700 disabled:opacity-50 px-4 py-2.5 text-sm font-semibold text-white transition-colors';

function shortProv(label: string): string {
  return label.replace(/（[^）]*）/g, '').replace(/【[^】]*】/g, '').trim();
}

interface OcrSectionProps {
  status: Status;
  apiKey: string;
  setApiKey: (k: string) => void;
  ocrProvider: string;
  onOcrProviderChange: (p: string) => void;
  ocrFile: File | null;
  setOcrFile: (f: File | null) => void;
  ocrModel: string;
  setOcrModel: (m: string) => void;
  ocrLocalUrl: string;
  setOcrLocalUrl: (u: string) => void;
  onRunOcr: () => void;
  labelCls: string;
  fieldCls: string;
}

export default function OcrSection({
  status, apiKey, setApiKey,
  ocrProvider, onOcrProviderChange,
  ocrFile, setOcrFile,
  ocrModel, setOcrModel,
  onRunOcr,
  labelCls, fieldCls,
}: OcrSectionProps) {
  const busy = status === 'processing';
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
}
