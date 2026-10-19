import type { DeviceDto, DeviceLocationDto, DeviceStatus, LatestValue } from '@perspice/shared';
import { type QueryClient, type InfiniteData, useIsFetching, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import type { Page } from '@/api/types';
import { useDeviceRooms, useRoomSubscription, useSocketEvent } from '@/realtime/socket';

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

/**
 * Readings published between a view's fetch and the server joining its device rooms never arrive
 * as events, so fetch once more when `joined` turns true (and after every reconnect). Not needed
 * when the rooms were joined before the view fetched anything, or when it follows no device.
 * Returns true once caught up.
 */
export function useCatchUp(joined: boolean, refetch: () => Promise<unknown>, needed = true): boolean {
  const latest = useRef(refetch);
  latest.current = refetch;
  const joinedBeforeFetch = useRef(joined);
  const [caughtUp, setCaughtUp] = useState(false);
  useEffect(() => {
    if (!joined) {
      joinedBeforeFetch.current = false;
      setCaughtUp(false);
      return;
    }
    if (joinedBeforeFetch.current || !needed) {
      setCaughtUp(true);
      return;
    }
    let current = true;
    void latest.current().finally(() => current && setCaughtUp(true));
    return () => {
      current = false;
    };
  }, [joined, needed]);
  return joined && caughtUp;
}

/**
 * Merges telemetry and status events for one device into its cached DeviceDto. Returns true while
 * live: the device's room is joined, the device caught up, and no fetch in flight.
 */
export function useDeviceLive(deviceId: string): boolean {
  const qc = useQueryClient();
  const joined = useDeviceRooms([deviceId]);
  const caughtUp = useCatchUp(joined, () => qc.refetchQueries({ queryKey: deviceKey(deviceId), exact: true }));
  const fetching = useIsFetching({ queryKey: deviceKey(deviceId), exact: true }) > 0;
  useRoomSubscription('subscribe:status', null, {});
  useSocketEvent<TelemetryEvent>('telemetry', (e) => {
    if (e.deviceId !== deviceId) return;
    const newest = Math.max(...Object.values(e.values).map((v) => v.ts));
    patchDevice(qc, deviceId, (d) => ({ ...d, latest: { ...d.latest, ...e.values }, lastSeen: Math.max(d.lastSeen ?? 0, newest) }));
  });
  useSocketEvent<StatusEvent>('status', (e) => {
    if (e.deviceId === deviceId) patchDevice(qc, deviceId, (d) => ({ ...d, status: e.to }));
  });
  useSocketEvent<{ deviceId: string; location: DeviceLocationDto }>('location', (e) => {
    if (e.deviceId === deviceId) patchDevice(qc, deviceId, (d) => (d.location && d.location.ts >= e.location.ts ? d : { ...d, location: e.location }));
  });
  return caughtUp && !fetching;
}

/**
 * Joins the live rooms of every device a dashboard shows (the server drops out-of-scope ids).
 * Returns true once the server has answered for `watch` (all of them by default).
 */
export function useDevicesSubscription(deviceIds: string[], watch: string[] = deviceIds): boolean {
  useDeviceRooms(deviceIds);
  return useDeviceRooms(watch);
}
