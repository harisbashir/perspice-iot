import type { DeviceDto, DeviceProfileDto } from '@perspice/shared';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { api } from '@/api/client';
import type { Page } from '@/api/types';
import { DEVICE_LISTS, deviceKey } from '@/realtime/hooks';

export interface DeviceFilters {
  search?: string;
  status?: string;
  profileId?: string;
}

export const useDeviceList = (filters: DeviceFilters) =>
  useInfiniteQuery({
    queryKey: [...DEVICE_LISTS, filters],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => api<Page<DeviceDto>>('/devices', { query: { ...filters, cursor: pageParam, limit: 50 } }),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });

export const useDevice = (id: string) => useQuery({ queryKey: deviceKey(id), queryFn: () => api<DeviceDto>(`/devices/${id}`) });

export const useProfiles = () => useQuery({ queryKey: ['profiles'], queryFn: () => api<DeviceProfileDto[]>('/device-profiles') });

export const useProfile = (id: string | undefined) =>
  useQuery({ queryKey: ['profiles', id], queryFn: () => api<DeviceProfileDto>(`/device-profiles/${id}`), enabled: !!id });

