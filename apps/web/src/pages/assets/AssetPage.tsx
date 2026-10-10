import type { DashboardViewDto, DeviceDto } from '@perspice/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { api } from '@/api/client';
import { useAuth } from '@/auth/AuthProvider';
import { AlarmsTable } from '@/alarms/AlarmsTable';
import { ErrorText } from '@/components/ErrorText';
import { PageHeader } from '@/components/PageHeader';
import { selectClass } from '@/components/TimezoneSelect';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { LazyDashboardView as DashboardView } from '@/dashboards/LazyDashboardView';
import { NotFoundPage } from '../NotFoundPage';
import { StatusBadge } from '../devices/StatusBadge';
import { timeAgo } from '../devices/format';
import { AssetForm } from './AssetForm';
import { ASSETS, useAsset, useAssetTree, useAssetTypes } from './hooks';

type Maybe = DashboardViewDto | { dashboard: null };

/** One asset: its dashboard, devices, sub-assets, alarms and details. */
export function AssetPage() {
  const { id = '' } = useParams();
  const { hasPerm } = useAuth();
  const { data: asset, isLoading, error } = useAsset(id);
  const { data: types = [] } = useAssetTypes();
  const tree = useAssetTree();
  const dashboard = useQuery({
    queryKey: ['dashboards', 'asset', id],
    queryFn: async () => {
      const r = await api<Maybe>(`/dashboards/asset/${id}`);
      return 'dashboard' in r ? null : r;
    },
  });
  const [tab, setTab] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [adding, setAdding] = useState(false);

  if (isLoading || dashboard.isLoading) return <Skeleton className="h-64" />;
  if (error || !asset) return <NotFoundPage />;
  const type = types.find((t) => t.id === asset.typeId);
  const children = (tree.data ?? []).filter((a) => a.parentId === asset.id);
  const canWrite = hasPerm('asset.write');
  const view = dashboard.data ?? null;

  return (
    <div>
      <nav aria-label="Breadcrumb" className="mb-1 text-sm text-slate-500">
        <Link to="/assets" className="hover:underline">
          Assets
        </Link>
        {asset.path.map((p) => (
          <span key={p.id}>
            {' › '}
            <Link to={`/assets/${p.id}`} className="hover:underline">
              {p.name}
            </Link>
          </span>
        ))}
      </nav>
      <PageHeader
        title={asset.name}
        description={asset.typeName}
        actions={
          canWrite && (
            <Button variant="outline" onClick={() => setEditing(true)}>
              Edit
            </Button>
          )
        }
      />
      <Tabs value={tab ?? (view ? 'dashboard' : 'devices')} onValueChange={setTab}>
        <TabsList>
          {view && <TabsTrigger value="dashboard">Dashboard</TabsTrigger>}
          <TabsTrigger value="devices">Devices</TabsTrigger>
          <TabsTrigger value="children">Sub-assets</TabsTrigger>
          {hasPerm('alarm.read') && <TabsTrigger value="alarms">Alarms</TabsTrigger>}
          <TabsTrigger value="details">Details</TabsTrigger>
        </TabsList>
        {view && (
          <TabsContent value="dashboard">
            <DashboardView key={`${view.instanceId}-${view.templateVersion}`} definition={view.definition} assetId={asset.id} />
          </TabsContent>
        )}
        <TabsContent value="devices">
          <AssetDevices assetId={asset.id} customerId={asset.customerId} canWrite={canWrite && hasPerm('device.read')} />
        </TabsContent>
        <TabsContent value="children">
          <ul className="space-y-1 text-sm" aria-label="Sub-assets">
            {children.map((c) => (
              <li key={c.id}>
                <Link to={`/assets/${c.id}`} className="font-medium text-primary-700 hover:underline dark:text-primary-300">
                  {c.name}
                </Link>{' '}
                <span className="text-xs text-slate-500">
                  {c.rollup.devices} device{c.rollup.devices === 1 ? '' : 's'}
                </span>
              </li>
            ))}
            {children.length === 0 && <li className="text-slate-500">No sub-assets.</li>}
          </ul>
          {canWrite && (
            <Button className="mt-3" size="sm" variant="outline" onClick={() => setAdding(true)}>
              Add inside
            </Button>
          )}
        </TabsContent>
        <TabsContent value="alarms">
          <AlarmsTable base={{ assetId: asset.id }} />
        </TabsContent>
        <TabsContent value="details">
          <dl className="grid max-w-xl grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm">
            {(type?.attributes ?? []).map((a) => (
              <div key={a.key} className="contents">
                <dt className="text-slate-500">{a.label}</dt>
                <dd data-testid={`attr-${a.key}`}>{asset.attributes[a.key] ?? '—'}</dd>
              </div>
            ))}
            <dt className="text-slate-500">Location</dt>
            <dd>{asset.location ? `${asset.location.lat}, ${asset.location.lng}` : '—'}</dd>
          </dl>
        </TabsContent>
      </Tabs>
      {editing && <AssetForm asset={asset} types={types} tree={tree.data ?? []} onClose={() => setEditing(false)} />}
      {adding && <AssetForm parentId={asset.id} customerId={asset.customerId} types={types} tree={tree.data ?? []} onClose={() => setAdding(false)} />}
    </div>
  );
}

