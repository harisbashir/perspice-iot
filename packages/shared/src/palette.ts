export const PALETTE_STEPS = ['50', '100', '200', '300', '400', '500', '600', '700', '800', '900', '950'] as const;
export type PaletteStep = (typeof PALETTE_STEPS)[number];

export const HEX_COLOR = /^#[0-9A-Fa-f]{6}$/;

type Rgb = [number, number, number];

function toRgb(hex: string): Rgb {
  if (!HEX_COLOR.test(hex)) throw new Error(`Invalid colour: ${hex}`);
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

const toHex = (rgb: Rgb) => `#${rgb.map((c) => Math.round(c).toString(16).padStart(2, '0')).join('')}`;

const mix = (a: Rgb, b: Rgb, weightOfB: number): Rgb =>
  [0, 1, 2].map((i) => a[i]! + (b[i]! - a[i]!) * weightOfB) as Rgb;

/** Tints toward white below 500 and shades toward black above it; 500 is the brand colour. */
const MIX: Record<PaletteStep, number> = {
  '50': 0.95,
  '100': 0.9,
  '200': 0.75,
  '300': 0.6,
  '400': 0.3,
  '500': 0,
  '600': -0.15,
  '700': -0.3,
  '800': -0.45,
  '900': -0.6,
  '950': -0.75,
};

export function generatePalette(hex: string): Record<PaletteStep, string> {
  const base = toRgb(hex);
  const out = {} as Record<PaletteStep, string>;
  for (const step of PALETTE_STEPS) {
    const w = MIX[step];
    out[step] = toHex(w >= 0 ? mix(base, [255, 255, 255], w) : mix(base, [0, 0, 0], -w));
  }
  return out;
}

function luminance(hex: string): number {
  const [r, g, b] = toRgb(hex).map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  }) as Rgb;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG 2.x contrast ratio, 1–21. */
export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}
