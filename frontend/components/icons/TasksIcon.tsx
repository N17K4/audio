
export default function TasksIcon({ size = 28, badge = 0 }: { size?: number; badge?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 28 28" style={{ flexShrink: 0 }}>
      <rect width="28" height="28" rx="7" fill="#f0fdf4" />
      <rect x="7" y="8" width="14" height="2.5" rx="1.25" fill="#16a34a" />
      <rect x="7" y="12.75" width="10" height="2.5" rx="1.25" fill="#16a34a" />
      <rect x="7" y="17.5" width="7" height="2.5" rx="1.25" fill="#16a34a" />
      {badge > 0 && <>
        <circle cx="22" cy="7" r="5" fill="#f97316" />
        <text x="22" y="7" dominantBaseline="central" textAnchor="middle" fontSize="6" fontWeight="700" fill="#fff" fontFamily="-apple-system,sans-serif">{badge > 9 ? '9+' : badge}</text>
      </>}
    </svg>
  );
}
