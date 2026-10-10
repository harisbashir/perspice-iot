import { profileKeys } from '@perspice/shared';
import type { ReportScheduleDto, ReportScheduleInput, ScheduleCadence } from '@perspice/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Play, Plus, Trash2 } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { api } from '@/api/client';
import type { UserDto } from '@/api/types';
import { useAuth } from '@/auth/AuthProvider';
import { ErrorText, errorMessage } from '@/components/ErrorText';
import { PageHeader } from '@/components/PageHeader';
import { TimezoneSelect, selectClass } from '@/components/TimezoneSelect';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useToast } from '@/components/ui/toast';
import { useDeviceList, useProfiles } from '../devices/hooks';

const DAY = 86_400_000;
const WINDOWS = [
  { ms: DAY, label: 'Last 24 hours' },
  { ms: 7 * DAY, label: 'Last 7 days' },
  { ms: 30 * DAY, label: 'Last 30 days' },
];
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export function cadenceText(c: ScheduleCadence, tz: string): string {
  const at = `at ${c.time} (${tz})`;
  if (c.kind === 'daily') return `Daily ${at}`;
  if (c.kind === 'weekly') return `Every ${WEEKDAYS[c.day]} ${at}`;
  return `Monthly on day ${c.day} ${at}`;
}

type Draft = {
  name: string;
  kind: 'dashboard' | 'overview' | 'telemetry';
  deviceId: string;
  keys: string[];
  format: 'csv' | 'xlsx' | 'pdf';
  lastMs: number;
  cadence: ScheduleCadence;
  timezone: string;
  recipients: string[];
};

function toInput(d: Draft): ReportScheduleInput {
  const target =
    d.kind === 'telemetry'
      ? { kind: 'telemetry' as const, deviceId: d.deviceId, keys: d.keys, format: d.format }
      : d.kind === 'overview'
        ? { kind: 'dashboard' as const, overview: true }
        : { kind: 'dashboard' as const, deviceId: d.deviceId };
  return { name: d.name, target, timewindow: { kind: 'relative', lastMs: d.lastMs }, cadence: d.cadence, timezone: d.timezone, recipients: d.recipients, enabled: true };
}

