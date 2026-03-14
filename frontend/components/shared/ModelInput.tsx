import { PROVIDER_MODELS, DEFAULT_MODELS } from '../../constants';

export default function ModelInput({
  value, onChange, task, provider, placeholder,
}: {
  value: string; onChange: (v: string) => void;
  task: string; provider: string; placeholder?: string;
}) {
  const listId = `model-list-${task}-${provider}`;
  const options = PROVIDER_MODELS[task]?.[provider] ?? [];
  const defaultModel = DEFAULT_MODELS[task]?.[provider];
  const ph = placeholder ?? (defaultModel ? `默认：${defaultModel}` : '留空用默认');
  return (
    <>
      <input
        className="w-full rounded-xl border border-slate-200 bg-slate-50/50 px-3.5 py-2.5 text-sm text-slate-800 placeholder:text-slate-400 focus:border-indigo-400 focus:bg-white focus:ring-2 focus:ring-indigo-500/15 transition-all dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200 dark:placeholder:text-slate-500 dark:focus:bg-slate-700 dark:focus:border-indigo-400"
        list={listId}
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={ph}
        autoComplete="off"
      />
      <datalist id={listId}>
        {options.map(m => <option key={m} value={m} />)}
      </datalist>
    </>
  );
}
