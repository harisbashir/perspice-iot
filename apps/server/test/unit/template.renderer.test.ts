import type { BrandingDto } from '@perspice/shared';
import { describe, expect, it } from 'vitest';
import { renderTemplate } from '../../src/email/template.renderer';

const branding: BrandingDto = {
  productName: 'Acme Monitor',
  logoLightUrl: null,
  logoDarkUrl: null,
  faviconUrl: null,
  primaryColor: '#1D4ED8',
  accentColor: '#F59E0B',
  loginBackgroundUrl: null,
  supportEmail: 'help@acme.test',
  customCss: null,
};

describe('renderTemplate', () => {
  it('renders branding and substitutes variables', async () => {
    const out = await renderTemplate('password_reset', { link: 'https://acme.test/reset?token=abc' }, branding);
    expect(out.subject).toContain('Reset');
    expect(out.subject).toContain('Acme Monitor');
    expect(out.html).toContain('Acme Monitor');
    // Handlebars HTML-escapes `=` as `&#x3D;`; browsers decode it back inside the href.
    expect(out.html.replaceAll('&#x3D;', '=')).toContain('https://acme.test/reset?token=abc');
    expect(out.html).toContain('#1D4ED8');
    expect(out.html).toContain('help@acme.test');
    expect(out.text).toContain('https://acme.test/reset?token=abc');
    expect(out.text).not.toContain('<');
  });

  it('escapes HTML in variables', async () => {
    const out = await renderTemplate('device_offline', { deviceName: '<script>x</script>', link: 'x' }, branding);
    expect(out.html).not.toContain('<script>x</script>');
  });

  it('prefers a database override', async () => {
    const out = await renderTemplate('test', {}, branding, {
      subject: 'Custom {{productName}}',
      bodyMjml: '<mj-text>Overridden body</mj-text>',
    });
    expect(out.subject).toBe('Custom Acme Monitor');
    expect(out.html).toContain('Overridden body');
  });

  it('renders every template key', async () => {
    for (const key of [
      'user_invite',
      'password_reset',
      'password_changed',
      'device_offline',
      'device_online',
      'device_dead',
      'test',
    ] as const) {
      const out = await renderTemplate(key, { link: 'x', deviceName: 'd', profileName: 'p', lastSeen: 'now' }, branding);
      expect(out.subject.length).toBeGreaterThan(0);
      expect(out.html).toContain('<html');
    }
  });
});
