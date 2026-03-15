import type { ToolboxSubPage } from '../../types';
import OutputDirRow from '../shared/OutputDirRow';

const IMG_OUTPUT_FORMATS = ['png', 'jpg', 'webp', 'bmp'];
const TEXT_ENCODINGS = ['utf-8', 'gbk', 'gb2312', 'latin-1', 'utf-16', 'big5'];

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
  const numCls = 'w-24 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-800/50 px-3 py-2.5 text-sm text-slate-800 dark:text-slate-200 placeholder:text-slate-400 focus:border-indigo-400 focus:ring-2 focus:ring-indigo-500/15 transition-all text-center';

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
        <div className="flex rounded-xl border border-slate-200 dark:border-slate-700 overflow-hidden text-sm bg-slate-50/50 dark:bg-slate-800/50">
          {SUB_PAGES.map(opt => (
            <button key={opt.value}
              className={`flex-1 py-2 flex flex-col items-center gap-0.5 transition-all ${toolSubPage === opt.value ? 'bg-slate-800 dark:bg-slate-600 text-white shadow-sm' : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 hover:bg-slate-100 dark:hover:bg-slate-700 dark:hover:text-slate-200'}`}
              onClick={() => setToolSubPage(opt.value)}>
              <span className="text-sm font-medium">{opt.label}</span>
              <span className={`text-xs ${toolSubPage === opt.value ? 'text-slate-300' : 'text-slate-400 dark:text-slate-600'}`}>{opt.sub}</span>
            </button>
          ))}
        </div>
      </div>

      {/* ── 图片处理 ── */}
      {toolSubPage === 'image' && (
        <>
          <label className="block">
            <span className={labelCls}>输入图片</span>
            <input className={fileCls} type="file" accept="image/*,.jpg,.jpeg,.png,.webp,.bmp,.tiff"
              onChange={e => setImgFile(e.target.files?.[0] || null)} />
            {imgFile && <p className="text-xs text-slate-400 mt-1.5">{imgFile.name}（{Math.round(imgFile.size / 1024)} KB）</p>}
          </label>

          <div>
            <span className={labelCls}>输出格式</span>
            <div className="flex flex-wrap gap-2">
              {IMG_OUTPUT_FORMATS.map(f => (
                <button key={f}
                  className={`px-3 py-1.5 rounded-lg border text-xs font-semibold uppercase transition-all ${imgOutputFmt === f ? 'bg-slate-800 dark:bg-slate-600 border-slate-800 dark:border-slate-600 text-white' : 'border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700'}`}
                  onClick={() => setImgOutputFmt(f)}>{f}
                </button>
              ))}
            </div>
          </div>

          <div>
            <span className={labelCls}>缩放尺寸（留空保持原尺寸）</span>
            <div className="flex items-center gap-2">
              <input className={numCls} type="number" min="1" placeholder="宽 px" value={imgResizeW} onChange={e => setImgResizeW(e.target.value)} />
              <span className="text-sm text-slate-400">×</span>
              <input className={numCls} type="number" min="1" placeholder="高 px" value={imgResizeH} onChange={e => setImgResizeH(e.target.value)} />
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
            <div className="flex rounded-xl border border-slate-200 dark:border-slate-700 overflow-hidden text-sm bg-slate-50/50 dark:bg-slate-800/50">
              {([{ v: 'generate', l: '生成二维码' }, { v: 'decode', l: '识别二维码' }] as const).map(opt => (
                <button key={opt.v}
                  className={`flex-1 py-2 text-sm font-medium transition-all ${qrMode === opt.v ? 'bg-slate-800 dark:bg-slate-600 text-white shadow-sm' : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 hover:bg-slate-100 dark:hover:bg-slate-700 dark:hover:text-slate-200'}`}
                  onClick={() => setQrMode(opt.v)}>{opt.l}
                </button>
              ))}
            </div>
          </div>

          {qrMode === 'generate' ? (
            <div>
              <span className={labelCls}>二维码内容</span>
              <textarea className={`${fieldCls} h-24 resize-none`} placeholder="输入要编码的文字或网址"
                value={qrText} onChange={e => setQrText(e.target.value)} />
            </div>
          ) : (
            <label className="block">
              <span className={labelCls}>包含二维码的图片</span>
              <input className={fileCls} type="file" accept="image/*"
                onChange={e => setQrFile(e.target.files?.[0] || null)} />
              {qrFile && <p className="text-xs text-slate-400 mt-1.5">{qrFile.name}</p>}
            </label>
          )}
        </>
      )}

      {/* ── 文本编码 ── */}
      {toolSubPage === 'text_encoding' && (
        <>
          <label className="block">
            <span className={labelCls}>输入文件（自动检测原始编码）</span>
            <input className={fileCls} type="file" accept=".txt,.csv,.srt,.vtt,.json,.xml,.html,.md,.log"
              onChange={e => setEncFile(e.target.files?.[0] || null)} />
            {encFile && <p className="text-xs text-slate-400 mt-1.5">{encFile.name}（{Math.round(encFile.size / 1024)} KB）</p>}
          </label>

          <div>
            <span className={labelCls}>目标编码</span>
            <div className="flex flex-wrap gap-2">
              {TEXT_ENCODINGS.map(enc => (
                <button key={enc}
                  className={`px-3 py-1.5 rounded-lg border text-xs font-semibold uppercase transition-all ${encTarget === enc ? 'bg-slate-800 dark:bg-slate-600 border-slate-800 dark:border-slate-600 text-white' : 'border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700'}`}
                  onClick={() => setEncTarget(enc)}>{enc}
                </button>
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
