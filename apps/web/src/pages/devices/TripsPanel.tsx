import type { TripDto } from '@perspice/shared';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '@/api/client';
import { useAuth } from '@/auth/AuthProvider';
import { ErrorText } from '@/components/ErrorText';
import { selectClass } from '@/components/TimezoneSelect';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ExportMenu } from '@/exports/ExportMenu';

const DAY = 86_400_000;
const PERIODS = [
  [1, 'Last 24 hours'],
  [7, 'Last 7 days'],
  [30, 'Last 30 days'],
] as const;

const km = (m: number) => `${(m / 1000).toFixed(1)} km`;
const duration = (t: TripDto) => {
  const min = Math.round(((t.endTs ?? Date.now()) - t.startTs) / 60_000);
  return min >= 60 ? `${Math.floor(min / 60)} h ${min % 60} min` : `${min} min`;
};

/** The device's trips and distance per day over a period, with export. */
export function TripsPanel({ deviceId }: { deviceId: string }) {
  const { hasPerm } = useAuth();
  const [days, setDays] = useState<number>(7);
  // Fixed per period choice so the queries don't refetch on every render.
  const [to] = useState(() => Date.now());
  const from = to - days * DAY;
  // Refreshed every 30 s: a trip under way grows.
  const trips = useQuery({
    queryKey: ['trips', deviceId, days],
    queryFn: () => api<TripDto[]>(`/devices/${deviceId}/trips?from=${from}&to=${Date.now()}&limit=500`),
    refetchInterval: 30_000,
  });
  const distance = useQuery({
    queryKey: ['distance', deviceId, days],
    queryFn: () => api<{ timezone: string; days: { day: string; distanceM: number }[] }>(`/devices/${deviceId}/distance?from=${from}&to=${to}`),
  });
  const maxDay = Math.max(1, ...(distance.data?.days ?? []).map((d) => d.distanceM));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <select aria-label="Period" className={`${selectClass} w-44`} value={days} onChange={(e) => setDays(Number(e.target.value))}>
          {PERIODS.map(([d, label]) => (
            <option key={d} value={d}>
              {label}
            </option>
          ))}
        </select>
        {hasPerm('export.data') && <ExportMenu label="Export trips" request={(format) => ({ kind: 'trips', format, params: { deviceId, from, to } })} />}
      </div>

      {distance.data && distance.data.days.length > 0 && (
        <section aria-label="Distance per day" className="space-y-1 text-sm">
          <h3 className="font-medium">Distance per day <span className="font-normal text-fg-muted">({distance.data.timezone})</span></h3>
          {distance.data.days.map((d) => (
            <div key={d.day} className="flex items-center gap-2">
              <span className="w-24 tabular-nums text-fg-muted">{d.day}</span>
              <span className="h-3 rounded bg-blue-500" style={{ width: `${(d.distanceM / maxDay) * 60}%` }} />
              <span className="tabular-nums">{km(d.distanceM)}</span>
            </div>
          ))}
        </section>
      )}

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Start</TableHead>
            <TableHead>Duration</TableHead>
            <TableHead>Distance</TableHead>
            <TableHead>Max speed</TableHead>
            <TableHead>Average speed</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {(trips.data ?? []).map((t) => (
            <TableRow key={t.id}>
              <TableCell>{new Date(t.startTs).toLocaleString()}</TableCell>
              <TableCell>
                {duration(t)}
                {t.endTs === null && <span className="ml-1 text-xs text-blue-600">under way</span>}
              </TableCell>
              <TableCell className="tabular-nums">{km(t.distanceM)}</TableCell>
              <TableCell className="tabular-nums">{t.maxSpeedKmh === null ? '—' : `${Math.round(t.maxSpeedKmh)} km/h`}</TableCell>
              <TableCell className="tabular-nums">{t.avgSpeedKmh === null ? '—' : `${Math.round(t.avgSpeedKmh)} km/h`}</TableCell>
            </TableRow>
          ))}
          {trips.data?.length === 0 && (
            <TableRow>
              <TableCell colSpan={5} className="text-center text-fg-muted">
                No trips in this period.
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
      <ErrorText error={trips.error ?? distance.error} />
    </div>
  );
}
