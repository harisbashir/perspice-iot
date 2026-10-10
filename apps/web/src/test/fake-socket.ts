import { useEffect, useRef } from 'react';

type Handler = (payload: unknown) => void;
const handlers = new Map<string, Set<Handler>>();

/** In-memory stand-in for the Socket.IO connection (mocked globally in setup.ts). */
export const fakeSocket = {
  emitted: [] as [string, unknown][],
  /** Simulates the server pushing an event. */
  serverEmit(event: string, payload: unknown): void {
    for (const h of handlers.get(event) ?? []) h(payload);
  },
  reset(): void {
    handlers.clear();
    this.emitted = [];
  },
};

const on = (event: string, h: Handler) => {
  if (!handlers.has(event)) handlers.set(event, new Set());
  handlers.get(event)!.add(h);
};
const off = (event: string, h: Handler) => handlers.get(event)?.delete(h);

export function getSocket() {
  return { connected: true, on, off, emit: (event: string, payload: unknown) => fakeSocket.emitted.push([event, payload]) };
}

export function useSocketEvent<T>(event: string, handler: (payload: T) => void): void {
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => {
    const h = (p: unknown) => ref.current(p as T);
    on(event, h);
    return () => {
      off(event, h);
    };
  }, [event]);
}

export function useRoomSubscription(subscribe: string, _unsubscribe: string | null, body: Record<string, unknown> | null): void {
  const key = body ? JSON.stringify(body) : null;
  useEffect(() => {
    if (key !== null) fakeSocket.emitted.push([subscribe, JSON.parse(key)]);
  }, [subscribe, key]);
}

export function useDeviceRooms(deviceIds: string[]): void {
  const key = [...new Set(deviceIds)].sort().join(',');
  useEffect(() => {
    if (key) fakeSocket.emitted.push(['subscribe:devices', { deviceIds: key.split(',') }]);
  }, [key]);
}
