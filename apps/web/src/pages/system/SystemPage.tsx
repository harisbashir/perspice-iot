import type { BackupStatusDto, RestoreStatusDto, SystemStatusDto } from '@perspice/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useEffect, useRef, useState } from 'react';
import { api, apiResponse } from '@/api/client';
import { useAuth } from '@/auth/AuthProvider';
import { ErrorText, errorMessage } from '@/components/ErrorText';
import { PageHeader } from '@/components/PageHeader';
import { TimezoneSelect } from '@/components/TimezoneSelect';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useToast } from '@/components/ui/toast';

export function formatBytes(n: number | null | undefined): string {
  if (n === null || n === undefined) return '—';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let v = n;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v < 10 && i > 0 ? v.toFixed(1) : Math.round(v)} ${units[i]}`;
}

const uptime = (since: number) => {
  const m = Math.round((Date.now() - since) / 60_000);
  return m < 60 ? `${m} min` : m < 1440 ? `${Math.floor(m / 60)} h` : `${Math.floor(m / 1440)} d`;
};

function Tile({ label, value }: { label: string; value: string }) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="text-xs font-medium uppercase text-slate-500">{label}</div>
        <div className="mt-1 text-2xl font-semibold tabular-nums">{value}</div>
      </CardContent>
    </Card>
  );
}

function BackupsCard() {
  const toast = useToast();
  const qc = useQueryClient();
  const status = useQuery({ queryKey: ['backups'], queryFn: () => api<BackupStatusDto>('/system/backups'), refetchInterval: (q) => (q.state.data?.running ? 2000 : false) });
  const restore = useQuery({
    queryKey: ['restore'],
    queryFn: () => api<RestoreStatusDto>('/system/restore'),
    refetchInterval: (q) => (['checking', 'restoring', 'migrating'].includes(q.state.data?.state ?? '') ? 2000 : false),
  });
  const [schedule, setSchedule] = useState<BackupStatusDto['schedule'] | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [confirming, setConfirming] = useState<File | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const s = status.data;
  const restoring = ['checking', 'restoring', 'migrating'].includes(restore.data?.state ?? '');

  useEffect(() => {
    if (s && !schedule) setSchedule(s.schedule);
  }, [s, schedule]);

  // When a restore finishes, everything on screen may be stale.
  const lastState = useRef(restore.data?.state);
  useEffect(() => {
    if (lastState.current && lastState.current !== restore.data?.state && restore.data?.state === 'done') void qc.invalidateQueries();
    lastState.current = restore.data?.state;
  }, [restore.data?.state, qc]);

  if (!s) return null;

  async function backUpNow() {
    setError(null);
    try {
      await api('/system/backups', { method: 'POST' });
      await status.refetch();
      toast({ title: 'Backup started' });
    } catch (err) {
      setError(err);
    }
  }

  async function download() {
    try {
      const { url } = await api<{ url: string }>('/system/backups/latest/download');
      window.location.assign(url);
    } catch (err) {
      toast({ title: 'Download failed', description: errorMessage(err), variant: 'error' });
    }
  }

  async function saveSchedule(e: FormEvent) {
    e.preventDefault();
    try {
      await api('/system/backups/schedule', { method: 'PUT', body: schedule });
      await status.refetch();
      toast({ title: 'Backup schedule saved', variant: 'success' });
    } catch (err) {
      setError(err);
    }
  }

  async function startRestore(file: File) {
    setConfirming(null);
    setError(null);
    try {
      await apiResponse('/system/restore', { method: 'POST', body: file });
      await restore.refetch();
    } catch (err) {
      setError(err);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Backups</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        {!s.configured && <p className="text-amber-700">Backups need BACKUP_PASSPHRASE in the server configuration (see docs/backups.md).</p>}
        <div>
          {s.latest ? (
            <p>
              Latest: <span className="font-mono">{s.latest.file}</span> · {formatBytes(s.latest.size)} · {new Date(s.latest.createdAt).toLocaleString()}
            </p>
          ) : (
            <p className="text-slate-500">No backup yet.</p>
          )}
          {s.lastError && (
            <p role="alert" className="text-red-600">
              Last backup failed {new Date(s.lastError.at).toLocaleString()}: {s.lastError.message}
            </p>
          )}
          {s.nextRunAt && <p className="text-slate-500">Next scheduled backup: {new Date(s.nextRunAt).toLocaleString()}</p>}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button disabled={!s.configured || s.running} onClick={() => void backUpNow()}>
            {s.running ? 'Backing up…' : 'Back up now'}
          </Button>
          <Button variant="outline" disabled={!s.latest} onClick={() => void download()}>
            Download latest
          </Button>
        </div>
        {schedule && (
          <form className="flex flex-wrap items-end gap-3" onSubmit={(e) => void saveSchedule(e)}>
            <label className="flex items-center gap-2 pb-2">
              <input type="checkbox" checked={schedule.enabled} onChange={(e) => setSchedule({ ...schedule, enabled: e.target.checked })} /> Daily backup
            </label>
            <div className="w-32">
              <Field label="At">{(id) => <Input id={id} type="time" value={schedule.time} onChange={(e) => setSchedule({ ...schedule, time: e.target.value })} />}</Field>
            </div>
            <div className="w-64">
              <Field label="Timezone">{(id) => <TimezoneSelect id={id} value={schedule.timezone} onChange={(tz) => setSchedule({ ...schedule, timezone: tz ?? 'UTC' })} />}</Field>
            </div>
            <Button type="submit" variant="outline">
              Save schedule
            </Button>
          </form>
        )}
        <div className="space-y-2 border-t border-slate-200 pt-4 dark:border-slate-800">
          <h3 className="font-medium">Restore</h3>
          <p className="text-slate-500">Replaces all data and files with the backup’s. The platform is unavailable while it runs.</p>
          <input
            ref={fileRef}
            type="file"
            accept=".pbk"
            aria-label="Backup file"
            disabled={restoring || !s.configured}
            onChange={(e) => setConfirming(e.target.files?.[0] ?? null)}
          />
          {confirming && (
            <div role="alertdialog" aria-label="Confirm restore" className="flex flex-wrap items-center gap-2 rounded-md border border-red-300 bg-red-50 p-3 dark:border-red-800 dark:bg-red-950">
              <span>
                Restore <span className="font-mono">{confirming.name}</span>? Everything since that backup is lost.
              </span>
              <Button variant="destructive" size="sm" onClick={() => void startRestore(confirming)}>
                Restore
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setConfirming(null);
                  if (fileRef.current) fileRef.current.value = '';
                }}
              >
                Cancel
              </Button>
            </div>
          )}
          {restore.data && restore.data.state !== 'idle' && (
            <p role="status" className={restore.data.state === 'failed' ? 'text-red-600' : restore.data.state === 'done' ? 'text-green-700' : ''}>
              <Badge variant={restore.data.state === 'failed' ? 'danger' : restore.data.state === 'done' ? 'success' : 'warning'}>{restore.data.state}</Badge> {restore.data.message}
            </p>
          )}
        </div>
        <ErrorText error={error} />
      </CardContent>
    </Card>
  );
}

/** Platform health: processes, load, queues, storage and backups. */
export function SystemPage() {
  const { hasPerm } = useAuth();
  const { data: s, error } = useQuery({ queryKey: ['system-status'], queryFn: () => api<SystemStatusDto>('/system/status'), refetchInterval: 10_000 });
  const fresh = (p: SystemStatusDto['processes'][number]) => Date.now() - p.lastSeen < 30_000;
  const runningRoles = new Set(s?.processes.map((p) => p.role));
  const missing = s && !runningRoles.has('all') ? s.expectedRoles.filter((r) => !runningRoles.has(r)) : [];

  return (
    <div className="space-y-6">
      <PageHeader title="System" description={s ? `Version ${s.version}` : undefined} />
      <ErrorText error={error} />
      {s && (
        <>
          {s.maintenance && <p className="rounded-md bg-amber-50 p-3 text-sm text-amber-900">Maintenance mode is on (a restore is running).</p>}
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Tile label="Messages / min" value={s.messagesPerMinute.toLocaleString()} />
            <Tile label="Devices online" value={s.connectedDevices.toLocaleString()} />
            <Tile label="Browser sessions" value={s.websocketClients.toLocaleString()} />
            <Tile label="Database" value={formatBytes(s.database.sizeBytes)} />
          </div>
          <Card>
            <CardHeader>
              <CardTitle>Processes</CardTitle>
            </CardHeader>
            <CardContent>
              {missing.length > 0 && (
                <p role="alert" className="mb-3 text-sm text-red-600">
                  Not running: {missing.join(', ')}
                </p>
              )}
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Role</TableHead>
                    <TableHead>Instance</TableHead>
                    <TableHead>Version</TableHead>
                    <TableHead>Up</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {s.processes.map((p) => (
                    <TableRow key={`${p.role}-${p.instance}`}>
                      <TableCell className="font-medium">{p.role}</TableCell>
                      <TableCell className="font-mono text-xs">{p.instance}</TableCell>
                      <TableCell>{p.version}</TableCell>
                      <TableCell>{uptime(p.startedAt)}</TableCell>
                      <TableCell>
                        <Badge variant={fresh(p) ? 'success' : 'danger'}>{fresh(p) ? 'healthy' : 'silent'}</Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
          <div className="grid gap-6 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>Queues</CardTitle>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Queue</TableHead>
                      <TableHead>Waiting</TableHead>
                      <TableHead>Active</TableHead>
                      <TableHead>Failed</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {Object.entries(s.queues).map(([name, q]) => (
                      <TableRow key={name}>
                        <TableCell>{name}</TableCell>
                        <TableCell>{q.waiting + q.delayed}</TableCell>
                        <TableCell>{q.active}</TableCell>
                        <TableCell className={q.failed ? 'text-red-600' : ''}>{q.failed}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>Storage</CardTitle>
              </CardHeader>
              <CardContent className="space-y-1 text-sm">
                <p>Driver: {s.storage.driver === 's3' ? 'S3' : 'Local disk'}</p>
                {s.storage.driver === 'local' && (
                  <p>
                    {formatBytes(s.storage.usedBytes)} used · {formatBytes(s.storage.freeBytes)} free
                  </p>
                )}
              </CardContent>
            </Card>
          </div>
        </>
      )}
      {hasPerm('backup.manage') && <BackupsCard />}
    </div>
  );
}
