import containerQueries from '@tailwindcss/container-queries';
import type { Config } from 'tailwindcss';
import plugin from 'tailwindcss/plugin';

const STEPS = ['50', '100', '200', '300', '400', '500', '600', '700', '800', '900', '950'];

/** Brand colours come from CSS variables set at runtime by applyTheme (white-label). */
const fromVar = (name: string) =>
  Object.fromEntries(STEPS.map((s) => [s, `rgb(var(--color-${name}-${s}) / <alpha-value>)`]));

/** A semantic colour token from src/index.css; it switches value in dark mode by itself. */
const token = (name: string) => `rgb(var(--${name}) / <alpha-value>)`;

export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{ts,tsx}', '../../packages/widgets/src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        primary: { ...fromVar('primary'), DEFAULT: 'rgb(var(--color-primary-600) / <alpha-value>)' },
        accent: 'rgb(var(--color-accent) / <alpha-value>)',
        // Surfaces, text and lines (see "Design tokens" in apps/web/CLAUDE.md). Use these, not slate-*.
        canvas: token('canvas'),
        surface: { DEFAULT: token('surface'), 2: token('surface-2') },
        fill: { DEFAULT: token('fill'), strong: token('fill-strong') },
        line: { DEFAULT: token('line'), strong: token('line-strong') },
        fg: { DEFAULT: token('fg'), 2: token('fg-2'), muted: token('fg-muted') },
        // Status: `ok` etc. are readable as text on surfaces; `-vivid` is for dots, bars and rings;
        // `-tint` is a badge background.
        ok: { DEFAULT: token('ok'), vivid: token('ok-vivid'), tint: token('ok-tint') },
        warn: { DEFAULT: token('warn'), vivid: token('warn-vivid'), tint: token('warn-tint') },
        crit: { DEFAULT: token('crit'), vivid: token('crit-vivid'), tint: token('crit-tint') },
        info: { DEFAULT: token('info'), vivid: token('info-vivid'), tint: token('info-tint') },
      },
      borderColor: { DEFAULT: token('line') },
      fontFamily: {
        sans: ['-apple-system', 'BlinkMacSystemFont', '"SF Pro Text"', '"Segoe UI"', 'Roboto', '"Helvetica Neue"', 'Arial', 'sans-serif'],
        // Readings and counts: SF Pro Rounded on Apple devices, the system face elsewhere.
        rounded: ['ui-rounded', '"SF Pro Rounded"', '-apple-system', 'BlinkMacSystemFont', '"Segoe UI"', 'Roboto', 'sans-serif'],
        mono: ['ui-monospace', '"SF Mono"', 'Menlo', 'Consolas', 'monospace'],
      },
      borderRadius: { xl: '0.875rem', '2xl': '1.125rem' },
      boxShadow: {
        card: '0 0 0 0.5px rgb(0 0 0 / 0.04), 0 1px 2px rgb(0 0 0 / 0.04), 0 2px 8px rgb(0 0 0 / 0.03)',
        float: '0 0 0 0.5px rgb(0 0 0 / 0.06), 0 8px 28px rgb(0 0 0 / 0.14)',
      },
      keyframes: {
        // A reading just arrived: the value glows once in the accent colour.
        live: { '0%': { color: 'rgb(var(--color-primary-500))' }, '100%': {} },
        'sheet-up': { from: { transform: 'translateY(100%)' }, to: { transform: 'translateY(0)' } },
        'fade-in': { from: { opacity: '0' }, to: { opacity: '1' } },
        'pop-in': { from: { opacity: '0', transform: 'translate(-50%, -48%) scale(0.97)' }, to: { opacity: '1', transform: 'translate(-50%, -50%) scale(1)' } },
      },
      animation: {
        live: 'live 1.2s ease-out',
        'sheet-up': 'sheet-up 0.28s cubic-bezier(0.32, 0.72, 0, 1)',
        'fade-in': 'fade-in 0.2s ease-out',
        'pop-in': 'pop-in 0.2s cubic-bezier(0.32, 0.72, 0, 1)',
      },
    },
  },
  plugins: [
    containerQueries,
    plugin(({ addVariant }) => {
      // Touch screens: bigger targets (44 px) where a finger, not a pointer, operates the UI.
      addVariant('touch', '@media (pointer: coarse)');
    }),
  ],
} satisfies Config;
