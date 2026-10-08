import { describe, expect, it } from 'vitest';
import { PALETTE_STEPS, contrastRatio, generatePalette } from '../../src/branding/palette';
import { sanitizeCss } from '../../src/branding/sanitize';

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

describe('sanitizeCss', () => {
  it('strips imports, remote urls, expressions and style breakouts', () => {
    const css = sanitizeCss(
      `@import url(http://evil.test/x.css);\n.a{background:url(https://evil.test/p.png)}\n.b{width:expression(alert(1))}\n.c{background:url(/api/public/assets/branding/x.png)}\n</style><script>x</script>`,
    );
    expect(css).not.toMatch(/@import/i);
    expect(css).not.toContain('evil.test');
    expect(css).not.toMatch(/expression\(/i);
    expect(css).not.toMatch(/<\/style/i);
    expect(css).toContain('url(/api/public/assets/branding/x.png)');
  });
});
