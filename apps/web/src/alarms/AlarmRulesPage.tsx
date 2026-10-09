import type { AlarmRuleDto, AlarmScope, DeviceProfileDto } from '@perspice/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { useSearchParams } from 'react-router';
import { api } from '@/api/client';
import { useAuth } from '@/auth/AuthProvider';
import { errorMessage } from '@/components/ErrorText';
import { PageHeader } from '@/components/PageHeader';
import { selectClass } from '@/components/TimezoneSelect';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useToast } from '@/components/ui/toast';
import { useDeviceList, useProfiles } from '@/pages/devices/hooks';
import { SeverityBadge } from './badges';
import { describeRule } from './describe';
import { RuleForm } from './RuleForm';

/** Where a new rule goes: the page's filter if any, else a choice. */
function ScopePicker({ value, onChange }: { value: AlarmScope | null; onChange: (s: AlarmScope | null) => void }) {
  const { user } = useAuth();
  const { data: profiles = [] } = useProfiles();
  const devices = useDeviceList({});
  const list = devices.data?.pages.flatMap((p) => p.items) ?? [];
  const platform = user?.scopeType === 'platform';
  const encoded = value ? `${value.kind}:${value.kind === 'profile' ? value.profileId : value.kind === 'device' ? value.deviceId : value.customerId}` : '';
  return (
    <select
      aria-label="Applies to"
      className={selectClass}
      value={encoded}
      onChange={(e) => {
        const [kind, id] = e.target.value.split(':') as [string, string];
        onChange(!kind ? null : kind === 'profile' ? { kind, profileId: id } : kind === 'device' ? { kind, deviceId: id } : { kind: 'customer', customerId: id });
      }}
    >
      <option value="">Choose what the rule applies to…</option>
      {platform && (
        <optgroup label="Every device of a profile">
          {profiles.map((p) => (
            <option key={p.id} value={`profile:${p.id}`}>
              {p.name}
            </option>
          ))}
        </optgroup>
      )}
      {!platform && user?.customerId && !user.groupId && <option value={`customer:${user.customerId}`}>All of our devices</option>}
      <optgroup label="One device">
        {list.map((d) => (
          <option key={d.id} value={`device:${d.id}`}>
            {d.name}
          </option>
        ))}
      </optgroup>
    </select>
  );
}

export function AlarmRulesPage() {
  const { user, hasPerm } = useAuth();
  const toast = useToast();
  const qc = useQueryClient();
  const [params] = useSearchParams();
  const filter = { profileId: params.get('profileId') ?? undefined, deviceId: params.get('deviceId') ?? undefined };
  const { data: rules = [] } = useQuery({ queryKey: ['alarm-rules', filter], queryFn: () => api<AlarmRuleDto[]>('/alarm-rules', { query: filter }) });
  const { data: profiles = [] } = useProfiles();
  const devices = useDeviceList({});
  const deviceList = devices.data?.pages.flatMap((p) => p.items) ?? [];
  const [editing, setEditing] = useState<{ rule?: AlarmRuleDto; scope: AlarmScope | null } | null>(null);
  const canWrite = hasPerm('alarm.rule.write');
  const writable = (r: AlarmRuleDto) => canWrite && (user?.scopeType === 'platform' || r.scope.kind !== 'profile');
  const profileOf = (s: AlarmScope | null): DeviceProfileDto | null => {
    if (!s) return null;
    const pid = s.kind === 'profile' ? s.profileId : s.kind === 'device' ? deviceList.find((d) => d.id === s.deviceId)?.profileId : s.profileId;
    return profiles.find((p) => p.id === pid) ?? null;
  };
  const scopeText = (s: AlarmScope) =>
    s.kind === 'profile'
      ? `All ${profiles.find((p) => p.id === s.profileId)?.name ?? ''} devices`
      : s.kind === 'device'
        ? (deviceList.find((d) => d.id === s.deviceId)?.name ?? 'One device')
        : 'All of the customer’s devices';
  const initialScope: AlarmScope | null = filter.deviceId ? { kind: 'device', deviceId: filter.deviceId } : filter.profileId && user?.scopeType === 'platform' ? { kind: 'profile', profileId: filter.profileId } : null;

  async function remove(r: AlarmRuleDto) {
    try {
      await api(`/alarm-rules/${r.id}`, { method: 'DELETE' });
      await qc.invalidateQueries({ queryKey: ['alarm-rules'] });
      toast({ title: 'Rule deleted', variant: 'success' });
    } catch (err) {
      toast({ title: 'Could not delete', description: errorMessage(err), variant: 'error' });
    }
  }

  return (
    <div>
      <PageHeader
        title="Alarm rules"
        description="Rules on a profile apply to every device of it, in every customer. Device and customer rules add to them."
        actions={
          canWrite && (
            <Button onClick={() => setEditing({ scope: initialScope })}>
              <Plus className="h-4 w-4" /> New rule
            </Button>
          )
        }
      />
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Rule</TableHead>
            <TableHead>Applies to</TableHead>
            <TableHead>Raises when</TableHead>
            <TableHead>Severity</TableHead>
            <TableHead className="w-24" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {rules.map((r) => (
            <TableRow key={r.id}>
              <TableCell className="font-medium">
                {r.name} {!r.enabled && <Badge variant="secondary">off</Badge>} {r.disablesRuleId && <Badge variant="warning">opt-out</Badge>}
              </TableCell>
              <TableCell>{scopeText(r.scope)}</TableCell>
              <TableCell className="text-sm">{describeRule(r, (k) => profileOf(r.scope)?.telemetrySchema.find((x) => x.key === k)?.label ?? k)}</TableCell>
              <TableCell>
                <SeverityBadge severity={r.severity} />
              </TableCell>
              <TableCell className="flex gap-1">
                {writable(r) && (
                  <>
                    <Button size="icon" variant="ghost" aria-label={`Edit ${r.name}`} onClick={() => setEditing({ rule: r, scope: r.scope })}>
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button size="icon" variant="ghost" aria-label={`Delete ${r.name}`} onClick={() => void remove(r)}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </>
                )}
              </TableCell>
            </TableRow>
          ))}
          {rules.length === 0 && (
            <TableRow>
              <TableCell colSpan={5} className="py-8 text-center text-slate-500">
                No alarm rules yet.
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
      {editing && (
        <Dialog open onOpenChange={(o) => !o && setEditing(null)}>
          <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
            <DialogHeader>
              <DialogTitle>{editing.rule ? 'Edit alarm rule' : 'New alarm rule'}</DialogTitle>
            </DialogHeader>
            {!editing.rule && <ScopePicker value={editing.scope} onChange={(scope) => setEditing({ scope })} />}
            {editing.scope && (
              <RuleForm
                key={JSON.stringify(editing.scope)}
                scope={editing.scope}
                rule={editing.rule}
                profile={profileOf(editing.scope)}
                onSaved={() => {
                  setEditing(null);
                  void qc.invalidateQueries({ queryKey: ['alarm-rules'] });
                  toast({ title: 'Rule saved', variant: 'success' });
                }}
              />
            )}
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
