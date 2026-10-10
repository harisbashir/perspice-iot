import { describe, expect, it } from 'vitest';
import { sanitizeCss } from '../../src/branding/sanitize';

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
