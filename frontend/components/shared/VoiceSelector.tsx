import type { VoiceInfo } from '../../types';
import CustomSelect from './CustomSelect';

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
        <CustomSelect
          className="flex-1"
          value={value}
          onChange={onChange}
          placeholder="（暂无音色）"
          options={voices.map(v => ({
            value: v.voice_id,
            label: `${v.name}${v.model_file ? ` · ${v.model_file}` : ''} [${v.engine}]${v.is_ready ? '' : ' ⚠️'}`,
          }))}
        />
        <button className={btnSec} onClick={onRefresh}>刷新</button>
      </div>
    </label>
  );
}
