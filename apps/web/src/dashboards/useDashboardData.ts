import type { DashboardState, DataResponse, Timewindow } from '@perspice/shared';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { api } from '@/api/client';
import { useDevicesSubscription } from '@/realtime/hooks';
import { useSocketEvent } from '@/realtime/socket';
import { type Results, type StatusEvent, type TelemetryEvent, type WidgetQuery, applyStatus, applyTelemetry, buildRequests, devicesIn } from './live';

/**
 * Fetches every widget's data in one request and keeps it live: telemetry and status events for
 * the devices on screen are merged in without refetching.
 */
export function useDashboardData(state: DashboardState, deviceId: string | undefined, timewindow: Timewindow, refreshS: number) {
  const [queries, setQueries] = useState<Record<string, WidgetQuery>>({});
  const { requests, meta } = useMemo(() => buildRequests(state, deviceId, timewindow, queries), [state, deviceId, timewindow, queries]);

  const query = useQuery({
    queryKey: ['dashboard-data', deviceId ?? null, requests],
    queryFn: () => (requests.length ? api<DataResponse>('/dashboards/data', { body: { deviceId, requests } }) : Promise.resolve({ results: {} })),
    refetchInterval: refreshS > 0 ? refreshS * 1000 : false,
    staleTime: 0,
  });

  const [results, setResults] = useState<Results>({});
  useEffect(() => {
    if (query.data) setResults(query.data.results);
  }, [query.data]);

  useDevicesSubscription(devicesIn(results, meta));
  useSocketEvent<TelemetryEvent>('telemetry', (e) => setResults((r) => applyTelemetry(r, meta, e, timewindow.kind === 'relative')));
  useSocketEvent<StatusEvent>('status', (e) => setResults((r) => applyStatus(r, e)));

  const setQuery = (widgetId: string, patch: WidgetQuery) => setQueries((q) => ({ ...q, [widgetId]: { ...q[widgetId], ...patch } }));
  // Widgets with nothing to fetch are "ready" with no data.
  const resultFor = (widgetId: string) => (meta[widgetId] ? results[widgetId] : { ok: true as const, data: null });

  return { resultFor, setQuery, loading: query.isLoading, error: query.error };
}
