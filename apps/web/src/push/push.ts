import { api } from '@/api/client';

export interface PushStatus {
  /** The browser can do push (service workers, Push API, notifications). */
  supported: boolean;
  /** The server has VAPID keys. */
  available: boolean;
  /** This browser is subscribed. */
  enabled: boolean;
  permission: NotificationPermission | 'unsupported';
}

const SW_URL = '/sw.js';

export const browserSupportsPush = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

function keyBytes(base64url: string): Uint8Array<ArrayBuffer> {
  const pad = '='.repeat((4 - (base64url.length % 4)) % 4);
  const raw = atob((base64url + pad).replace(/-/g, '+').replace(/_/g, '/'));
  const bytes = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

async function currentSubscription(): Promise<PushSubscription | null> {
  const reg = await navigator.serviceWorker.getRegistration(SW_URL);
  return (await reg?.pushManager.getSubscription()) ?? null;
}

export async function pushStatus(): Promise<PushStatus> {
  const supported = browserSupportsPush();
  const { publicKey } = await api<{ publicKey: string | null }>('/push/public-key');
  return {
    supported,
    available: !!publicKey,
    enabled: supported && !!publicKey && !!(await currentSubscription()),
    permission: supported ? Notification.permission : 'unsupported',
  };
}

/** Asks for permission, subscribes this browser and registers it with the server. */
export async function enablePush(): Promise<void> {
  if (!browserSupportsPush()) throw new Error('This browser does not support push notifications.');
  const { publicKey } = await api<{ publicKey: string | null }>('/push/public-key');
  if (!publicKey) throw new Error('Push notifications are not set up on this server.');
  if ((await Notification.requestPermission()) !== 'granted') throw new Error('Notifications are blocked for this site in your browser settings.');
  const reg = await navigator.serviceWorker.register(SW_URL);
  await navigator.serviceWorker.ready;
  const sub = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(publicKey) }));
  await api('/push/subscriptions', { body: sub.toJSON() });
}

export async function disablePush(): Promise<void> {
  const sub = await currentSubscription();
  if (!sub) return;
  await api('/push/subscriptions', { method: 'DELETE', body: { endpoint: sub.endpoint } });
  await sub.unsubscribe();
}
