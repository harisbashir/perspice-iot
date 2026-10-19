import { OTA_DEVICE_STATES } from '@perspice/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { api } from '@/api/client';
import { ErrorText } from '@/components/ErrorText';
import { PageHeader } from '@/components/PageHeader';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { NotFoundPage } from '../NotFoundPage';
import { useProfiles } from '../devices/hooks';
import { OTA_JOBS, useOtaJob, useOtaJobDevices } from './hooks';
import { OtaJobBadge, OtaStateBadge } from './OtaStateBadge';

export function OtaJobPage() {
  const { id = '' } = useParams();
  const qc = useQueryClient();
  const { data: job, isLoading, error } = useOtaJob(id);
  const { data: devices = [] } = useOtaJobDevices(id, job?.status);
  const { data: profiles = [] } = useProfiles();
  const [cancelError, setCancelError] = useState<unknown>(null);

  if (isLoading) return <Skeleton className="h-64" />;
  if (error || !job) return <NotFoundPage />;
  const total = Object.values(job.counts).reduce((a, b) => a + b, 0);
  const done = job.counts.applied + job.counts.failed + job.counts.skipped;
  const pct = total ? Math.round((done * 100) / total) : 100;
  const profile = profiles.find((p) => p.id === job.firmware.profileId)?.name ?? '';

  async function cancel() {
    setCancelError(null);
    try {
      await api(`/ota-jobs/${id}/cancel`, { method: 'POST' });
      await qc.invalidateQueries({ queryKey: OTA_JOBS });
    } catch (err) {
      setCancelError(err);
    }
  }

  return (
    <div>
      <PageHeader
        title={`Update to ${profile} ${job.firmware.version}`.replace(/\s+/g, ' ')}
        description={`Batches of ${job.batchSize}; halts above ${job.maxFailurePct}% failed; a device times out after ${job.timeoutMin} min.`}
        actions={
          (job.status === 'running' || job.status === 'halted') && (
            <Button variant="outline" onClick={() => void cancel()}>
              Cancel update
            </Button>
          )
        }
      />
      <ErrorText error={cancelError} />
      <div className="mb-4 flex flex-wrap items-center gap-3 text-sm">
        <OtaJobBadge status={job.status} />
        <Link to="/firmware" className="text-primary-700 hover:underline dark:text-primary-300">
          All firmware
        </Link>
      </div>
      {job.haltReason && (
        <p role="alert" className="mb-4 rounded-xl bg-warn-tint p-3 text-sm text-warn">
          Halted: {job.haltReason}
        </p>
      )}
      <div className="mb-2 h-2 w-full overflow-hidden rounded-full bg-fill-strong" role="progressbar" aria-label="Devices finished" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
        <div className="h-full bg-primary-600" style={{ width: `${pct}%` }} />
      </div>
      <dl className="mb-6 flex flex-wrap gap-x-6 gap-y-1 text-sm" data-testid="ota-counts">
        {OTA_DEVICE_STATES.filter((s) => job.counts[s]).map((s) => (
          <div key={s} className="flex gap-1">
            <dt className="text-fg-muted">{s}</dt>
            <dd className="font-medium">{job.counts[s]}</dd>
          </div>
        ))}
      </dl>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Device</TableHead>
            <TableHead>State</TableHead>
            <TableHead>Error</TableHead>
            <TableHead>Last change</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {devices.map((d) => (
            <TableRow key={d.deviceId} data-testid={`ota-device-${d.deviceId}`}>
              <TableCell>
                <Link to={`/devices/${d.deviceId}`} className="font-medium text-primary-700 hover:underline dark:text-primary-300">
                  {d.deviceName}
                </Link>
              </TableCell>
              <TableCell>
                <OtaStateBadge state={d.state} pct={d.pct} />
              </TableCell>
              <TableCell className="text-sm text-red-700 dark:text-red-300">{d.error}</TableCell>
              <TableCell>{new Date(d.updatedAt).toLocaleTimeString()}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
