import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { imageOverlay } from '../src/library/other/image-overlay';
import { markdownCard, renderMarkdown } from '../src/library/other/markdown';
import { latest, propsFor } from './props';

describe('content widgets (Review Focus 3)', () => {
  it('strips scripts, event handlers and javascript: links from markdown', () => {
    const html = renderMarkdown(
      '# Site\n\n<script>alert(1)</script>\n\n<img src="x" onerror="alert(1)">\n\n[click](javascript:alert(1)) [ok](https://example.com)\n\n<a href="javascript:alert(2)">raw</a>',
      {},
    );
    expect(html).not.toMatch(/<script/i);
    expect(html).not.toMatch(/onerror/i);
    expect(html).not.toMatch(/href="javascript:/i);
    expect(html).toContain('>click<');
    expect(html).toContain('href="https://example.com"');
    expect(html).toContain('rel="noopener noreferrer"');
  });

  it('substitutes {{key}} with escaped latest values', () => {
    render(
      <markdownCard.Component
        {...propsFor(markdownCard, { settings: { content: 'Fuel is **{{fuel_level}}**' }, result: latest({ fuel_level: 42.123 }) })}
      />,
    );
    expect(screen.getByText('42.1 %')).toBeInTheDocument();
    const hostile = renderMarkdown('Value: {{name}}', { name: '<img src=x onerror=alert(1)>' });
    expect(hostile).not.toMatch(/<img/);
  });

  it('accepts only uploaded or https image URLs', () => {
    const ok = (url: string) => imageOverlay.settingsSchema.safeParse({ imageUrl: url }).success;
    expect(ok('/api/public/assets/branding/a.png')).toBe(true);
    expect(ok('https://example.com/site.png')).toBe(true);
    expect(ok('http://example.com/site.png')).toBe(false);
    expect(ok('data:image/png;base64,AAAA')).toBe(false);
    expect(ok('javascript:alert(1)')).toBe(false);
  });

  it('places value labels over the image', () => {
    render(
      <imageOverlay.Component
        {...propsFor(imageOverlay, {
          datasource: { kind: 'currentDevice', keys: ['fuel_level'] },
          settings: { imageUrl: 'https://example.com/site.png', labels: '[{"key":"fuel_level","x":25,"y":40}]' },
          result: latest({ fuel_level: 55 }),
        })}
      />,
    );
    const label = screen.getByText('55.0 %');
    expect(label.style.left).toBe('25%');
    expect(label.style.top).toBe('40%');
  });
});
