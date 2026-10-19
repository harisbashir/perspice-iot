import { ALARM_SEVERITIES, type AlarmFilter, type AlarmSeverity, type AlarmStatus } from '@perspice/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router';
import { useAuth } from '@/auth/AuthProvider';
import { errorMessage } from '@/components/ErrorText';
import { selectClass } from '@/components/TimezoneSelect';
import { Button } from '@/components/ui/button';
import { ListRow, ListRows } from '@/components/ListRows';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { GRID_QUERY, useMediaQuery } from '@/lib/useMediaQuery';
import { cn } from '@/lib/utils';
import { useToast } from '@/components/ui/toast';
import { ExportMenu } from '@/exports/ExportMenu';
import { timeAgo } from '@/pages/devices/format';
import { AlarmStatusText, SeverityBadge } from './badges';
import { acknowledge, clearAlarm, useAlarmFeed, useAlarms } from './hooks';

const STATUS_FILTERS: { id: string; label: string; status?: AlarmStatus[] }[] = [
  { id: 'open', label: 'Open', status: ['active', 'acknowledged'] },
  { id: 'active', label: 'Unacknowledged', status: ['active'] },
  { id: 'cleared', label: 'Cleared', status: ['cleared'] },
  { id: 'all', label: 'All' },
];

/** Alarm list with status/severity filters, live updates, and (with alarm.ack) acknowledge/clear. */
export function AlarmsTable({ base = {}, showDevice = true }: { base?: AlarmFilter; showDevice?: boolean }) {
  const { user, hasPerm } = useAuth();
  const toast = useToast();
  const qc = useQueryClient();
  const [statusId, setStatusId] = useState('open');
  const [severity, setSeverity] = useState<AlarmSeverity | ''>('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const filter: AlarmFilter = { ...base, status: STATUS_FILTERS.find((s) => s.id === statusId)!.status, severity: severity ? [severity] : undefined };
  const list = useAlarms(filter);
  useAlarmFeed();
  const rows = list.data?.pages.flatMap((p) => p.items) ?? [];
  const canAck = hasPerm('alarm.ack');
  const platform = user?.scopeType === 'platform';

  async function run(ids: string[], fn: (id: string) => Promise<unknown>, done: string) {
    const failed: string[] = [];
    for (const id of ids) await fn(id).catch((err: unknown) => failed.push(errorMessage(err)));
    setSelected(new Set());
    await qc.invalidateQueries({ queryKey: ['alarms'] });
    toast(failed.length ? { title: `${ids.length - failed.length} of ${ids.length} done`, description: failed[0], variant: 'error' } : { title: done, variant: 'success' });
  }

  const ackable = rows.filter((a) => selected.has(a.id) && a.status === 'active').map((a) => a.id);
  const wide = useMediaQuery(GRID_QUERY);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div role="tablist" aria-label="Alarm status" className="scroll-row h-9 w-full items-center gap-0.5 rounded-[10px] bg-fill p-0.5 sm:w-auto touch:h-10">
          {STATUS_FILTERS.map((s) => (
            <button
              key={s.id}
              type="button"
              role="tab"
              aria-selected={statusId === s.id}
              className={cn(
                'h-full flex-1 whitespace-nowrap rounded-lg px-3 text-[13px] font-medium sm:flex-none',
                statusId === s.id ? 'bg-surface text-fg shadow-sm dark:bg-fill-strong' : 'text-fg-muted hover:text-fg',
              )}
              onClick={() => setStatusId(s.id)}
            >
              {s.label}
            </button>
          ))}
        </div>
        <select aria-label="Severity" className={`${selectClass} w-auto min-w-[9rem] flex-1 sm:flex-none`} value={severity} onChange={(e) => setSeverity(e.target.value as AlarmSeverity | '')}>
          <option value="">All severities</option>
          {ALARM_SEVERITIES.map((s) => (
            <option key={s} value={s}>
              {s[0]!.toUpperCase() + s.slice(1)}
            </option>
          ))}
        </select>
        <div className="flex-1" />
        {canAck && ackable.length > 0 && (
          <Button size="sm" onClick={() => void run(ackable, (id) => acknowledge(id), `Acknowledged ${ackable.length}`)}>
            Acknowledge {ackable.length} selected
          </Button>
        )}
        <ExportMenu request={(format) => ({ kind: 'alarms', format, params: filter })} />
      </div>
      {!wide ? (
        <ListRows empty="No alarms here.">
          {rows.map((a) => (
            <ListRow
              key={a.id}
              to={`/alarms/${a.id}`}
              leading={<SeverityBadge severity={a.severity} className="self-start" />}
              title={a.ruleName}
              subtitle={`${showDevice ? `${a.device.name} · ` : ''}${timeAgo(a.startedAt)}`}
              trailing={<AlarmStatusText status={a.status} />}
              footer={
                canAck &&
                a.status !== 'cleared' && (
                  <>
                    {a.status === 'active' && (
                      <Button size="sm" variant="outline" onClick={() => void run([a.id], (id) => acknowledge(id), 'Alarm acknowledged')}>
                        Acknowledge
                      </Button>
                    )}
                    <Button size="sm" variant="ghost" onClick={() => void run([a.id], (id) => clearAlarm(id), 'Alarm cleared')}>
                      Clear
                    </Button>
                  </>
                )
              }
            />
          ))}
        </ListRows>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              {canAck && <TableHead className="w-8" />}
              <TableHead>Severity</TableHead>
              <TableHead>Alarm</TableHead>
              {showDevice && <TableHead>Device</TableHead>}
              {showDevice && platform && <TableHead>Customer</TableHead>}
              <TableHead>Started</TableHead>
              <TableHead>Status</TableHead>
              {canAck && <TableHead className="w-40" />}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((a) => (
              <TableRow key={a.id}>
                {canAck && (
                  <TableCell>
                    <input
                      type="checkbox"
                      aria-label={`Select ${a.ruleName} on ${a.device.name}`}
                      checked={selected.has(a.id)}
                      onChange={(e) => {
                        const next = new Set(selected);
                        if (e.target.checked) next.add(a.id);
                        else next.delete(a.id);
                        setSelected(next);
                      }}
                    />
                  </TableCell>
                )}
                <TableCell>
                  <SeverityBadge severity={a.severity} />
                </TableCell>
                <TableCell>
                  <Link to={`/alarms/${a.id}`} className="font-medium text-primary-700 hover:underline dark:text-primary-300">
                    {a.ruleName}
                  </Link>
                  <div className="text-xs text-fg-muted">{a.message}</div>
                </TableCell>
                {showDevice && (
                  <TableCell>
                    <Link to={`/devices/${a.device.id}`} className="hover:underline">
                      {a.device.name}
                    </Link>
                  </TableCell>
                )}
                {showDevice && platform && <TableCell>{a.customer?.name ?? '—'}</TableCell>}
                <TableCell title={new Date(a.startedAt).toLocaleString()}>{timeAgo(a.startedAt)}</TableCell>
                <TableCell>
                  <AlarmStatusText status={a.status} />
                </TableCell>
                {canAck && (
                  <TableCell className="space-x-1 text-right">
                    {a.status === 'active' && (
                      <Button size="sm" variant="outline" onClick={() => void run([a.id], (id) => acknowledge(id), 'Alarm acknowledged')}>
                        Acknowledge
                      </Button>
                    )}
                    {a.status !== 'cleared' && (
                      <Button size="sm" variant="ghost" onClick={() => void run([a.id], (id) => clearAlarm(id), 'Alarm cleared')}>
                        Clear
                      </Button>
                    )}
                  </TableCell>
                )}
              </TableRow>
            ))}
            {!list.isLoading && rows.length === 0 && (
              <TableRow>
                <TableCell colSpan={8} className="py-8 text-center text-fg-muted">
                  No alarms here.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      )}
      {list.hasNextPage && (
        <Button variant="outline" onClick={() => void list.fetchNextPage()}>
          Load more
        </Button>
      )}
    </div>
  );
}
