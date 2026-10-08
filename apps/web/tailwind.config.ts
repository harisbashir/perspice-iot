import type { Config } from 'tailwindcss';

const STEPS = ['50', '100', '200', '300', '400', '500', '600', '700', '800', '900', '950'];

/** Brand colours come from CSS variables set at runtime by applyTheme (white-label). */
const fromVar = (name: string) =>
  Object.fromEntries(STEPS.map((s) => [s, `rgb(var(--color-${name}-${s}) / <alpha-value>)`]));

export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        primary: { ...fromVar('primary'), DEFAULT: 'rgb(var(--color-primary-600) / <alpha-value>)' },
        accent: 'rgb(var(--color-accent) / <alpha-value>)',
      },
    },
  },
  plugins: [],
} satisfies Config;
