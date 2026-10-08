import { useEffect, useRef } from 'react';
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
