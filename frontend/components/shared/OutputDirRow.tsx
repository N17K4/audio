
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
      <div className="flex gap-2">
        <input className={`flex-1 ${fieldCls}`}
          value={outputDir} onChange={e => setOutputDir(e.target.value)} placeholder="/保存/输出/路径" />
        <button className={btnSec}
          onClick={async () => { const d = await window.electronAPI?.selectOutputDir?.(); if (d) setOutputDir(d); }}>
          浏览
        </button>
      </div>
    </label>
  );
}
