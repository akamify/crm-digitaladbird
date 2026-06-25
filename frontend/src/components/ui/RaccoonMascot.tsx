'use client';

/**
 * Raccoon — Digital AdBird supporting mascot.
 *
 * Friendly, modern, tech-company illustration style. Used in:
 *   - Login left panel (full body, hero illustration)
 *   - Empty-state / onboarding screens (head-only, `variant="head"`)
 *
 * Deliberately keeps a small palette (3 tones + accent) so it composes well
 * over the brand gradient without competing for attention.
 */
export function RaccoonMascot({
  className = 'h-40 w-40',
  variant = 'full',
}: { className?: string; variant?: 'full' | 'head' }) {
  if (variant === 'head') return <RaccoonHead className={className} />;
  return <RaccoonBody className={className} />;
}

function RaccoonHead({ className }: { className: string }) {
  return (
    <svg viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg" className={className} aria-label="Mascot">
      <defs>
        <radialGradient id="rh-fur" cx="0.5" cy="0.4" r="0.7">
          <stop offset="0%" stopColor="#A0AEC0" />
          <stop offset="100%" stopColor="#4A5568" />
        </radialGradient>
      </defs>
      {/* Ears */}
      <path d="M40 70 Q 30 30, 65 50 Z" fill="#4A5568" />
      <path d="M160 70 Q 170 30, 135 50 Z" fill="#4A5568" />
      <path d="M50 60 Q 45 40, 62 52 Z" fill="#F687B3" opacity="0.6" />
      <path d="M150 60 Q 155 40, 138 52 Z" fill="#F687B3" opacity="0.6" />
      {/* Head */}
      <ellipse cx="100" cy="110" rx="70" ry="60" fill="url(#rh-fur)" />
      {/* Light face mask */}
      <ellipse cx="100" cy="120" rx="50" ry="40" fill="#E2E8F0" />
      {/* Bandit mask */}
      <path d="M50 95 Q 70 85, 90 95 Q 100 100, 110 95 Q 130 85, 150 95 L 150 115 Q 130 122, 110 117 Q 100 113, 90 117 Q 70 122, 50 115 Z"
        fill="#1A202C" />
      {/* Eyes */}
      <circle cx="78" cy="108" r="6" fill="white" />
      <circle cx="122" cy="108" r="6" fill="white" />
      <circle cx="79" cy="109" r="3" fill="#1A202C" />
      <circle cx="123" cy="109" r="3" fill="#1A202C" />
      {/* Nose + smile */}
      <ellipse cx="100" cy="135" rx="6" ry="4" fill="#1A202C" />
      <path d="M90 145 Q 100 152, 110 145" stroke="#1A202C" strokeWidth="2.5" strokeLinecap="round" fill="none" />
    </svg>
  );
}

function RaccoonBody({ className }: { className: string }) {
  return (
    <svg viewBox="0 0 320 360" xmlns="http://www.w3.org/2000/svg" className={className} aria-label="Mascot">
      <defs>
        <radialGradient id="rb-fur" cx="0.5" cy="0.3" r="0.85">
          <stop offset="0%" stopColor="#A0AEC0" />
          <stop offset="100%" stopColor="#2D3748" />
        </radialGradient>
        <linearGradient id="rb-laptop" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#60A5FA" />
          <stop offset="100%" stopColor="#3B82F6" />
        </linearGradient>
      </defs>

      {/* ── Tail (striped, behind body) ── */}
      <g>
        <path d="M50 280 Q 20 240, 30 200 Q 40 170, 80 180 L 90 220 Z" fill="#4A5568" />
        <path d="M35 215 Q 30 200, 45 195 L 55 210 Z" fill="#1A202C" />
        <path d="M45 245 Q 40 230, 55 225 L 65 240 Z" fill="#1A202C" />
      </g>

      {/* ── Body / shirt ── */}
      <path d="M90 200 Q 70 280, 110 320 L 210 320 Q 250 280, 230 200 Z" fill="#3B82F6" />
      {/* Shirt collar */}
      <path d="M140 200 L 160 220 L 180 200 Z" fill="white" opacity="0.9" />

      {/* ── Laptop (in front of body) ── */}
      <g transform="translate(90 240)">
        <rect width="140" height="80" rx="6" fill="#1A202C" />
        <rect x="6" y="6" width="128" height="60" rx="3" fill="url(#rb-laptop)" />
        {/* Code lines */}
        <rect x="14" y="18" width="50" height="3" rx="1.5" fill="white" opacity="0.6" />
        <rect x="14" y="26" width="80" height="3" rx="1.5" fill="white" opacity="0.4" />
        <rect x="14" y="34" width="40" height="3" rx="1.5" fill="white" opacity="0.5" />
        <rect x="14" y="42" width="65" height="3" rx="1.5" fill="white" opacity="0.4" />
        <rect x="14" y="50" width="30" height="3" rx="1.5" fill="white" opacity="0.6" />
      </g>

      {/* ── Head ── */}
      {/* Ears */}
      <path d="M88 80 Q 78 30, 122 60 Z" fill="#2D3748" />
      <path d="M232 80 Q 242 30, 198 60 Z" fill="#2D3748" />
      <path d="M100 70 Q 95 45, 115 60 Z" fill="#F687B3" opacity="0.6" />
      <path d="M220 70 Q 225 45, 205 60 Z" fill="#F687B3" opacity="0.6" />

      {/* Head fill */}
      <ellipse cx="160" cy="130" rx="80" ry="72" fill="url(#rb-fur)" />
      {/* Light face mask */}
      <ellipse cx="160" cy="145" rx="58" ry="48" fill="#E2E8F0" />

      {/* Bandit mask */}
      <path d="M100 115 Q 125 102, 150 115 Q 160 121, 170 115 Q 195 102, 220 115 L 220 138 Q 195 147, 170 141 Q 160 137, 150 141 Q 125 147, 100 138 Z"
        fill="#1A202C" />

      {/* Eyes */}
      <circle cx="134" cy="128" r="8" fill="white" />
      <circle cx="186" cy="128" r="8" fill="white" />
      <circle cx="136" cy="130" r="4" fill="#1A202C" />
      <circle cx="188" cy="130" r="4" fill="#1A202C" />
      {/* Eye sparkle */}
      <circle cx="138" cy="127" r="1.2" fill="white" />
      <circle cx="190" cy="127" r="1.2" fill="white" />

      {/* Nose */}
      <ellipse cx="160" cy="160" rx="7" ry="5" fill="#1A202C" />

      {/* Smile */}
      <path d="M148 172 Q 160 182, 172 172" stroke="#1A202C" strokeWidth="3" strokeLinecap="round" fill="none" />
      <path d="M148 172 Q 152 175, 156 172" stroke="#1A202C" strokeWidth="3" strokeLinecap="round" fill="none" />
      <path d="M164 172 Q 168 175, 172 172" stroke="#1A202C" strokeWidth="3" strokeLinecap="round" fill="none" />
    </svg>
  );
}
