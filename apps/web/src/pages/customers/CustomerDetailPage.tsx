import { useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { useParams } from 'react-router';
import { api } from '@/api/client';
import { useCustomer, useGroups } from '@/api/hooks';
import { useAuth } from '@/auth/AuthProvider';
import { ErrorText } from '@/components/ErrorText';
import { PageHeader } from '@/components/PageHeader';
import { TimezoneSelect } from '@/components/TimezoneSelect';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { NotFoundPage } from '../NotFoundPage';
import { CustomerBrandingForm } from './CustomerBrandingForm';

export function CustomerDetailPage() {
  const { id = '' } = useParams();
  const { hasPerm } = useAuth();
  const qc = useQueryClient();
  const { data: customer, isLoading, error } = useCustomer(id);
  const { data: groups } = useGroups(id);
  const [groupName, setGroupName] = useState('');
  const [mutationError, setMutationError] = useState<unknown>(null);

  if (isLoading) return <Skeleton className="h-64" />;
  if (error || !customer) return <NotFoundPage />;

  const canManage = hasPerm('customer.manage');

  async function update(body: { status?: 'active' | 'suspended'; timezone?: string }) {
    try {
      await api(`/customers/${id}`, { method: 'PATCH', body });
      await qc.invalidateQueries({ queryKey: ['customers'] });
    } catch (e) {
      setMutationError(e);
    }
  }

  async function addGroup(e: FormEvent) {
    e.preventDefault();
    try {
      await api(`/customers/${id}/groups`, { body: { name: groupName } });
      setGroupName('');
      await qc.invalidateQueries({ queryKey: ['customers', id, 'groups'] });
    } catch (err) {
      setMutationError(err);
    }
  }

  return (
    <div>
      <PageHeader
        title={customer.name}
        description={`${customer.slug}.${window.location.hostname}`}
        actions={
          canManage &&
          (customer.status === 'active' ? (
            <Button variant="outline" onClick={() => void update({ status: 'suspended' })}>
              Suspend
            </Button>
          ) : (
            <Button onClick={() => void update({ status: 'active' })}>Reactivate</Button>
          ))
        }
      />
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Badge variant={customer.status === 'active' ? 'success' : 'warning'}>{customer.status}</Badge>
        <label className="flex items-center gap-2 text-sm">
          Timezone
          {canManage ? (
            <TimezoneSelect className="w-56" value={customer.timezone ?? 'UTC'} onChange={(tz) => void update({ timezone: tz ?? 'UTC' })} />
          ) : (
            <span>{customer.timezone ?? 'UTC'}</span>
          )}
        </label>
      </div>
      <ErrorText error={mutationError} />
      <Tabs defaultValue="groups">
        <TabsList>
          <TabsTrigger value="groups">Groups</TabsTrigger>
          {hasPerm('branding.edit') && <TabsTrigger value="branding">Branding</TabsTrigger>}
        </TabsList>
        <TabsContent value="groups">
          <Card>
            <CardHeader>
              <CardTitle>Groups and sites</CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="mb-4 space-y-1 text-sm">
                {(groups ?? []).map((g) => (
                  <li key={g.id}>{g.name}</li>
                ))}
                {groups?.length === 0 && <li className="text-fg-muted">No groups.</li>}
              </ul>
              <form onSubmit={addGroup} className="flex gap-2">
                <Input aria-label="New group name" placeholder="New group" value={groupName} onChange={(e) => setGroupName(e.target.value)} />
                <Button type="submit" disabled={!groupName.trim()}>
                  Add
                </Button>
              </form>
            </CardContent>
          </Card>
        </TabsContent>
        <TabsContent value="branding">
          <CustomerBrandingForm customerId={id} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
