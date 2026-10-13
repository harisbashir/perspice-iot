import { useQueryClient } from '@tanstack/react-query';
import { MoreHorizontal, Plus } from 'lucide-react';
import { useState } from 'react';
import { api } from '@/api/client';
import { useRoles, useUsers } from '@/api/hooks';
import type { UserDto } from '@/api/types';
import { useAuth } from '@/auth/AuthProvider';
import { ErrorText } from '@/components/ErrorText';
import { PageHeader } from '@/components/PageHeader';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useToast } from '@/components/ui/toast';
import { InviteLinkDialog } from './InviteLinkDialog';
import { InviteUserDialog } from './InviteUserDialog';

const STATUS_VARIANT = { active: 'success', invited: 'secondary', disabled: 'warning' } as const;

export function UsersPage() {
  const { user: me, hasPerm } = useAuth();
  const { data: users, isLoading } = useUsers();
  const { data: roles = [] } = useRoles();
  const qc = useQueryClient();
  const toast = useToast();
  const [inviteOpen, setInviteOpen] = useState(false);
  const [invite, setInvite] = useState<{ email: string; link: string } | null>(null);
  const [error, setError] = useState<unknown>(null);
  const canManage = hasPerm('user.manage');
  const roleName = (id: string) => roles.find((r) => r.id === id)?.name ?? '—';

  async function act(u: UserDto, action: 'disable' | 'enable' | 'resend' | 'link' | 'delete') {
    setError(null);
    try {
      if (action === 'link') {
        const { link } = await api<{ link: string }>(`/users/${u.id}/invite-link`, { method: 'POST' });
        setInvite({ email: u.email, link });
        return;
      }
      if (action === 'resend') await api(`/users/${u.id}/resend-invite`, { method: 'POST' });
      else if (action === 'delete') await api(`/users/${u.id}`, { method: 'DELETE' });
      else await api(`/users/${u.id}`, { method: 'PATCH', body: { status: action === 'disable' ? 'disabled' : 'active' } });
      await qc.invalidateQueries({ queryKey: ['users'] });
      toast({ title: action === 'resend' ? 'Invite sent' : 'User updated', variant: 'success' });
    } catch (e) {
      setError(e);
    }
  }

  return (
    <div>
      <PageHeader
        title="Users"
        actions={
          canManage && (
            <Button onClick={() => setInviteOpen(true)}>
              <Plus className="h-4 w-4" /> Invite user
            </Button>
          )
        }
      />
      <ErrorText error={error} />
      {isLoading ? (
        <Skeleton className="h-32" />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Email</TableHead>
              <TableHead>Role</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>2FA</TableHead>
              <TableHead className="w-10" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {(users ?? []).map((u) => (
              <TableRow key={u.id}>
                <TableCell className="font-medium">{u.name}</TableCell>
                <TableCell>{u.email}</TableCell>
                <TableCell>{roleName(u.roleId)}</TableCell>
                <TableCell>
                  <Badge variant={STATUS_VARIANT[u.status]}>{u.status}</Badge>
                </TableCell>
                <TableCell>{u.totpEnabled ? 'On' : 'Off'}</TableCell>
                <TableCell>
                  {canManage && u.id !== me?.id && (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" aria-label={`Actions for ${u.email}`}>
                          <MoreHorizontal className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        {u.status === 'invited' && <DropdownMenuItem onSelect={() => void act(u, 'resend')}>Resend invite</DropdownMenuItem>}
                        {u.status === 'invited' && <DropdownMenuItem onSelect={() => void act(u, 'link')}>Copy invite link</DropdownMenuItem>}
                        {u.status === 'active' && <DropdownMenuItem onSelect={() => void act(u, 'disable')}>Disable</DropdownMenuItem>}
                        {u.status === 'disabled' && <DropdownMenuItem onSelect={() => void act(u, 'enable')}>Enable</DropdownMenuItem>}
                        <DropdownMenuItem className="text-red-600" onSelect={() => void act(u, 'delete')}>
                          Delete
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
      <InviteUserDialog open={inviteOpen} onOpenChange={setInviteOpen} onInvited={setInvite} />
      <InviteLinkDialog invite={invite} onClose={() => setInvite(null)} />
    </div>
  );
}
