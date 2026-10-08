import { describe, expect, it } from 'vitest';
import { FALLBACK_BRANDING } from './BrandingProvider';
import { applyTheme } from './applyTheme';

describe('applyTheme', () => {
  it('sets the palette variables, title and custom CSS', () => {
    applyTheme({ ...FALLBACK_BRANDING, primaryColor: '#0F766E', productName: 'Acme Monitor', customCss: '.x{color:red}' });
    const style = document.documentElement.style;
    expect(style.getPropertyValue('--color-primary-500')).toBe('15 118 110');
    expect(style.getPropertyValue('--color-primary-50')).not.toBe('');
    expect(style.getPropertyValue('--color-accent')).toBe('245 158 11');
    expect(document.title).toBe('Acme Monitor');
    expect(document.getElementById('perspice-custom-css')?.textContent).toBe('.x{color:red}');

    applyTheme({ ...FALLBACK_BRANDING, customCss: null });
    expect(document.getElementById('perspice-custom-css')).toBeNull();
  });
});
