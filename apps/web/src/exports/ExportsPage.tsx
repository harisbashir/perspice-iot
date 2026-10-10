import type { ExportJobDto } from '@perspice/shared';
import { useQuery } from '@tanstack/react-query';
import { Download } from 'lucide-react';
import { Link, useParams } from 'react-router';
import { api } from '@/api/client';
import { ErrorText } from '@/components/ErrorText';
import { PageHeader } from '@/components/PageHeader';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

const STATUS_LABEL: Record<ExportJobDto['status'], string> = {
  queued: 'Queued',
  running: 'Running',
  done: 'Ready',
  failed: 'Failed',
};

const pending = (j: ExportJobDto | undefined) => j?.status === 'queued' || j?.status === 'running';
const when = (ms: number) => new Date(ms).toLocaleString();

function StatusBadge({ job }: { job: ExportJobDto }) {
  const expired = job.status === 'done' && !job.downloadUrl;
  return (
    <Badge variant={job.status === 'failed' ? 'danger' : job.status === 'done' && !expired ? 'success' : 'secondary'}>
      {expired ? 'Expired' : STATUS_LABEL[job.status]}
    </Badge>
  );
}

/** One background export: polls until it finishes, then offers the download (owner only). */
export function ExportPage() {
  const { id } = useParams();
  const { data: job, error, isLoading } = useQuery({
    queryKey: ['exports', id],
    queryFn: () => api<ExportJobDto>(`/exports/${id}`),
    refetchInterval: (q) => (pending(q.state.data) ? 2000 : false),
  });
  if (isLoading) return <Skeleton className="h-40 w-full" />;
  if (error || !job) return <ErrorText error={error ?? new Error('Export not found')} />;
  return (
    <div className="max-w-2xl">
      <PageHeader title={job.title} description={`${job.format.toUpperCase()} export · requested ${when(job.createdAt)}`} />
      <Card>
        <CardContent className="space-y-4 p-6">
          <div className="flex items-center gap-3">
            <StatusBadge job={job} />
            {job.rowCount !== null && <span className="text-sm text-slate-600 dark:text-slate-400">{job.rowCount.toLocaleString()} rows</span>}
          </div>
          {pending(job) && <p className="text-sm">This export is large, so it is being prepared in the background. You'll get a notification and an email when it's ready.</p>}
          {job.status === 'failed' && <p className="text-sm text-red-600">{job.error}</p>}
          {job.downloadUrl && (
            <>
              <Button asChild>
                <a href={job.downloadUrl}>
                  <Download className="h-4 w-4" /> Download
                </a>
              </Button>
              {job.expiresAt && <p className="text-xs text-slate-500">Available until {when(job.expiresAt)}.</p>}
            </>
          )}
          {job.status === 'done' && !job.downloadUrl && <p className="text-sm">This export has expired. Run it again to get a fresh file.</p>}
        </CardContent>
      </Card>
      <p className="mt-4 text-sm">
        <Link className="underline" to="/exports">
          All my exports
        </Link>
      </p>
    </div>
  );
}

export function ExportsPage() {
  const { data = [], isLoading } = useQuery({
    queryKey: ['exports'],
    queryFn: () => api<ExportJobDto[]>('/exports'),
    refetchInterval: (q) => (q.state.data?.some(pending) ? 5000 : false),
  });
  return (
    <div>
      <PageHeader title="My exports" description="Large exports run in the background and are kept for 24 hours." />
      {isLoading ? (
        <Skeleton className="h-40 w-full" />
      ) : data.length === 0 ? (
        <p className="text-sm text-slate-500">No background exports yet. Smaller exports download straight away.</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Export</TableHead>
              <TableHead>Format</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Rows</TableHead>
              <TableHead>Requested</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.map((j) => (
              <TableRow key={j.id}>
                <TableCell>
                  <Link className="font-medium underline-offset-2 hover:underline" to={`/exports/${j.id}`}>
                    {j.title}
                  </Link>
                </TableCell>
                <TableCell>{j.format.toUpperCase()}</TableCell>
                <TableCell>
                  <StatusBadge job={j} />
                </TableCell>
                <TableCell>{j.rowCount?.toLocaleString() ?? '—'}</TableCell>
                <TableCell>{when(j.createdAt)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
