interface LoadingDotsProps {
  size?: 'sm' | 'md';
}

export default function LoadingDots({ size = 'sm' }: LoadingDotsProps) {
  const dotCls = size === 'sm' ? 'w-1.5 h-1.5' : 'w-2 h-2';
  return (
    <span className="inline-flex gap-1">
      <span className={`${dotCls} rounded-full bg-slate-400 animate-bounce [animation-delay:0ms]`} />
      <span className={`${dotCls} rounded-full bg-slate-400 animate-bounce [animation-delay:150ms]`} />
      <span className={`${dotCls} rounded-full bg-slate-400 animate-bounce [animation-delay:300ms]`} />
    </span>
  );
}
