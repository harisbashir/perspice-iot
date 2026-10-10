import { http, HttpResponse } from 'msw';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { server } from '@/test/server';
import { disablePush, enablePush, pushStatus } from './push';

/** Minimal browser push stack: one registration whose subscription we control. */
function fakeBrowser(permission: NotificationPermission = 'granted') {
  let subscription: { endpoint: string; toJSON(): unknown; unsubscribe: () => Promise<boolean> } | null = null;
  const subscribe = vi.fn(async (opts: { applicationServerKey: Uint8Array }) => {
    subscription = {
      endpoint: 'https://push.example.com/abc',
      toJSON: () => ({ endpoint: 'https://push.example.com/abc', keys: { p256dh: 'p', auth: 'a' }, key: opts.applicationServerKey.length }),
      unsubscribe: vi.fn(async () => {
        subscription = null;
        return true;
      }),
    };
    return subscription;
  });
  const reg = { pushManager: { subscribe, getSubscription: async () => subscription } };
  Object.defineProperty(navigator, 'serviceWorker', {
    configurable: true,
    value: { register: vi.fn(async () => reg), ready: Promise.resolve(reg), getRegistration: async () => reg },
  });
  Object.assign(window, { PushManager: class {}, Notification: { permission, requestPermission: vi.fn(async () => permission) } });
  return { subscribe };
}

describe('push', () => {
  const calls: [string, unknown][] = [];
  beforeEach(() => {
    calls.length = 0;
    server.use(
      http.get('*/api/push/public-key', () => HttpResponse.json({ publicKey: 'BAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', subscriptions: 0 })),
      http.post('*/api/push/subscriptions', async ({ request }) => {
        calls.push(['subscribe', await request.json()]);
        return new HttpResponse(null, { status: 204 });
      }),
      http.delete('*/api/push/subscriptions', async ({ request }) => {
        calls.push(['unsubscribe', await request.json()]);
        return new HttpResponse(null, { status: 204 });
      }),
    );
  });
  afterEach(() => {
    delete (navigator as { serviceWorker?: unknown }).serviceWorker;
  });

  it('subscribes this browser with the server key and registers it', async () => {
    const { subscribe } = fakeBrowser();
    expect(await pushStatus()).toMatchObject({ supported: true, available: true, enabled: false });
    await enablePush();
    expect(subscribe).toHaveBeenCalledWith(expect.objectContaining({ userVisibleOnly: true }));
    expect(calls).toEqual([['subscribe', { endpoint: 'https://push.example.com/abc', keys: { p256dh: 'p', auth: 'a' }, key: 65 }]]);
    expect(await pushStatus()).toMatchObject({ enabled: true });

    await disablePush();
    expect(calls.at(-1)).toEqual(['unsubscribe', { endpoint: 'https://push.example.com/abc' }]);
    expect(await pushStatus()).toMatchObject({ enabled: false });
  });

  it('explains a blocked permission', async () => {
    fakeBrowser('denied');
    await expect(enablePush()).rejects.toThrow(/blocked/);
    expect(calls).toEqual([]);
  });

  it('reports when the server has no key', async () => {
    fakeBrowser();
    server.use(http.get('*/api/push/public-key', () => HttpResponse.json({ publicKey: null, subscriptions: 0 })));
    expect(await pushStatus()).toMatchObject({ available: false, enabled: false });
    await expect(enablePush()).rejects.toThrow(/not set up/);
  });
});
