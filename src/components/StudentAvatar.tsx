interface StudentAvatarProps {
  name: string;
  size?: 'sm' | 'md';
}

const PALETTES = [
  { bg: '#1B4332', fg: '#FAF9F6', accent: '#A3B18A' },
  { bg: '#7F2B11', fg: '#FAF9F6', accent: '#E6CCB2' },
  { bg: '#2C3E35', fg: '#FAF9F6', accent: '#DAD7CD' },
  { bg: '#4A3B32', fg: '#FAF9F6', accent: '#EDE0D4' },
];

export function StudentAvatar({ name, size = 'sm' }: StudentAvatarProps) {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  }
  const palette = PALETTES[hash % PALETTES.length];
  const dim = size === 'sm' ? 30 : 38;

  return (
    <svg
      width={dim}
      height={dim}
      viewBox="0 0 40 40"
      aria-hidden="true"
      className="shrink-0 rounded-control border border-border"
    >
      <rect x="0" y="0" width="40" height="40" fill={palette.bg} />
      {/* Illustrated scholar silhouette & open book motif */}
      <circle cx="20" cy="14.5" r="6" fill={palette.fg} fillOpacity="0.92" />
      <path
        d="M9 34C9 27.8 13.8 23.5 20 23.5C26.2 23.5 31 27.8 31 34"
        fill={palette.accent}
        fillOpacity="0.88"
      />
      <path
        d="M12 36L20 32.5L28 36"
        stroke={palette.fg}
        strokeWidth="1.5"
        strokeLinecap="round"
        fill="none"
      />
    </svg>
  );
}
