import { FileUp, KeyRound, Plus } from 'lucide-react';
import { useState } from 'react';
import { useAuth } from '@/auth/AuthProvider';
import { PageHeader } from '@/components/PageHeader';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { ExportMenu } from '@/exports/ExportMenu';
import { useStatusFeed } from '@/realtime/hooks';
import { BulkBar } from './BulkBar';
import { ClaimDialog } from './ClaimDialog';
import { CreateDeviceDialog } from './CreateDeviceDialog';
import { ImportDialog } from './ImportDialog';
import { DevicesTable } from './DevicesTable';
import { type DeviceFilters, useDeviceList, useProfiles } from './hooks';
import { flatten, useAssetTree } from '../assets/hooks';

export function DevicesPage() {
  const { user, hasPerm } = useAuth();
  const isPlatform = user?.scopeType === 'platform';
  const [filters, setFilters] = useState<DeviceFilters>({});
  const [open, setOpen] = useState(false);
  const [importing, setImporting] = useState(false);
  const [claiming, setClaiming] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const canBulk = hasPerm('device.write') || hasPerm('device.command');
  const select = (ids: string[], on: boolean) =>
    setSelected((prev) => {
      const next = new Set(prev);
      for (const id of ids) {
        if (on) next.add(id);
        else next.delete(id);
      }
      return next;
    });
  const list = useDeviceList(filters);
  const { data: profiles = [] } = useProfiles();
  const assetTree = useAssetTree();
  const assetOptions = hasPerm('asset.read') ? flatten(assetTree.data ?? []) : [];
  useStatusFeed();
  const devices = list.data?.pages.flatMap((p) => p.items) ?? [];
  const profileName = (id: string) => profiles.find((p) => p.id === id)?.name ?? '—';

  return (
    <div>
      <PageHeader
        title="Devices"
        actions={
          <div className="flex gap-2">
            <ExportMenu
              request={(format) => ({
                kind: 'devices',
                format,
                params: {
                  columns: ['name', 'status', 'lastSeen', 'profile', 'customer', 'tags'],
                  profileId: filters.profileId || null,
                  filter: {
                    search: filters.search || undefined,
                    status: filters.status ? [filters.status as 'online' | 'offline' | 'dead' | 'never'] : undefined,
                  },
                },
              })}
            />
            {isPlatform && hasPerm('device.write') && (
              <Button variant="outline" onClick={() => setImporting(true)}>
                <FileUp className="h-4 w-4" /> Import
              </Button>
            )}
            {!isPlatform && hasPerm('device.claim') && (
              <Button variant="outline" onClick={() => setClaiming(true)}>
                <KeyRound className="h-4 w-4" /> Add with claim code
              </Button>
            )}
            {hasPerm('device.write') && (
              <Button onClick={() => setOpen(true)}>
                <Plus className="h-4 w-4" /> New device
              </Button>
            )}
          </div>
        }
      />
      <div className="mb-4 grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
        <Input
          aria-label="Search devices"
          type="search"
          placeholder="Search by name"
          className="col-span-2 sm:w-64"
          value={filters.search ?? ''}
          onChange={(e) => setFilters((f) => ({ ...f, search: e.target.value || undefined }))}
        />
        <select
          aria-label="Filter by status"
          className="h-9 min-w-0 rounded-lg border border-line-strong bg-surface px-2.5 text-sm"
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
          className="h-9 min-w-0 rounded-lg border border-line-strong bg-surface px-2.5 text-sm"
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
        {assetOptions.length > 0 && (
          <select
            aria-label="Filter by asset"
            className="h-9 min-w-0 rounded-lg border border-line-strong bg-surface px-2.5 text-sm"
            value={filters.assetId ?? ''}
            onChange={(e) => setFilters((f) => ({ ...f, assetId: e.target.value || undefined }))}
          >
            <option value="">All assets</option>
            {assetOptions.map((a) => (
              <option key={a.id} value={a.id}>
                {'\u00a0\u00a0'.repeat(a.depth)}
                {a.name}
              </option>
            ))}
          </select>
        )}
      </div>
      {canBulk && <BulkBar deviceIds={[...selected]} onDone={() => setSelected(new Set())} />}
      {list.isLoading ? (
        <Skeleton className="h-40" />
      ) : (
        <DevicesTable devices={devices} profileName={profileName} {...(canBulk ? { selected, onSelect: select } : {})} />
      )}
      {list.hasNextPage && (
        <Button variant="outline" className="mt-4" onClick={() => void list.fetchNextPage()}>
          Load more
        </Button>
      )}
      <CreateDeviceDialog open={open} onOpenChange={setOpen} />
      <ImportDialog open={importing} onOpenChange={setImporting} />
      <ClaimDialog open={claiming} onOpenChange={setClaiming} />
    </div>
  );
}
