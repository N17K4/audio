import type { ToolboxSubPage } from '../../types';
import OutputDirRow from '../shared/OutputDirRow';
import FileDrop from '../shared/FileDrop';
import OptionButton from '../shared/OptionButton';
import TabBar from '../shared/TabBar';
import { IMG_OUTPUT_FORMATS, TEXT_ENCODINGS } from '../../constants';
import { numCls } from '../../constants/styles';

interface ToolboxPanelProps {
  toolSubPage: ToolboxSubPage;
  setToolSubPage: (v: ToolboxSubPage) => void;
  imgFile: File | null; setImgFile: (v: File | null) => void;
  imgOutputFmt: string; setImgOutputFmt: (v: string) => void;
  imgResizeW: string; setImgResizeW: (v: string) => void;
  imgResizeH: string; setImgResizeH: (v: string) => void;
  imgQuality: string; setImgQuality: (v: string) => void;
  qrMode: 'generate' | 'decode'; setQrMode: (v: 'generate' | 'decode') => void;
  qrText: string; setQrText: (v: string) => void;
  qrFile: File | null; setQrFile: (v: File | null) => void;
  encFile: File | null; setEncFile: (v: File | null) => void;
  encTarget: string; setEncTarget: (v: string) => void;
  outputDir: string; setOutputDir: (v: string) => void;
  status: string;
  onRun: () => void;
  fieldCls: string;
  fileCls: string;
  labelCls: string;
  btnSec: string;
}

const SUB_PAGES: { value: ToolboxSubPage; label: string; sub: string }[] = [
  { value: 'image',         label: '图片处理',   sub: 'Pillow'  },
  { value: 'qr',            label: '二维码',     sub: 'qrcode'  },
  { value: 'text_encoding', label: '文本编码',   sub: 'chardet' },
];

export default function ToolboxPanel({
  toolSubPage, setToolSubPage,
  imgFile, setImgFile, imgOutputFmt, setImgOutputFmt,
  imgResizeW, setImgResizeW, imgResizeH, setImgResizeH, imgQuality, setImgQuality,
  qrMode, setQrMode, qrText, setQrText, qrFile, setQrFile,
  encFile, setEncFile, encTarget, setEncTarget,
  outputDir, setOutputDir,
  status, onRun,
  fieldCls, fileCls, labelCls, btnSec,
}: ToolboxPanelProps) {
  const canRun = status !== 'processing' && (
    (toolSubPage === 'image' && !!imgFile) ||
    (toolSubPage === 'qr' && (qrMode === 'generate' ? !!qrText.trim() : !!qrFile)) ||
    (toolSubPage === 'text_encoding' && !!encFile && !!outputDir.trim())
  );

  return (
    <section className="rounded-2xl border border-slate-200/80 bg-white p-6 shadow-panel space-y-5 dark:bg-slate-900 dark:border-slate-700/80">

      {/* 子页面 tab */}
      <div>
        <span className={labelCls}>功能选择</span>
        <TabBar
          tabs={SUB_PAGES.map(p => ({ value: p.value, label: p.label, sub: p.sub }))}
          value={toolSubPage}
          onChange={setToolSubPage}
        />
      </div>

      {/* ── 图片处理 ── */}
      {toolSubPage === 'image' && (
        <>
          <div>
            <span className={labelCls}>输入图片</span>
            <FileDrop
              files={imgFile ? [imgFile] : []}
              onAdd={fs => setImgFile(fs[0])}
              onRemove={() => setImgFile(null)}
              accept="image/*,.jpg,.jpeg,.png,.webp,.bmp,.tiff"
              compact
              iconType="image"
              emptyLabel="点击或拖拽图片"
            />
          </div>

          <div>
            <span className={labelCls}>输出格式</span>
            <div className="flex flex-wrap gap-2">
              {IMG_OUTPUT_FORMATS.map(f => (
                <OptionButton key={f} selected={imgOutputFmt === f} label={f} onClick={() => setImgOutputFmt(f)} uppercase />
              ))}
            </div>
          </div>

          <div>
            <span className={labelCls}>缩放尺寸（留空保持原尺寸）</span>
            <div className="flex items-center gap-2">
              <input className={numCls()} type="number" min="1" placeholder="宽 px" value={imgResizeW} onChange={e => setImgResizeW(e.target.value)} />
              <span className="text-sm text-slate-400">×</span>
              <input className={numCls()} type="number" min="1" placeholder="高 px" value={imgResizeH} onChange={e => setImgResizeH(e.target.value)} />
            </div>
          </div>

          {(imgOutputFmt === 'jpg' || imgOutputFmt === 'webp') && (
            <div>
              <span className={labelCls}>质量 {imgQuality}%</span>
              <input type="range" min="1" max="95" value={imgQuality}
                onChange={e => setImgQuality(e.target.value)}
                className="w-full accent-slate-700" />
            </div>
          )}
        </>
      )}

      {/* ── 二维码 ── */}
      {toolSubPage === 'qr' && (
        <>
          <div>
            <span className={labelCls}>模式</span>
            <TabBar
              tabs={[{ value: 'generate' as const, label: '生成二维码' }, { value: 'decode' as const, label: '识别二维码' }]}
              value={qrMode}
              onChange={setQrMode}
            />
          </div>

          {qrMode === 'generate' ? (
            <div>
              <span className={labelCls}>二维码内容</span>
              <textarea className={`${fieldCls} h-24 resize-none`} placeholder="输入要编码的文字或网址"
                value={qrText} onChange={e => setQrText(e.target.value)} />
            </div>
          ) : (
            <div>
              <span className={labelCls}>包含二维码的图片</span>
              <FileDrop
                files={qrFile ? [qrFile] : []}
                onAdd={fs => setQrFile(fs[0])}
                onRemove={() => setQrFile(null)}
                accept="image/*"
                compact
                iconType="image"
                emptyLabel="点击或拖拽图片"
              />
            </div>
          )}
        </>
      )}

      {/* ── 文本编码 ── */}
      {toolSubPage === 'text_encoding' && (
        <>
          <div>
            <span className={labelCls}>输入文件（自动检测原始编码）</span>
            <FileDrop
              files={encFile ? [encFile] : []}
              onAdd={fs => setEncFile(fs[0])}
              onRemove={() => setEncFile(null)}
              accept=".txt,.csv,.srt,.vtt,.json,.xml,.html,.md,.log"
              compact
              iconType="file"
              emptyLabel="点击或拖拽文本文件"
            />
          </div>

          <div>
            <span className={labelCls}>目标编码</span>
            <div className="flex flex-wrap gap-2">
              {TEXT_ENCODINGS.map(enc => (
                <OptionButton key={enc} selected={encTarget === enc} label={enc} onClick={() => setEncTarget(enc)} uppercase />
              ))}
            </div>
          </div>
        </>
      )}

      {/* 输出目录（图片和编码转换需要） */}
      {(toolSubPage === 'image' || toolSubPage === 'text_encoding') && (
        <OutputDirRow outputDir={outputDir} setOutputDir={setOutputDir} fieldCls={fieldCls} labelCls={labelCls} btnSec={btnSec} required />
      )}

      <button
        className="w-full rounded-xl bg-slate-700 hover:bg-slate-800 active:bg-slate-900 py-2.5 text-sm font-semibold text-white shadow-sm transition-all duration-150 active:scale-[0.99] disabled:opacity-60 disabled:cursor-not-allowed"
        onClick={onRun} disabled={!canRun}>
        {status === 'processing' ? '处理中...' : '开始处理'}
      </button>
    </section>
  );
}
