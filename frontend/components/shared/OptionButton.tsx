interface OptionButtonProps {
  selected: boolean;
  label: string;
  onClick: () => void;
  uppercase?: boolean;
}

export default function OptionButton({ selected, label, onClick, uppercase }: OptionButtonProps) {
  return (
    <button
      className={`px-3 py-1.5 rounded-lg border text-xs font-semibold transition-all ${uppercase ? 'uppercase' : ''} ${
        selected
          ? 'bg-slate-800 dark:bg-slate-600 border-slate-800 dark:border-slate-600 text-white'
          : 'border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700'
      }`}
      onClick={onClick}>
      {label}
    </button>
  );
}
