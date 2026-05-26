import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          50:  '#eff6ff',
          100: '#dbeafe',
          200: '#bfdbfe',
          300: '#93c5fd',
          400: '#60a5fa',
          500: '#3b82f6',
          600: '#2563eb',
          700: '#1d4ed8',
          800: '#1e40af',
          900: '#1e3a8a',
        },
        surface: {
          DEFAULT: '#ffffff',
          muted:   '#f8fafc',
          subtle:  '#f1f5f9',
        },
      },
      fontFamily: {
        sans:    ['Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        display: ['"Plus Jakarta Sans"', 'Inter', 'ui-sans-serif', 'sans-serif'],
        mono:    ['"JetBrains Mono"', 'ui-monospace', 'monospace'],
      },
      boxShadow: {
        soft:  '0 1px 2px rgba(15,23,42,0.04), 0 4px 12px rgba(15,23,42,0.04)',
        glow:  '0 10px 30px -10px rgba(37,99,235,0.35)',
        card:  '0 1px 3px rgba(15,23,42,0.06), 0 2px 8px rgba(15,23,42,0.04)',
      },
      backgroundImage: {
        'grid-faint': "linear-gradient(rgba(15,23,42,0.04) 1px, transparent 1px), linear-gradient(90deg, rgba(15,23,42,0.04) 1px, transparent 1px)",
      },
      backgroundSize: { 'grid-faint': '32px 32px' },
    },
  },
  plugins: [],
};

export default config;
