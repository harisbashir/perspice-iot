import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { tokenFor } from '../auth-helpers';
import { createCustomer, createUser } from '../factories';
import { type TestApp, createTestApp } from '../harness';

describe('branding', () => {
  let t: TestApp;
  let platformAuth: string;

  beforeAll(async () => {
    t = await createTestApp();
    const p = await createUser(t.db, { roleKey: 'platform_admin' });
    platformAuth = `Bearer ${await tokenFor(t, p.email, p.password)}`;
    const res = await t.http
      .put('/api/branding/platform')
      .set('Authorization', platformAuth)
      .send({ productName: 'Operator Cloud', supportEmail: 'ops@operator.test' });
    expect(res.status).toBe(200);
  });

  afterAll(async () => {
    await t?.close();
  });

  it('serves platform branding with defaults on the platform host and unknown hosts', async () => {
    for (const host of ['localhost', 'unknown.example.org', 'nope.localhost']) {
      const res = await t.http.get('/api/public/branding').set('Host', host);
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ productName: 'Operator Cloud', primaryColor: '#0F766E', supportEmail: 'ops@operator.test' });
    }
  });

  it('merges customer overrides over platform branding', async () => {
    const c = await createCustomer(t.db);
    const res = await t.http
      .put(`/api/customers/${c.id}/branding`)
      .set('Authorization', platformAuth)
      .send({ productName: 'Acme Monitor', primaryColor: '#1D4ED8' });
    expect(res.status).toBe(200);
    const pub = await t.http.get('/api/public/branding').set('Host', `${c.slug}.localhost`);
    expect(pub.body).toMatchObject({
      productName: 'Acme Monitor',
      primaryColor: '#1D4ED8',
      accentColor: '#F59E0B',
      supportEmail: 'ops@operator.test',
    });
  });

  it('lets a customer admin edit their own branding but not another customer’s', async () => {
    const c = await createCustomer(t.db);
    const other = await createCustomer(t.db);
    const u = await createUser(t.db, { roleKey: 'customer_admin', customerId: c.id });
    const auth = `Bearer ${await tokenFor(t, u.email, u.password, `${c.slug}.localhost`)}`;
    expect(
      (await t.http.put(`/api/customers/${c.id}/branding`).set('Authorization', auth).send({ productName: 'Mine' })).status,
    ).toBe(200);
    expect(
      (await t.http.put(`/api/customers/${other.id}/branding`).set('Authorization', auth).send({ productName: 'X' })).status,
    ).toBe(404);
    expect((await t.http.put('/api/branding/platform').set('Authorization', auth).send({ productName: 'X' })).status).toBe(403);
  });

  it('rejects a low-contrast primary colour', async () => {
    const res = await t.http.put('/api/branding/platform').set('Authorization', platformAuth).send({ primaryColor: '#FFFF00' });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION');
    expect(res.body.details.contrast).toBeLessThan(3);
  });

  it('strips dangerous custom CSS', async () => {
    const c = await createCustomer(t.db);
    await t.http
      .put(`/api/customers/${c.id}/branding`)
      .set('Authorization', platformAuth)
      .send({ customCss: '@import url(http://evil.test/x.css);\n.x{color:red}' });
    const pub = await t.http.get('/api/public/branding').set('Host', `${c.slug}.localhost`);
    expect(pub.body.customCss).not.toContain('evil');
    expect(pub.body.customCss).toContain('.x{color:red}');
  });

  it('uploads assets: sanitises SVG and rejects other types', async () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script><circle r="5" onload="x()"/></svg>';
    const res = await t.http
      .post('/api/branding/assets')
      .set('Authorization', platformAuth)
      .attach('file', Buffer.from(svg), { filename: 'logo.svg', contentType: 'image/svg+xml' });
    expect(res.status).toBe(201);
    expect(res.body.url).toMatch(/^\/api\/public\/assets\/branding\/.+\.svg$/);
    const served = await t.http.get(res.body.url);
    expect(served.status).toBe(200);
    expect(served.headers['content-type']).toContain('image/svg+xml');
    const body = Buffer.isBuffer(served.body) ? served.body.toString() : served.text;
    expect(body).not.toContain('script');
    expect(body).not.toContain('onload');

    const bad = await t.http
      .post('/api/branding/assets')
      .set('Authorization', platformAuth)
      .attach('file', Buffer.from('<html></html>'), { filename: 'x.html', contentType: 'text/html' });
    expect(bad.status).toBe(400);

    const big = await t.http
      .post('/api/branding/assets')
      .set('Authorization', platformAuth)
      .attach('file', Buffer.alloc(1024 * 1024 + 1), { filename: 'big.png', contentType: 'image/png' });
    expect(big.status).toBe(413);
  });

  it('only serves branding assets publicly', async () => {
    expect((await t.http.get('/api/public/assets/exports/secret.csv')).status).toBe(404);
    expect((await t.http.get('/api/public/assets/branding/../x')).status).toBe(404);
  });

  describe('caddy ask', () => {
    it('allows the base domain and active customer subdomains only', async () => {
      const active = await createCustomer(t.db);
      const suspended = await createCustomer(t.db, { status: 'suspended' });
      const ask = (domain: string) => t.http.get(`/internal/caddy/ask?domain=${encodeURIComponent(domain)}`);
      expect((await ask('localhost')).status).toBe(200);
      expect((await ask(`${active.slug}.localhost`)).status).toBe(200);
      expect((await ask('mqtt.localhost')).status).toBe(200);
      expect((await ask(`${suspended.slug}.localhost`)).status).toBe(404);
      expect((await ask('unknown-slug.localhost')).status).toBe(404);
      expect((await ask('evil.example.com')).status).toBe(404);
      expect((await ask('')).status).toBe(404);
    });
  });
});

