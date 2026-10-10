import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router';
import { api } from '@/api/client';
import { useAuth } from '@/auth/AuthProvider';
import { ErrorText } from '@/components/ErrorText';
import { selectClass } from '@/components/TimezoneSelect';
import { Button } from '@/components/ui/button';
import { ASSETS, flatten, useAssetTree } from '../assets/hooks';

type Link_ = { asset: { id: string; name: string; path: { id: string; name: string }[] } | null };

/** The device's asset as a breadcrumb, and (asset.write) a picker to attach it elsewhere. */
export function DeviceAssetLine({ deviceId, customerId }: { deviceId: string; customerId: string | null }) {
  const { hasPerm } = useAuth();
  const qc = useQueryClient();
  const canRead = hasPerm('asset.read');
  const canWrite = hasPerm('asset.write') && !!customerId;
  const key = ['devices', deviceId, 'asset'];
  const { data } = useQuery({ queryKey: key, queryFn: () => api<Link_>(`/devices/${deviceId}/asset`), enabled: canRead });
  const [editing, setEditing] = useState(false);
  const tree = useAssetTree();
  const [error, setError] = useState<unknown>(null);
  if (!canRead || !data) return null;
  const options = flatten((tree.data ?? []).filter((a) => a.customerId === customerId));

  async function attach(assetId: string | null) {
    setError(null);
    try {
      qc.setQueryData(key, await api<Link_>(`/devices/${deviceId}/asset`, { method: 'PUT', body: { assetId } }));
      await qc.invalidateQueries({ queryKey: ASSETS });
      setEditing(false);
    } catch (err) {
      setError(err);
    }
  }

  return (
    <span className="flex flex-wrap items-center gap-2 text-sm text-slate-500" data-testid="device-asset">
      <span>Asset:</span>
      {editing ? (
        <select aria-label="Asset" className={`${selectClass} h-8 w-64`} value={data.asset?.id ?? ''} onChange={(e) => void attach(e.target.value || null)}>
          <option value="">None</option>
          {options.map((a) => (
            <option key={a.id} value={a.id}>
              {'  '.repeat(a.depth)}
              {a.name}
            </option>
          ))}
        </select>
      ) : data.asset ? (
        <span>
          {data.asset.path.map((p) => (
            <span key={p.id}>
              <Link to={`/assets/${p.id}`} className="hover:underline">
                {p.name}
              </Link>
              {' › '}
            </span>
          ))}
          <Link to={`/assets/${data.asset.id}`} className="font-medium text-primary-700 hover:underline dark:text-primary-300">
            {data.asset.name}
          </Link>
        </span>
      ) : (
        <span>none</span>
      )}
      {canWrite && !editing && (
        <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>
          {data.asset ? 'Change' : 'Attach'}
        </Button>
      )}
      <ErrorText error={error} />
    </span>
  );
}
