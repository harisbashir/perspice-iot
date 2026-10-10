import { type AssetAttributeDef, type AssetTypeDto, AssetTypeInputSchema } from '@perspice/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2 } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { api } from '@/api/client';
import { ErrorText } from '@/components/ErrorText';
import { PageHeader } from '@/components/PageHeader';
import { selectClass } from '@/components/TimezoneSelect';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ASSET_TYPES, useAssetTypes } from './hooks';

type Draft = { name: string; icon: string; attributes: AssetAttributeDef[]; defaultDashboardTemplateId: string | null };
const BLANK: Draft = { name: '', icon: 'building', attributes: [], defaultDashboardTemplateId: null };
const cell = 'h-8 text-xs';

/** Asset types (platform): what customers can build their hierarchy from. */
export function AssetTypesPage() {
  const { data: types = [] } = useAssetTypes();
  const qc = useQueryClient();
  const [editing, setEditing] = useState<AssetTypeDto | 'new' | null>(null);
  const [error, setError] = useState<unknown>(null);

  async function remove(t: AssetTypeDto) {
    setError(null);
    try {
      await api(`/asset-types/${t.id}`, { method: 'DELETE' });
      await qc.invalidateQueries({ queryKey: ASSET_TYPES });
    } catch (err) {
      setError(err);
    }
  }

  return (
    <div>
      <PageHeader
        title="Asset types"
        description="Customers build sites and equipment from these types; each can have attributes and a dashboard."
        actions={
          <Button onClick={() => setEditing('new')}>
            <Plus className="h-4 w-4" /> New asset type
          </Button>
        }
      />
      <ErrorText error={error} />
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead>Attributes</TableHead>
            <TableHead>Assets</TableHead>
            <TableHead />
          </TableRow>
        </TableHeader>
        <TableBody>
          {types.map((t) => (
            <TableRow key={t.id} data-testid={`asset-type-${t.name}`}>
              <TableCell className="font-medium">{t.name}</TableCell>
              <TableCell className="text-xs text-slate-500">{t.attributes.map((a) => a.label).join(', ') || '—'}</TableCell>
              <TableCell>{t.assetCount}</TableCell>
              <TableCell className="text-right">
                <div className="flex justify-end gap-2">
                  <Button size="sm" variant="outline" onClick={() => setEditing(t)}>
                    Edit
                  </Button>
                  <Button size="sm" variant="ghost" aria-label={`Delete ${t.name}`} onClick={() => void remove(t)}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </TableCell>
            </TableRow>
          ))}
          {types.length === 0 && (
            <TableRow>
              <TableCell colSpan={4} className="py-8 text-center text-slate-500">
                No asset types yet.
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
      {editing && <TypeDialog type={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

function TypeDialog({ type, onClose }: { type: AssetTypeDto | null; onClose: () => void }) {
  const qc = useQueryClient();
  const [d, setD] = useState<Draft>(type ? { name: type.name, icon: type.icon, attributes: type.attributes, defaultDashboardTemplateId: type.defaultDashboardTemplateId } : BLANK);
  const [error, setError] = useState<unknown>(null);
  const templates = useQuery({
    queryKey: ['dashboard-templates', 'asset', type?.id],
    queryFn: () => api<{ id: string; name: string }[]>('/dashboard-templates', { query: { kind: 'asset', assetTypeId: type!.id } }),
    enabled: !!type,
  });
  const parsed = AssetTypeInputSchema.safeParse(d);
  const setAttr = (i: number, patch: Partial<AssetAttributeDef>) => setD({ ...d, attributes: d.attributes.map((a, j) => (j === i ? { ...a, ...patch } : a)) });

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await api(type ? `/asset-types/${type.id}` : '/asset-types', { method: type ? 'PATCH' : 'POST', body: d });
      await qc.invalidateQueries({ queryKey: ASSET_TYPES });
      onClose();
    } catch (err) {
      setError(err);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{type ? `Edit ${type.name}` : 'New asset type'}</DialogTitle>
        </DialogHeader>
        <form className="space-y-4 text-sm" onSubmit={(e) => void submit(e)}>
          <div className="flex gap-3">
            <div className="flex-1">
              <Field label="Name">{(id) => <Input id={id} required value={d.name} onChange={(e) => setD({ ...d, name: e.target.value })} />}</Field>
            </div>
            <Field label="Icon" help="e.g. building, factory, zap">
              {(id, h) => <Input id={id} aria-describedby={h} className="w-32" value={d.icon} onChange={(e) => setD({ ...d, icon: e.target.value })} />}
            </Field>
          </div>
          <div className="space-y-2">
            <p className="font-medium">Attributes</p>
            {d.attributes.map((a, i) => (
              <div key={i} className="flex gap-2" data-testid={`attribute-${i}`}>
                <Input aria-label="Attribute key" className={cell} placeholder="key" value={a.key} onChange={(e) => setAttr(i, { key: e.target.value })} />
                <Input aria-label="Attribute label" className={cell} placeholder="Label" value={a.label} onChange={(e) => setAttr(i, { label: e.target.value })} />
                <select aria-label="Attribute type" className="h-8 rounded-md border border-slate-300 bg-transparent px-1 text-xs dark:border-slate-700" value={a.type} onChange={(e) => setAttr(i, { type: e.target.value as AssetAttributeDef['type'] })}>
                  <option value="text">text</option>
                  <option value="number">number</option>
                  <option value="date">date</option>
                </select>
                <Button type="button" variant="ghost" size="icon" aria-label={`Remove ${a.key || 'attribute'}`} onClick={() => setD({ ...d, attributes: d.attributes.filter((_, j) => j !== i) })}>
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))}
            <Button type="button" size="sm" variant="outline" onClick={() => setD({ ...d, attributes: [...d.attributes, { key: '', label: '', type: 'text' }] })}>
              Add attribute
            </Button>
          </div>
          {type && (
            <Field label="Dashboard" help="An asset dashboard template made for this type (Dashboards → New template, kind Asset).">
              {(id, h) => (
                <select id={id} aria-describedby={h} className={selectClass} value={d.defaultDashboardTemplateId ?? ''} onChange={(e) => setD({ ...d, defaultDashboardTemplateId: e.target.value || null })}>
                  <option value="">None</option>
                  {(templates.data ?? []).map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </select>
              )}
            </Field>
          )}
          {!parsed.success && <p className="text-red-600">{parsed.error.issues[0]?.message}</p>}
          <ErrorText error={error} />
          <DialogFooter>
            <Button type="submit" disabled={!parsed.success}>
              {type ? 'Save' : 'Create asset type'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
