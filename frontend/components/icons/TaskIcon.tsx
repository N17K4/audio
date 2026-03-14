import { TASK_ICON_CFG } from '../../constants';
import type { TaskType } from '../../types';

export default function TaskIcon({ task, size = 28 }: { task: TaskType; size?: number }) {
  const cfg = TASK_ICON_CFG[task];
  const fs = cfg.abbr.length >= 3 ? size * 0.34 : size * 0.4;
  return (
    <svg width={size} height={size} viewBox="0 0 28 28" style={{ flexShrink: 0 }}>
      <rect width="28" height="28" rx="7" fill={cfg.bg} />
      <text x="14" y="14" dominantBaseline="central" textAnchor="middle"
        fontSize={fs} fontWeight="700" fill={cfg.text} fontFamily="-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">
        {cfg.abbr}
      </text>
    </svg>
  );
}
