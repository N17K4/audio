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

interface DocPanelProps {
  docSubPage: DocSubPage;
  setDocSubPage: (v: DocSubPage) => void;
  docFile: File | null;
  setDocFile: (v: File | null) => void;
  docOutputFormat: string;
  setDocOutputFormat: (v: string) => void;
  docExtractMode: 'text' | 'images';
  setDocExtractMode: (v: 'text' | 'images') => void;
  outputDir: string;
  setOutputDir: (v: string) => void;
  status: string;
  onRunDocConvert: () => void;
  fieldCls: string;
  fileCls: string;
  labelCls: string;
  btnSec: string;
}

const SUB_PAGES: { value: DocSubPage; label: string; desc: string }[] = [
  { value: 'pdf_to_word', label: 'PDF 转 Word',  desc: 'pdf2docx' },
  { value: 'doc_convert', label: '文档互转',      desc: 'pandoc'   },
  { value: 'pdf_extract', label: 'PDF 提取',      desc: 'PyMuPDF'  },
];

const ACCEPT: Record<DocSubPage, string> = {
  pdf_to_word: '.pdf,application/pdf',
  doc_convert: '.docx,.odt,.md,.markdown,.html,.htm,.epub,.rst,.txt,.tex',
  pdf_extract: '.pdf,application/pdf',
};

export default function DocPanel({
  docSubPage, setDocSubPage,
  docFile, setDocFile,
  docOutputFormat, setDocOutputFormat,
  docExtractMode, setDocExtractMode,
  outputDir, setOutputDir,
  status, onRunDocConvert,
  fieldCls, fileCls, labelCls, btnSec,
}: DocPanelProps) {
  return (
    <section className="rounded-2xl border border-slate-200/80 bg-white p-6 shadow-panel space-y-5 dark:bg-slate-900 dark:border-slate-700/80">

      {/* 子页面 tab */}
      <div>
        <span className={labelCls}>功能选择</span>
        <div className="flex rounded-xl border border-slate-200 dark:border-slate-700 overflow-hidden text-sm bg-slate-50/50 dark:bg-slate-800/50">
          {SUB_PAGES.map(opt => (
            <button key={opt.value}
              className={`flex-1 py-2 flex flex-col items-center gap-0.5 transition-all ${docSubPage === opt.value ? 'bg-slate-800 dark:bg-slate-600 text-white shadow-sm' : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 hover:bg-slate-100 dark:hover:bg-slate-700 dark:hover:text-slate-200'}`}
              onClick={() => { setDocSubPage(opt.value); setDocFile(null); }}>
              <span className="text-sm font-medium">{opt.label}</span>
              <span className={`text-xs ${docSubPage === opt.value ? 'text-slate-300' : 'text-slate-400 dark:text-slate-600'}`}>{opt.desc}</span>
            </button>
          ))}
        </div>
      </div>

      {/* 输入文件 */}
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

      {/* pdf_to_word：无需额外选项，输出固定为 docx */}
      {docSubPage === 'pdf_to_word' && (
        <div className="rounded-xl bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800/50 px-4 py-3 text-xs text-amber-700 dark:text-amber-400">
          输出格式固定为 <span className="font-semibold">DOCX</span>，由 pdf2docx 负责排版还原。
        </div>
      )}

      {/* doc_convert：选择输出格式 */}
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

      {/* pdf_extract：选择提取模式 */}
      {docSubPage === 'pdf_extract' && (
        <div>
          <span className={labelCls}>提取内容</span>
          <div className="flex rounded-xl border border-slate-200 dark:border-slate-700 overflow-hidden text-sm bg-slate-50/50 dark:bg-slate-800/50">
            {([
              { value: 'text',   label: '提取文字', sub: '输出 .txt' },
              { value: 'images', label: '提取图片', sub: '输出 .zip' },
            ] as { value: 'text' | 'images'; label: string; sub: string }[]).map(opt => (
              <button key={opt.value}
                className={`flex-1 py-2 flex flex-col items-center gap-0.5 transition-all ${docExtractMode === opt.value ? 'bg-slate-800 dark:bg-slate-600 text-white shadow-sm' : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 hover:bg-slate-100 dark:hover:bg-slate-700 dark:hover:text-slate-200'}`}
                onClick={() => setDocExtractMode(opt.value)}>
                <span className="text-sm font-medium">{opt.label}</span>
                <span className={`text-xs ${docExtractMode === opt.value ? 'text-slate-300' : 'text-slate-400 dark:text-slate-600'}`}>{opt.sub}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* 输出目录 */}
      <OutputDirRow outputDir={outputDir} setOutputDir={setOutputDir} fieldCls={fieldCls} labelCls={labelCls} btnSec={btnSec} required />

      <button
        className="w-full rounded-xl bg-amber-600 hover:bg-amber-700 active:bg-amber-800 py-2.5 text-sm font-semibold text-white shadow-sm transition-all duration-150 active:scale-[0.99] disabled:opacity-60 disabled:cursor-not-allowed"
        onClick={onRunDocConvert}
        disabled={status === 'processing' || !docFile || !outputDir.trim()}>
        {status === 'processing' ? '处理中...' : '开始转换'}
      </button>
    </section>
  );
}
