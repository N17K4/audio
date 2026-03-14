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
        <select className={`flex-1 ${fieldCls}`}
          value={value} onChange={e => onChange(e.target.value)}>
          {voices.length === 0 && <option value="">（暂无音色）</option>}
          {voices.map(v => (
            <option key={v.voice_id} value={v.voice_id}>
              {v.name}【{v.engine}】{v.is_ready ? '' : ' ⚠️'}
            </option>
          ))}
        </select>
        <button className={btnSec} onClick={onRefresh}>刷新</button>
      </div>
    </label>
  );
}
