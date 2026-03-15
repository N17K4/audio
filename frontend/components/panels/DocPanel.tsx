import type { DocSubPage } from '../../types';
import OutputDirRow from '../shared/OutputDirRow';

const PANDOC_OUTPUT_FORMATS = [
  { value: 'docx',     label: 'DOCX'     },
  { value: 'odt',      label: 'ODT'      },
  { value: 'markdown', label: 'Markdown' },
  { value: 'html',     label: 'HTML'     },
  { value: 'epub',     label: 'EPUB'     },
  { value: 'rst',      label: 'RST'      },
  { value: 'txt',      label: '纯文本'   },
];

const IMG_OUTPUT_FORMATS = ['png', 'jpg', 'webp', 'bmp'];
const TEXT_ENCODINGS = ['utf-8', 'gbk', 'gb2312', 'latin-1', 'utf-16', 'big5'];

interface DocPanelProps {
  docSubPage: DocSubPage;
  setDocSubPage: (v: DocSubPage) => void;
  // 文档转换
  docFile: File | null;
  setDocFile: (v: File | null) => void;
  docOutputFormat: string;
  setDocOutputFormat: (v: string) => void;
  docExtractMode: 'text' | 'images';
  setDocExtractMode: (v: 'text' | 'images') => void;
  onRunDocConvert: () => void;
  // 图片处理
  imgFile: File | null; setImgFile: (v: File | null) => void;
  imgOutputFmt: string; setImgOutputFmt: (v: string) => void;
  imgResizeW: string; setImgResizeW: (v: string) => void;
  imgResizeH: string; setImgResizeH: (v: string) => void;
  imgQuality: string; setImgQuality: (v: string) => void;
  // 二维码
  qrMode: 'generate' | 'decode'; setQrMode: (v: 'generate' | 'decode') => void;
  qrText: string; setQrText: (v: string) => void;
  qrFile: File | null; setQrFile: (v: File | null) => void;
  // 文本编码
  encFile: File | null; setEncFile: (v: File | null) => void;
  encTarget: string; setEncTarget: (v: string) => void;
  // 工具箱执行
  onRunToolbox: () => void;
  // 公共
  outputDir: string;
  setOutputDir: (v: string) => void;
  status: string;
  fieldCls: string;
  fileCls: string;
  labelCls: string;
  btnSec: string;
}

const DOC_PAGES: { value: DocSubPage; label: string; desc: string }[] = [
  { value: 'pdf_to_word', label: 'PDF 转 Word', desc: 'pdf2docx' },
  { value: 'doc_convert', label: '文档互转',    desc: 'pandoc'   },
  { value: 'pdf_extract', label: 'PDF 提取内容', desc: 'PyMuPDF · 文字/图片' },
];

const TOOL_PAGES: { value: DocSubPage; label: string; desc: string }[] = [
  { value: 'image',         label: '图片处理', desc: 'Pillow'  },
  { value: 'qr',            label: '二维码',   desc: 'qrcode'  },
  { value: 'text_encoding', label: '文本编码', desc: 'chardet' },
];

const ACCEPT: Partial<Record<DocSubPage, string>> = {
  pdf_to_word: '.pdf,application/pdf',
  doc_convert: '.docx,.odt,.md,.markdown,.html,.htm,.epub,.rst,.txt,.tex',
  pdf_extract: '.pdf,application/pdf',
};

const isDocPage = (p: DocSubPage) => ['pdf_to_word', 'doc_convert', 'pdf_extract'].includes(p);
const isToolPage = (p: DocSubPage) => ['image', 'qr', 'text_encoding'].includes(p);

