'use client';

import ComboSelect from '../../shared/ComboSelect';
import FileDrop from '../../shared/FileDrop';
import ProcessFlow from '../../shared/ProcessFlow';
import type { Status } from '../../../types';
import {
  IMAGE_UNDERSTAND_PROVIDERS, IMAGE_UNDERSTAND_PROVIDER_LABELS, IMAGE_UNDERSTAND_MODELS,
} from '../../../constants';
import { IMG_UNDERSTAND_FLOW } from '../../../constants/flows';

interface ImageUnderstandSectionProps {
  status: Status;
  apiKey: string;
  setApiKey: (k: string) => void;
  cloudEndpoint: string;
  setCloudEndpoint: (e: string) => void;
  imageUnderstandProvider: string;
  onImageUnderstandProviderChange: (p: string) => void;
  imageUnderstandFile: File | null;
  setImageUnderstandFile: (f: File | null) => void;
  imageUnderstandPrompt: string;
  setImageUnderstandPrompt: (t: string) => void;
  imageUnderstandModel: string;
  setImageUnderstandModel: (m: string) => void;
  onRunImageUnderstand: () => void;
  labelCls: string;
  fieldCls: string;
}

const btnPrimary = 'w-full rounded-xl bg-violet-600 hover:bg-violet-700 disabled:opacity-50 px-4 py-2.5 text-sm font-semibold text-white transition-colors';

export default function ImageUnderstandSection({
  status, apiKey, setApiKey, cloudEndpoint, setCloudEndpoint,
  imageUnderstandProvider, onImageUnderstandProviderChange,
  imageUnderstandFile, setImageUnderstandFile,
  imageUnderstandPrompt, setImageUnderstandPrompt,
  imageUnderstandModel, setImageUnderstandModel,
  onRunImageUnderstand,
  labelCls, fieldCls,
}: ImageUnderstandSectionProps) {
  const busy = status === 'processing';
  const isOllama = imageUnderstandProvider === 'ollama';

  return (
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

      {isOllama ? (
        <div>
          <label className={labelCls}>Ollama 服务地址</label>
          <input className={fieldCls} value={cloudEndpoint} onChange={e => setCloudEndpoint(e.target.value)}
            placeholder="http://localhost:11434" />
        </div>
      ) : (
        <div>
          <label className={labelCls}>API Key</label>
          <input className={fieldCls} type="password" value={apiKey} onChange={e => setApiKey(e.target.value)}
            placeholder="sk-... / AIza... / sk-ant-..." />
        </div>
      )}

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
  );
}
