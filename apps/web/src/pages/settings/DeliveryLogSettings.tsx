import type { DeliveryDto, NotifyChannel } from '@perspice/shared';
import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '@/api/client';
import type { Page } from '@/api/types';
import { useAuth } from '@/auth/AuthProvider';
import { errorMessage } from '@/components/ErrorText';
import { selectClass } from '@/components/TimezoneSelect';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useToast } from '@/components/ui/toast';

const STATUS_VARIANT = { queued: 'secondary', sent: 'success', failed: 'warning', dead: 'danger', held: 'secondary' } as const;
const CHANNEL_LABEL: Record<NotifyChannel, string> = { inapp: 'In-app', email: 'Email', push: 'Push', webhook: 'Webhook' };

/** Every notification and webhook call, with retry for failed ones (dead letters). */
export function DeliveryLogSettings() {
  const { hasPerm } = useAuth();
  const toast = useToast();
  const qc = useQueryClient();
  const [status, setStatus] = useState('');
  const [channel, setChannel] = useState('');
  const list = useInfiniteQuery({
    queryKey: ['delivery-log', status, channel],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => api<Page<DeliveryDto>>('/delivery-log', { query: { status: status || undefined, channel: channel || undefined, cursor: pageParam, limit: 50 } }),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
  const rows = list.data?.pages.flatMap((p) => p.items) ?? [];

  async function retry(id: string) {
    try {
      await api(`/delivery-log/${id}/retry`, { method: 'POST' });
      await qc.invalidateQueries({ queryKey: ['delivery-log'] });
      toast({ title: 'Delivery queued again', variant: 'success' });
    } catch (err) {
      toast({ title: 'Retry failed', description: errorMessage(err), variant: 'error' });
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <select aria-label="Status" className={`${selectClass} w-44`} value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">All statuses</option>
          <option value="failed,dead">Failed</option>
          <option value="dead">Gave up</option>
          <option value="held">Held for a digest</option>
          <option value="sent">Sent</option>
        </select>
        <select aria-label="Channel" className={`${selectClass} w-40`} value={channel} onChange={(e) => setChannel(e.target.value)}>
          <option value="">All channels</option>
          {Object.entries(CHANNEL_LABEL).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>When</TableHead>
            <TableHead>Channel</TableHead>
            <TableHead>To</TableHead>
            <TableHead>Subject</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="w-20" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((d) => (
            <TableRow key={d.id}>
              <TableCell className="whitespace-nowrap">{new Date(d.createdAt).toLocaleString()}</TableCell>
              <TableCell>{CHANNEL_LABEL[d.channel]}</TableCell>
              <TableCell className="max-w-48 truncate">{d.recipient}</TableCell>
              <TableCell className="max-w-64 truncate">{d.subject}</TableCell>
              <TableCell>
                <Badge variant={STATUS_VARIANT[d.status]}>{d.status}</Badge>
                {d.error && <div className="mt-0.5 max-w-64 truncate text-xs text-fg-muted" title={d.error}>{d.error}</div>}
              </TableCell>
              <TableCell>
                {hasPerm('webhook.manage') && (d.status === 'failed' || d.status === 'dead') && (
                  <Button size="sm" variant="outline" onClick={() => void retry(d.id)}>
                    Retry
                  </Button>
                )}
              </TableCell>
            </TableRow>
          ))}
          {!list.isLoading && rows.length === 0 && (
            <TableRow>
              <TableCell colSpan={6} className="py-8 text-center text-fg-muted">
                Nothing here.
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
      {list.hasNextPage && (
        <Button variant="outline" onClick={() => void list.fetchNextPage()}>
          Load more
        </Button>
      )}
    </div>
  );
}
