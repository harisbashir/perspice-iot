import type { ProvisioningKeyDto, ProvisioningMode } from '@perspice/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { KeyRound, Plus } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { api } from '@/api/client';
import { useCustomers, useGroups } from '@/api/hooks';
import { CopyField } from '@/components/CopyField';
import { ErrorText } from '@/components/ErrorText';
import { selectClass } from '@/components/TimezoneSelect';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

const when = (ms: number | null) => (ms ? new Date(ms).toLocaleString() : '—');

function status(k: ProvisioningKeyDto): { label: string; variant: 'success' | 'secondary' | 'warning' } {
  if (k.revokedAt) return { label: 'Revoked', variant: 'secondary' };
  if (k.expiresAt && k.expiresAt <= Date.now()) return { label: 'Expired', variant: 'secondary' };
  if (k.maxDevices !== null && k.provisionedCount >= k.maxDevices)
    return { label: 'Limit reached', variant: 'warning' };
  return { label: 'Active', variant: 'success' };
}

/** The Arduino library settings and a curl test for a new key. */
function snippets(secret: string) {
  const origin = window.location.origin;
  return {
    firmware: `// The same in every unit's firmware: no per-device credentials.
PerspiceConfig cfg;
cfg.apiHost = "${new URL(origin).host}";
cfg.provisionKey = "${secret}";
// cfg.serial defaults to the ESP32's MAC address.
cfg.firmwareVersion = "1.0.0";
perspice.begin(cfg);   // first boot: fetches and stores this unit's own id and token`,
    curl: `curl -X POST ${origin}/api/v1/device/provision \\
  -H 'content-type: application/json' \\
  -d '{"key":"${secret}","serial":"TEST-0001"}'`,
  };
}

