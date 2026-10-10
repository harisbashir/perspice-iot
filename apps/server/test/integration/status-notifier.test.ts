import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PresenceService } from '../../src/presence/presence.service';
import { tokenFor } from '../auth-helpers';
import { createCustomer, createDevice, createProfile, createUser } from '../factories';
import { type TestApp, createTestApp } from '../harness';
import { configureMailpit, listMail, mailText, waitForMail } from '../mailpit';

async function eventually<T>(fn: () => Promise<T>, check: (v: T) => boolean, timeoutMs = 5000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let last: T;
  do {
    last = await fn();
    if (check(last)) return last;
    await new Promise((r) => setTimeout(r, 100));
  } while (Date.now() < deadline);
  return last;
}

describe('device status notifications', () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await createTestApp();
    await configureMailpit(t);
  });

  afterAll(async () => {
    await t?.close();
  });

  async function setup(enabled = true) {
    const c = await createCustomer(t.db);
    const email = `admin-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@example.com`;
    const admin = await createUser(t.db, { roleKey: 'customer_admin', customerId: c.id, email });
    const viewer = await createUser(t.db, { roleKey: 'customer_viewer', customerId: c.id });
    const profile = await createProfile(t.db, {
      name: 'Telecom RMS',
      statusNotify: { enabled, roleKeys: ['customer_admin'], channels: ['email', 'inapp'] },
    });
    const { device } = await createDevice(t.db, { profileId: profile.id, customerId: c.id, name: 'Tower 17' });
    const auth = `Bearer ${await tokenFor(t, admin.email, admin.password, `${c.slug}.localhost`)}`;
    return { c, admin, viewer, device, auth };
  }

  it('notifies the customer admin in-app and by email when a device goes offline', async () => {
    const s = await setup();
    const presence = t.app.get(PresenceService);
    await presence.transition(s.device.id, 'online', 'test');
    await presence.transition(s.device.id, 'offline', 'test');

    const msg = await waitForMail(s.admin.email);
    expect(msg.Subject).toContain('Device offline: Tower 17');
    const text = await mailText(msg.ID);
    expect(text).toContain(`http://${s.c.slug}.localhost/devices/${s.device.id}`);

    const list = await eventually(
      () => t.http.get('/api/notifications').set('Authorization', s.auth),
      (r) => (r.body.items ?? []).some((n: { title: string }) => n.title.includes('offline')),
    );
    const n = list.body.items.find((x: { title: string }) => x.title.includes('offline'));
    expect(n).toMatchObject({ severity: 'warning', link: `/devices/${s.device.id}` });

    const count = await t.http.get('/api/notifications/unread-count').set('Authorization', s.auth);
    expect(count.body.count).toBeGreaterThanOrEqual(1);
    expect((await t.http.post(`/api/notifications/${n.id}/read`).set('Authorization', s.auth)).status).toBe(204);
    await t.http.post('/api/notifications/read-all').set('Authorization', s.auth);
    expect((await t.http.get('/api/notifications/unread-count').set('Authorization', s.auth)).body.count).toBe(0);

    // The viewer's role is not in roleKeys.
    expect(await listMail(s.viewer.email)).toHaveLength(0);
  });

  it('sends one offline email when a device flaps twice within 5 minutes', async () => {
    const s = await setup();
    const presence = t.app.get(PresenceService);
    for (const to of ['online', 'offline', 'online', 'offline'] as const) {
      await presence.transition(s.device.id, to, 'test');
    }
    await waitForMail(s.admin.email);
    await new Promise((r) => setTimeout(r, 1500));
    const offline = (await listMail(s.admin.email)).filter((m) => m.Subject.includes('offline'));
    expect(offline).toHaveLength(1);
  });

  it('does nothing when the profile has notifications disabled', async () => {
    const s = await setup(false);
    const presence = t.app.get(PresenceService);
    await presence.transition(s.device.id, 'online', 'test');
    await presence.transition(s.device.id, 'offline', 'test');
    await new Promise((r) => setTimeout(r, 1500));
    expect(await listMail(s.admin.email)).toHaveLength(0);
  });
});
