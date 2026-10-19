import { useEffect, useRef, useSyncExternalStore } from 'react';
import { type Socket, io } from 'socket.io-client';
import { refreshSession, session } from '@/api/client';

let socket: Socket | null = null;

/** One authenticated Socket.IO connection per tab, created on first use. */
export function getSocket(): Socket {
  if (socket) return socket;
  const s = io(`${window.location.origin}/rt`, {
    path: '/api/socket.io',
    transports: ['websocket'],
    // Evaluated on every (re)connect, so a refreshed access token is picked up.
    auth: (cb) => cb({ token: session.token() }),
  });
  s.on('connect_error', (err) => {
    if (err.message !== 'UNAUTHENTICATED') return;
    void refreshSession().then((ok) => ok && s.connect());
  });
  session.subscribe((current) => {
    if (!current) s.disconnect();
    else if (!s.connected) s.connect();
  });
  socket = s;
  return s;
}

/** Subscribes `handler` to a server event for the component's lifetime. */
export function useSocketEvent<T>(event: string, handler: (payload: T) => void): void {
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => {
    const s = getSocket();
    const listener = (payload: T) => ref.current(payload);
    s.on(event, listener);
    return () => {
      s.off(event, listener);
    };
  }, [event]);
}

/** Emits a room subscription now and again after every reconnect. */
export function useRoomSubscription(subscribe: string, unsubscribe: string | null, body: Record<string, unknown> | null): void {
  const key = body ? JSON.stringify(body) : null;
  useEffect(() => {
    if (key === null) return;
    const s = getSocket();
    const payload = JSON.parse(key) as Record<string, unknown>;
    const join = () => s.emit(subscribe, payload);
    if (s.connected) join();
    s.on('connect', join);
    return () => {
      s.off('connect', join);
      if (unsubscribe) s.emit(unsubscribe, payload);
    };
  }, [subscribe, unsubscribe, key]);
}

// Device rooms are shared: the device page and a dashboard on it may both follow one device, so
// rooms are reference-counted and only left when the last user goes away.
const deviceRooms = new Map<string, number>();
const MAX_IDS_PER_MESSAGE = 500;
let roomEventsBound = false;

// Rooms the server has answered for (joined, or refused as out of scope) since the last connect:
// events for a device published before its answer may not have reached this tab.
const settled = new Set<string>();
const settledListeners = new Set<() => void>();
let settledVersion = 0;

function changeSettled(change: () => void): void {
  change();
  settledVersion++;
  settledListeners.forEach((l) => l());
}

function onSettledChange(listener: () => void): () => void {
  settledListeners.add(listener);
  return () => settledListeners.delete(listener);
}

function joinRooms(s: Socket, ids: string[]): void {
  for (let i = 0; i < ids.length; i += MAX_IDS_PER_MESSAGE) {
    const chunk = ids.slice(i, i + MAX_IDS_PER_MESSAGE);
    // Any answer settles them; rooms left meanwhile stay unsettled.
    s.emit('subscribe:devices', { deviceIds: chunk }, () =>
      changeSettled(() => chunk.filter((id) => deviceRooms.has(id)).forEach((id) => settled.add(id))),
    );
  }
}

function leaveRooms(s: Socket, ids: string[]): void {
  for (let i = 0; i < ids.length; i += MAX_IDS_PER_MESSAGE) s.emit('unsubscribe:devices', { deviceIds: ids.slice(i, i + MAX_IDS_PER_MESSAGE) });
}

/**
 * Follows the live rooms of these devices for the component's lifetime (the server drops
 * out-of-scope ids). Returns true once the server has answered for all of them since the last
 * (re)connect, i.e. from when on their events are delivered.
 */
export function useDeviceRooms(deviceIds: string[]): boolean {
  const key = [...new Set(deviceIds)].sort().join(',');
  useEffect(() => {
    if (!key) return;
    const ids = key.split(',');
    const s = getSocket();
    if (!roomEventsBound) {
      roomEventsBound = true;
      s.on('connect', () => joinRooms(s, [...deviceRooms.keys()]));
      s.on('disconnect', () => changeSettled(() => settled.clear()));
    }
    const fresh = ids.filter((id) => {
      const n = deviceRooms.get(id) ?? 0;
      deviceRooms.set(id, n + 1);
      return n === 0;
    });
    if (fresh.length && s.connected) joinRooms(s, fresh);
    return () => {
      const gone = ids.filter((id) => {
        const n = (deviceRooms.get(id) ?? 1) - 1;
        if (n > 0) deviceRooms.set(id, n);
        else deviceRooms.delete(id);
        return n <= 0;
      });
      if (gone.length) {
        changeSettled(() => gone.forEach((id) => settled.delete(id)));
        leaveRooms(s, gone);
      }
    };
  }, [key]);
  useSyncExternalStore(onSettledChange, () => settledVersion); // re-render when it changes
  return !key || key.split(',').every((id) => settled.has(id));
}
