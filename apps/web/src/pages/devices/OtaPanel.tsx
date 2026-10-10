import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useDeviceOta } from '../firmware/hooks';
import { OtaStateBadge } from '../firmware/OtaStateBadge';

/** The device's firmware updates, newest first. */
export function OtaPanel({ deviceId, firmwareVersion }: { deviceId: string; firmwareVersion: string | null }) {
  const { data: rows, isLoading } = useDeviceOta(deviceId);
  if (isLoading) return <Skeleton className="h-24" />;
  return (
    <div className="space-y-3">
      <p className="text-sm">
        Running firmware: <span className="font-medium">{firmwareVersion ?? 'not reported'}</span>
      </p>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Version</TableHead>
            <TableHead>State</TableHead>
            <TableHead>Error</TableHead>
            <TableHead>Last change</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {(rows ?? []).map((r) => (
            <TableRow key={r.jobId}>
              <TableCell className="font-medium">{r.version}</TableCell>
              <TableCell>
                <OtaStateBadge state={r.state} pct={r.pct} />
              </TableCell>
              <TableCell className="text-sm text-red-700 dark:text-red-300">{r.error}</TableCell>
              <TableCell>{new Date(r.updatedAt).toLocaleString()}</TableCell>
            </TableRow>
          ))}
          {rows?.length === 0 && (
            <TableRow>
              <TableCell colSpan={4} className="py-6 text-center text-slate-500">
                No firmware updates for this device.
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  );
}
