import type { DeviceDto } from '@perspice/shared';
import { Link } from 'react-router';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { StatusBadge } from './StatusBadge';
import { timeAgo } from './format';

export function DevicesTable({
  devices,
  profileName,
  selected,
  onSelect,
}: {
  devices: DeviceDto[];
  profileName: (id: string) => string;
  /** With these, rows can be selected for bulk actions. */
  selected?: ReadonlySet<string>;
  onSelect?: (ids: string[], on: boolean) => void;
}) {
  const selectable = !!selected && !!onSelect;
  const all = devices.length > 0 && devices.every((d) => selected?.has(d.id));
  return (
    <Table>
      <TableHeader>
        <TableRow>
          {selectable && (
            <TableHead className="w-8">
              <input type="checkbox" aria-label="Select all devices" checked={all} onChange={(e) => onSelect(devices.map((d) => d.id), e.target.checked)} />
            </TableHead>
          )}
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
            {selectable && (
              <TableCell>
                <input type="checkbox" aria-label={`Select ${d.name}`} checked={selected.has(d.id)} onChange={(e) => onSelect([d.id], e.target.checked)} />
              </TableCell>
            )}
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
            <TableCell colSpan={selectable ? 6 : 5} className="py-8 text-center text-slate-500">
              No devices.
            </TableCell>
          </TableRow>
        )}
      </TableBody>
    </Table>
  );
}