export default function DocPanel({
  docSubPage, setDocSubPage,
  docFile, setDocFile, docOutputFormat, setDocOutputFormat, docExtractMode, setDocExtractMode, onRunDocConvert,
  imgFile, setImgFile, imgOutputFmt, setImgOutputFmt,
  imgResizeW, setImgResizeW, imgResizeH, setImgResizeH, imgQuality, setImgQuality,
  qrMode, setQrMode, qrText, setQrText, qrFile, setQrFile,
  encFile, setEncFile, encTarget, setEncTarget, onRunToolbox,
  outputDir, setOutputDir, status,
  fieldCls, fileCls, labelCls, btnSec,
}: DocPanelProps) {
  const numCls = 'w-24 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-800/50 px-3 py-2.5 text-sm text-slate-800 dark:text-slate-200 placeholder:text-slate-400 focus:border-indigo-400 focus:ring-2 focus:ring-indigo-500/15 transition-all text-center';

  const tabBtn = (active: boolean) =>
    `flex-1 py-2 flex flex-col items-center gap-0.5 transition-all ${active ? 'bg-slate-800 dark:bg-slate-600 text-white shadow-sm' : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 hover:bg-slate-100 dark:hover:bg-slate-700 dark:hover:text-slate-200'}`;
  const subLbl = (active: boolean) =>
    `text-xs ${active ? 'text-slate-300' : 'text-slate-400 dark:text-slate-600'}`;

  const canRunToolbox = status !== 'processing' && (
    (docSubPage === 'image' && !!imgFile) ||
    (docSubPage === 'qr' && (qrMode === 'generate' ? !!qrText.trim() : !!qrFile)) ||
    (docSubPage === 'text_encoding' && !!encFile && !!outputDir.trim())
  );

  return (
    <section className="rounded-2xl border border-slate-200/80 bg-white p-6 shadow-panel space-y-5 dark:bg-slate-900 dark:border-slate-700/80">

      {/* 六项 tab 并排 */}
      <div>
        <span className={labelCls}>功能</span>
        <div className="flex rounded-xl border border-slate-200 dark:border-slate-700 overflow-hidden text-sm bg-slate-50/50 dark:bg-slate-800/50">
          {[...DOC_PAGES, ...TOOL_PAGES].map(opt => (
            <button key={opt.value} className={tabBtn(docSubPage === opt.value)}
              onClick={() => { setDocSubPage(opt.value); setDocFile(null); }}>
              <span className="text-sm font-medium">{opt.label}</span>
              <span className={subLbl(docSubPage === opt.value)}>{opt.desc}</span>
            </button>
          ))}
        </div>
      </div>

      {/* ── 文档：输入文件 ── */}
      {isDocPage(docSubPage) && (
        <label className="block">
          <span className={labelCls}>
            {docSubPage === 'pdf_to_word' && '输入 PDF 文件'}
            {docSubPage === 'doc_convert' && '输入文档'}
            {docSubPage === 'pdf_extract' && '输入 PDF 文件'}
          </span>
          <input className={fileCls} type="file" accept={ACCEPT[docSubPage]}
            onChange={e => setDocFile(e.target.files?.[0] || null)} />
          {docFile && <p className="text-xs text-slate-400 mt-1.5">{docFile.name}（{Math.round(docFile.size / 1024)} KB）</p>}
        </label>
      )}

      {docSubPage === 'pdf_to_word' && (
        <div className="rounded-xl bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800/50 px-4 py-3 text-xs text-amber-700 dark:text-amber-400">
          输出格式固定为 <span className="font-semibold">DOCX</span>，由 pdf2docx 负责排版还原。
        </div>
      )}

      {docSubPage === 'doc_convert' && (
        <div>
          <span className={labelCls}>输出格式</span>
          <div className="flex flex-wrap gap-2">
            {PANDOC_OUTPUT_FORMATS.map(f => (
              <button key={f.value}
                className={`px-3 py-1.5 rounded-lg border text-xs font-semibold transition-all ${docOutputFormat === f.value ? 'bg-slate-800 dark:bg-slate-600 border-slate-800 dark:border-slate-600 text-white' : 'border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700'}`}
                onClick={() => setDocOutputFormat(f.value)}>
                {f.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {docSubPage === 'pdf_extract' && (
        <div>
          <span className={labelCls}>提取内容</span>
          <div className="flex rounded-xl border border-slate-200 dark:border-slate-700 overflow-hidden text-sm bg-slate-50/50 dark:bg-slate-800/50">
            {([
              { value: 'text',   label: '提取文字', sub: '输出 .txt' },
              { value: 'images', label: '提取图片', sub: '输出 .zip' },
            ] as { value: 'text' | 'images'; label: string; sub: string }[]).map(opt => (
              <button key={opt.value} className={tabBtn(docExtractMode === opt.value)}
                onClick={() => setDocExtractMode(opt.value)}>
                <span className="text-sm font-medium">{opt.label}</span>
                <span className={subLbl(docExtractMode === opt.value)}>{opt.sub}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* ── 图片处理 ── */}
      {docSubPage === 'image' && (
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
      {docSubPage === 'qr' && (
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
      {docSubPage === 'text_encoding' && (
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

      {/* 输出目录 */}
      {(isDocPage(docSubPage) || docSubPage === 'image' || docSubPage === 'text_encoding') && (
        <OutputDirRow outputDir={outputDir} setOutputDir={setOutputDir} fieldCls={fieldCls} labelCls={labelCls} btnSec={btnSec} required />
      )}

      {/* 执行按钮 */}
      {isDocPage(docSubPage) && (
        <button
          className="w-full rounded-xl bg-amber-600 hover:bg-amber-700 active:bg-amber-800 py-2.5 text-sm font-semibold text-white shadow-sm transition-all duration-150 active:scale-[0.99] disabled:opacity-60 disabled:cursor-not-allowed"
          onClick={onRunDocConvert}
          disabled={status === 'processing' || !docFile || !outputDir.trim()}>
          {status === 'processing' ? '处理中...' : '开始转换'}
        </button>
      )}
      {isToolPage(docSubPage) && (
        <button
          className="w-full rounded-xl bg-slate-700 hover:bg-slate-800 active:bg-slate-900 py-2.5 text-sm font-semibold text-white shadow-sm transition-all duration-150 active:scale-[0.99] disabled:opacity-60 disabled:cursor-not-allowed"
          onClick={onRunToolbox}
          disabled={!canRunToolbox}>
          {status === 'processing' ? '处理中...' : '开始处理'}
        </button>
      )}
    </section>
  );
}
