import type { Status } from '../../types';
import { IMG_I2I_PROVIDERS, IMG_I2I_PROVIDER_LABELS, IMG_I2I_MODELS, LOCAL_PROVIDERS, UNSUPPORTED_PROVIDERS } from '../../constants';
import ComboSelect from '../shared/ComboSelect';
import FileDrop from '../shared/FileDrop';

interface ImageI2IPanelProps {
  status: Status;
  apiKey: string;
  setApiKey: (k: string) => void;
  cloudEndpoint: string;
  setCloudEndpoint: (e: string) => void;
  imgI2iProvider: string;
  onProviderChange: (p: string) => void;
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
  onRun: () => void;
  fieldCls: string;
  fileCls: string;
  labelCls: string;
}

const btnPrimary = 'w-full rounded-xl bg-rose-600 hover:bg-rose-700 disabled:opacity-50 px-4 py-2.5 text-sm font-semibold text-white transition-colors';

export default function ImageI2IPanel({
  status, apiKey, setApiKey, cloudEndpoint, setCloudEndpoint,
  imgI2iProvider, onProviderChange,
  imgI2iSourceFile, setImgI2iSourceFile,
  imgI2iRefFile, setImgI2iRefFile,
  imgI2iPrompt, setImgI2iPrompt,
  imgI2iModel, setImgI2iModel,
  imgI2iStrength, setImgI2iStrength,
  imgI2iComfyUrl, setImgI2iComfyUrl,
  onRun,
  fieldCls, fileCls, labelCls,
}: ImageI2IPanelProps) {
  const busy = status === 'processing';
  const isComfyUI = imgI2iProvider === 'comfyui';
  const isLocal = LOCAL_PROVIDERS.has(imgI2iProvider);
  const isUnsupported = UNSUPPORTED_PROVIDERS.has(imgI2iProvider);
  const models = IMG_I2I_MODELS[imgI2iProvider] || [];

  return (
    <div className="rounded-2xl border border-slate-200/80 dark:border-slate-700/80 bg-white dark:bg-slate-900 shadow-panel p-5 space-y-4">
      {/* 服务商下拉 */}
      <div>
        <label className={labelCls}>服务商</label>
        <ComboSelect
          value={imgI2iProvider}
          onChange={onProviderChange}
          options={IMG_I2I_PROVIDERS.map(p => ({ value: p, label: IMG_I2I_PROVIDER_LABELS[p] || p }))}
          placeholder="选择服务商"
        />
      </div>

      {/* 认证 */}
      {isComfyUI ? (
        <div>
          <label className={labelCls}>ComfyUI 服务地址</label>
          <input className={fieldCls} value={imgI2iComfyUrl} onChange={e => setImgI2iComfyUrl(e.target.value)}
            placeholder="http://127.0.0.1:8188" />
        </div>
      ) : !isLocal ? (
        <div>
          <label className={labelCls}>API Key</label>
          <input className={fieldCls} type="password" value={apiKey} onChange={e => setApiKey(e.target.value)}
            placeholder="sk-... / Bearer ..." />
        </div>
      ) : null}

      {/* 模型 */}
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

      {/* 源图片 */}
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

      {/* 参考图片（换脸用） */}
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

      {/* 提示词 */}
      <div>
        <label className={labelCls}>提示词（描述目标效果，可选）</label>
        <textarea rows={3} className={fieldCls}
          value={imgI2iPrompt} onChange={e => setImgI2iPrompt(e.target.value)}
          placeholder="如：保持原来姿势，换成水墨画风格..." />
      </div>

      {/* 变化强度 */}
      <div>
        <label className={labelCls}>变化强度 {imgI2iStrength.toFixed(2)}（0 = 几乎不变，1 = 完全重绘）</label>
        <input type="range" min={0} max={1} step={0.05}
          value={imgI2iStrength}
          onChange={e => setImgI2iStrength(Number(e.target.value))}
          className="w-full accent-rose-500" />
      </div>

      <button className={btnPrimary} disabled={busy || !imgI2iSourceFile || isUnsupported} onClick={onRun}>
        {busy ? '处理中...' : isUnsupported ? '暂不支持' : '开始换脸换图'}
      </button>
    </div>
  );
}
