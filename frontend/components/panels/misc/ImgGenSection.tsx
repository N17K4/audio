'use client';

import ComboSelect from '../../shared/ComboSelect';
import ProcessFlow from '../../shared/ProcessFlow';
import OutputDirRow from '../../shared/OutputDirRow';
import type { Status } from '../../../types';
import {
  IMG_GEN_PROVIDERS, IMG_GEN_PROVIDER_LABELS, IMG_GEN_MODELS, IMG_GEN_SIZES,
  LOCAL_PROVIDERS, UNSUPPORTED_PROVIDERS, cleanProviderLabel,
} from '../../../constants';
import { IMG_GEN_FLOW_LOCAL, IMG_GEN_FLOW_CLOUD } from '../../../constants/flows';
import { pillBase, pillOn, pillOff, btnMiscPrimary } from '../../../constants/styles';

interface ImgGenSectionProps {
  status: Status;
  apiKey: string;
  setApiKey: (k: string) => void;
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
  outputDir: string;
  setOutputDir: (v: string) => void;
  labelCls: string;
  fieldCls: string;
  btnSec: string;
}

export default function ImgGenSection({
  status, apiKey, setApiKey,
  imgGenProvider, onImgGenProviderChange,
  imgGenPrompt, setImgGenPrompt,
  imgGenModel, setImgGenModel,
  imgGenSize, setImgGenSize,
  imgGenComfyUrl, setImgGenComfyUrl,
  onRunImgGen,
  outputDir, setOutputDir,
  labelCls, fieldCls, btnSec,
}: ImgGenSectionProps) {
  const busy = status === 'processing';
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
            <button key={p} onClick={() => onImgGenProviderChange(p)} className={`${pillBase} ${imgGenProvider === p ? pillOn : pillOff}`}>
              {cleanProviderLabel(IMG_GEN_PROVIDER_LABELS[p] || p)}
            </button>
          ))}
        </div>
        {imgGenProvider === 'sd_local' && <p className="mt-1.5 text-xs text-sky-600 dark:text-sky-400">本地运行，无需 API Key，首次需安装模型（约 2.3 GB，运行 pnpm run checkpoints --engine sd）</p>}
        {imgGenProvider === 'flux' && <p className="mt-1.5 text-xs text-amber-600 dark:text-amber-400">Flux 已被 SD-Turbo 替代（Flux 需 ~30 GB + HF 账号）。如需使用，手动运行 pnpm run checkpoints --engine flux</p>}
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
      <OutputDirRow required outputDir={outputDir} setOutputDir={setOutputDir} fieldCls={fieldCls} labelCls={labelCls} btnSec={btnSec} />
      <button className={`${btnMiscPrimary} !bg-pink-600 hover:!bg-pink-700`} disabled={busy || !imgGenPrompt.trim() || isUnsupported} onClick={onRunImgGen}>
        {busy ? '生成中...' : isUnsupported ? '暂不支持' : '生成图像'}
      </button>
    </div>
  );
}
