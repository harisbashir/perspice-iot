import { WEBHOOK_EVENTS, type WebhookDto, type WebhookEvent } from '@perspice/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { api } from '@/api/client';
import { useAuth } from '@/auth/AuthProvider';
import { ErrorText, errorMessage } from '@/components/ErrorText';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useToast } from '@/components/ui/toast';

const EVENT_LABEL: Record<WebhookEvent, string> = {
  'alarm.raised': 'Alarm raised',
  'alarm.acknowledged': 'Alarm acknowledged',
  'alarm.cleared': 'Alarm cleared',
  'device.status_changed': 'Device online/offline',
};

/** Shown once, right after creating or rotating. */
function SecretDialog({ secret, onClose }: { secret: string; onClose: () => void }) {
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Signing secret</DialogTitle>
        </DialogHeader>
        <p className="text-sm">Copy it now: it won’t be shown again. Verify each call by comparing the <code>X-Perspice-Signature</code> header with an HMAC-SHA256 of <code>timestamp.body</code> using this secret.</p>
        <code data-testid="webhook-secret" className="block break-all rounded bg-slate-100 p-2 text-sm dark:bg-slate-800">
          {secret}
        </code>
        <DialogFooter>
          <Button onClick={onClose}>Done</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CreateDialog({ onClose, onCreated }: { onClose: () => void; onCreated: (w: WebhookDto) => void }) {
  const [name, setName] = useState('');
  const [url, setUrl] = useState('https://');
  const [events, setEvents] = useState<WebhookEvent[]>(['alarm.raised', 'alarm.cleared']);
  const [error, setError] = useState<unknown>(null);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      onCreated(await api<WebhookDto>('/webhooks', { body: { name, url, events } }));
    } catch (err) {
      setError(err);
    }
  }
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New webhook</DialogTitle>
        </DialogHeader>
        <form className="space-y-4" onSubmit={(e) => void submit(e)}>
          <Field label="Name">{(id) => <Input id={id} required value={name} onChange={(e) => setName(e.target.value)} />}</Field>
          <Field label="URL" help="HTTPS on the public internet.">{(id) => <Input id={id} required type="url" value={url} onChange={(e) => setUrl(e.target.value)} />}</Field>
          <fieldset className="space-y-1 text-sm">
            <legend className="text-sm font-medium">Events</legend>
            {WEBHOOK_EVENTS.map((ev) => (
              <label key={ev} className="flex items-center gap-2">
                <input type="checkbox" checked={events.includes(ev)} onChange={(e) => setEvents(e.target.checked ? [...events, ev] : events.filter((x) => x !== ev))} />
                {EVENT_LABEL[ev]}
              </label>
            ))}
          </fieldset>
          <ErrorText error={error} />
          <DialogFooter>
            <Button type="submit" disabled={!events.length}>
              Create webhook
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function PolicyCard() {
  const toast = useToast();
  const { data, refetch } = useQuery({ queryKey: ['webhook-policy'], queryFn: () => api<{ allowHttp: boolean; allowPrivate: boolean }>('/settings/webhooks') });
  if (!data) return null;
  async function set(patch: Partial<typeof data>) {
    await api('/settings/webhooks', { method: 'PUT', body: { ...data, ...patch } });
    await refetch();
    toast({ title: 'Webhook policy saved', variant: 'success' });
  }
  return (
    <Card>
      <CardHeader>
        <CardTitle>Destinations</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2 text-sm">
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={data.allowHttp} onChange={(e) => void set({ allowHttp: e.target.checked })} /> Allow plain HTTP URLs
        </label>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={data.allowPrivate} onChange={(e) => void set({ allowPrivate: e.target.checked })} /> Allow private and local network addresses
        </label>
        <p className="text-xs text-slate-500">Leave both off unless webhooks must reach systems on your own network.</p>
      </CardContent>
    </Card>
  );
}

export function WebhookSettings() {
  const { user, hasPerm } = useAuth();
  const toast = useToast();
  const qc = useQueryClient();
  const { data = [] } = useQuery({ queryKey: ['webhooks'], queryFn: () => api<WebhookDto[]>('/webhooks') });
  const [creating, setCreating] = useState(false);
  const [secret, setSecret] = useState<string | null>(null);
  const refresh = () => qc.invalidateQueries({ queryKey: ['webhooks'] });

  async function act(fn: () => Promise<unknown>, done: string) {
    try {
      await fn();
      await refresh();
      toast({ title: done, variant: 'success' });
    } catch (err) {
      toast({ title: 'Something went wrong', description: errorMessage(err), variant: 'error' });
    }
  }

  async function test(w: WebhookDto) {
    const r = await api<{ ok: boolean; status: number | null; error: string | null }>(`/webhooks/${w.id}/test`, { method: 'POST' });
    toast(r.ok ? { title: `Test sent: HTTP ${r.status}`, variant: 'success' } : { title: 'Test failed', description: r.error ?? '', variant: 'error' });
  }

  return (
    <div className="max-w-4xl space-y-6">
      <div className="flex items-center justify-between">
        <p className="text-sm text-slate-500">
          {user?.scopeType === 'platform' ? 'Platform webhooks receive events from every customer.' : 'Webhooks receive your organisation’s events.'}
        </p>
        <Button onClick={() => setCreating(true)}>New webhook</Button>
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead>URL</TableHead>
            <TableHead>Events</TableHead>
            <TableHead className="w-80" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {data.map((w) => (
            <TableRow key={w.id}>
              <TableCell className="font-medium">
                {w.name} {!w.enabled && <Badge variant="secondary">off</Badge>}
              </TableCell>
              <TableCell className="max-w-56 truncate font-mono text-xs">{w.url}</TableCell>
              <TableCell className="text-xs">{w.events.map((e) => EVENT_LABEL[e]).join(', ')}</TableCell>
              <TableCell className="space-x-1 text-right">
                <Button size="sm" variant="outline" onClick={() => void test(w)}>
                  Send test
                </Button>
                <Button size="sm" variant="ghost" onClick={() => void act(() => api(`/webhooks/${w.id}`, { method: 'PUT', body: { name: w.name, url: w.url, events: w.events, enabled: !w.enabled } }), w.enabled ? 'Webhook paused' : 'Webhook resumed')}>
                  {w.enabled ? 'Pause' : 'Resume'}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => void act(async () => setSecret((await api<WebhookDto>(`/webhooks/${w.id}/rotate-secret`, { method: 'POST' })).secret ?? null), 'Secret rotated')}>
                  Rotate secret
                </Button>
                <Button size="sm" variant="ghost" aria-label={`Delete ${w.name}`} onClick={() => void act(() => api(`/webhooks/${w.id}`, { method: 'DELETE' }), 'Webhook deleted')}>
                  Delete
                </Button>
              </TableCell>
            </TableRow>
          ))}
          {data.length === 0 && (
            <TableRow>
              <TableCell colSpan={4} className="py-8 text-center text-slate-500">
                No webhooks yet.
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
      {hasPerm('system.settings') && <PolicyCard />}
      {creating && (
        <CreateDialog
          onClose={() => setCreating(false)}
          onCreated={(w) => {
            setCreating(false);
            setSecret(w.secret ?? null);
            void refresh();
          }}
        />
      )}
      {secret && <SecretDialog secret={secret} onClose={() => setSecret(null)} />}
    </div>
  );
}
