import type { CommandDef } from '@perspice/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { api } from '@/api/client';
import { useAuth } from '@/auth/AuthProvider';
import { ErrorText } from '@/components/ErrorText';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useSocketEvent } from '@/realtime/socket';

export interface CommandDto {
  id: string;
  name: string;
  params: Record<string, unknown>;
  status: 'queued' | 'sent' | 'success' | 'failed' | 'timeout';
  result: unknown;
  createdAt: number;
  completedAt: number | null;
}

const STATUS_VARIANT = { queued: 'secondary', sent: 'default', success: 'success', failed: 'danger', timeout: 'warning' } as const;

interface SchemaProp {
  type?: string;
  enum?: unknown[];
  title?: string;
  minimum?: number;
  maximum?: number;
}

/** Renders a flat JSON-schema object as inputs (string, number, integer, boolean, enum). */
function ParamsForm({ schema, value, onChange }: { schema?: Record<string, unknown>; value: Record<string, unknown>; onChange: (v: Record<string, unknown>) => void }) {
  const props = (schema?.properties ?? {}) as Record<string, SchemaProp>;
  const required = new Set((schema?.required as string[] | undefined) ?? []);
  return (
    <>
      {Object.entries(props).map(([name, p]) => (
        <Field key={name} label={`${p.title ?? name}${required.has(name) ? '' : ' (optional)'}`}>
          {(id) =>
            p.enum ? (
              <select id={id} className="h-9 w-full rounded-lg border border-line-strong bg-surface px-2 text-sm" value={String(value[name] ?? '')} onChange={(e) => onChange({ ...value, [name]: e.target.value })}>
                <option value="" />
                {p.enum.map((o) => (
                  <option key={String(o)} value={String(o)}>
                    {String(o)}
                  </option>
                ))}
              </select>
            ) : p.type === 'boolean' ? (
              <input id={id} type="checkbox" checked={!!value[name]} onChange={(e) => onChange({ ...value, [name]: e.target.checked })} />
            ) : (
              <Input
                id={id}
                type={p.type === 'number' || p.type === 'integer' ? 'number' : 'text'}
                min={p.minimum}
                max={p.maximum}
                required={required.has(name)}
                value={String(value[name] ?? '')}
                onChange={(e) =>
                  onChange({ ...value, [name]: p.type === 'number' || p.type === 'integer' ? (e.target.value === '' ? undefined : Number(e.target.value)) : e.target.value })
                }
              />
            )
          }
        </Field>
      ))}
    </>
  );
}

function CommandCard({ deviceId, deviceName, def }: { deviceId: string; deviceName: string; def: CommandDef }) {
  const qc = useQueryClient();
  const [params, setParams] = useState<Record<string, unknown>>({});
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<unknown>(null);

  async function send() {
    setConfirming(false);
    setError(null);
    try {
      await api(`/devices/${deviceId}/commands`, { body: { name: def.name, params } });
      await qc.invalidateQueries({ queryKey: ['commands', deviceId] });
    } catch (e) {
      setError(e);
    }
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    if (def.confirm) setConfirming(true);
    else void send();
  }

  return (
    <Card role="group" aria-label={def.label}>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">{def.label}</CardTitle>
      </CardHeader>
      <CardContent>
        <form className="space-y-3" onSubmit={submit}>
          <ParamsForm schema={def.paramsSchema} value={params} onChange={setParams} />
          <ErrorText error={error} />
          <Button type="submit">Send</Button>
        </form>
      </CardContent>
      <Dialog open={confirming} onOpenChange={setConfirming}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{def.label}?</DialogTitle>
            <DialogDescription>
              This sends “{def.label}” to {deviceName}.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirming(false)}>
              Cancel
            </Button>
            <Button onClick={() => void send()}>Confirm</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

export function CommandsPanel({ deviceId, deviceName, commands }: { deviceId: string; deviceName: string; commands: CommandDef[] }) {
  const { hasPerm } = useAuth();
  const qc = useQueryClient();
  const { data: history = [] } = useQuery({
    queryKey: ['commands', deviceId],
    queryFn: () => api<CommandDto[]>(`/devices/${deviceId}/commands`, { query: { limit: 20 } }),
  });
  useSocketEvent<{ deviceId: string; command: CommandDto }>('command', (e) => {
    if (e.deviceId !== deviceId) return;
    qc.setQueryData<CommandDto[]>(['commands', deviceId], (rows = []) =>
      rows.some((r) => r.id === e.command.id) ? rows.map((r) => (r.id === e.command.id ? e.command : r)) : [e.command, ...rows],
    );
  });

  return (
    <div className="space-y-6">
      {hasPerm('device.command') && commands.length > 0 && (
        <div className="grid gap-4 md:grid-cols-2">
          {commands.map((c) => (
            <CommandCard key={c.name} deviceId={deviceId} deviceName={deviceName} def={c} />
          ))}
        </div>
      )}
      {commands.length === 0 && <p className="text-sm text-fg-muted">This device's profile declares no commands.</p>}
      <div>
        <h3 className="mb-2 text-sm font-semibold">Recent commands</h3>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Sent</TableHead>
              <TableHead>Command</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Result</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {history.map((c) => (
              <TableRow key={c.id}>
                <TableCell className="whitespace-nowrap text-xs">{new Date(c.createdAt).toLocaleString()}</TableCell>
                <TableCell className="font-mono text-xs">{c.name}</TableCell>
                <TableCell>
                  <Badge variant={STATUS_VARIANT[c.status]}>{c.status}</Badge>
                </TableCell>
                <TableCell className="max-w-xs truncate font-mono text-xs">{c.result ? JSON.stringify(c.result) : ''}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
