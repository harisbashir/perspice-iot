import { eq, isNull, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runCli } from '../../src/cli';
import { setupOpenApi } from '../../src/openapi';
import { tokenFor } from '../auth-helpers';
import { createUser } from '../factories';
import { deviceProfile, emailTemplate, role, user } from '../../src/db/schema';
import { type TestApp, createTestApp, testEnv } from '../harness';

async function cli(t: TestApp, ...args: string[]) {
  const out: string[] = [];
  const err: string[] = [];
  const code = await runCli(args, {
    env: { ...testEnv(t.config.DATABASE_URL), REDIS_URL: t.config.REDIS_URL, PUBLIC_URL: 'https://iot.example.com' },
    out: (l) => out.push(l),
    err: (l) => err.push(l),
  });
  return { code, out: out.join('\n'), err: err.join('\n') };
}

describe('cli', () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await createTestApp();
  });

  afterAll(async () => {
    await t?.close();
  });

  it('migrate is idempotent', async () => {
    expect((await cli(t, 'migrate')).code).toBe(0);
    expect((await cli(t, 'migrate')).code).toBe(0);
  });

  it('seed twice creates no duplicates', async () => {
    expect((await cli(t, 'seed')).code).toBe(0);
    expect((await cli(t, 'seed')).code).toBe(0);
    const roles = await t.db.select({ n: sql<number>`count(*)::int` }).from(role).where(eq(role.builtIn, true));
    expect(roles[0]!.n).toBe(6);
    const profiles = await t.db.select().from(deviceProfile);
    expect(profiles.filter((p) => p.name === 'Telecom RMS')).toHaveLength(1);
    expect(profiles.filter((p) => p.name === 'Generic Sensor')).toHaveLength(1);
    const rms = profiles.find((p) => p.name === 'Telecom RMS')!;
    expect(rms.commands.map((c) => c.name)).toEqual(['gen_start', 'gen_stop']);
    expect(rms.statusNotify).toMatchObject({ enabled: true, roleKeys: ['customer_admin', 'platform_admin'] });
    const templates = await t.db.select().from(emailTemplate).where(isNull(emailTemplate.customerId));
    expect(templates.length).toBeGreaterThanOrEqual(7);
    expect(new Set(templates.map((x) => x.key)).size).toBe(templates.length);
  });

  it('create-admin prints an activation URL; a second run exits 1 unless --force', async () => {
    const first = await cli(t, 'create-admin', '--email', 'Owner@Example.com', '--name', 'Owner');
    expect(first.code).toBe(0);
    expect(first.out).toMatch(/https:\/\/iot\.example\.com\/activate\?token=[A-Za-z0-9_-]+/);
    const admin = await t.db.query.user.findFirst({ where: eq(user.email, 'owner@example.com') });
    expect(admin?.status).toBe('invited');

    const second = await cli(t, 'create-admin', '--email', 'other@example.com', '--name', 'Other');
    expect(second.code).toBe(1);
    expect(second.err).toMatch(/already exists/i);

    const forced = await cli(t, 'create-admin', '--email', 'other@example.com', '--name', 'Other', '--force');
    expect(forced.code).toBe(0);
  });

  it('health checks the database and Redis', async () => {
    const res = await cli(t, 'health');
    expect(res.code).toBe(0);
    expect(res.out).toContain('database: ok');
  });

  it('rejects unknown commands', async () => {
    expect((await cli(t, 'frobnicate')).code).toBe(2);
  });
});

describe('openapi', () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await createTestApp();
  });

  afterAll(async () => {
    await t?.close();
  });

  it('serves the spec to signed-in users only', async () => {
    await t.baseUrl(); // listen first, as bootstrap does, so supertest reuses the server
    await setupOpenApi(t.app, t.config);
    expect((await t.http.get('/api/docs/openapi.json')).status).toBe(401);
    const u = await createUser(t.db, { roleKey: 'platform_admin' });
    const res = await t.http.get('/api/docs/openapi.json').set('Authorization', `Bearer ${await tokenFor(t, u.email, u.password)}`);
    expect(res.status).toBe(200);
    expect(Object.keys(res.body.paths)).toEqual(expect.arrayContaining(['/api/devices', '/api/auth/login']));
  });
});
