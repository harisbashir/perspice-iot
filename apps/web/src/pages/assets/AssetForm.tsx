import type { AssetDto, AssetTreeRow, AssetTypeDto } from '@perspice/shared';
import { useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { api } from '@/api/client';
import { useGroups } from '@/api/hooks';
import { useAuth } from '@/auth/AuthProvider';
import { ErrorText } from '@/components/ErrorText';
import { selectClass } from '@/components/TimezoneSelect';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { ASSETS, flatten, subtreeOf } from './hooks';

type Values = Record<string, string | number | null>;

/** Create (optionally under a parent) or edit an asset: type, parent, group, location, attributes. */
export function AssetForm({
  asset,
  parentId,
  customerId,
  types,
  tree,
  onClose,
  onSaved,
}: {
  asset?: AssetDto;
  parentId?: string | null;
  /** Platform users: the customer to create in. */
  customerId?: string;
  types: AssetTypeDto[];
  tree: AssetTreeRow[];
  onClose: () => void;
  onSaved?: (a: AssetDto) => void;
}) {
  const { user, hasPerm } = useAuth();
  const qc = useQueryClient();
  const [name, setName] = useState(asset?.name ?? '');
  const [typeId, setTypeId] = useState(asset?.typeId ?? types[0]?.id ?? '');
  const [parent, setParent] = useState<string>(asset?.parentId ?? parentId ?? '');
  const [groupId, setGroupId] = useState<string>(asset?.groupId ?? '');
  const [lat, setLat] = useState(asset?.location ? String(asset.location.lat) : '');
  const [lng, setLng] = useState(asset?.location ? String(asset.location.lng) : '');
  const [values, setValues] = useState<Values>(asset?.attributes ?? {});
  const [error, setError] = useState<unknown>(null);
  const owner = asset?.customerId ?? customerId ?? user?.customerId ?? null;
  const groups = useGroups(hasPerm('user.read') ? owner : null);
  const type = types.find((t) => t.id === typeId);
  // A move can't go inside itself; parents come from the same customer.
  const blocked = asset ? subtreeOf(tree, asset.id) : new Set<string>();
  const parents = flatten(tree.filter((r) => (!owner || r.customerId === owner) && !blocked.has(r.id)));

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const attributes = Object.fromEntries(
      (type?.attributes ?? []).map((a) => {
        const v = values[a.key];
        return [a.key, v === '' || v === undefined ? null : a.type === 'number' ? Number(v) : v];
      }),
    );
    const location = lat !== '' && lng !== '' ? { lat: Number(lat), lng: Number(lng) } : null;
    const body = { name, parentId: parent || null, groupId: groupId || null, location, attributes };
    try {
      const saved = asset
        ? await api<AssetDto>(`/assets/${asset.id}`, { method: 'PATCH', body })
        : await api<AssetDto>('/assets', { body: { ...body, typeId, ...(customerId ? { customerId } : {}) } });
      await qc.invalidateQueries({ queryKey: ASSETS });
      onSaved?.(saved);
      onClose();
    } catch (err) {
      setError(err);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{asset ? `Edit ${asset.name}` : 'New asset'}</DialogTitle>
        </DialogHeader>
        <form className="space-y-4 text-sm" onSubmit={(e) => void submit(e)}>
          <Field label="Name">{(id) => <Input id={id} required value={name} onChange={(e) => setName(e.target.value)} />}</Field>
          {!asset && (
            <Field label="Type">
              {(id) => (
                <select id={id} required className={selectClass} value={typeId} onChange={(e) => setTypeId(e.target.value)}>
                  {types.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </select>
              )}
            </Field>
          )}
          <Field label="Inside">
            {(id) => (
              <select id={id} className={selectClass} value={parent} onChange={(e) => setParent(e.target.value)}>
                <option value="">— top level —</option>
                {parents.map((p) => (
                  <option key={p.id} value={p.id}>
                    {'  '.repeat(p.depth)}
                    {p.name}
                  </option>
                ))}
              </select>
            )}
          </Field>
          {(groups.data?.length ?? 0) > 0 && (
            <Field label="Group" help="Users limited to a group see only its assets.">
              {(id, h) => (
                <select id={id} aria-describedby={h} className={selectClass} value={groupId} onChange={(e) => setGroupId(e.target.value)}>
                  <option value="">None</option>
                  {groups.data!.map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.name}
                    </option>
                  ))}
                </select>
              )}
            </Field>
          )}
          <div className="flex gap-3">
            <Field label="Latitude">{(id) => <Input id={id} type="number" step="any" min={-90} max={90} value={lat} onChange={(e) => setLat(e.target.value)} />}</Field>
            <Field label="Longitude">{(id) => <Input id={id} type="number" step="any" min={-180} max={180} value={lng} onChange={(e) => setLng(e.target.value)} />}</Field>
          </div>
          {type?.attributes.map((a) => (
            <Field key={a.key} label={a.label}>
              {(id) => (
                <Input
                  id={id}
                  type={a.type === 'number' ? 'number' : a.type === 'date' ? 'date' : 'text'}
                  step="any"
                  value={values[a.key] === null || values[a.key] === undefined ? '' : String(values[a.key])}
                  onChange={(e) => setValues({ ...values, [a.key]: e.target.value })}
                />
              )}
            </Field>
          ))}
          <ErrorText error={error} />
          <DialogFooter>
            <Button type="submit" disabled={!typeId}>
              {asset ? 'Save' : 'Create asset'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
