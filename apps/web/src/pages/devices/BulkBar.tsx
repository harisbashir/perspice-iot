import type { BulkAction, BulkResult } from '@perspice/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '@/api/client';
import { useCustomers, useGroups } from '@/api/hooks';
import { useAuth } from '@/auth/AuthProvider';
import { ErrorText } from '@/components/ErrorText';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { DEVICE_LISTS } from '@/realtime/hooks';

type Kind = BulkAction['kind'];
const selectClass = 'h-9 w-full rounded-md border border-slate-300 bg-transparent px-2 text-sm dark:border-slate-700';
const list = (s: string) => s.split(',').map((t) => t.trim()).filter(Boolean);

const TITLES: Record<Kind, string> = {
  tags: 'Change tags',
  group: 'Move to a group',
  assign: 'Assign to a customer',
  command: 'Send a command',
  delete: 'Delete devices',
  asset: 'Attach to an asset',
};

/** Actions on the selected devices (spec §11); each device reports its own outcome. */
export function BulkBar({ deviceIds, onDone }: { deviceIds: string[]; onDone: () => void }) {
  const { user, hasPerm } = useAuth();
  const isPlatform = user?.scopeType === 'platform';
  const [kind, setKind] = useState<Kind | null>(null);
  if (!deviceIds.length) return null;
  const n = deviceIds.length;

  return (
    <div className="mb-3 flex flex-wrap items-center gap-2 rounded-md border border-primary-200 bg-primary-50 px-3 py-2 text-sm dark:border-primary-900 dark:bg-primary-950" role="toolbar" aria-label="Selected devices">
      <span className="mr-2 font-medium">{n === 1 ? '1 device selected' : `${n} devices selected`}</span>
      {hasPerm('device.write') && (
        <>
          <Button size="sm" variant="outline" onClick={() => setKind('tags')}>
            Tags
          </Button>
          {!isPlatform && (
            <Button size="sm" variant="outline" onClick={() => setKind('group')}>
              Group
            </Button>
          )}
          {isPlatform && (
            <Button size="sm" variant="outline" onClick={() => setKind('assign')}>
              Assign
            </Button>
          )}
        </>
      )}
      {hasPerm('device.command') && (
        <Button size="sm" variant="outline" onClick={() => setKind('command')}>
          Command
        </Button>
      )}
      {hasPerm('device.write') && (
        <Button size="sm" variant="outline" onClick={() => setKind('delete')}>
          Delete
        </Button>
      )}
      <Button size="sm" variant="ghost" onClick={onDone}>
        Clear selection
      </Button>
      {kind && <BulkDialog kind={kind} deviceIds={deviceIds} customerId={user?.customerId ?? null} onClose={() => setKind(null)} onDone={onDone} />}
    </div>
  );
}

function BulkDialog({ kind, deviceIds, customerId, onClose, onDone }: { kind: Kind; deviceIds: string[]; customerId: string | null; onClose: () => void; onDone: () => void }) {
  const qc = useQueryClient();
  const { data: customers = [] } = useCustomers(kind === 'assign');
  const { data: groups = [] } = useGroups(kind === 'group' ? customerId : null);
  const [add, setAdd] = useState('');
  const [remove, setRemove] = useState('');
  const [target, setTarget] = useState('');
  const [command, setCommand] = useState('');
  const [params, setParams] = useState('{}');
  const [error, setError] = useState<unknown>(null);
  const [paramsError, setParamsError] = useState<string | null>(null);
  const [result, setResult] = useState<BulkResult | null>(null);
  const [busy, setBusy] = useState(false);

  function action(): BulkAction | null {
    switch (kind) {
      case 'tags':
        return { kind, add: list(add), remove: list(remove) };
      case 'group':
        return { kind, groupId: target || null };
      case 'assign':
        return { kind, customerId: target || null };
      case 'command': {
        try {
          return { kind, name: command, params: JSON.parse(params || '{}') as Record<string, unknown> };
        } catch {
          setParamsError('Parameters must be JSON');
          return null;
        }
      }
      case 'delete':
        return { kind };
      case 'asset':
        return { kind, assetId: target || null };
    }
  }

  async function run() {
    setError(null);
    setParamsError(null);
    const a = action();
    if (!a) return;
    setBusy(true);
    try {
      const res = await api<BulkResult>('/devices/bulk', { body: { deviceIds, action: a } });
      await qc.invalidateQueries({ queryKey: DEVICE_LISTS });
      if (res.ok === deviceIds.length) {
        onClose();
        onDone();
      } else {
        setResult(res);
      }
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  const failed = result?.results.filter((r) => !r.ok) ?? [];
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{TITLES[kind]}</DialogTitle>
        </DialogHeader>
        {result ? (
          <div className="space-y-3 text-sm" data-testid="bulk-result">
            <p>
              {result.ok} of {deviceIds.length} done; {failed.length} failed:
            </p>
            <ul className="max-h-48 list-disc overflow-auto pl-5">
              {failed.map((r) => (
                <li key={r.deviceId}>
                  <span className="font-mono text-xs">{r.deviceId.slice(0, 8)}</span> — {r.error}
                </li>
              ))}
            </ul>
            <DialogFooter>
              <Button
                onClick={() => {
                  onClose();
                  onDone();
                }}
              >
                Close
              </Button>
            </DialogFooter>
          </div>
        ) : (
          <div className="space-y-4">
            {kind === 'tags' && (
              <>
                <Field label="Add tags" help="Comma separated.">
                  {(id, d) => <Input id={id} aria-describedby={d} value={add} onChange={(e) => setAdd(e.target.value)} />}
                </Field>
                <Field label="Remove tags">{(id) => <Input id={id} value={remove} onChange={(e) => setRemove(e.target.value)} />}</Field>
              </>
            )}
            {kind === 'group' && (
              <Field label="Group">
                {(id) => (
                  <select id={id} className={selectClass} value={target} onChange={(e) => setTarget(e.target.value)}>
                    <option value="">No group</option>
                    {groups.map((g) => (
                      <option key={g.id} value={g.id}>
                        {g.name}
                      </option>
                    ))}
                  </select>
                )}
              </Field>
            )}
            {kind === 'assign' && (
              <Field label="Customer">
                {(id) => (
                  <select id={id} className={selectClass} value={target} onChange={(e) => setTarget(e.target.value)}>
                    <option value="">Unassigned</option>
                    {customers.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                )}
              </Field>
            )}
            {kind === 'command' && (
              <>
                <Field label="Command" help="Its name in the device profile.">
                  {(id, d) => <Input id={id} aria-describedby={d} required value={command} onChange={(e) => setCommand(e.target.value)} />}
                </Field>
                <Field label="Parameters (JSON)" error={paramsError}>
                  {(id, d) => <Input id={id} aria-describedby={d} className="font-mono" value={params} onChange={(e) => setParams(e.target.value)} />}
                </Field>
              </>
            )}
            {kind === 'delete' && (
              <p className="text-sm">
                Delete {deviceIds.length === 1 ? 'this device' : `these ${deviceIds.length} devices`} with their history? This can’t be undone.
              </p>
            )}
            <ErrorText error={error} />
            <DialogFooter>
              <Button variant={kind === 'delete' ? 'destructive' : 'default'} disabled={busy || (kind === 'command' && !command)} onClick={() => void run()}>
                {kind === 'delete' ? 'Delete' : 'Apply'} to {deviceIds.length}
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
