import React from 'react';

interface Step {
  title: string;
  desc: string;
}

interface HowToStepsProps {
  steps: Step[];
}

export default function HowToSteps({ steps }: HowToStepsProps) {
  return (
    <div className="mt-6 pt-5 border-t border-slate-100 dark:border-slate-800">
      <h3 className="text-xs font-semibold text-slate-400 dark:text-slate-500 uppercase tracking-wider mb-4">
        使用步骤
      </h3>
      <div className="flex items-start gap-2">
        {steps.map((step, i) => (
          <React.Fragment key={i}>
            <div className="flex flex-col items-center gap-2 flex-1 min-w-0">
              <div
                className="w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold shrink-0 text-white"
                style={{ backgroundColor: '#1A8FE3' }}>
                {i + 1}
              </div>
              <div className="text-center">
                <div className="text-sm font-semibold text-slate-700 dark:text-slate-200">
                  {step.title}
                </div>
                <div className="text-xs text-slate-400 dark:text-slate-500 mt-0.5 leading-relaxed">
                  {step.desc}
                </div>
              </div>
            </div>
            {i < steps.length - 1 && (
              <svg className="shrink-0 mt-3 text-slate-300 dark:text-slate-600" width="16" height="16" viewBox="0 0 16 16" fill="none">
                <path d="M3 8 L13 8 M9 4 L13 8 L9 12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            )}
          </React.Fragment>
        ))}
      </div>
    </div>
  );
}
