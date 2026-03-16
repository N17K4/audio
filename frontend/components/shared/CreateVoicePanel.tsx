import { useState } from 'react';
import FileDrop from './FileDrop';

interface CreateVoicePanelProps {
  engine?: string;
  newVoiceEngine: string;
  newVoiceName: string;
  creatingVoice: boolean;
  setNewVoiceEngine: (v: string) => void;
  setNewVoiceName: (v: string) => void;
  setNewVoiceModel: (v: File | null) => void;
  setNewVoiceIndex: (v: File | null) => void;
  setNewVoiceRef: (v: File | null) => void;
  setShowCreateVoice: (v: boolean) => void;
  onCreateVoice: () => void;
  fieldCls: string;
  fileCls: string;
  labelCls: string;
}

export default function CreateVoicePanel({
  engine,
  newVoiceEngine,
  newVoiceName,
  creatingVoice,
  setNewVoiceEngine,
  setNewVoiceName,
  setNewVoiceModel,
  setNewVoiceIndex,
  setNewVoiceRef,
  setShowCreateVoice,
  onCreateVoice,
  fieldCls,
  // fileCls is kept in props for backward compatibility but not used in template
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  fileCls: _fileCls,
  labelCls,
}: CreateVoicePanelProps) {
  const eng = engine || newVoiceEngine;
  const isRvc = eng === 'rvc';

  const [modelFile, setModelFile] = useState<File | null>(null);
  const [indexFile, setIndexFile] = useState<File | null>(null);
  const [refAudioFile, setRefAudioFile] = useState<File | null>(null);

  return (
    <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50/60 p-5 space-y-4 dark:border-slate-600 dark:bg-slate-800/40">
      <div className="flex items-center justify-between">
        <span className="text-sm font-semibold text-slate-700 dark:text-slate-200">新建音色包</span>
        <button className="text-xs text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition-colors" onClick={() => setShowCreateVoice(false)}>收起</button>
      </div>
      <div className="flex gap-3 flex-wrap">
        <label className="flex-1 min-w-[120px]">
          <span className={labelCls}>音色名称</span>
          <input className={fieldCls}
            value={newVoiceName} onChange={e => setNewVoiceName(e.target.value)} placeholder="我的音色" />
        </label>
        {!engine && (
          <label className="flex-1 min-w-[120px]">
            <span className={labelCls}>引擎</span>
            <select className={fieldCls}
              value={newVoiceEngine} onChange={e => setNewVoiceEngine(e.target.value)}>
              <option value="rvc">RVC</option>
              <option value="fish_speech">Fish Speech</option>
              <option value="seed_vc">Seed-VC</option>
            </select>
          </label>
        )}
      </div>
      {isRvc && (
        <>
          {/* 模型文件 */}
          <div>
            <span className={labelCls}>模型文件 .pth（必填）</span>
            <FileDrop
              files={modelFile ? [modelFile] : []}
              onAdd={fs => { setModelFile(fs[0]); setNewVoiceModel(fs[0]); }}
              onRemove={() => { setModelFile(null); setNewVoiceModel(null); }}
              accept=".pth,.onnx,.pt,.safetensors"
              compact
              iconType="file"
              emptyLabel="点击选择模型文件 (.pth)"
            />
          </div>

          {/* 索引文件 */}
          <div>
            <span className={labelCls}>索引文件 .index（可选）</span>
            <FileDrop
              files={indexFile ? [indexFile] : []}
              onAdd={fs => { setIndexFile(fs[0]); setNewVoiceIndex(fs[0]); }}
              onRemove={() => { setIndexFile(null); setNewVoiceIndex(null); }}
              accept=".index"
              compact
              iconType="file"
              emptyLabel="点击选择索引文件 (.index)（可选）"
            />
          </div>
        </>
      )}

      {/* 参考音频 */}
      <div>
        <span className={labelCls}>
          {isRvc ? '参考音频（可选，用于音色预览）' : '参考音频（必填，用于声音克隆）'}
        </span>
        <FileDrop
          files={refAudioFile ? [refAudioFile] : []}
          onAdd={fs => { setRefAudioFile(fs[0]); setNewVoiceRef(fs[0]); }}
          onRemove={() => { setRefAudioFile(null); setNewVoiceRef(null); }}
          accept="audio/*"
          compact
          iconType="audio"
          emptyLabel="点击选择参考音频"
        />
      </div>

      <button className="w-full rounded-xl bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800 py-2.5 text-sm font-semibold text-white shadow-sm hover:shadow transition-all duration-150 disabled:opacity-50 disabled:cursor-not-allowed"
        onClick={onCreateVoice} disabled={creatingVoice}>
        {creatingVoice ? '创建中...' : '确认创建'}
      </button>
    </div>
  );
}
