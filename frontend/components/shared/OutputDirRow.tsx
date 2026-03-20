
interface OutputDirRowProps {
  required?: boolean;
  outputDir: string;
  setOutputDir: (v: string) => void;
  fieldCls: string;
  labelCls: string;
  btnSec: string;
}

export default function OutputDirRow({ required, outputDir, setOutputDir, fieldCls, labelCls, btnSec }: OutputDirRowProps) {
  return (
    <label className="block">
      <span className={labelCls}>输出目录{required ? '' : '（可选）'}</span>
      <div className="flex w-full rounded-xl border border-slate-200 bg-slate-50/50 text-sm overflow-hidden transition-all focus-within:border-[#1A8FE3] focus-within:ring-2 focus-within:ring-[#1A8FE3]/15 dark:border-slate-700 dark:bg-slate-800/50">
        <input
          className="flex-1 bg-transparent px-3 py-2.5 text-slate-800 placeholder:text-slate-400 outline-none dark:text-slate-200"
          value={outputDir} onChange={e => setOutputDir(e.target.value)} placeholder="/保存/输出/路径" />
      </div>
    </label>
  );
}
