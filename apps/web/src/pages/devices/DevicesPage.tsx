import { Plus } from 'lucide-react';
import { useState } from 'react';
import { useAuth } from '@/auth/AuthProvider';
import { PageHeader } from '@/components/PageHeader';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { useStatusFeed } from '@/realtime/hooks';
import { CreateDeviceDialog } from './CreateDeviceDialog';
import { DevicesTable } from './DevicesTable';
import { type DeviceFilters, useDeviceList, useProfiles } from './hooks';

export function DevicesPage() {
  const { hasPerm } = useAuth();
  const [filters, setFilters] = useState<DeviceFilters>({});
  const [open, setOpen] = useState(false);
  const list = useDeviceList(filters);
  const { data: profiles = [] } = useProfiles();
  useStatusFeed();
  const devices = list.data?.pages.flatMap((p) => p.items) ?? [];
  const profileName = (id: string) => profiles.find((p) => p.id === id)?.name ?? '—';

  return (
    <div>
      <PageHeader
        title="Devices"
        actions={
          hasPerm('device.write') && (
            <Button onClick={() => setOpen(true)}>
              <Plus className="h-4 w-4" /> New device
            </Button>
          )
        }
      />
      <div className="mb-4 flex flex-wrap gap-2">
        <Input
          aria-label="Search devices"
          placeholder="Search by name"
          className="w-64"
          value={filters.search ?? ''}
          onChange={(e) => setFilters((f) => ({ ...f, search: e.target.value || undefined }))}
        />
        <select
          aria-label="Filter by status"
          className="h-9 rounded-md border border-slate-300 bg-transparent px-2 text-sm dark:border-slate-700"
          value={filters.status ?? ''}
          onChange={(e) => setFilters((f) => ({ ...f, status: e.target.value || undefined }))}
        >
          <option value="">All statuses</option>
          <option value="online">Online</option>
          <option value="offline">Offline</option>
          <option value="dead">Dead</option>
          <option value="never">Never connected</option>
        </select>
        <select
          aria-label="Filter by profile"
          className="h-9 rounded-md border border-slate-300 bg-transparent px-2 text-sm dark:border-slate-700"
          value={filters.profileId ?? ''}
          onChange={(e) => setFilters((f) => ({ ...f, profileId: e.target.value || undefined }))}
        >
          <option value="">All profiles</option>
          {profiles.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </div>
      {list.isLoading ? <Skeleton className="h-40" /> : <DevicesTable devices={devices} profileName={profileName} />}
      {list.hasNextPage && (
        <Button variant="outline" className="mt-4" onClick={() => void list.fetchNextPage()}>
          Load more
        </Button>
      )}
      <CreateDeviceDialog open={open} onOpenChange={setOpen} />
    </div>
  );
}
