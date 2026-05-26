'use client';

/** Minimal premium bird logo — blue/white, used in sidebar + login. */
export function BirdLogo({ className = 'h-5 w-5' }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 32 32"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
    >
      {/* Body — sleek bird in flight */}
      <path
        d="M4 20c2-4 6-7 11-8 2-.4 4-.2 6 .5 1.5.5 3 1.5 4.2 3 .8 1 1.3 2.2 1.5 3.5.1.8 0 1.6-.3 2.3-.5 1-1.5 1.6-2.8 1.7-2 .2-4-.5-5.8-1.5-2-1.2-3.8-2.8-5.5-4.5L4 20z"
        fill="currentColor"
        opacity="0.9"
      />
      {/* Wing — swept back */}
      <path
        d="M10 12c3-3 7-5 12-5.5 2-.2 3.5.3 4.5 1.5.8 1 1 2.2.5 3.5-.8 2-2.5 3-4.8 3.2-2 .2-4-.2-6-.8-2.5-.8-4.5-2-6.2-3.5V12z"
        fill="currentColor"
        opacity="0.6"
      />
      {/* Eye */}
      <circle cx="23" cy="14" r="1.2" fill="currentColor" opacity="0.3" />
      {/* Tail accent */}
      <path
        d="M4 20c-.5 1.5-.5 3 .2 4.2.5.8 1.2 1.3 2 1.5 1 .2 2-.1 2.8-.8.6-.5 1-1.2 1.2-2L4 20z"
        fill="currentColor"
        opacity="0.7"
      />
    </svg>
  );
}
