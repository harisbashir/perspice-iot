import { Card, CardContent } from '@/components/ui/card';
import { PageHeader } from '@/components/PageHeader';
import { useStatusFeed } from '@/realtime/hooks';
import { DevicesTable } from '../devices/DevicesTable';
import { useDeviceList, useDeviceStats, useProfiles } from '../devices/hooks';

const TILES = [
  { key: 'total', label: 'Devices', className: '' },
  { key: 'online', label: 'Online', className: 'text-green-700 dark:text-green-400' },
  { key: 'offline', label: 'Offline', className: 'text-amber-700 dark:text-amber-400' },
  { key: 'dead', label: 'Dead', className: 'text-red-700 dark:text-red-400' },
  { key: 'never', label: 'Never connected', className: 'text-slate-500' },
] as const;

export function OverviewPage() {
  const { data: stats } = useDeviceStats();
  const list = useDeviceList({});
  const { data: profiles = [] } = useProfiles();
  useStatusFeed();
  const devices = list.data?.pages.flatMap((p) => p.items) ?? [];
  return (
    <div>
      <PageHeader title="Overview" />
      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-5">
        {TILES.map((t) => (
          <Card key={t.key}>
            <CardContent className="p-4">
              <div className="text-xs font-medium uppercase text-slate-500">{t.label}</div>
              <div className={`mt-1 text-3xl font-semibold tabular-nums ${t.className}`}>{stats ? stats[t.key] : '–'}</div>
            </CardContent>
          </Card>
        ))}
      </div>
      <DevicesTable devices={devices} profileName={(id) => profiles.find((p) => p.id === id)?.name ?? '—'} />
    </div>
  );
}
