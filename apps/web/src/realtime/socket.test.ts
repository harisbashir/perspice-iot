import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.unmock('@/realtime/socket');
const emitted: [string, unknown][] = [];
vi.mock('socket.io-client', () => ({
  io: () => ({ connected: true, on: vi.fn(), off: vi.fn(), connect: vi.fn(), disconnect: vi.fn(), emit: (e: string, p: unknown) => emitted.push([e, p]) }),
}));

describe('device rooms', () => {
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
});