function AssetDevices({ assetId, customerId, canWrite }: { assetId: string; customerId: string; canWrite: boolean }) {
  const qc = useQueryClient();
  const [depth, setDepth] = useState<'subtree' | 'children'>('subtree');
  const [pick, setPick] = useState('');
  const [error, setError] = useState<unknown>(null);
  const devices = useQuery({ queryKey: [...ASSETS, assetId, 'devices', depth], queryFn: () => api<DeviceDto[]>(`/assets/${assetId}/devices`, { query: { depth } }) });
  const candidates = useQuery({
    queryKey: ['devices', 'attachable', customerId],
    queryFn: () => api<{ items: DeviceDto[] }>('/devices', { query: { customerId, limit: 500 } }),
    enabled: canWrite,
  });
  const attached = new Set((devices.data ?? []).map((d) => d.id));

  async function attach(deviceId: string, target: string | null) {
    setError(null);
    try {
      await api(`/devices/${deviceId}/asset`, { method: 'PUT', body: { assetId: target } });
      setPick('');
      await qc.invalidateQueries({ queryKey: ASSETS });
    } catch (err) {
      setError(err);
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <select aria-label="Which devices" className={`${selectClass} w-72`} value={depth} onChange={(e) => setDepth(e.target.value as 'subtree' | 'children')}>
          <option value="subtree">Everywhere in this asset</option>
          <option value="children">Attached to this asset itself</option>
        </select>
        {canWrite && (
          <>
            <select aria-label="Device to attach" className={`${selectClass} w-72`} value={pick} onChange={(e) => setPick(e.target.value)}>
              <option value="">Attach a device…</option>
              {(candidates.data?.items ?? [])
                .filter((d) => !attached.has(d.id))
                .map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
            </select>
            <Button size="sm" disabled={!pick} onClick={() => void attach(pick, assetId)}>
              Attach
            </Button>
          </>
        )}
      </div>
      <ErrorText error={error} />
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Device</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Last seen</TableHead>
            <TableHead />
          </TableRow>
        </TableHeader>
        <TableBody>
          {(devices.data ?? []).map((d) => (
            <TableRow key={d.id} data-testid={`asset-device-${d.id}`}>
              <TableCell>
                <Link to={`/devices/${d.id}`} className="font-medium text-primary-700 hover:underline dark:text-primary-300">
                  {d.name}
                </Link>
              </TableCell>
              <TableCell>
                <StatusBadge status={d.status} />
              </TableCell>
              <TableCell>{timeAgo(d.lastSeen)}</TableCell>
              <TableCell className="text-right">
                {canWrite && (
                  <Button size="sm" variant="ghost" onClick={() => void attach(d.id, null)}>
                    Detach
                  </Button>
                )}
              </TableCell>
            </TableRow>
          ))}
          {devices.data?.length === 0 && (
            <TableRow>
              <TableCell colSpan={4} className="py-6 text-center text-slate-500">
                No devices.
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  );
}
