import { PERMISSIONS, type Permission } from '@perspice/shared';
import { useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { api } from '@/api/client';
import { useRoles } from '@/api/hooks';
import { useAuth } from '@/auth/AuthProvider';
import { ErrorText } from '@/components/ErrorText';
import { PageHeader } from '@/components/PageHeader';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

export function RolesPage() {
  const { user, hasPerm } = useAuth();
  const { data: roles = [] } = useRoles();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [scope, setScope] = useState<'platform' | 'customer'>('customer');
  const [perms, setPerms] = useState<Permission[]>([]);
  const [error, setError] = useState<unknown>(null);
  const held = new Set(user?.permissions ?? []);

  async function submit(e: FormEvent) {
    e.preventDefault();
    try {
      await api('/roles', { body: { name, scope, permissions: perms } });
      await qc.invalidateQueries({ queryKey: ['roles'] });
      setOpen(false);
      setName('');
      setPerms([]);
    } catch (err) {
      setError(err);
    }
  }

  async function remove(id: string) {
    try {
      await api(`/roles/${id}`, { method: 'DELETE' });
      await qc.invalidateQueries({ queryKey: ['roles'] });
    } catch (err) {
      setError(err);
    }
  }

  return (
    <div>
      <PageHeader
        title="Roles"
        description="Built-in roles are fixed. Custom roles can never hold more permissions than you."
        actions={
          hasPerm('role.manage') && (
            <Button onClick={() => setOpen(true)}>
              <Plus className="h-4 w-4" /> New role
            </Button>
          )
        }
      />
      <ErrorText error={error} />
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead>Scope</TableHead>
            <TableHead>Permissions</TableHead>
            <TableHead />
          </TableRow>
        </TableHeader>
        <TableBody>
          {roles.map((r) => (
            <TableRow key={r.id}>
              <TableCell className="font-medium">
                {r.name} {r.builtIn && <Badge variant="secondary">built-in</Badge>}
              </TableCell>
              <TableCell>{r.scope}</TableCell>
              <TableCell className="max-w-md text-xs text-slate-500">{r.permissions.join(', ')}</TableCell>
              <TableCell>
                {!r.builtIn && hasPerm('role.manage') && (
                  <Button variant="ghost" size="sm" onClick={() => void remove(r.id)}>
                    Delete
                  </Button>
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>New role</DialogTitle>
          </DialogHeader>
          <form className="space-y-4" onSubmit={submit}>
            <Field label="Name">{(id) => <Input id={id} required value={name} onChange={(e) => setName(e.target.value)} />}</Field>
            <Field label="Scope">
              {(id) => (
                <select
                  id={id}
                  className="h-9 w-full rounded-md border border-slate-300 bg-transparent px-2 text-sm dark:border-slate-700"
                  value={scope}
                  onChange={(e) => setScope(e.target.value as 'platform' | 'customer')}
                >
                  <option value="customer">Customer</option>
                  <option value="platform">Platform</option>
                </select>
              )}
            </Field>
            <fieldset>
              <legend className="mb-2 text-sm font-medium">Permissions</legend>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {PERMISSIONS.filter((p) => held.has(p)).map((p) => (
                  <label key={p} className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={perms.includes(p)}
                      onChange={(e) => setPerms((cur) => (e.target.checked ? [...cur, p] : cur.filter((x) => x !== p)))}
                    />
                    {p}
                  </label>
                ))}
              </div>
            </fieldset>
            <ErrorText error={error} />
            <DialogFooter>
              <Button type="submit">Create role</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
