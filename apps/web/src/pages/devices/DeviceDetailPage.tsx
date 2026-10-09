import { Suspense, lazy, useState } from 'react';
import { useParams } from 'react-router';
import { useAuth } from '@/auth/AuthProvider';
import { LazyDashboardView as DashboardView } from '@/dashboards/LazyDashboardView';
import { DeviceDashboardToolbar, OutdatedBanner } from '@/dashboards/DeviceDashboardToolbar';
import { useDeviceDashboard } from '@/dashboards/hooks';
import { PageHeader } from '@/components/PageHeader';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useDeviceLive } from '@/realtime/hooks';
import { NotFoundPage } from '../NotFoundPage';
import { AttributesPanel } from './AttributesPanel';
import { CommandsPanel } from './CommandsPanel';
import { CredentialsPanel } from './CredentialsPanel';
import { DebugPanel } from './DebugPanel';
import { LatestValuesPanel } from './LatestValuesPanel';
import { StatusBadge } from './StatusBadge';
import { timeAgo } from './format';
import { useDevice, useProfile } from './hooks';
import { ReportButton } from '@/exports/ReportButton';
import { DeviceAlarmsTab } from '@/alarms/DeviceAlarmsTab';

// ECharts is large; load it only when the History tab is opened.
const HistoryChart = lazy(() => import('./HistoryChart').then((m) => ({ default: m.HistoryChart })));

export function DeviceDetailPage() {
  const { id = '' } = useParams();
  const { hasPerm } = useAuth();
  const { data: device, isLoading, error } = useDevice(id);
  const { data: profile } = useProfile(device?.profileId);
  const dashboard = useDeviceDashboard(id);
  const [tab, setTab] = useState<string | null>(null);
  useDeviceLive(id);

  if (isLoading || dashboard.isLoading) return <Skeleton className="h-64" />;
  if (error || !device) return <NotFoundPage />;
  const view = dashboard.data ?? null;

  return (
    <div>
      <PageHeader
        title={device.name}
        description={[profile?.name, device.firmwareVersion ? `firmware ${device.firmwareVersion}` : null].filter(Boolean).join(' · ')}
      />
      <div className="mb-4 flex items-center gap-3 text-sm">
        <StatusBadge status={device.status} />
        <span className="text-slate-500">Last seen {timeAgo(device.lastSeen)}</span>
      </div>
      <Tabs value={tab ?? (view ? 'dashboard' : 'overview')} onValueChange={setTab}>
        <TabsList className="flex-wrap">
          {view && <TabsTrigger value="dashboard">Dashboard</TabsTrigger>}
          <TabsTrigger value="overview">Overview</TabsTrigger>
          {hasPerm('alarm.read') && <TabsTrigger value="alarms">Alarms</TabsTrigger>}
          <TabsTrigger value="history">History</TabsTrigger>
          <TabsTrigger value="commands">Commands</TabsTrigger>
          <TabsTrigger value="attributes">Attributes</TabsTrigger>
          <TabsTrigger value="credentials">Credentials</TabsTrigger>
          {hasPerm('device.read') && <TabsTrigger value="debug">Debug</TabsTrigger>}
        </TabsList>
        {view && (
          <TabsContent value="dashboard">
            <OutdatedBanner view={view} />
            <DashboardView
              key={`${view.instanceId}-${view.templateVersion}-${view.overridden}`}
              definition={view.definition}
              device={device}
              profile={profile ?? null}
              toolbar={(ctx) => (
                <>
                  <DeviceDashboardToolbar deviceId={device.id} view={view} />
                  <ReportButton deviceId={device.id} {...ctx} />
                </>
              )}
            />
          </TabsContent>
        )}
        <TabsContent value="overview">
          <LatestValuesPanel device={device} schema={profile?.telemetrySchema ?? []} />
        </TabsContent>
        <TabsContent value="history">
          <Suspense fallback={<Skeleton className="h-80" />}>
            <HistoryChart deviceId={device.id} keys={profile?.telemetrySchema ?? []} />
          </Suspense>
        </TabsContent>
        <TabsContent value="commands">
          <CommandsPanel deviceId={device.id} deviceName={device.name} commands={profile?.commands ?? []} />
        </TabsContent>
        <TabsContent value="attributes">
          <AttributesPanel device={device} />
        </TabsContent>
        <TabsContent value="credentials">
          <CredentialsPanel deviceId={device.id} />
        </TabsContent>
        <TabsContent value="debug">
          <DebugPanel deviceId={device.id} />
        </TabsContent>
        <TabsContent value="alarms">
          <DeviceAlarmsTab deviceId={device.id} profile={profile ?? null} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
