import type { FirmwareDto, OtaDeviceDto, OtaJobDto } from '@perspice/shared';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/api/client';

export const FIRMWARE = ['firmware'] as const;
export const OTA_JOBS = ['ota-jobs'] as const;

export const useFirmware = () => useQuery({ queryKey: FIRMWARE, queryFn: () => api<FirmwareDto[]>('/firmware') });

export const useOtaJobs = () => useQuery({ queryKey: OTA_JOBS, queryFn: () => api<OtaJobDto[]>('/ota-jobs'), refetchInterval: 15_000 });

/** A running job moves on every 15 s scheduler tick; refresh it while it does. */
const live = (status: OtaJobDto['status'] | undefined) => (status === 'running' ? 5_000 : false);

export const useOtaJob = (id: string) =>
  useQuery({ queryKey: [...OTA_JOBS, id], queryFn: () => api<OtaJobDto>(`/ota-jobs/${id}`), refetchInterval: (q) => live(q.state.data?.status) });

export const useOtaJobDevices = (id: string, status: OtaJobDto['status'] | undefined) =>
  useQuery({ queryKey: [...OTA_JOBS, id, 'devices'], queryFn: () => api<OtaDeviceDto[]>(`/ota-jobs/${id}/devices`), refetchInterval: live(status) });

export interface DeviceOtaRow {
  jobId: string;
  version: string;
  jobStatus: string;
  state: OtaDeviceDto['state'];
  pct: number | null;
  error: string | null;
  updatedAt: number;
}

export const useDeviceOta = (deviceId: string) =>
  useQuery({ queryKey: ['devices', deviceId, 'ota'], queryFn: () => api<DeviceOtaRow[]>(`/devices/${deviceId}/ota`), refetchInterval: 15_000 });

export const formatBytes = (n: number) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.ceil(n / 1024)} KB`);