export function ProvisioningKeys({ profileId }: { profileId: string }) {
  const qc = useQueryClient();
  const { data: keys = [] } = useQuery({
    queryKey: ['provisioning-keys', profileId],
    queryFn: () => api<ProvisioningKeyDto[]>(`/device-profiles/${profileId}/provisioning-keys`),
  });
  const { data: customers = [] } = useCustomers();
  const [creating, setCreating] = useState(false);
  const [secret, setSecret] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const customerName = (id: string | null) =>
    id ? (customers.find((c) => c.id === id)?.name ?? '—') : 'Unassigned';

  async function revoke(k: ProvisioningKeyDto) {
    setError(null);
    try {
      await api(`/provisioning-keys/${k.id}`, { method: 'DELETE' });
      await qc.invalidateQueries({ queryKey: ['provisioning-keys', profileId] });
    } catch (e) {
      setError(e);
    }
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0">
        <div>
          <CardTitle className="text-base">Provisioning</CardTitle>
          <p className="mt-1 max-w-3xl text-sm text-fg-muted">
            For devices made in quantity: build one provisioning key into the firmware of every unit. On first
            boot each unit sends it with its serial number and receives its own device credentials, which it
            keeps across firmware updates.
          </p>
        </div>
        <Button type="button" variant="outline" onClick={() => setCreating(true)}>
          <Plus className="h-4 w-4" /> New provisioning key
        </Button>
      </CardHeader>
      <CardContent>
        <ErrorText error={error} />
        {keys.length ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Accepts</TableHead>
                <TableHead>New devices go to</TableHead>
                <TableHead>Devices</TableHead>
                <TableHead>Last used</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="w-24" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {keys.map((k) => {
                const s = status(k);
                return (
                  <TableRow key={k.id}>
                    <TableCell className="font-medium">{k.name}</TableCell>
                    <TableCell>{k.mode === 'create' ? 'Any serial' : 'Registered serials'}</TableCell>
                    <TableCell>
                      {customerName(k.customerId)}
                      {k.tags.length ? <span className="text-fg-muted"> · {k.tags.join(', ')}</span> : null}
                    </TableCell>
                    <TableCell>
                      {k.provisionedCount}
                      {k.maxDevices !== null ? ` / ${k.maxDevices}` : ''}
                    </TableCell>
                    <TableCell>{when(k.lastUsedAt)}</TableCell>
                    <TableCell>
                      <Badge variant={s.variant}>{s.label}</Badge>
                    </TableCell>
                    <TableCell>
                      {!k.revokedAt && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => void revoke(k)}
                          aria-label={`Revoke ${k.name}`}
                        >
                          Revoke
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        ) : (
          <p className="text-sm text-fg-muted">
            No provisioning keys. Devices of this profile use credentials entered one by one.
          </p>
        )}
      </CardContent>
      <NewKeyDialog
        open={creating}
        profileId={profileId}
        onClose={() => setCreating(false)}
        onCreated={async (s) => {
          setCreating(false);
          setSecret(s);
          await qc.invalidateQueries({ queryKey: ['provisioning-keys', profileId] });
        }}
      />
      <Dialog open={secret !== null} onOpenChange={(o) => !o && setSecret(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              <KeyRound className="mr-2 inline h-4 w-4" />
              Your provisioning key
            </DialogTitle>
            <DialogDescription>
              Copy it now: it is shown only once. Anyone with it can provision devices of this profile, so
              keep it out of public repositories.
            </DialogDescription>
          </DialogHeader>
          {secret && (
            <div className="space-y-4">
              <Field label="Provisioning key">{(id) => <CopyField id={id} value={secret} />}</Field>
              <Field label="Firmware (PerspiceClient library)">
                {(id) => <CopyField id={id} value={snippets(secret).firmware} multiline />}
              </Field>
              <Field label="Test it">
                {(id) => <CopyField id={id} value={snippets(secret).curl} multiline />}
              </Field>
            </div>
          )}
          <DialogFooter>
            <Button onClick={() => setSecret(null)}>Done</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

function NewKeyDialog({
  open,
  profileId,
  onClose,
  onCreated,
}: {
  open: boolean;
  profileId: string;
  onClose: () => void;
  onCreated: (secret: string) => Promise<void>;
}) {
  const { data: customers = [] } = useCustomers(open);
  const [name, setName] = useState('');
  const [mode, setMode] = useState<ProvisioningMode>('create');
  const [customerId, setCustomerId] = useState('');
  const [groupId, setGroupId] = useState('');
  const [tags, setTags] = useState('');
  const [maxDevices, setMaxDevices] = useState('');
  const [expires, setExpires] = useState('');
  const [claimCodes, setClaimCodes] = useState(false);
  const [reprovision, setReprovision] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const { data: groups = [] } = useGroups(customerId || null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      const created = await api<{ secret: string }>(`/device-profiles/${profileId}/provisioning-keys`, {
        body: {
          name,
          mode,
          customerId: customerId || null,
          groupId: groupId || null,
          tags: tags
            .split(',')
            .map((t) => t.trim())
            .filter(Boolean),
          issueClaimCodes: !customerId && claimCodes,
          allowReprovision: reprovision,
          maxDevices: maxDevices ? Number(maxDevices) : null,
          expiresAt: expires ? new Date(`${expires}T23:59:59`).getTime() : null,
        },
      });
      setName('');
      setTags('');
      setMaxDevices('');
      setExpires('');
      await onCreated(created.secret);
    } catch (err) {
      setError(err);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>New provisioning key</DialogTitle>
          <DialogDescription>
            One key per production batch or firmware line is a good habit: revoking it then affects only that
            batch.
          </DialogDescription>
        </DialogHeader>
        <form className="space-y-4" onSubmit={submit}>
          <Field label="Name" help="e.g. Factory line 1, batch 2026-10">
            {(id, d) => (
              <Input
                id={id}
                aria-describedby={d}
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            )}
          </Field>
          <fieldset className="space-y-2 text-sm">
            <legend className="mb-1 font-medium">Accept</legend>
            <label className="flex items-start gap-2">
              <input
                type="radio"
                name="mode"
                checked={mode === 'create'}
                onChange={() => setMode('create')}
                className="mt-1"
              />
              <span>Any serial: a device with a new serial is created automatically</span>
            </label>
            <label className="flex items-start gap-2">
              <input
                type="radio"
                name="mode"
                checked={mode === 'preregistered'}
                onChange={() => setMode('preregistered')}
                className="mt-1"
              />
              <span>
                Only serials registered beforehand (New device or CSV import with a serial column): safest
              </span>
            </label>
          </fieldset>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="New devices go to">
              {(id) => (
                <select
                  id={id}
                  className={selectClass}
                  value={customerId}
                  onChange={(e) => {
                    setCustomerId(e.target.value);
                    setGroupId('');
                  }}
                >
                  <option value="">Unassigned (stock)</option>
                  {customers.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              )}
            </Field>
            {groups.length > 0 && (
              <Field label="Group">
                {(id) => (
                  <select
                    id={id}
                    className={selectClass}
                    value={groupId}
                    onChange={(e) => setGroupId(e.target.value)}
                  >
                    <option value="">Whole customer</option>
                    {groups.map((g) => (
                      <option key={g.id} value={g.id}>
                        {g.name}
                      </option>
                    ))}
                  </select>
                )}
              </Field>
            )}
            <Field label="Tags" help="Comma separated, added to new devices.">
              {(id, d) => (
                <Input id={id} aria-describedby={d} value={tags} onChange={(e) => setTags(e.target.value)} />
              )}
            </Field>
            <Field label="At most (devices)" help="Limits the damage if the key leaks.">
              {(id, d) => (
                <Input
                  id={id}
                  aria-describedby={d}
                  type="number"
                  min={1}
                  value={maxDevices}
                  onChange={(e) => setMaxDevices(e.target.value)}
                />
              )}
            </Field>
            <Field label="Expires" help="Optional; the last day it works.">
              {(id, d) => (
                <Input
                  id={id}
                  aria-describedby={d}
                  type="date"
                  value={expires}
                  onChange={(e) => setExpires(e.target.value)}
                />
              )}
            </Field>
          </div>
          {!customerId && (
            <label className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                checked={claimCodes}
                onChange={(e) => setClaimCodes(e.target.checked)}
                className="mt-1"
              />
              <span>
                Give each new device a claim code, returned to the device (e.g. for the test jig to print on
                its label) so a customer can add it
              </span>
            </label>
          )}
          <label className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              checked={reprovision}
              onChange={(e) => setReprovision(e.target.checked)}
              className="mt-1"
            />
            <span>
              Allow re-provisioning: a device whose storage was wiped can fetch new credentials (its old token
              stops working). Leave off unless needed: anyone with the key and a serial could then take that
              device's identity.
            </span>
          </label>
          <ErrorText error={error} />
          <DialogFooter>
            <Button type="submit">Create key</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
