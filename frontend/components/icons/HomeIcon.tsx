
export default function HomeIcon({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 28 28" style={{ flexShrink: 0 }}>
      <rect width="28" height="28" rx="7" fill="#bae6fd" />
      <path d="M14 7L22 14H19V21H16V17H12V21H9V14H6L14 7Z" fill="#0369a1" />
    </svg>
  );
}
