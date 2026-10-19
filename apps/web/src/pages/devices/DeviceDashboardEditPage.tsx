import type { DashboardViewDto } from '@perspice/shared';
import { useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useParams } from 'react-router';
import { api } from '@/api/client';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/components/ui/toast';
import { DashboardEditor } from '@/dashboards/builder/DashboardEditor';
import { deviceDashboardKey, useDeviceDashboard } from '@/dashboards/hooks';
import { NotFoundPage } from '../NotFoundPage';
import { useDevice, useProfile } from './hooks';

/** Customises this customer's copy of a device dashboard (instance override). */
export function DeviceDashboardEditPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();
  const { data: device, isLoading } = useDevice(id);
  const { data: profile } = useProfile(device?.profileId);
  const dashboard = useDeviceDashboard(id);

  if (isLoading || dashboard.isLoading) return <Skeleton className="h-96" />;
  if (!device || !dashboard.data) return <NotFoundPage />;
  const view = dashboard.data;

  return (
    <div className="space-y-4">
      <div>
        <Link to={`/devices/${id}`} className="text-sm text-primary-700 hover:underline dark:text-primary-300">
          ← {device.name}
        </Link>
        <h1 className="mt-1 text-2xl font-semibold">Customise dashboard</h1>
        <p className="text-sm text-fg-muted">Changes apply to every {profile?.name ?? ''} device of your organisation. Based on “{view.templateName}”.</p>
      </div>
      <DashboardEditor
        initial={view.definition}
        profile={profile ?? null}
        previewDevice={device}
        onSave={async (definition) => {
          const saved = await api<DashboardViewDto>(`/dashboard-instances/${view.instanceId}/override`, { method: 'PUT', body: { definition } });
          qc.setQueryData(deviceDashboardKey(id), saved);
          toast({ title: 'Dashboard customised', variant: 'success' });
          navigate(`/devices/${id}`);
        }}
      />
    </div>
  );
}
