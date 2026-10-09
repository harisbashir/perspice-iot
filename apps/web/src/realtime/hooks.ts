import type { DeviceDto, DeviceStatus, LatestValue } from '@perspice/shared';
import { type QueryClient, type InfiniteData, useQueryClient } from '@tanstack/react-query';
import type { Page } from '@/api/types';
import { useDeviceRooms, useRoomSubscription, useSocketEvent } from './socket';

export interface StatusEvent {
  deviceId: string;
  from: DeviceStatus;
  to: DeviceStatus;
  ts: number;
}

export interface TelemetryEvent {
  deviceId: string;
  values: Record<string, LatestValue>;
}

export const deviceKey = (id: string) => ['devices', 'one', id] as const;
export const DEVICE_LISTS = ['devices', 'list'] as const;

type DeviceList = InfiniteData<Page<DeviceDto>> | Page<DeviceDto>;

/** Applies `fn` to the device everywhere it is cached (detail and list pages). */
export function patchDevice(qc: QueryClient, id: string, fn: (d: DeviceDto) => DeviceDto): void {
  qc.setQueryData<DeviceDto>(deviceKey(id), (d) => (d ? fn(d) : d));
  qc.setQueriesData<DeviceList>({ queryKey: DEVICE_LISTS }, (data) => {
    if (!data) return data;
    const mapPage = (p: Page<DeviceDto>) => ({ ...p, items: p.items.map((d) => (d.id === id ? fn(d) : d)) });
    return 'pages' in data ? { ...data, pages: data.pages.map(mapPage) } : mapPage(data);
  });
}

/** Live status changes for list pages: rows update in place. */
export function useStatusFeed(): void {
  const qc = useQueryClient();
  useRoomSubscription('subscribe:status', null, {});
  useSocketEvent<StatusEvent>('status', (e) => {
    patchDevice(qc, e.deviceId, (d) => ({ ...d, status: e.to, lastSeen: e.to === 'online' ? e.ts : d.lastSeen }));
  });
}

/** Merges telemetry and status events for one device into its cached DeviceDto. */
export function useDeviceLive(deviceId: string): void {
  const qc = useQueryClient();
  useDeviceRooms([deviceId]);
  useRoomSubscription('subscribe:status', null, {});
  useSocketEvent<TelemetryEvent>('telemetry', (e) => {
    if (e.deviceId !== deviceId) return;
    const newest = Math.max(...Object.values(e.values).map((v) => v.ts));
    patchDevice(qc, deviceId, (d) => ({ ...d, latest: { ...d.latest, ...e.values }, lastSeen: Math.max(d.lastSeen ?? 0, newest) }));
  });
  useSocketEvent<StatusEvent>('status', (e) => {
    if (e.deviceId === deviceId) patchDevice(qc, deviceId, (d) => ({ ...d, status: e.to }));
  });
}

/** Joins the live rooms of every device a dashboard shows (the server drops out-of-scope ids). */
export function useDevicesSubscription(deviceIds: string[]): void {
  useDeviceRooms(deviceIds);
}
