import type { DeviceDto } from '@perspice/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '@/api/client';
import { useAuth } from '@/auth/AuthProvider';
import { ErrorText } from '@/components/ErrorText';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { deviceKey } from '@/realtime/hooks';

function JsonEditor({ deviceId, kind, value, canEdit }: { deviceId: string; kind: 'server' | 'shared'; value: Record<string, unknown>; canEdit: boolean }) {
  const qc = useQueryClient();
  const [text, setText] = useState(JSON.stringify(value, null, 2));
  const [error, setError] = useState<unknown>(null);
  async function save() {
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      return setError(new Error('Not valid JSON'));
    }
    try {
      const d = await api<DeviceDto>(`/devices/${deviceId}/attributes/${kind}`, { method: 'PUT', body: parsed });
      qc.setQueryData(deviceKey(deviceId), d);
      setError(null);
    } catch (e) {
      setError(e);
    }
  }
  return (
    <div className="space-y-2">
      <textarea
        aria-label={`${kind} attributes`}
        rows={8}
        readOnly={!canEdit}
        className="w-full rounded-md border border-slate-300 bg-transparent p-2 font-mono text-xs dark:border-slate-700"
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
      {error instanceof Error && !('code' in error) ? <p className="text-sm text-red-600">{error.message}</p> : <ErrorText error={error} />}
      {canEdit && <Button onClick={() => void save()}>Save</Button>}
    </div>
  );
}

export function AttributesPanel({ device }: { device: DeviceDto }) {
  const { hasPerm } = useAuth();
  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Client</CardTitle>
          <CardDescription>Reported by the device (firmware, serial…).</CardDescription>
        </CardHeader>
        <CardContent>
          <pre className="overflow-x-auto rounded bg-slate-100 p-2 text-xs dark:bg-slate-800">{JSON.stringify(device.attributes.client, null, 2)}</pre>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Server</CardTitle>
          <CardDescription>Notes kept on the platform; not sent to the device.</CardDescription>
        </CardHeader>
        <CardContent>
          <JsonEditor deviceId={device.id} kind="server" value={device.attributes.server} canEdit={hasPerm('device.write')} />
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Shared</CardTitle>
          <CardDescription>Configuration pushed to the device.</CardDescription>
        </CardHeader>
        <CardContent>
          <JsonEditor deviceId={device.id} kind="shared" value={device.attributes.shared} canEdit={hasPerm('device.write')} />
        </CardContent>
      </Card>
    </div>
  );
}
