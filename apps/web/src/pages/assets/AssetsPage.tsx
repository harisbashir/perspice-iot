import { type AssetTreeNode, type AssetTreeRow, buildAssetTree } from '@perspice/shared';
import { useQueryClient } from '@tanstack/react-query';
import { ChevronDown, ChevronRight, Plus } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import { api } from '@/api/client';
import { useCustomers } from '@/api/hooks';
import { useAuth } from '@/auth/AuthProvider';
import { SeverityBadge } from '@/alarms/badges';
import { ErrorText } from '@/components/ErrorText';
import { PageHeader } from '@/components/PageHeader';
import { selectClass } from '@/components/TimezoneSelect';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { AssetForm } from './AssetForm';
import { ASSETS, useAssetTree, useAssetTypes } from './hooks';

/** The asset hierarchy with device and alarm roll-ups per subtree. */
export function AssetsPage() {
  const { user, hasPerm } = useAuth();
  const isPlatform = user?.scopeType === 'platform';
  const { data: customers = [] } = useCustomers(isPlatform);
  const [customerId, setCustomerId] = useState('');
  const tree = useAssetTree(isPlatform ? customerId || undefined : undefined);
  const { data: types = [] } = useAssetTypes();
  const [creating, setCreating] = useState<{ parentId: string | null } | null>(null);
  const canWrite = hasPerm('asset.write') && (!isPlatform || !!customerId);
  const rows = tree.data ?? [];
  const nodes = buildAssetTree(rows);

  return (
    <div>
      <PageHeader
        title="Assets"
        description="Sites and equipment, with the devices attached to them."
        actions={
          canWrite && (
            <Button onClick={() => setCreating({ parentId: null })} disabled={!types.length}>
              <Plus className="h-4 w-4" /> New asset
            </Button>
          )
        }
      />
      {isPlatform && (
        <div className="mb-4 w-64">
          <select aria-label="Customer" className={selectClass} value={customerId} onChange={(e) => setCustomerId(e.target.value)}>
            <option value="">All customers</option>
            {customers.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
      )}
      {!types.length && <p className="mb-4 text-sm text-slate-500">No asset types are defined yet{isPlatform ? ': add them under Asset types.' : '.'}</p>}
      {tree.isLoading ? (
        <Skeleton className="h-40" />
      ) : nodes.length ? (
        <ul role="tree" aria-label="Assets" className="space-y-1">
          {nodes.map((n) => (
            <TreeItem key={n.id} node={n} depth={0} canWrite={canWrite} onAdd={(parentId) => setCreating({ parentId })} />
          ))}
        </ul>
      ) : (
        <p className="py-8 text-center text-sm text-slate-500">No assets yet.</p>
      )}
      {creating && <AssetForm parentId={creating.parentId} customerId={isPlatform ? customerId : undefined} types={types} tree={rows} onClose={() => setCreating(null)} />}
    </div>
  );
}

function TreeItem({ node, depth, canWrite, onAdd }: { node: AssetTreeNode<AssetTreeRow>; depth: number; canWrite: boolean; onAdd: (parentId: string) => void }) {
  const [open, setOpen] = useState(depth < 1);
  const qc = useQueryClient();
  const [error, setError] = useState<unknown>(null);
  const r = node.rollup;
  const hasChildren = node.children.length > 0;

  async function remove() {
    setError(null);
    try {
      await api(`/assets/${node.id}`, { method: 'DELETE' });
      await qc.invalidateQueries({ queryKey: ASSETS });
    } catch (err) {
      setError(err);
    }
  }

  return (
    <li role="treeitem" aria-expanded={hasChildren ? open : undefined} aria-label={node.name} data-testid={`asset-${node.name}`}>
      <div className="group flex flex-wrap items-center gap-2 rounded-md px-2 py-1.5 hover:bg-slate-50 dark:hover:bg-slate-900" style={{ paddingLeft: `${depth * 1.25 + 0.5}rem` }}>
        <button type="button" className="h-5 w-5 text-slate-500" aria-label={open ? `Collapse ${node.name}` : `Expand ${node.name}`} disabled={!hasChildren} onClick={() => setOpen(!open)}>
          {hasChildren ? open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" /> : null}
        </button>
        <Link to={`/assets/${node.id}`} className="font-medium text-primary-700 hover:underline dark:text-primary-300">
          {node.name}
        </Link>
        <span className="text-xs text-slate-500" data-testid="rollup">
          {r.devices} device{r.devices === 1 ? '' : 's'}
          {r.devices > 0 && ` · ${r.online} online`}
          {r.offline + r.dead > 0 && ` · ${r.offline + r.dead} offline`}
        </span>
        {r.alarms > 0 && r.worstSeverity && (
          <span className="flex items-center gap-1 text-xs" data-testid="rollup-alarms">
            <SeverityBadge severity={r.worstSeverity} /> {r.alarms} alarm{r.alarms === 1 ? '' : 's'}
          </span>
        )}
        {canWrite && (
          <span className="ml-auto flex gap-1 opacity-70 group-hover:opacity-100">
            <Button size="sm" variant="ghost" onClick={() => onAdd(node.id)}>
              Add inside
            </Button>
            {!hasChildren && (
              <Button size="sm" variant="ghost" aria-label={`Delete ${node.name}`} onClick={() => void remove()}>
                Delete
              </Button>
            )}
          </span>
        )}
      </div>
      <ErrorText error={error} />
      {hasChildren && open && (
        <ul role="group" className="space-y-1">
          {node.children.map((c) => (
            <TreeItem key={c.id} node={c} depth={depth + 1} canWrite={canWrite} onAdd={onAdd} />
          ))}
        </ul>
      )}
    </li>
  );
}
