/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        netuno: {
          cyan: '#11C3E3',
          deepCyan: '#0A93B2',
          ice: '#E0F7FC',
          snow: '#F4F8FA',
          borderLight: '#E6EEF2',
          borderMuted: '#D8E4E9',
          muted: '#EAECEF',
          graphite: '#2B3A42',
          black: '#000000',
          dark: '#050C10',
          darkCard: '#0B161E',
          deep: '#050C10',
          abyss: '#0B161E',
          card: '#0F1F28',
          teal: '#0A93B2',
          aqua: '#11C3E3',
          bright: '#47DDF5',
          foam: '#E0F7FC',
        }
      },
      fontFamily: {
        serif: ['"Cinzel"', '"Playfair Display"', 'Georgia', 'serif'],
        sans: ['"Inter"', 'system-ui', 'sans-serif'],
      },
      animation: {
        'float-slow': 'float 6s ease-in-out infinite',
        'pulse-glow': 'pulseGlow 3s ease-in-out infinite',
      },
      keyframes: {
        float: {
          '0%, 100%': { transform: 'translateY(0px)' },
          '50%': { transform: 'translateY(-6px)' },
        },
        pulseGlow: {
          '0%, 100%': { opacity: 0.6 },
          '50%': { opacity: 1 },
        }
      }
    },
  },
  plugins: [],
}

