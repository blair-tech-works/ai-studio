/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './app/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}'
  ],
  theme: {
    extend: {
      colors: {
        canvas: '#08090c',
        surface: '#0f1014',
        elevated: '#15171c',
        border: {
          subtle: '#1a1d24',
          strong: '#262a33'
        },
        accent: {
          300: '#bef264',
          400: '#a3e635',
          500: '#a3e635',
          600: '#84cc16'
        },
        text: {
          primary: '#e6e7eb',
          secondary: '#9aa0aa',
          muted: '#5d6470',
          accent: '#bef264'
        },
        // Keep the old `dark.*` names for any straggler references during migration.
        dark: {
          bg: '#08090c',
          card: '#0f1014',
          border: '#1a1d24'
        }
      },
      fontFamily: {
        sans: ['var(--font-sans)', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'sans-serif'],
        mono: ['var(--font-mono)', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace']
      },
      boxShadow: {
        focus: '0 0 0 3px rgba(163, 230, 53, 0.15)'
      },
      transitionTimingFunction: {
        out: 'cubic-bezier(0.16, 1, 0.3, 1)'
      }
    }
  },
  plugins: []
};
