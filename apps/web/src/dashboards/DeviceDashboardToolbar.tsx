import type { DashboardViewDto } from '@perspice/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router';
import { api } from '@/api/client';
import { useAuth } from '@/auth/AuthProvider';
import { ErrorText } from '@/components/ErrorText';
import { Button } from '@/components/ui/button';
import { deviceDashboardKey } from './hooks';

/** Customise / re-sync / edit-template controls for a device dashboard. */
export function DeviceDashboardToolbar({ deviceId, view }: { deviceId: string; view: DashboardViewDto }) {
  const { hasPerm } = useAuth();
  const qc = useQueryClient();
  const [error, setError] = useState<unknown>(null);

  async function resync() {
    setError(null);
    try {
      qc.setQueryData(deviceDashboardKey(deviceId), await api<DashboardViewDto>(`/dashboard-instances/${view.instanceId}/override`, { method: 'DELETE' }));
    } catch (e) {
      setError(e);
    }
  }

  return (
    <>
      {hasPerm('dashboard.customize') && (
        <>
          <Button asChild size="sm" variant="outline">
            <Link to={`/devices/${deviceId}/dashboard/edit`}>{view.overridden ? 'Edit customisation' : 'Customise'}</Link>
          </Button>
          {view.overridden && (
            <Button size="sm" variant="outline" onClick={() => void resync()}>
              Re-sync with template
            </Button>
          )}
        </>
      )}
      {hasPerm('dashboard.edit') && (
        <Button asChild size="sm" variant="ghost">
          <Link to={`/dashboards/${view.templateId}/edit`}>Edit template</Link>
        </Button>
      )}
      <ErrorText error={error} />
    </>
  );
}

export function OutdatedBanner({ view }: { view: DashboardViewDto }) {
  if (!view.outdated) return null;
  return (
    <div role="status" className="mb-3 rounded-xl bg-warn-tint p-3 text-sm text-warn">
      “{view.templateName}” has changed since this dashboard was customised. Re-sync to get the changes (your customisations will be replaced).
    </div>
  );
}
