'use client';

/**
 * DigitalADbird — primary brand mark.
 *
 * Swift geometric bird in flight. The body forms an upward stroke that
 * doubles as a growth-trajectory arrow (lead-gen / marketing motif).
 * Single-color: inherits `currentColor` so it works on light, dark, gradient,
 * and inside the brand chip.
 */
export function BirdLogo({ className = 'h-5 w-5' }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 32 32"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-label="DigitalADbird"
    >
      <path
        d="M3 22 C 9 19, 14 17, 18 13 L 22 9"
        stroke="currentColor"
        strokeWidth="2.6"
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity="0.55"
      />
      <path
        d="M22 9 L 29 6 L 26 13 L 30 12 L 22.5 18.5 C 19 21.5, 14.5 23.5, 9 24 C 13 21.5, 16 18.5, 17.5 15 L 22 9 Z"
        fill="currentColor"
      />
      <circle cx="26" cy="9.5" r="0.9" fill="white" opacity="0.85" />
    </svg>
  );
}

/**
 * Solid square mark — favicon / launcher / OG image.
 * Wraps the bird in the brand gradient chip so it stays legible on any tab bar.
 */
export function BirdMark({ className = 'h-9 w-9' }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 64 64"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-label="DigitalADbird"
    >
      <defs>
        <linearGradient id="bm-bg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#3B82F6" />
          <stop offset="100%" stopColor="#4338CA" />
        </linearGradient>
      </defs>
      <rect width="64" height="64" rx="14" fill="url(#bm-bg)" />
      <g transform="translate(8 10) scale(1.5)" fill="white">
        <path
          d="M3 22 C 9 19, 14 17, 18 13 L 22 9"
          stroke="white"
          strokeWidth="2.6"
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
          opacity="0.55"
        />
        <path d="M22 9 L 29 6 L 26 13 L 30 12 L 22.5 18.5 C 19 21.5, 14.5 23.5, 9 24 C 13 21.5, 16 18.5, 17.5 15 L 22 9 Z" />
        <circle cx="26" cy="9.5" r="0.9" fill="#3B82F6" />
      </g>
    </svg>
  );
}

/**
 * Wordmark lockup: bird mark + "DigitalADbird" + "CRM" tagline.
 * Use `tone="light"` for dark backgrounds, `tone="dark"` for light backgrounds.
 */
export function LogoLockup({
  className = '',
  tone = 'dark',
  showTagline = true,
}: { className?: string; tone?: 'dark' | 'light'; showTagline?: boolean }) {
  const titleColor   = tone === 'light' ? 'text-white'    : 'text-slate-900';
  const taglineColor = tone === 'light' ? 'text-blue-200' : 'text-slate-500';
  return (
    <div className={`flex items-center gap-3 ${className}`}>
      <BirdMark className="h-10 w-10 shrink-0" />
      <div className="leading-tight">
        <div className={`font-display text-lg font-semibold tracking-tight ${titleColor}`}>
          DigitalADbird
        </div>
        {showTagline && (
          <div className={`text-[10px] uppercase tracking-[0.2em] ${taglineColor}`}>
            CRM Platform
          </div>
        )}
      </div>
    </div>
  );
}