function ScheduleDialog({ onClose }: { onClose: () => void }) {
  const { user, hasPerm } = useAuth();
  const qc = useQueryClient();
  const devices = useDeviceList({});
  const { data: profiles = [] } = useProfiles();
  const { data: users = [] } = useQuery({ queryKey: ['users'], queryFn: () => api<UserDto[]>('/users'), enabled: hasPerm('user.read') });
  const [error, setError] = useState<unknown>(null);
  const [d, setD] = useState<Draft>({
    name: '',
    kind: 'dashboard',
    deviceId: '',
    keys: [],
    format: 'csv',
    lastMs: DAY,
    cadence: { kind: 'daily', time: '07:00' },
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
    recipients: user ? [user.id] : [],
  });
  const set = (patch: Partial<Draft>) => setD({ ...d, ...patch });
  const list = devices.data?.pages.flatMap((p) => p.items) ?? [];
  const device = list.find((x) => x.id === d.deviceId);
  const keys = profileKeys(profiles.find((p) => p.id === device?.profileId));
  const people = users.filter((u) => u.status === 'active');

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await api('/report-schedules', { body: toInput(d) });
      await qc.invalidateQueries({ queryKey: ['report-schedules'] });
      onClose();
    } catch (err) {
      setError(err);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>New scheduled report</DialogTitle>
        </DialogHeader>
        <form className="space-y-4" onSubmit={(e) => void submit(e)}>
          <Field label="Name">{(id) => <Input id={id} required maxLength={120} value={d.name} onChange={(e) => set({ name: e.target.value })} />}</Field>
          <Field label="Report">
            {(id) => (
              <select id={id} className={selectClass} value={d.kind} onChange={(e) => set({ kind: e.target.value as Draft['kind'] })}>
                <option value="dashboard">A device dashboard (PDF)</option>
                <option value="overview">The overview dashboard (PDF)</option>
                <option value="telemetry">Device telemetry export</option>
              </select>
            )}
          </Field>
          {d.kind !== 'overview' && (
            <Field label="Device">
              {(id) => (
                <select id={id} className={selectClass} required value={d.deviceId} onChange={(e) => set({ deviceId: e.target.value, keys: [] })}>
                  <option value="">Choose a device…</option>
                  {list.map((x) => (
                    <option key={x.id} value={x.id}>
                      {x.name}
                    </option>
                  ))}
                </select>
              )}
            </Field>
          )}
          {d.kind === 'telemetry' && (
            <>
              <fieldset className="space-y-1 text-sm">
                <legend className="text-sm font-medium">Values</legend>
                {keys.map((k) => (
                  <label key={k.key} className="mr-4 inline-flex items-center gap-1.5">
                    <input type="checkbox" checked={d.keys.includes(k.key)} onChange={(e) => set({ keys: e.target.checked ? [...d.keys, k.key] : d.keys.filter((x) => x !== k.key) })} />
                    {k.label}
                  </label>
                ))}
                {device && !keys.length && <p className="text-slate-500">This device’s profile has no telemetry keys.</p>}
              </fieldset>
              <Field label="Format">
                {(id) => (
                  <select id={id} className={selectClass} value={d.format} onChange={(e) => set({ format: e.target.value as Draft['format'] })}>
                    <option value="csv">CSV</option>
                    <option value="xlsx">Excel (XLSX)</option>
                    <option value="pdf">PDF</option>
                  </select>
                )}
              </Field>
            </>
          )}
          <Field label="Period">
            {(id) => (
              <select id={id} className={selectClass} value={d.lastMs} onChange={(e) => set({ lastMs: Number(e.target.value) })}>
                {WINDOWS.map((w) => (
                  <option key={w.ms} value={w.ms}>
                    {w.label}
                  </option>
                ))}
              </select>
            )}
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Repeat">
              {(id) => (
                <select
                  id={id}
                  className={selectClass}
                  value={d.cadence.kind}
                  onChange={(e) => {
                    const kind = e.target.value as ScheduleCadence['kind'];
                    const time = d.cadence.time;
                    set({ cadence: kind === 'daily' ? { kind, time } : kind === 'weekly' ? { kind, day: 1, time } : { kind, day: 1, time } });
                  }}
                >
                  <option value="daily">Daily</option>
                  <option value="weekly">Weekly</option>
                  <option value="monthly">Monthly</option>
                </select>
              )}
            </Field>
            <Field label="At">{(id) => <Input id={id} type="time" required value={d.cadence.time} onChange={(e) => set({ cadence: { ...d.cadence, time: e.target.value } })} />}</Field>
          </div>
          {d.cadence.kind === 'weekly' && (
            <Field label="On">
              {(id) => (
                <select id={id} className={selectClass} value={d.cadence.kind === 'weekly' ? d.cadence.day : 1} onChange={(e) => set({ cadence: { kind: 'weekly', day: Number(e.target.value), time: d.cadence.time } })}>
                  {WEEKDAYS.map((w, i) => (
                    <option key={w} value={i}>
                      {w}
                    </option>
                  ))}
                </select>
              )}
            </Field>
          )}
          {d.cadence.kind === 'monthly' && (
            <Field label="Day of the month" help="1–28, so every month has it.">
              {(id) => (
                <Input id={id} type="number" min={1} max={28} value={d.cadence.kind === 'monthly' ? d.cadence.day : 1} onChange={(e) => set({ cadence: { kind: 'monthly', day: Number(e.target.value), time: d.cadence.time } })} />
              )}
            </Field>
          )}
          <Field label="Timezone">{(id) => <TimezoneSelect id={id} value={d.timezone} onChange={(tz) => set({ timezone: tz ?? 'UTC' })} />}</Field>
          {people.length > 0 && (
            <fieldset className="space-y-1 text-sm">
              <legend className="text-sm font-medium">Send to</legend>
              {people.map((u) => (
                <label key={u.id} className="flex items-center gap-2">
                  <input type="checkbox" checked={d.recipients.includes(u.id)} onChange={(e) => set({ recipients: e.target.checked ? [...d.recipients, u.id] : d.recipients.filter((x) => x !== u.id) })} />
                  {u.name} <span className="text-slate-500">{u.email}</span>
                </label>
              ))}
            </fieldset>
          )}
          <ErrorText error={error} />
          <DialogFooter>
            <Button type="submit" disabled={!d.recipients.length || (d.kind === 'telemetry' && !d.keys.length)}>
              Create schedule
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

const STATUS_VARIANT = { ok: 'success', skipped: 'warning', failed: 'danger' } as const;

export function ReportSchedulesPage() {
  const toast = useToast();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const { data = [] } = useQuery({ queryKey: ['report-schedules'], queryFn: () => api<ReportScheduleDto[]>('/report-schedules') });

  async function act(fn: () => Promise<unknown>, done: string) {
    try {
      await fn();
      await qc.invalidateQueries({ queryKey: ['report-schedules'] });
      toast({ title: done, variant: 'success' });
    } catch (err) {
      toast({ title: 'Something went wrong', description: errorMessage(err), variant: 'error' });
    }
  }

  return (
    <div>
      <PageHeader
        title="Scheduled reports"
        description="Dashboards and exports emailed on a schedule. Links in the emails work for 7 days."
        actions={
          <Button onClick={() => setOpen(true)}>
            <Plus className="h-4 w-4" /> New schedule
          </Button>
        }
      />
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead>When</TableHead>
            <TableHead>Next run</TableHead>
            <TableHead>Last run</TableHead>
            <TableHead className="w-24" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {data.map((s) => (
            <TableRow key={s.id}>
              <TableCell className="font-medium">{s.name}</TableCell>
              <TableCell>{cadenceText(s.cadence, s.timezone)}</TableCell>
              <TableCell>{s.nextRunAt ? new Date(s.nextRunAt).toLocaleString() : 'Paused'}</TableCell>
              <TableCell>
                {s.lastRun ? (
                  <span className="flex items-center gap-2">
                    <Badge variant={STATUS_VARIANT[s.lastRun.status]}>{s.lastRun.status}</Badge>
                    <span className="text-xs text-slate-500">{s.lastRun.message}</span>
                  </span>
                ) : (
                  '—'
                )}
              </TableCell>
              <TableCell className="flex gap-1">
                <Button size="icon" variant="ghost" aria-label={`Run ${s.name} now`} onClick={() => void act(() => api(`/report-schedules/${s.id}/run`, { method: 'POST' }), 'Report started')}>
                  <Play className="h-4 w-4" />
                </Button>
                <Button size="icon" variant="ghost" aria-label={`Delete ${s.name}`} onClick={() => void act(() => api(`/report-schedules/${s.id}`, { method: 'DELETE' }), 'Schedule deleted')}>
                  <Trash2 className="h-4 w-4" />
                </Button>
              </TableCell>
            </TableRow>
          ))}
          {data.length === 0 && (
            <TableRow>
              <TableCell colSpan={5} className="py-8 text-center text-slate-500">
                No scheduled reports yet.
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
      {open && <ScheduleDialog onClose={() => setOpen(false)} />}
    </div>
  );
}
