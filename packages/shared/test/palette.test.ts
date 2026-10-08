import { describe, expect, it } from 'vitest';
import { PALETTE_STEPS, contrastRatio, generatePalette } from '../src/index.js';

describe('palette', () => {
  it('keeps the base colour at 500 and orders lightness', () => {
    const p = generatePalette('#0F766E');
    expect(Object.keys(p)).toEqual([...PALETTE_STEPS]);
    expect(p['500']).toBe('#0f766e');
    const lum = (hex: string) => contrastRatio(hex, '#000000');
    for (let i = 1; i < PALETTE_STEPS.length; i++) {
      expect(lum(p[PALETTE_STEPS[i - 1]!]!)).toBeGreaterThan(lum(p[PALETTE_STEPS[i]!]!));
    }
  });

  it('computes WCAG contrast ratios', () => {
    expect(contrastRatio('#000000', '#FFFFFF')).toBeCloseTo(21, 1);
    expect(contrastRatio('#FFFFFF', '#FFFFFF')).toBeCloseTo(1, 5);
    expect(contrastRatio('#FFFF00', '#FFFFFF')).toBeLessThan(3);
    expect(contrastRatio('#0F766E', '#FFFFFF')).toBeGreaterThan(3);
  });
});
