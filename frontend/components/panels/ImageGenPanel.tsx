import type { Status } from '../../types';
import { IMG_GEN_PROVIDERS, IMG_GEN_PROVIDER_LABELS, IMG_GEN_MODELS, IMG_GEN_SIZES, LOCAL_PROVIDERS, UNSUPPORTED_PROVIDERS } from '../../constants';
import ComboSelect from '../shared/ComboSelect';

interface ImageGenPanelProps {
  status: Status;
  apiKey: string;
  setApiKey: (k: string) => void;
  cloudEndpoint: string;
  setCloudEndpoint: (e: string) => void;
  imgGenProvider: string;
  onProviderChange: (p: string) => void;
  imgGenPrompt: string;
  setImgGenPrompt: (t: string) => void;
  imgGenModel: string;
  setImgGenModel: (m: string) => void;
  imgGenSize: string;
  setImgGenSize: (s: string) => void;
  imgGenComfyUrl: string;
  setImgGenComfyUrl: (u: string) => void;
  onRun: () => void;
  fieldCls: string;
  fileCls: string;
  labelCls: string;
}

const btnPrimary = 'w-full rounded-xl bg-pink-600 hover:bg-pink-700 disabled:opacity-50 px-4 py-2.5 text-sm font-semibold text-white transition-colors';

export default function ImageGenPanel({
  status, apiKey, setApiKey, cloudEndpoint, setCloudEndpoint,
  imgGenProvider, onProviderChange,
  imgGenPrompt, setImgGenPrompt,
  imgGenModel, setImgGenModel,
  imgGenSize, setImgGenSize,
  imgGenComfyUrl, setImgGenComfyUrl,
  onRun,
  fieldCls, fileCls, labelCls,
}: ImageGenPanelProps) {
  const busy = status === 'processing';
  const isComfyUI = imgGenProvider === 'comfyui';
  const isLocal = LOCAL_PROVIDERS.has(imgGenProvider);
  const isUnsupported = UNSUPPORTED_PROVIDERS.has(imgGenProvider);

  function handleRun() {
    if (imgGenProvider === 'sd_local') {
      const ok = window.confirm(
        '⚠️ 本地 Stable Diffusion 图像生成\n\n' +
        '首次运行约需 20-30 秒加载模型\n' +
        '· Apple Silicon / NVIDIA：约 10-30 秒\n' +
        '· CPU：约 1-3 分钟\n\n' +
        '确认提交？'
      );
      if (!ok) return;
    } else if (imgGenProvider === 'flux') {
      const ok = window.confirm(
        '⚠️ 本地 Flux 图像生成耗时较长\n\n' +
        '· NVIDIA GPU：约 30 秒\n' +
        '· Apple Silicon / CPU：可能超过 10 分钟\n\n' +
        '确认提交？'
      );
      if (!ok) return;
    }
    onRun();
  }
  const models = IMG_GEN_MODELS[imgGenProvider] || [];
  const sizes = IMG_GEN_SIZES[imgGenProvider] || [];
  const sizeLabel = imgGenProvider === 'openai' || imgGenProvider === 'dashscope' || imgGenProvider === 'sd_local' ? '尺寸' : '比例';

  return (
    <div className="rounded-2xl border border-slate-200/80 dark:border-slate-700/80 bg-white dark:bg-slate-900 shadow-panel p-5 space-y-4">
      {/* 服务商下拉 */}
      <div>
        <label className={labelCls}>服务商</label>
        <ComboSelect
          value={imgGenProvider}
          onChange={onProviderChange}
          options={IMG_GEN_PROVIDERS.map(p => ({ value: p, label: IMG_GEN_PROVIDER_LABELS[p] || p }))}
          placeholder="选择服务商"
        />
      </div>

      {/* 认证 */}
      {isComfyUI ? (
        <div>
          <label className={labelCls}>ComfyUI 服务地址</label>
          <input className={fieldCls} value={imgGenComfyUrl} onChange={e => setImgGenComfyUrl(e.target.value)}
            placeholder="http://127.0.0.1:8188" />
        </div>
      ) : !isLocal ? (
        <div>
          <label className={labelCls}>API Key</label>
          <input className={fieldCls} type="password" value={apiKey} onChange={e => setApiKey(e.target.value)}
            placeholder="sk-... / AIza... / Bearer ..." />
        </div>
      ) : null}

      {/* 模型 */}
      {models.length > 0 && (
        <div>
          <label className={labelCls}>模型</label>
          <ComboSelect
            value={imgGenModel}
            onChange={setImgGenModel}
            options={models.map(m => ({ value: m, label: m }))}
            placeholder={`默认：${models[0]}`}
            allowCustom
          />
        </div>
      )}

      {/* 尺寸/比例 */}
      {sizes.length > 0 && (
        <div>
          <label className={labelCls}>{sizeLabel}</label>
          <ComboSelect
            value={imgGenSize}
            onChange={setImgGenSize}
            options={sizes.map(s => ({ value: s, label: s }))}
            placeholder="选择尺寸"
          />
          {imgGenProvider === 'sd_local' && (
            <p className="text-xs text-slate-400 mt-1">SD-Turbo 最佳分辨率为 512×512，大尺寸不会提升质量</p>
          )}
        </div>
      )}

      {/* 提示词 */}
      <div>
        <label className={labelCls}>图像描述（提示词）</label>
        <textarea rows={4} className={fieldCls}
          value={imgGenPrompt} onChange={e => setImgGenPrompt(e.target.value)}
          placeholder="描述你想生成的图像内容，越详细越好..." />
      </div>

      <button className={btnPrimary} disabled={busy || !imgGenPrompt.trim() || isUnsupported} onClick={handleRun}>
        {busy ? '生成中...' : isUnsupported ? '暂不支持' : '生成图像'}
      </button>
    </div>
  );
}
