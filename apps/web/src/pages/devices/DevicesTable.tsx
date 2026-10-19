import type { DeviceDto } from '@perspice/shared';
import { Link } from 'react-router';
import { ListRow, ListRows } from '@/components/ListRows';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { GRID_QUERY, useMediaQuery } from '@/lib/useMediaQuery';
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
  const wide = useMediaQuery(GRID_QUERY);
  const selectable = !!selected && !!onSelect;
  const all = devices.length > 0 && devices.every((d) => selected?.has(d.id));
  // Phones get a list: name, status and when it was last heard from (bulk selection needs the table).
  if (!wide) {
    return (
      <ListRows empty="No devices.">
        {devices.map((d) => (
          <ListRow
            key={d.id}
            to={`/devices/${d.id}`}
            title={d.name}
            subtitle={`${profileName(d.profileId)} · ${timeAgo(d.lastSeen)}`}
            trailing={<StatusBadge status={d.status} />}
          />
        ))}
      </ListRows>
    );
  }
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
            <TableCell className="text-xs text-fg-muted">{d.tags.join(', ')}</TableCell>
          </TableRow>
        ))}
        {devices.length === 0 && (
          <TableRow>
            <TableCell colSpan={selectable ? 6 : 5} className="py-8 text-center text-fg-muted">
              No devices.
            </TableCell>
          </TableRow>
        )}
      </TableBody>
    </Table>
  );
}
