import type { AlarmDto, AlarmEventDto, AlarmFilter, AlarmSummary } from '@perspice/shared';
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef } from 'react';
import { api } from '@/api/client';
import type { Page } from '@/api/types';
import { useAuth } from '@/auth/AuthProvider';
import { useRoomSubscription, useSocketEvent } from '@/realtime/socket';

export type AlarmDetail = AlarmDto & { timeline: AlarmEventDto[] };

const toQuery = (f: AlarmFilter) => ({
  status: f.status?.join(','),
  severity: f.severity?.join(','),
  deviceId: f.deviceId,
  profileId: f.profileId,
  customerId: f.customerId,
});

export const useAlarms = (f: AlarmFilter) =>
  useInfiniteQuery({
    queryKey: ['alarms', 'list', f],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => api<Page<AlarmDto>>('/alarms', { query: { ...toQuery(f), cursor: pageParam, limit: 50 } }),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });

export const useAlarm = (id: string) => useQuery({ queryKey: ['alarms', 'one', id], queryFn: () => api<AlarmDetail>(`/alarms/${id}`) });

export function useAlarmSummary() {
  const { hasPerm } = useAuth();
  return useQuery({ queryKey: ['alarms', 'summary'], queryFn: () => api<AlarmSummary>('/alarms/summary'), enabled: hasPerm('alarm.read') });
}

/** Keeps alarm queries fresh from the tenant's live alarm feed (refetches, coalesced). */
export function useAlarmFeed(): void {
  const { hasPerm } = useAuth();
  const qc = useQueryClient();
  const timer = useRef<ReturnType<typeof setTimeout>>();
  useRoomSubscription('subscribe:alarms', null, hasPerm('alarm.read') ? {} : null);
  useSocketEvent('alarm', () => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => void qc.invalidateQueries({ queryKey: ['alarms'] }), 150);
  });
}

export async function acknowledge(id: string, comment?: string) {
  return api<AlarmDto>(`/alarms/${id}/ack`, { body: comment ? { comment } : {} });
}

export async function clearAlarm(id: string, comment?: string) {
  return api<AlarmDto>(`/alarms/${id}/clear`, { body: comment ? { comment } : {} });
}
