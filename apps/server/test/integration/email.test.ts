import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it, inject } from 'vitest';
import { systemSetting } from '../../src/db/schema';
import { EmailService } from '../../src/email/email.service';
import { SettingsService } from '../../src/settings/settings.service';
import { type TestApp, createTestApp } from '../harness';
import { clearMailpit, configureMailpit, waitForMail } from '../mailpit';

describe('email', () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await createTestApp();
    await configureMailpit(t);
  });

  beforeEach(async () => {
    await clearMailpit();
  });

  afterAll(async () => {
    await t?.close();
  });

  it('stores SMTP settings encrypted', async () => {
    const res = await t.db.query.systemSetting.findFirst({ where: eq(systemSetting.key, 'email.smtp') });
    expect(res?.secret).toBe(true);
    expect(typeof res?.value).toBe('string');
    expect(res?.value as string).toMatch(/^v1:/);
    expect(await t.app.get(SettingsService).get('email.smtp')).toMatchObject({ port: inject('mailpitSmtp').port });
  });

  it('delivers a queued password reset email', async () => {
    const to = `reset-${Date.now()}@example.com`;
    await t.app.get(EmailService).send('password_reset', to, { link: 'http://x/reset?token=t' }, {});
    const msg = await waitForMail(to);
    expect(msg.Subject).toContain('Reset');
  });

  it('sends a test email synchronously', async () => {
    const to = `test-${Date.now()}@example.com`;
    await t.app.get(EmailService).sendTest(to);
    const msg = await waitForMail(to, 2000);
    expect(msg.Subject).toContain('Test');
  });
});
