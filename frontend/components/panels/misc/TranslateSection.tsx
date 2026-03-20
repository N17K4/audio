'use client';

import ComboSelect from '../../shared/ComboSelect';
import ModelInput, { INPUT_CLS } from '../../shared/ModelInput';
import ProcessFlow from '../../shared/ProcessFlow';
import type { Status } from '../../../types';
import {
  TRANSLATE_PROVIDERS, TRANSLATE_LANGUAGES, PROVIDER_LABELS, DEFAULT_MODELS,
} from '../../../constants';
import { TRANSLATE_FLOW } from '../../../constants/flows';

interface TranslateSectionProps {
  status: Status;
  apiKey: string;
  setApiKey: (k: string) => void;
  cloudEndpoint: string;
  setCloudEndpoint: (e: string) => void;
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
  labelCls: string;
  fieldCls: string;
}

const btnPrimary = 'w-full rounded-xl bg-violet-600 hover:bg-violet-700 disabled:opacity-50 px-4 py-2.5 text-sm font-semibold text-white transition-colors';

export default function TranslateSection({
  status, apiKey, setApiKey, cloudEndpoint, setCloudEndpoint,
  translateProvider, setTranslateProvider,
  translateText, setTranslateText,
  translateTarget, setTranslateTarget,
  translateSource, setTranslateSource,
  translateModel, setTranslateModel,
  onRunTranslate,
  labelCls, fieldCls,
}: TranslateSectionProps) {
  const busy = status === 'processing';
  const isOllama = translateProvider === 'ollama';

  return (
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
        {isOllama ? (
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
  );
}
