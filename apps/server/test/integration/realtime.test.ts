import type { MqttClient } from 'mqtt';
import type { Socket } from 'socket.io-client';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { NotificationsService } from '../../src/notifications/notifications.service';
import { PresenceService } from '../../src/presence/presence.service';
import { tokenFor } from '../auth-helpers';
import { createCustomer, createDevice, createProfile, createUser } from '../factories';
import { type TestApp, createTestApp } from '../harness';
import { connectDevice } from '../mqtt-helpers';
import { connectSocket, nextEvent } from '../socket-helpers';

describe('realtime gateway', () => {
  let t: TestApp;
  let base: string;
  const sockets: Socket[] = [];
  const clients: MqttClient[] = [];

  beforeAll(async () => {
    t = await createTestApp({ emqx: true });
    base = await t.baseUrl();
  });

  afterEach(async () => {
    sockets.splice(0).forEach((s) => s.close());
    await Promise.all(clients.splice(0).map((c) => c.endAsync(true).catch(() => undefined)));
  });

  afterAll(async () => {
    await t?.close();
  });

  async function customerSide() {
    const c = await createCustomer(t.db);
    const u = await createUser(t.db, { roleKey: 'customer_admin', customerId: c.id });
    const token = await tokenFor(t, u.email, u.password, `${c.slug}.localhost`);
    const p = await createProfile(t.db);
    const created = await createDevice(t.db, { profileId: p.id, customerId: c.id });
    const socket = await connectSocket(base, token);
    sockets.push(socket);
    return { c, u, socket, device: created.device, deviceToken: created.token };
  }

  it('rejects connections without a valid token', async () => {
    await expect(connectSocket(base, 'nope')).rejects.toBeTruthy();
  });

  it('accepts API keys', async () => {
    const a = await customerSide();
    const key = await t.http
      .post('/api/api-keys')
      .set('Authorization', `Bearer ${await tokenFor(t, a.u.email, a.u.password, `${a.c.slug}.localhost`)}`)
      .send({ name: 'sim', permissions: ['device.read'] });
    const socket = await connectSocket(base, key.body.key);
    sockets.push(socket);
    expect(await socket.emitWithAck('subscribe:device', { deviceId: a.device.id })).toEqual({ ok: true });
  });

  it("customer A cannot subscribe to customer B's device", async () => {
    const a = await customerSide();
    const b = await customerSide();
    const ack = await a.socket.emitWithAck('subscribe:device', { deviceId: b.device.id });
    expect(ack).toEqual({ ok: false, code: 'NOT_FOUND' });
  });

  it('streams telemetry within 2 s of an MQTT publish', async () => {
    const a = await customerSide();
    expect(await a.socket.emitWithAck('subscribe:device', { deviceId: a.device.id })).toEqual({ ok: true });
    const mqtt = await connectDevice(t, a.device.id, a.deviceToken);
    clients.push(mqtt);
    const event = nextEvent<{ deviceId: string; values: Record<string, { v: unknown }> }>(a.socket, 'telemetry', 2000);
    await mqtt.publishAsync(`perspice/v1/${a.device.id}/telemetry`, JSON.stringify({ values: { fuel_level: 64.5 } }), { qos: 1 });
    const msg = await event;
    expect(msg.deviceId).toBe(a.device.id);
    expect(msg.values.fuel_level?.v).toBe(64.5);
  });

  it('pushes status changes to the customer and platform status rooms', async () => {
    const a = await customerSide();
    expect(await a.socket.emitWithAck('subscribe:status', {})).toEqual({ ok: true });
    const p = await createUser(t.db, { roleKey: 'platform_admin' });
    const platform = await connectSocket(base, await tokenFor(t, p.email, p.password));
    sockets.push(platform);
    await platform.emitWithAck('subscribe:status', {});
    const other = await customerSide();
    await other.socket.emitWithAck('subscribe:status', {});
    let leaked = false;
    other.socket.on('status', () => (leaked = true));

    const forCustomer = nextEvent<{ deviceId: string; to: string }>(a.socket, 'status', 2000, (e) => e.deviceId === a.device.id);
    const forPlatform = nextEvent<{ deviceId: string; to: string }>(platform, 'status', 2000, (e) => e.deviceId === a.device.id);
    await t.app.get(PresenceService).transition(a.device.id, 'online', 'test');
    expect((await forCustomer).to).toBe('online');
    expect((await forPlatform).to).toBe('online');
    await new Promise((r) => setTimeout(r, 300));
    expect(leaked).toBe(false);
  });

  it('delivers notifications to the owning user only', async () => {
    const a = await customerSide();
    const b = await customerSide();
    let leaked = false;
    b.socket.on('notification', () => (leaked = true));
    const got = nextEvent<{ title: string }>(a.socket, 'notification');
    await t.app.get(NotificationsService).create(a.u.id, { type: 'test', severity: 'info', title: 'Hello', body: '' });
    expect((await got).title).toBe('Hello');
    await new Promise((r) => setTimeout(r, 300));
    expect(leaked).toBe(false);
  });
});
