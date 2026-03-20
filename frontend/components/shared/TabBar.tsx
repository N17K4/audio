interface TabBarProps<T extends string> {
  tabs: readonly { value: T; label: string; sub?: string }[];
  value: T;
  onChange: (v: T) => void;
  variant?: 'bordered' | 'pill';
}

export default function TabBar<T extends string>({ tabs, value, onChange, variant = 'bordered' }: TabBarProps<T>) {
  if (variant === 'pill') {
    return (
      <div className="flex gap-1 rounded-2xl bg-slate-100 dark:bg-slate-800 p-1">
        {tabs.map(tab => (
          <button key={tab.value}
            className={`flex-1 rounded-xl py-2 flex flex-col items-center gap-0.5 transition-all ${
              value === tab.value
                ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100 shadow-sm'
                : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'
            }`}
            onClick={() => onChange(tab.value)}>
            <span className="text-sm font-medium">{tab.label}</span>
            {tab.sub && (
              <span className={`text-xs ${value === tab.value ? 'text-slate-500 dark:text-slate-400' : 'text-slate-400 dark:text-slate-600'}`}>
                {tab.sub}
              </span>
            )}
          </button>
        ))}
      </div>
    );
  }
  // bordered variant (default)
  return (
    <div className="flex rounded-xl border border-slate-200 dark:border-slate-700 overflow-hidden text-sm bg-slate-50/50 dark:bg-slate-800/50">
      {tabs.map(tab => (
        <button key={tab.value}
          className={`flex-1 py-2 text-sm font-medium transition-all ${
            value === tab.value
              ? 'bg-slate-800 dark:bg-slate-600 text-white shadow-sm'
              : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 hover:bg-slate-100 dark:hover:bg-slate-700 dark:hover:text-slate-200'
          }`}
          onClick={() => onChange(tab.value)}>
          {tab.label}
          {tab.sub && (
            <span className={`block text-xs ${value === tab.value ? 'text-slate-300' : 'text-slate-400 dark:text-slate-600'}`}>
              {tab.sub}
            </span>
          )}
        </button>
      ))}
    </div>
  );
}
