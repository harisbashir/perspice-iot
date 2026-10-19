import type { DashboardState, DataResponse, TelemetryKeyDef, Timewindow } from '@perspice/shared';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '@/api/client';
import { useDevicesSubscription } from '@/realtime/hooks';
import { useRoomSubscription, useSocketEvent } from '@/realtime/socket';
import { isSampled, sampleResult } from './sample-data';
import { type LocationEvent, type Results, type StatusEvent, type TelemetryEvent, type WidgetQuery, applyLocation, applyStatus, applyTelemetry, buildRequests, devicesIn } from './live';

/**
 * Fetches every widget's data in one request and keeps it live: telemetry and status events for
 * the devices on screen are merged in without refetching. With `sample` (key definitions), widgets
 * of the dashboard's own device or asset get made-up data instead (template previews).
 */
export function useDashboardData(
  state: DashboardState,
  deviceId: string | undefined,
  timewindow: Timewindow,
  refreshS: number,
  assetId?: string,
  sample?: TelemetryKeyDef[] | null,
) {
  const [queries, setQueries] = useState<Record<string, WidgetQuery>>({});
  const built = useMemo(() => buildRequests(state, deviceId, timewindow, queries), [state, deviceId, timewindow, queries]);
  const { requests, meta, sampled } = useMemo(() => {
    if (!sample) return { ...built, sampled: {} };
    const own = built.requests.filter((r) => isSampled(r.datasource));
    return {
      requests: built.requests.filter((r) => !isSampled(r.datasource)),
      meta: Object.fromEntries(Object.entries(built.meta).filter(([id]) => !own.some((r) => r.widgetId === id))),
      sampled: Object.fromEntries(own.map((r) => [r.widgetId, sampleResult(r, sample)])),
    };
  }, [built, sample]);

  const query = useQuery({
    queryKey: ['dashboard-data', deviceId ?? null, assetId ?? null, requests],
    queryFn: () => (requests.length ? api<DataResponse>('/dashboards/data', { body: { deviceId, assetId, requests } }) : Promise.resolve({ results: {} })),
    refetchInterval: refreshS > 0 ? refreshS * 1000 : false,
    staleTime: 0,
  });

  const [results, setResults] = useState<Results>({});
  useEffect(() => {
    if (query.data) setResults(query.data.results);
  }, [query.data]);

  // The devices the dashboard names itself (its own, or one chosen in a widget). Devices that only
  // turn up in lists don't hold back the catch-up below: the next fetch may list others.
  const named = useMemo(() => [...new Set(Object.values(meta).flatMap((m) => (m.deviceId ? [m.deviceId] : [])))], [meta]);
  const joined = useDevicesSubscription(devicesIn(results, meta), named);
  // Readings published between the fetch and the server joining the rooms never arrive as events,
  // so fetch once more when it has (and after every reconnect). Not needed when the rooms were
  // joined before this dashboard fetched anything (another view on the same device).
  const refetch = useRef(query.refetch);
  refetch.current = query.refetch;
  const joinedBeforeFetch = useRef(joined);
  const [caughtUp, setCaughtUp] = useState(false);
  useEffect(() => {
    if (!joined) {
      joinedBeforeFetch.current = false;
      setCaughtUp(false);
      return;
    }
    if (joinedBeforeFetch.current || !named.length) {
      setCaughtUp(true);
      return;
    }
    let current = true;
    void refetch.current().finally(() => current && setCaughtUp(true));
    return () => {
      current = false;
    };
  }, [joined, named.length]);
  // KPI tiles count the whole scope, so they need every status change, not just on-screen devices.
  const stats = Object.values(meta).map((m) => m.stats);
  const hasAlarms = Object.values(meta).some((m) => m.alarms);
  useRoomSubscription('subscribe:status', null, stats.some(Boolean) ? {} : null);
  useRoomSubscription('subscribe:alarms', null, hasAlarms ? {} : null);
  const refetchTimer = useRef<ReturnType<typeof setTimeout>>();
  useEffect(() => () => clearTimeout(refetchTimer.current), []);
  useSocketEvent<TelemetryEvent>('telemetry', (e) => setResults((r) => applyTelemetry(r, meta, e, timewindow.kind === 'relative')));
  useSocketEvent<LocationEvent>('location', (e) => setResults((r) => applyLocation(r, e)));
  useSocketEvent('alarm', () => {
    if (!hasAlarms) return;
    clearTimeout(refetchTimer.current);
    refetchTimer.current = setTimeout(() => void query.refetch(), 300);
  });
  useSocketEvent<StatusEvent>('status', (e) => {
    setResults((r) => applyStatus(r, e, meta));
    if (stats.includes('filtered')) {
      // Whether the device counts towards a filtered KPI is the server's call; refetch, debounced.
      clearTimeout(refetchTimer.current);
      refetchTimer.current = setTimeout(() => void query.refetch(), 1000);
    }
  });

  const setQuery = (widgetId: string, patch: WidgetQuery) => setQueries((q) => ({ ...q, [widgetId]: { ...q[widgetId], ...patch } }));
  // Widgets with nothing to fetch are "ready" with no data.
  const resultFor = (widgetId: string) =>
    (sampled as Results)[widgetId] ?? (meta[widgetId] ? results[widgetId] : { ok: true as const, data: null });

  // Live: every update from here on arrives as an event (and no fetch in flight can overwrite it).
  const live = joined && caughtUp && !query.isFetching;
  return { resultFor, setQuery, live, loading: query.isLoading, error: query.error };
}
