import type { DeviceProfileDto, DeviceServiceDto, RunHoursDto } from '@perspice/shared';
import { useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { api } from '@/api/client';
import { useAuth } from '@/auth/AuthProvider';
import { ErrorText } from '@/components/ErrorText';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

const localInput = (ms: number) => {
  const d = new Date(ms - new Date(ms).getTimezoneOffset() * 60_000);
  return d.toISOString().slice(0, 16);
};

/** Run hours of the profile's runtime keys, the service log, and logging a service (spec §11). */
export function MaintenancePanel({ deviceId, profile }: { deviceId: string; profile: DeviceProfileDto | null }) {
  const { hasPerm } = useAuth();
  const qc = useQueryClient();
  const runtimeKeys = (profile?.calculated ?? []).filter((c) => c.kind === 'runtime');
  const hours = useQueries({
    queries: runtimeKeys.map((k) => ({
      queryKey: ['devices', deviceId, 'run-hours', k.key],
      queryFn: () => api<RunHoursDto>(`/devices/${deviceId}/run-hours`, { query: { key: k.key } }),
    })),
  });
  const services = useQuery({ queryKey: ['devices', deviceId, 'services'], queryFn: () => api<DeviceServiceDto[]>(`/devices/${deviceId}/services`) });
  const [note, setNote] = useState('');
  const [when, setWhen] = useState(() => localInput(Date.now()));
  const [error, setError] = useState<unknown>(null);

  async function log(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await api<DeviceServiceDto>(`/devices/${deviceId}/services`, { body: { note, servicedAt: new Date(when).getTime() } });
      setNote('');
      await Promise.all([qc.invalidateQueries({ queryKey: ['devices', deviceId] }), qc.invalidateQueries({ queryKey: ['alarms'] })]);
    } catch (err) {
      setError(err);
    }
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Run hours</CardTitle>
        </CardHeader>
        <CardContent className="text-sm">
          {runtimeKeys.length === 0 ? (
            <p className="text-slate-500">This profile has no run-time key. Add a calculated key of the kind “Run time” to count run hours.</p>
          ) : (
            <dl className="grid gap-3 sm:grid-cols-2">
              {runtimeKeys.map((k, i) => {
                const h = hours[i]?.data;
                return (
                  <div key={k.key} data-testid={`run-hours-${k.key}`} className="rounded-md border border-slate-200 p-3 dark:border-slate-800">
                    <dt className="text-slate-500">{k.label}</dt>
                    <dd className="text-2xl font-semibold tabular-nums">{h ? `${h.total.toLocaleString()} h` : '—'}</dd>
                    <dd className="text-xs text-slate-500">{h ? `${h.sinceService.toLocaleString()} h since ${h.lastService ? 'the last service' : 'it was added'}` : ''}</dd>
                  </div>
                );
              })}
            </dl>
          )}
        </CardContent>
      </Card>

      {hasPerm('device.service') && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Log a service</CardTitle>
          </CardHeader>
          <CardContent>
            <form className="flex flex-wrap items-end gap-3 text-sm" onSubmit={(e) => void log(e)}>
              <Field label="Done on">{(id) => <Input id={id} type="datetime-local" className="w-56" value={when} onChange={(e) => setWhen(e.target.value)} />}</Field>
              <div className="min-w-64 flex-1">
                <Field label="Note">{(id) => <Input id={id} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. oil and filters changed" />}</Field>
              </div>
              <Button type="submit">Log service</Button>
            </form>
            <p className="mt-2 text-xs text-slate-500">Maintenance reminders for this device start counting again from here.</p>
            <ErrorText error={error} />
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Service history</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Note</TableHead>
                <TableHead>Run hours then</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(services.data ?? []).map((s) => (
                <TableRow key={s.id}>
                  <TableCell>{new Date(s.servicedAt).toLocaleString()}</TableCell>
                  <TableCell>{s.note}</TableCell>
                  <TableCell className="text-xs text-slate-500">
                    {Object.entries(s.runHours)
                      .map(([k, v]) => `${runtimeKeys.find((r) => r.key === k)?.label ?? k}: ${v} h`)
                      .join(', ')}
                  </TableCell>
                </TableRow>
              ))}
              {services.data?.length === 0 && (
                <TableRow>
                  <TableCell colSpan={3} className="py-6 text-center text-slate-500">
                    No services logged yet.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
