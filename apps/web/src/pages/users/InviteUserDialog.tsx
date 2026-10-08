import { canGrant } from '@perspice/shared';
import { useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useMemo, useState } from 'react';
import { api } from '@/api/client';
import { useCustomers, useGroups, useRoles } from '@/api/hooks';
import type { RoleDto } from '@/api/types';
import { useAuth } from '@/auth/AuthProvider';
import { ErrorText } from '@/components/ErrorText';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';

const selectClass = 'h-9 w-full rounded-md border border-slate-300 bg-transparent px-2 text-sm dark:border-slate-700';

/** Roles the current user may hand out: never more permissions than they hold. */
export function grantableRoles(roles: RoleDto[], held: RoleDto['permissions'], scopeType: 'platform' | 'customer'): RoleDto[] {
  return roles.filter((r) => canGrant(held, r.permissions) && (scopeType === 'platform' || r.scope === 'customer'));
}

export function InviteUserDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const { data: roles = [] } = useRoles();
  const isPlatform = user?.scopeType === 'platform';
  const { data: customers = [] } = useCustomers(isPlatform && open);
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [roleId, setRoleId] = useState('');
  const [customerId, setCustomerId] = useState('');
  const [groupId, setGroupId] = useState('');
  const [error, setError] = useState<unknown>(null);

  const options = useMemo(() => grantableRoles(roles, user?.permissions ?? [], user?.scopeType ?? 'customer'), [roles, user]);
  const role = options.find((r) => r.id === roleId);
  const targetCustomer = role?.scope === 'customer' ? (isPlatform ? customerId : user?.customerId) : null;
  const { data: groups = [] } = useGroups(targetCustomer);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await api('/users/invite', {
        body: {
          email,
          name,
          roleId,
          ...(isPlatform && role?.scope === 'customer' ? { customerId } : {}),
          ...(groupId ? { groupId } : {}),
        },
      });
      await qc.invalidateQueries({ queryKey: ['users'] });
      onOpenChange(false);
      setEmail('');
      setName('');
      setRoleId('');
    } catch (err) {
      setError(err);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Invite user</DialogTitle>
          <DialogDescription>They'll get an email with a link to set their password (valid 72 hours).</DialogDescription>
        </DialogHeader>
        <form className="space-y-4" onSubmit={submit}>
          <Field label="Email">{(id) => <Input id={id} type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />}</Field>
          <Field label="Name">{(id) => <Input id={id} required value={name} onChange={(e) => setName(e.target.value)} />}</Field>
          <Field label="Role">
            {(id) => (
              <select id={id} required className={selectClass} value={roleId} onChange={(e) => setRoleId(e.target.value)}>
                <option value="" disabled>
                  Choose a role
                </option>
                {options.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                    {isPlatform ? ` (${r.scope})` : ''}
                  </option>
                ))}
              </select>
            )}
          </Field>
          {isPlatform && role?.scope === 'customer' && (
            <Field label="Customer">
              {(id) => (
                <select id={id} required className={selectClass} value={customerId} onChange={(e) => setCustomerId(e.target.value)}>
                  <option value="" disabled>
                    Choose a customer
                  </option>
                  {customers.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              )}
            </Field>
          )}
          {groups.length > 0 && (
            <Field label="Group" help="Limit the user to one group (and its sub-groups).">
              {(id, d) => (
                <select id={id} aria-describedby={d} className={selectClass} value={groupId} onChange={(e) => setGroupId(e.target.value)}>
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
          <ErrorText error={error} />
          <DialogFooter>
            <Button type="submit" disabled={!roleId}>
              Send invite
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
