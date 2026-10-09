import type { DashboardViewDto } from '@perspice/shared';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/api/client';

type Maybe = DashboardViewDto | { dashboard: null };
const unwrap = (r: Maybe): DashboardViewDto | null => ('dashboard' in r ? null : r);

export const deviceDashboardKey = (deviceId: string) => ['dashboards', 'device', deviceId] as const;

export const useDeviceDashboard = (deviceId: string) =>
  useQuery({ queryKey: deviceDashboardKey(deviceId), queryFn: async () => unwrap(await api<Maybe>(`/dashboards/device/${deviceId}`)) });

export const useOverviewDashboard = () =>
  useQuery({ queryKey: ['dashboards', 'overview'], queryFn: async () => unwrap(await api<Maybe>('/dashboards/overview')) });
