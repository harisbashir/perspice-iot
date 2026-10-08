import type { DeviceDto } from '@perspice/shared';
import { Link } from 'react-router';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { StatusBadge } from './StatusBadge';
import { timeAgo } from './format';

export function DevicesTable({ devices, profileName }: { devices: DeviceDto[]; profileName: (id: string) => string }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Name</TableHead>
          <TableHead>Status</TableHead>
          <TableHead>Profile</TableHead>
          <TableHead>Last seen</TableHead>
          <TableHead>Tags</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {devices.map((d) => (
          <TableRow key={d.id} data-testid={`device-row-${d.id}`}>
            <TableCell>
              <Link to={`/devices/${d.id}`} className="font-medium text-primary-700 hover:underline dark:text-primary-300">
                {d.name}
              </Link>
            </TableCell>
            <TableCell>
              <StatusBadge status={d.status} />
            </TableCell>
            <TableCell>{profileName(d.profileId)}</TableCell>
            <TableCell title={d.lastSeen ? new Date(d.lastSeen).toLocaleString() : undefined}>{timeAgo(d.lastSeen)}</TableCell>
            <TableCell className="text-xs text-slate-500">{d.tags.join(', ')}</TableCell>
          </TableRow>
        ))}
        {devices.length === 0 && (
          <TableRow>
            <TableCell colSpan={5} className="py-8 text-center text-slate-500">
              No devices.
            </TableCell>
          </TableRow>
        )}
      </TableBody>
    </Table>
  );
}
