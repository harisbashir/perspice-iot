import type { Permission } from '@perspice/shared';
import { describe, expect, it } from 'vitest';
import { HELP_ARTICLES, articleForPath, visibleArticles } from './articles';
import { renderHelp } from './render';

const content = import.meta.glob('./content/*.md', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
const all = () => true;

describe('help articles', () => {
  it('every article has content, and every file has an article', () => {
    const files = Object.keys(content).map((f) => f.replace('./content/', '').replace('.md', '')).sort();
    expect(files).toEqual(HELP_ARTICLES.map((a) => a.slug).sort());
    for (const [file, md] of Object.entries(content)) expect(md.length, file).toBeGreaterThan(400);
  });

  it('links between articles point at articles that exist', () => {
    const slugs = new Set(HELP_ARTICLES.map((a) => a.slug));
    for (const [file, md] of Object.entries(content)) {
      for (const [, slug] of md.matchAll(/\]\(\/help\/([a-z-]+)/g)) expect(slugs.has(slug!), `${file} → ${slug}`).toBe(true);
    }
  });

  it('customer-facing text doesn’t name the product (customers may see their own brand)', () => {
    for (const a of HELP_ARTICLES.filter((x) => x.audience === 'everyone')) {
      const forCustomers = renderHelp(content[`./content/${a.slug}.md`]!, { platform: false });
      expect(forCustomers, a.slug).not.toMatch(/perspice/i);
    }
  });

  it('customers see neither platform articles nor platform notes; platform users see both, set apart', () => {
    const forCustomer = visibleArticles('customer', all);
    expect(forCustomer.some((a) => a.audience === 'platform')).toBe(false);
    expect(visibleArticles('platform', all)).toHaveLength(HELP_ARTICLES.length);

    const md = 'Intro.\n\n:::platform\nRun `perspice logs`.\n:::\n\nOutro.';
    expect(renderHelp(md, { platform: false })).not.toContain('perspice logs');
    const html = renderHelp(md, { platform: true });
    expect(html).toContain('<aside class="help-platform"');
    expect(html).toContain('<code>perspice logs</code>');
    expect(renderHelp('<script>alert(1)</script><img src=x onerror=alert(1)>', { platform: true })).not.toMatch(/script|onerror/);
  });

  it('hides articles for pages the user can’t open', () => {
    const viewer = visibleArticles('customer', (p: Permission) => ['device.read', 'alarm.read'].includes(p));
    expect(viewer.map((a) => a.slug)).toContain('devices');
    expect(viewer.map((a) => a.slug)).not.toContain('users-roles');
  });

  it('finds the article for a page, the most specific path first', () => {
    const articles = visibleArticles('platform', all);
    expect(articleForPath('/', articles)?.slug).toBe('overview');
    expect(articleForPath('/devices/123', articles)?.slug).toBe('devices');
    expect(articleForPath('/settings/tariff', articles)?.slug).toBe('energy');
    expect(articleForPath('/settings/email', articles)?.slug).toBe('system');
    expect(articleForPath('/settings/profile', articles)?.slug).toBe('account');
    expect(articleForPath('/dashboards/t1/edit', articles)?.slug).toBe('dashboard-templates');
    expect(articleForPath('/devices/1/dashboard/edit', articles)?.slug).toBe('devices');
  });
});
