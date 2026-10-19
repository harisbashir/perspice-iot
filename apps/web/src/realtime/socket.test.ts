import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.unmock('@/realtime/socket');
const emitted: [string, unknown][] = [];
const acks: ((answer: unknown) => void)[] = [];
const listeners = new Map<string, ((...args: unknown[]) => void)[]>();
vi.mock('socket.io-client', () => ({
  io: () => ({
    connected: true,
    on: (event: string, fn: (...args: unknown[]) => void) => listeners.set(event, [...(listeners.get(event) ?? []), fn]),
    off: vi.fn(),
    connect: vi.fn(),
    disconnect: vi.fn(),
    emit: (e: string, p: unknown, ack?: (answer: unknown) => void) => {
      emitted.push([e, p]);
      if (ack) acks.push(ack);
    },
  }),
}));

const fire = (event: string) => listeners.get(event)?.forEach((fn) => fn());

describe('device rooms', () => {
  beforeEach(() => {
    emitted.length = 0;
    acks.length = 0;
  });

  it('stay joined while any view still follows the device', async () => {
    const { useDeviceRooms } = await import('./socket');
    const page = renderHook(() => useDeviceRooms(['d1']));
    const dashboard = renderHook(() => useDeviceRooms(['d1', 'd2']));
    expect(emitted).toEqual([
      ['subscribe:devices', { deviceIds: ['d1'] }],
      ['subscribe:devices', { deviceIds: ['d2'] }],
    ]);
    dashboard.unmount(); // e.g. switching from the Dashboard tab to Overview
    expect(emitted.at(-1)).toEqual(['unsubscribe:devices', { deviceIds: ['d2'] }]);
    page.unmount();
    expect(emitted.at(-1)).toEqual(['unsubscribe:devices', { deviceIds: ['d1'] }]);
  });

  it('are ready once the server has answered for every device, and again after a reconnect', async () => {
    const { useDeviceRooms } = await import('./socket');
    const view = renderHook(() => useDeviceRooms(['d3', 'd4']));
    expect(view.result.current).toBe(false);
    act(() => acks[0]!({ ok: true, joined: ['d3'], rejected: ['d4'] }));
    expect(view.result.current).toBe(true);

    // A second view of a device already joined is ready without asking again.
    const other = renderHook(() => useDeviceRooms(['d3']));
    expect(other.result.current).toBe(true);
    expect(acks).toHaveLength(1);

    act(() => fire('disconnect'));
    expect(view.result.current).toBe(false);
    act(() => fire('connect')); // rejoins every followed room
    expect(emitted.at(-1)).toEqual(['subscribe:devices', { deviceIds: ['d3', 'd4'] }]);
    act(() => acks.at(-1)!({ ok: true, joined: ['d3', 'd4'], rejected: [] }));
    expect(view.result.current).toBe(true);
    view.unmount();
    other.unmount();
  });

  it('with no devices are ready at once', async () => {
    const { useDeviceRooms } = await import('./socket');
    expect(renderHook(() => useDeviceRooms([])).result.current).toBe(true);
  });
});
