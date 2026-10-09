import { useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { Link, useParams } from 'react-router';
import { api } from '@/api/client';
import { useAuth } from '@/auth/AuthProvider';
import { ErrorText } from '@/components/ErrorText';
import { PageHeader } from '@/components/PageHeader';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { NotFoundPage } from '@/pages/NotFoundPage';
import { AlarmsTable } from './AlarmsTable';
import { AlarmStatusText, SeverityBadge } from './badges';
import { acknowledge, clearAlarm, useAlarm, useAlarmFeed } from './hooks';

export function AlarmsPage() {
  const { hasPerm } = useAuth();
  return (
    <div>
      <PageHeader
        title="Alarms"
        actions={
          hasPerm('alarm.read') && (
            <Button asChild variant="outline">
              <Link to="/alarm-rules">Alarm rules</Link>
            </Button>
          )
        }
      />
      <AlarmsTable />
    </div>
  );
}

const EVENT_TEXT = { raised: 'Raised', acknowledged: 'Acknowledged', cleared: 'Cleared', comment: 'Comment', notified: 'Notified' } as const;

/** One alarm: what happened, its timeline, and acknowledge / clear / comment. */
export function AlarmDetailPage() {
  const { id = '' } = useParams();
  const { hasPerm } = useAuth();
  const qc = useQueryClient();
  const { data: a, isLoading, error } = useAlarm(id);
  const [comment, setComment] = useState('');
  const [actionError, setActionError] = useState<unknown>(null);
  useAlarmFeed();

  if (isLoading) return <Skeleton className="h-64" />;
  if (error || !a) return <NotFoundPage />;
  const canAck = hasPerm('alarm.ack');

  async function act(fn: () => Promise<unknown>) {
    setActionError(null);
    try {
      await fn();
      setComment('');
      await qc.invalidateQueries({ queryKey: ['alarms'] });
    } catch (err) {
      setActionError(err);
    }
  }

  const onComment = (e: FormEvent) => {
    e.preventDefault();
    void act(() => api(`/alarms/${a.id}/comments`, { body: { comment } }));
  };

  return (
    <div className="max-w-3xl space-y-4">
      <PageHeader title={a.ruleName} description={a.message} />
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <SeverityBadge severity={a.severity} />
        <AlarmStatusText status={a.status} />
        <span>
          on{' '}
          <Link className="font-medium hover:underline" to={`/devices/${a.device.id}`}>
            {a.device.name}
          </Link>
          {a.customer && <> ({a.customer.name})</>}
        </span>
        <span className="text-slate-500">since {new Date(a.startedAt).toLocaleString()}</span>
      </div>
      {canAck && a.status !== 'cleared' && (
        <div className="flex flex-wrap gap-2">
          {a.status === 'active' && <Button onClick={() => void act(() => acknowledge(a.id, comment || undefined))}>Acknowledge</Button>}
          <Button variant="outline" onClick={() => void act(() => clearAlarm(a.id, comment || undefined))}>
            Clear
          </Button>
        </div>
      )}
      <ErrorText error={actionError} />
      <Card>
        <CardHeader>
          <CardTitle>Timeline</CardTitle>
        </CardHeader>
        <CardContent>
          <ol className="space-y-3">
            {a.timeline.map((e) => (
              <li key={e.id} className="border-l-2 border-slate-200 pl-3 dark:border-slate-700">
                <div className="text-sm">
                  <span className="font-medium">{EVENT_TEXT[e.type]}</span>
                  {e.user && <> by {e.user.name}</>}
                  {e.type === 'cleared' && (e.data as { reason?: string } | null)?.reason === 'condition' && <> (condition recovered)</>}
                  <span className="ml-2 text-xs text-slate-500">{new Date(e.ts).toLocaleString()}</span>
                </div>
                {e.comment && <p className="mt-1 text-sm text-slate-700 dark:text-slate-300">{e.comment}</p>}
              </li>
            ))}
          </ol>
          {canAck && (
            <form className="mt-4 flex gap-2" onSubmit={onComment}>
              <Input aria-label="Comment" placeholder="Add a comment (also used for acknowledge and clear)" value={comment} onChange={(e) => setComment(e.target.value)} />
              <Button type="submit" variant="outline" disabled={!comment.trim()}>
                Comment
              </Button>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
