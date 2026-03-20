'use client';

import ComboSelect from '../../shared/ComboSelect';
import FileDrop from '../../shared/FileDrop';
import ProcessFlow from '../../shared/ProcessFlow';
import OutputDirRow from '../../shared/OutputDirRow';
import type { Status } from '../../../types';
import {
  IMG_I2I_PROVIDERS, IMG_I2I_PROVIDER_LABELS, IMG_I2I_MODELS,
  LOCAL_PROVIDERS, UNSUPPORTED_PROVIDERS,
} from '../../../constants';
import { IMG_I2I_FLOW_FACEFUSION, IMG_I2I_FLOW_COMFYUI } from '../../../constants/flows';

const PILL_BASE = 'rounded-xl border px-2 py-2 text-xs font-medium transition-all text-center leading-tight';
const PILL_ON  = 'border-violet-400 bg-violet-50 text-violet-700 dark:bg-violet-900/30 dark:border-violet-500 dark:text-violet-300';
const PILL_OFF = 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400 hover:border-slate-300 dark:hover:border-slate-600 hover:bg-slate-50 dark:hover:bg-slate-800/50';
const btnPrimary = 'w-full rounded-xl bg-violet-600 hover:bg-violet-700 disabled:opacity-50 px-4 py-2.5 text-sm font-semibold text-white transition-colors';

function shortProv(label: string): string {
  return label.replace(/（[^）]*）/g, '').replace(/【[^】]*】/g, '').trim();
}

interface ImgI2iSectionProps {
  status: Status;
  apiKey: string;
  setApiKey: (k: string) => void;
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
  outputDir: string;
  setOutputDir: (v: string) => void;
  labelCls: string;
  fieldCls: string;
  btnSec: string;
}

export default function ImgI2iSection({
  status, apiKey, setApiKey,
  imgI2iProvider, onImgI2iProviderChange,
  imgI2iSourceFile, setImgI2iSourceFile,
  imgI2iRefFile, setImgI2iRefFile,
  imgI2iPrompt, setImgI2iPrompt,
  imgI2iModel, setImgI2iModel,
  imgI2iStrength, setImgI2iStrength,
  imgI2iComfyUrl, setImgI2iComfyUrl,
  onRunImgI2i,
  outputDir, setOutputDir,
  labelCls, fieldCls, btnSec,
}: ImgI2iSectionProps) {
  const busy = status === 'processing';
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
        {imgI2iProvider === 'facefusion' && <p className="mt-1.5 text-xs text-amber-600 dark:text-amber-400">Mac 用户：FaceFusion 在 Apple Silicon 上回退 CPU 模式，速度较慢</p>}
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
      <OutputDirRow required outputDir={outputDir} setOutputDir={setOutputDir} fieldCls={fieldCls} labelCls={labelCls} btnSec={btnSec} />
      <button className={`${btnPrimary} !bg-rose-600 hover:!bg-rose-700`} disabled={busy || !imgI2iSourceFile || isUnsupported} onClick={onRunImgI2i}>
        {busy ? '处理中...' : isUnsupported ? '暂不支持' : '开始换脸换图'}
      </button>
    </div>
  );
}
