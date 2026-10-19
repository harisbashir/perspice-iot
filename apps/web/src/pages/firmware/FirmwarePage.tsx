import type { DeviceProfileDto, FirmwareDto, OtaJobDto } from '@perspice/shared';
import { useQueryClient } from '@tanstack/react-query';
import { Upload } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { api } from '@/api/client';
import { useCustomers } from '@/api/hooks';
import { ErrorText } from '@/components/ErrorText';
import { PageHeader } from '@/components/PageHeader';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useProfiles } from '../devices/hooks';
import { FIRMWARE, OTA_JOBS, formatBytes, useFirmware, useOtaJobs } from './hooks';
import { OtaJobBadge } from './OtaStateBadge';

const selectClass = 'h-9 w-full rounded-lg border border-line-strong bg-surface px-2 text-sm';

export function FirmwarePage() {
  const { data: firmware, isLoading } = useFirmware();
  const { data: jobs = [] } = useOtaJobs();
  const { data: profiles = [] } = useProfiles();
  const qc = useQueryClient();
  const [uploading, setUploading] = useState(false);
  const [deploying, setDeploying] = useState<FirmwareDto | null>(null);
  const [error, setError] = useState<unknown>(null);
  const profileName = (id: string) => profiles.find((p) => p.id === id)?.name ?? '—';

  async function remove(f: FirmwareDto) {
    setError(null);
    try {
      await api(`/firmware/${f.id}`, { method: 'DELETE' });
      await qc.invalidateQueries({ queryKey: FIRMWARE });
    } catch (err) {
      setError(err);
    }
  }

  return (
    <div>
      <PageHeader
        title="Firmware"
        description="Images per device profile, and updates rolled out to devices in batches."
        actions={
          <Button onClick={() => setUploading(true)}>
            <Upload className="h-4 w-4" /> Upload firmware
          </Button>
        }
      />
      <ErrorText error={error} />
      {isLoading ? (
        <Skeleton className="h-40" />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Version</TableHead>
              <TableHead>Profile</TableHead>
              <TableHead>Size</TableHead>
              <TableHead>SHA-256</TableHead>
              <TableHead>Uploaded</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {(firmware ?? []).map((f) => (
              <TableRow key={f.id} data-testid={`firmware-${f.version}`}>
                <TableCell className="font-medium" title={f.notes || undefined}>
                  {f.version}
                </TableCell>
                <TableCell>{profileName(f.profileId)}</TableCell>
                <TableCell>{formatBytes(f.size)}</TableCell>
                <TableCell className="font-mono text-xs" title={f.sha256}>
                  {f.sha256.slice(0, 12)}…
                </TableCell>
                <TableCell>{new Date(f.createdAt).toLocaleDateString()}</TableCell>
                <TableCell className="text-right">
                  <div className="flex justify-end gap-2">
                    <Button size="sm" onClick={() => setDeploying(f)}>
                      Deploy
                    </Button>
                    <Button size="sm" variant="outline" aria-label={`Delete ${f.version}`} onClick={() => void remove(f)}>
                      Delete
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
            {firmware?.length === 0 && (
              <TableRow>
                <TableCell colSpan={6} className="py-8 text-center text-fg-muted">
                  No firmware yet.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      )}

      <h2 className="mb-2 mt-8 text-lg font-semibold">Updates</h2>
      <JobsTable jobs={jobs} profileName={profileName} />

      <UploadDialog open={uploading} onOpenChange={setUploading} profiles={profiles} />
      <DeployDialog firmware={deploying} onClose={() => setDeploying(null)} profileName={profileName} />
    </div>
  );
}

function JobsTable({ jobs, profileName }: { jobs: OtaJobDto[]; profileName: (id: string) => string }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Firmware</TableHead>
          <TableHead>Status</TableHead>
          <TableHead>Progress</TableHead>
          <TableHead>Started</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {jobs.map((j) => {
          const total = Object.values(j.counts).reduce((a, b) => a + b, 0);
          return (
            <TableRow key={j.id}>
              <TableCell>
                <Link to={`/ota-jobs/${j.id}`} className="font-medium text-primary-700 hover:underline dark:text-primary-300">
                  {profileName(j.firmware.profileId)} {j.firmware.version}
                </Link>
              </TableCell>
              <TableCell>
                <OtaJobBadge status={j.status} />
              </TableCell>
              <TableCell>
                {j.counts.applied} of {total} updated{j.counts.failed ? `, ${j.counts.failed} failed` : ''}
              </TableCell>
              <TableCell>{new Date(j.createdAt).toLocaleString()}</TableCell>
            </TableRow>
          );
        })}
        {jobs.length === 0 && (
          <TableRow>
            <TableCell colSpan={4} className="py-8 text-center text-fg-muted">
              No updates yet.
            </TableCell>
          </TableRow>
        )}
      </TableBody>
    </Table>
  );
}

function UploadDialog({ open, onOpenChange, profiles }: { open: boolean; onOpenChange: (o: boolean) => void; profiles: DeviceProfileDto[] }) {
  const qc = useQueryClient();
  const [profileId, setProfileId] = useState('');
  const [version, setVersion] = useState('');
  const [notes, setNotes] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      await api('/firmware', { body: file, query: { profileId, version, notes: notes || undefined } });
      await qc.invalidateQueries({ queryKey: FIRMWARE });
      onOpenChange(false);
      setVersion('');
      setNotes('');
      setFile(null);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Upload firmware</DialogTitle>
        </DialogHeader>
        <form className="space-y-4" onSubmit={submit}>
          <Field label="Profile">
            {(id) => (
              <select id={id} required className={selectClass} value={profileId} onChange={(e) => setProfileId(e.target.value)}>
                <option value="" disabled>
                  Choose a profile
                </option>
                {profiles.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            )}
          </Field>
          <Field label="Version" help="As the firmware reports it in its fw attribute, e.g. 1.2.0.">
            {(id, d) => <Input id={id} aria-describedby={d} required value={version} onChange={(e) => setVersion(e.target.value)} />}
          </Field>
          <Field label="Notes">{(id) => <Input id={id} value={notes} onChange={(e) => setNotes(e.target.value)} />}</Field>
          <Field label="Image (.bin)" help="Up to 16 MB.">
            {(id, d) => <input id={id} aria-describedby={d} type="file" accept=".bin,application/octet-stream" className="text-sm" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />}
          </Field>
          <ErrorText error={error} />
          <DialogFooter>
            <Button type="submit" disabled={busy || !file || !profileId}>
              {busy ? 'Uploading…' : 'Upload'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function DeployDialog({ firmware, onClose, profileName }: { firmware: FirmwareDto | null; onClose: () => void; profileName: (id: string) => string }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { data: customers = [] } = useCustomers(!!firmware);
  const [customerId, setCustomerId] = useState('');
  const [tags, setTags] = useState('');
  const [batchSize, setBatchSize] = useState(10);
  const [maxFailurePct, setMaxFailurePct] = useState(20);
  const [timeoutMin, setTimeoutMin] = useState(30);
  const [error, setError] = useState<unknown>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!firmware) return;
    setError(null);
    try {
      const job = await api<OtaJobDto>('/ota-jobs', {
        body: {
          firmwareId: firmware.id,
          target: { kind: 'profile', customerId: customerId || null, tags: tags.split(',').map((t) => t.trim()).filter(Boolean) },
          batchSize,
          maxFailurePct,
          timeoutMin,
        },
      });
      await qc.invalidateQueries({ queryKey: OTA_JOBS });
      onClose();
      void navigate(`/ota-jobs/${job.id}`);
    } catch (err) {
      setError(err);
    }
  }

  return (
    <Dialog open={!!firmware} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            Deploy {firmware && `${profileName(firmware.profileId)} ${firmware.version}`}
          </DialogTitle>
        </DialogHeader>
        <form className="space-y-4" onSubmit={submit}>
          <p className="text-sm text-fg-muted">Devices of this profile that are already on this version are skipped.</p>
          <Field label="Customer">
            {(id) => (
              <select id={id} className={selectClass} value={customerId} onChange={(e) => setCustomerId(e.target.value)}>
                <option value="">All customers</option>
                {customers.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            )}
          </Field>
          <Field label="Only devices with these tags" help="Comma separated; leave empty for all.">
            {(id, d) => <Input id={id} aria-describedby={d} value={tags} onChange={(e) => setTags(e.target.value)} />}
          </Field>
          <div className="grid grid-cols-3 gap-3">
            <Field label="Batch size">
              {(id) => <Input id={id} type="number" min={1} max={1000} value={batchSize} onChange={(e) => setBatchSize(Number(e.target.value))} />}
            </Field>
            <Field label="Halt above (% failed)">
              {(id) => <Input id={id} type="number" min={0} max={100} value={maxFailurePct} onChange={(e) => setMaxFailurePct(Number(e.target.value))} />}
            </Field>
            <Field label="Timeout (min)">
              {(id) => <Input id={id} type="number" min={5} max={1440} value={timeoutMin} onChange={(e) => setTimeoutMin(Number(e.target.value))} />}
            </Field>
          </div>
          <ErrorText error={error} />
          <DialogFooter>
            <Button type="submit">Start update</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
