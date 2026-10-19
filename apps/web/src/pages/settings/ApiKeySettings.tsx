import { PERMISSIONS, type Permission } from '@perspice/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { api } from '@/api/client';
import { useAuth } from '@/auth/AuthProvider';
import { CopyField } from '@/components/CopyField';
import { ErrorText } from '@/components/ErrorText';
import { selectClass } from '@/components/TimezoneSelect';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

export interface ApiKeyDto {
  id: string;
  name: string;
  permissions: Permission[];
  expiresAt: number | null;
  lastUsed: number | null;
  createdAt: number;
  createdBy?: { id: string; name: string; email: string };
}

const EXPIRY = [
  ['30', '30 days'],
  ['90', '90 days'],
  ['365', '1 year'],
  ['', 'Never'],
] as const;

const when = (ms: number | null) => (ms ? new Date(ms).toLocaleDateString() : '—');
const expired = (k: ApiKeyDto) => k.expiresAt !== null && k.expiresAt <= Date.now();

function KeysTable({ keys, onRevoke, showOwner }: { keys: ApiKeyDto[]; onRevoke: (k: ApiKeyDto) => void; showOwner?: boolean }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Name</TableHead>
          {showOwner && <TableHead>Created by</TableHead>}
          <TableHead>Permissions</TableHead>
          <TableHead>Last used</TableHead>
          <TableHead>Expires</TableHead>
          <TableHead className="w-24" />
        </TableRow>
      </TableHeader>
      <TableBody>
        {keys.map((k) => (
          <TableRow key={k.id}>
            <TableCell className="font-medium">
              {k.name} {expired(k) && <Badge variant="secondary">Expired</Badge>}
            </TableCell>
            {showOwner && <TableCell>{k.createdBy ? `${k.createdBy.name} (${k.createdBy.email})` : '—'}</TableCell>}
            <TableCell className="max-w-xs text-xs text-fg-muted">{k.permissions.join(', ') || 'none'}</TableCell>
            <TableCell>{when(k.lastUsed)}</TableCell>
            <TableCell>{k.expiresAt ? when(k.expiresAt) : 'Never'}</TableCell>
            <TableCell>
              <Button variant="ghost" size="sm" onClick={() => onRevoke(k)} aria-label={`Revoke ${k.name}`}>
                Revoke
              </Button>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

export function ApiKeySettings() {
  const { user, hasPerm } = useAuth();
  const qc = useQueryClient();
  const { data: mine = [] } = useQuery({ queryKey: ['api-keys', 'mine'], queryFn: () => api<ApiKeyDto[]>('/api-keys') });
  const canManage = hasPerm('user.manage');
  const { data: all = [] } = useQuery({
    queryKey: ['api-keys', 'organisation'],
    queryFn: () => api<ApiKeyDto[]>('/api-keys', { query: { scope: 'organisation' } }),
    enabled: canManage,
  });
  const [creating, setCreating] = useState(false);
  const [created, setCreated] = useState<string | null>(null);
  const [revoking, setRevoking] = useState<ApiKeyDto | null>(null);
  const [error, setError] = useState<unknown>(null);
  const others = all.filter((k) => k.createdBy?.id !== user?.id);

  async function revoke() {
    if (!revoking) return;
    setError(null);
    try {
      await api(`/api-keys/${revoking.id}`, { method: 'DELETE' });
      await qc.invalidateQueries({ queryKey: ['api-keys'] });
      setRevoking(null);
    } catch (e) {
      setError(e);
    }
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0">
          <div>
            <CardTitle className="text-base">Your API keys</CardTitle>
            <p className="mt-1 max-w-2xl text-sm text-fg-muted">
              Let other systems use the API on your behalf: send <code>Authorization: Bearer pk_…</code>. A key has only the
              permissions you give it, never more than yours, and stops working if your account is disabled.
            </p>
          </div>
          <Button onClick={() => setCreating(true)}>
            <Plus className="h-4 w-4" /> New API key
          </Button>
        </CardHeader>
        <CardContent>
          {mine.length ? <KeysTable keys={mine} onRevoke={setRevoking} /> : <p className="text-sm text-fg-muted">You have no API keys.</p>}
        </CardContent>
      </Card>

      {canManage && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Everyone else’s keys</CardTitle>
            <p className="mt-1 text-sm text-fg-muted">Revoke a key that leaked or belongs to someone who left.</p>
          </CardHeader>
          <CardContent>
            {others.length ? <KeysTable keys={others} onRevoke={setRevoking} showOwner /> : <p className="text-sm text-fg-muted">Nobody else has API keys.</p>}
          </CardContent>
        </Card>
      )}

      <NewKeyDialog
        open={creating}
        held={user?.permissions ?? []}
        onClose={() => setCreating(false)}
        onCreated={async (key) => {
          setCreating(false);
          setCreated(key);
          await qc.invalidateQueries({ queryKey: ['api-keys'] });
        }}
      />

      <Dialog open={created !== null} onOpenChange={(o) => !o && setCreated(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Your new API key</DialogTitle>
            <DialogDescription>Copy it now: it is shown only once. Treat it like a password.</DialogDescription>
          </DialogHeader>
          {created && (
            <div className="space-y-4">
              <Field label="API key">{(id) => <CopyField id={id} value={created} />}</Field>
              <Field label="Try it">
                {(id) => <CopyField id={id} multiline value={`curl ${window.location.origin}/api/devices \\\n  -H 'Authorization: Bearer ${created}'`} />}
              </Field>
              <p className="text-sm text-fg-muted">
                The API reference (OpenAPI) is at <code>/api/docs/openapi.json</code>; see Help → API and integrations.
              </p>
            </div>
          )}
          <DialogFooter>
            <Button onClick={() => setCreated(null)}>Done</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={revoking !== null} onOpenChange={(o) => !o && setRevoking(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Revoke “{revoking?.name}”?</DialogTitle>
            <DialogDescription>Systems using it stop working at once. This can’t be undone.</DialogDescription>
          </DialogHeader>
          <ErrorText error={error} />
          <DialogFooter>
            <Button variant="outline" onClick={() => setRevoking(null)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={() => void revoke()}>
              Revoke key
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function NewKeyDialog({ open, held, onClose, onCreated }: { open: boolean; held: Permission[]; onClose: () => void; onCreated: (key: string) => Promise<void> }) {
  const [name, setName] = useState('');
  const [perms, setPerms] = useState<Permission[]>([]);
  const [expiry, setExpiry] = useState('90');
  const [error, setError] = useState<unknown>(null);
  const available = PERMISSIONS.filter((p) => held.includes(p));

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      const res = await api<{ key: string }>('/api-keys', {
        body: { name, permissions: perms, ...(expiry ? { expiresAt: Date.now() + Number(expiry) * 86_400_000 } : {}) },
      });
      setName('');
      setPerms([]);
      await onCreated(res.key);
    } catch (err) {
      setError(err);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>New API key</DialogTitle>
          <DialogDescription>Give it only what the other system needs, e.g. device.read and telemetry.read to read data.</DialogDescription>
        </DialogHeader>
        <form className="space-y-4" onSubmit={submit}>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Name" help="What uses it, e.g. ERP sync.">
              {(id, d) => <Input id={id} aria-describedby={d} required value={name} onChange={(e) => setName(e.target.value)} />}
            </Field>
            <Field label="Expires after">
              {(id) => (
                <select id={id} className={selectClass} value={expiry} onChange={(e) => setExpiry(e.target.value)}>
                  {EXPIRY.map(([v, label]) => (
                    <option key={label} value={v}>
                      {label}
                    </option>
                  ))}
                </select>
              )}
            </Field>
          </div>
          <fieldset>
            <legend className="mb-2 text-sm font-medium">Permissions</legend>
            <div className="grid max-h-64 grid-cols-2 gap-2 overflow-y-auto sm:grid-cols-3">
              {available.map((p) => (
                <label key={p} className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={perms.includes(p)} onChange={(e) => setPerms((cur) => (e.target.checked ? [...cur, p] : cur.filter((x) => x !== p)))} />
                  {p}
                </label>
              ))}
            </div>
          </fieldset>
          <ErrorText error={error} />
          <DialogFooter>
            <Button type="submit" disabled={!perms.length}>
              Create key
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
