import type { VoiceInfo } from '../../types';

interface VoiceSelectorProps {
  label: string;
  value: string;
  onChange: (v: string) => void;
  voices: VoiceInfo[];
  onRefresh: () => void;
  fieldCls: string;
  labelCls: string;
  btnSec: string;
}

export default function VoiceSelector({ label, value, onChange, voices, onRefresh, fieldCls, labelCls, btnSec }: VoiceSelectorProps) {
  return (
    <label className="block">
      <span className={labelCls}>{label}</span>
      <div className="flex gap-2">
        <select className="flex-1 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-800/50 px-3 py-2.5 text-sm text-slate-800 dark:text-slate-200 focus:border-indigo-400 focus:ring-2 focus:ring-indigo-500/15 transition-all"
          value={value} onChange={e => onChange(e.target.value)}>
          {voices.length === 0 && <option value="">（暂无音色）</option>}
          {voices.map(v => (
            <option key={v.voice_id} value={v.voice_id}>
              {v.name}{v.model_file ? ` · ${v.model_file}` : ''} [{v.engine}]{v.is_ready ? '' : ' ⚠️'}
            </option>
          ))}
        </select>
        <button className={btnSec} onClick={onRefresh}>刷新</button>
      </div>
    </label>
  );
}
