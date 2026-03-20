/**
 * ProcessFlow — 实际运行流程可视化条
 */

export interface FlowStep {
  label: string;
  tech?: string;
  note?: string;
}

interface Props {
  steps: FlowStep[];
  color?: string;
}

export default function ProcessFlow({ steps, color = '#4f46e5' }: Props) {
  return (
    <div
      className="px-3.5 py-2.5 rounded-lg mb-1"
      style={{ background: `${color}08`, border: `1px solid ${color}22` }}
    >
      <div
        className="text-[11px] font-bold uppercase tracking-wider mb-2"
        style={{ color }}
      >
        实际运行流程
      </div>
      <div className="flex flex-wrap items-center gap-1">
        {steps.map((step, i) => (
          <div key={i} className="flex items-center gap-1">
            <div
              className="px-2.5 py-1 rounded-md bg-white dark:bg-slate-800 flex flex-col items-center min-w-[64px]"
              style={{ border: `1px solid ${color}44` }}
            >
              <span className="text-xs font-semibold text-slate-700 dark:text-slate-200 whitespace-nowrap">
                {step.label}
              </span>
              {step.tech && (
                <span className="text-[10px] font-mono mt-px whitespace-nowrap" style={{ color }}>
                  {step.tech}
                </span>
              )}
              {step.note && (
                <span className="text-[9px] text-slate-400 mt-px whitespace-nowrap">
                  {step.note}
                </span>
              )}
            </div>
            {i < steps.length - 1 && (
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className="shrink-0 text-slate-400">
                <path d="M3 8H13M9 4L13 8L9 12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
